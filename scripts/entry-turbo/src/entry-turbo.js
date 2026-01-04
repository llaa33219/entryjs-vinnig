/**
 * Entry Turbo - 고성능 EntryJS 런타임
 * 
 * Entry 블록을 JavaScript로 JIT 컴파일하여 고속 실행합니다.
 * Entry.block 스키마를 활용하여 올바른 파라미터 추출을 보장합니다.
 * 
 * @version 2.0.0
 * @license MIT
 */

(function(global) {
    'use strict';

    // ============================================================
    // TurboCompiler - Entry 블록을 JavaScript로 JIT 컴파일
    // ============================================================
    
    const TurboCompiler = {
        cache: new Map(),
        debug: false,

        /**
         * 스레드(블록 배열)를 컴파일된 제너레이터 함수로 변환
         */
        compileThread(blocks, objectId) {
            const cacheKey = JSON.stringify(blocks) + objectId;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            try {
                const bodyCode = this.compileBlocks(blocks);
                const code = `
                    return async function* turboThread(entity, runtime) {
                        const vars = runtime.variables;
                        const lists = runtime.lists;
                        try {
                            ${bodyCode}
                        } catch (e) {
                            console.error('[TurboCompiler] Runtime error:', e);
                        }
                    };
                `;

                if (this.debug) {
                    console.log('[TurboCompiler] Generated code:\n', code);
                }

                const fn = new Function(code)();
                this.cache.set(cacheKey, fn);
                return fn;
            } catch (e) {
                console.error('[TurboCompiler] Compilation error:', e);
                return this.createFallbackThread(blocks);
            }
        },

        /**
         * 블록 배열을 JavaScript 코드로 컴파일
         */
        compileBlocks(blocks) {
            if (!blocks || !Array.isArray(blocks)) return '';
            return blocks.map(block => this.compileBlock(block)).filter(Boolean).join('\n');
        },

        /**
         * 단일 블록을 JavaScript 코드로 컴파일
         */
        compileBlock(block) {
            if (!block || typeof block !== 'object' || Array.isArray(block)) return '';
            
            const { type } = block;
            if (!type) return '';

            // Entry.block 스키마 가져오기
            const schema = typeof Entry !== 'undefined' ? Entry.block?.[type] : null;

            // 컴파일러가 지원하는 블록인지 확인
            let compiler = this.blockCompilers[type];
            
            // 동적 함수 블록 컴파일러 확인 (func_XXXX)
            if (!compiler && type.startsWith('func_')) {
                compiler = this.getFunctionCompiler(type);
            }
            
            // 동적 파라미터 블록 확인 (stringParam_*, booleanParam_*)
            if (!compiler && (type.startsWith('stringParam_') || type.startsWith('booleanParam_'))) {
                return `runtime.getFunctionParam(entity, '${type}')`;
            }
            
            if (compiler) {
                try {
                    return compiler.call(this, block, schema);
                } catch (e) {
                    if (this.debug) console.warn(`[TurboCompiler] Failed to compile ${type}:`, e);
                }
            }

            // 지원하지 않는 블록 → 건너뛰기
            return this.compileFallback(block, type);
        },

        /**
         * Entry.block 스키마를 사용하여 파라미터 값 추출 코드 생성
         */
        getParam(block, paramName, schema) {
            if (!schema?.paramsKeyMap) {
                // 스키마 없으면 인덱스로 직접 접근 시도
                const idx = typeof paramName === 'number' ? paramName : 0;
                return this.compileParamValue(block.params?.[idx]);
            }

            const index = schema.paramsKeyMap[paramName];
            if (index === undefined) return '0';

            return this.compileParamValue(block.params?.[index]);
        },

        /**
         * 파라미터 값을 JavaScript 표현식으로 컴파일
         */
        compileParamValue(param) {
            if (param === null || param === undefined) return '0';
            if (typeof param === 'number') return String(param);
            if (typeof param === 'string') return JSON.stringify(param);
            if (typeof param === 'boolean') return String(param);

            // 중첩 블록인 경우
            if (typeof param === 'object' && param.type) {
                // 동적 파라미터 블록 확인
                if (param.type.startsWith('stringParam_') || param.type.startsWith('booleanParam_')) {
                    return `runtime.getFunctionParam(entity, '${param.type}')`;
                }
                return this.compileExpression(param);
            }

            return '0';
        },

        /**
         * 값을 반환하는 블록(표현식)을 컴파일
         */
        compileExpression(block) {
            if (!block || !block.type) return '0';

            const { type } = block;
            const schema = typeof Entry !== 'undefined' ? Entry.block?.[type] : null;

            // 기본 값 블록들
            if (type === 'number' || type === 'text' || type === 'angle') {
                const val = block.params?.[0];
                if (val === null || val === undefined) return '0';
                if (typeof val === 'number') return String(val);
                return JSON.stringify(String(val));
            }

            // 동적 파라미터 블록 확인
            if (type.startsWith('stringParam_') || type.startsWith('booleanParam_')) {
                return `runtime.getFunctionParam(entity, '${type}')`;
            }
            
            // 동적 함수 값 블록 확인 (func_XXXX 값 반환형)
            if (type.startsWith('func_')) {
                const funcId = type.replace('func_', '');
                const params = (block.params || []).filter(p => p && typeof p === 'object' && p.type);
                const compiledParams = params.map(p => this.compileExpression(p)).join(', ');
                return `(yield* runtime.callFunctionValue('${funcId}', entity, [${compiledParams}]))`;
            }

            // 표현식 컴파일러 확인
            const exprCompiler = this.expressionCompilers[type];
            if (exprCompiler) {
                try {
                    return exprCompiler.call(this, block, schema);
                } catch (e) {
                    if (this.debug) console.warn(`[TurboCompiler] Failed to compile expression ${type}:`, e);
                }
            }

            // 폴백: 0 반환
            console.warn('[TurboCompiler] Unknown expression:', type);
            return '0';
        },

        /**
         * statements 컴파일 (if/반복문 내부)
         */
        compileStatements(block, statementName, schema) {
            if (!schema?.statementsKeyMap) {
                const idx = typeof statementName === 'number' ? statementName : 0;
                const statements = block.statements?.[idx];
                return statements ? this.compileBlocks(statements) : '';
            }

            const index = schema.statementsKeyMap[statementName];
            if (index === undefined) return '';

            const statements = block.statements?.[index];
            return statements ? this.compileBlocks(statements) : '';
        },

        /**
         * 지원하지 않는 블록 → 건너뛰기 (경고만 출력)
         */
        compileFallback(block, type) {
            // 함수 블록 등 복잡한 블록은 현재 지원하지 않음
            return `console.warn('[TurboCompiler] Unsupported block skipped:', '${type}');`;
        },

        /**
         * 폴백 스레드 생성 (컴파일 실패 시)
         */
        createFallbackThread(blocks) {
            return async function*(entity, runtime) {
                for (const block of blocks) {
                    yield* runtime.executeEntryBlock(block, entity);
                }
            };
        },

        // ============================================================
        // 블록 컴파일러 정의
        // ============================================================

        blockCompilers: {
            // === 시작 블록들 (이벤트 트리거) ===
            'when_run_button_click': () => '// start event',
            'when_some_key_pressed': () => '// key event',
            'when_object_click': () => '// click event',
            'when_object_click_canceled': () => '// click cancel event',
            'when_message_cast': () => '// message event',
            'when_clone_start': () => '// clone start',
            'when_scene_start': () => '// scene start',

            // === 흐름 제어 ===
            'wait_second': function(block, schema) {
                const sec = this.getParam(block, 'SECOND', schema);
                return `yield { type: 'wait', duration: (${sec}) * 1000 };`;
            },

            'repeat_basic': function(block, schema) {
                const count = this.getParam(block, 'VALUE', schema);
                const body = this.compileStatements(block, 'DO', schema);
                return `
                    for (let _i = 0, _max = Math.floor(${count}); _i < _max; _i++) {
                        ${body}
                        yield { type: 'tick' };
                    }
                `;
            },

            'repeat_inf': function(block, schema) {
                const body = this.compileStatements(block, 'DO', schema);
                return `
                    while (true) {
                        ${body}
                        yield { type: 'tick' };
                    }
                `;
            },

            'repeat_while_true': function(block, schema) {
                const condition = this.getParam(block, 'BOOL', schema);
                const body = this.compileStatements(block, 'DO', schema);
                return `
                    while (${condition}) {
                        ${body}
                        yield { type: 'tick' };
                    }
                `;
            },

            '_if': function(block, schema) {
                const condition = this.getParam(block, 'BOOL', schema);
                const body = this.compileStatements(block, 'DO', schema);
                return `if (${condition}) { ${body} }`;
            },

            'if_else': function(block, schema) {
                const condition = this.getParam(block, 'BOOL', schema);
                const ifBody = this.compileStatements(block, 'DO', schema);
                const elseBody = this.compileStatements(block, 'ELSE', schema);
                return `if (${condition}) { ${ifBody} } else { ${elseBody} }`;
            },

            'stop_repeat': () => 'break;',
            'stop_object': () => 'return;',
            'restart_project': () => 'runtime.restartProject();',
            'stop_all': () => 'runtime.stopAll();',

            // === 움직임 ===
            'move_direction': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `entity.setX(entity.getX() + (${value}) * Math.cos((entity.getDirection() - 90) * Math.PI / 180));
                        entity.setY(entity.getY() + (${value}) * Math.sin((entity.getDirection() - 90) * Math.PI / 180));`;
            },

            'move_x': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `entity.setX(entity.getX() + (${value}));`;
            },

            'move_y': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `entity.setY(entity.getY() + (${value}));`;
            },

            'locate_x': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `entity.setX(${value});`;
            },

            'locate_y': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `entity.setY(${value});`;
            },

            'locate_xy': function(block, schema) {
                const x = this.getParam(block, 'VALUE1', schema);
                const y = this.getParam(block, 'VALUE2', schema);
                return `entity.setX(${x}); entity.setY(${y});`;
            },

            'locate_xy_time': function(block, schema) {
                const sec = this.getParam(block, 'VALUE1', schema);
                const x = this.getParam(block, 'VALUE2', schema);
                const y = this.getParam(block, 'VALUE3', schema);
                return `yield* runtime.glide(entity, ${x}, ${y}, ${sec});`;
            },

            'rotate_by_angle': function(block, schema) {
                const angle = this.getParam(block, 'VALUE', schema);
                return `entity.setRotation(entity.getRotation() + (${angle}));`;
            },

            'direction_relative': function(block, schema) {
                const angle = this.getParam(block, 'VALUE', schema);
                return `entity.setDirection(entity.getDirection() + (${angle}));`;
            },

            'rotate_absolute': function(block, schema) {
                const angle = this.getParam(block, 'VALUE', schema);
                return `entity.setRotation(${angle});`;
            },

            'direction_absolute': function(block, schema) {
                const angle = this.getParam(block, 'VALUE', schema);
                return `entity.setDirection(${angle});`;
            },

            'see_angle_object': function(block, schema) {
                const targetId = this.getParam(block, 'VALUE', schema);
                return `runtime.lookAt(entity, ${targetId});`;
            },

            'move_to_angle': function(block, schema) {
                const angle = this.getParam(block, 'VALUE1', schema);
                const dist = this.getParam(block, 'VALUE2', schema);
                return `entity.setX(entity.getX() + (${dist}) * Math.cos(((${angle}) - 90) * Math.PI / 180));
                        entity.setY(entity.getY() + (${dist}) * Math.sin(((${angle}) - 90) * Math.PI / 180));`;
            },

            'locate': function(block, schema) {
                const targetId = this.getParam(block, 'VALUE', schema);
                return `runtime.locateTo(entity, ${targetId});`;
            },

            'bounce_wall': () => `runtime.bounceWall(entity);`,

            // === 형태 ===
            'show': () => 'entity.setVisible(true);',
            'hide': () => 'entity.setVisible(false);',

            'dialog': function(block, schema) {
                const text = this.getParam(block, 'VALUE', schema);
                const type = block.params?.[1] || 'speak';
                return `runtime.showDialog(entity, ${text}, '${type}');`;
            },

            'dialog_time': function(block, schema) {
                const text = this.getParam(block, 'VALUE', schema);
                const sec = this.getParam(block, 'SECOND', schema);
                const type = block.params?.[2] || 'speak';
                return `runtime.showDialog(entity, ${text}, '${type}'); yield { type: 'wait', duration: (${sec}) * 1000 }; runtime.removeDialog(entity);`;
            },

            'remove_dialog': () => 'runtime.removeDialog(entity);',

            'change_to_some_shape': function(block, schema) {
                const picture = this.getParam(block, 'VALUE', schema);
                return `runtime.setCostume(entity, ${picture});`;
            },

            'change_to_next_shape': function(block, schema) {
                const dir = block.params?.[0];
                return dir === 'prev' ? 'entity.prevPicture();' : 'entity.nextPicture();';
            },

            'set_effect_amount': function(block, schema) {
                const effect = block.params?.[0];
                const value = this.getParam(block, 'VALUE', schema);
                return `entity.setEffect('${effect}', ${value});`;
            },

            'change_effect_amount': function(block, schema) {
                const effect = block.params?.[0];
                const value = this.getParam(block, 'VALUE', schema);
                return `entity.setEffect('${effect}', entity.getEffect('${effect}') + (${value}));`;
            },

            'erase_all_effects': () => 'entity.resetFilter();',

            'change_scale_size': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `entity.setSize(entity.getSize() + (${value}));`;
            },

            'set_scale_size': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `entity.setSize(${value});`;
            },

            // === 소리 ===
            'sound_something': function(block, schema) {
                const sound = this.getParam(block, 'VALUE', schema);
                return `runtime.playSound(entity, ${sound});`;
            },

            'sound_something_wait': function(block, schema) {
                const sound = this.getParam(block, 'VALUE', schema);
                return `yield* runtime.playSoundWait(entity, ${sound});`;
            },

            'sound_volume_set': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `runtime.setVolume(${value});`;
            },

            'sound_volume_change': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `runtime.changeVolume(${value});`;
            },

            'sound_silent_all': () => 'runtime.stopAllSounds();',

            // === 변수 ===
            'set_variable': function(block, schema) {
                const varId = block.params?.[0];
                const value = this.getParam(block, 'VALUE', schema);
                return `runtime.setVariable('${varId}', ${value});`;
            },

            'change_variable': function(block, schema) {
                const varId = block.params?.[0];
                const value = this.getParam(block, 'VALUE', schema);
                return `runtime.changeVariable('${varId}', ${value});`;
            },

            'show_variable': function(block) {
                const varId = block.params?.[0];
                return `runtime.showVariable('${varId}');`;
            },

            'hide_variable': function(block) {
                const varId = block.params?.[0];
                return `runtime.hideVariable('${varId}');`;
            },

            // === 리스트 ===
            'add_value_to_list': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                const listId = block.params?.[1];
                return `runtime.addToList('${listId}', ${value});`;
            },

            'remove_value_from_list': function(block, schema) {
                const index = this.getParam(block, 'VALUE', schema);
                const listId = block.params?.[1];
                return `runtime.removeFromList('${listId}', ${index});`;
            },

            // === 신호 ===
            'message_cast': function(block) {
                const msgId = block.params?.[0];
                return `runtime.broadcast('${msgId}');`;
            },

            'message_cast_wait': function(block) {
                const msgId = block.params?.[0];
                return `yield* runtime.broadcastWait('${msgId}');`;
            },

            // === 복제 ===
            'create_clone': function(block) {
                const targetId = block.params?.[0];
                return `runtime.createClone(entity, '${targetId}');`;
            },

            'delete_clone': () => `if (entity.isClone) { runtime.removeClone(entity); return; }`,

            // === 붓 ===
            'start_drawing': () => 'runtime.startDrawing(entity);',
            'stop_drawing': () => 'runtime.stopDrawing(entity);',
            
            'set_color': function(block, schema) {
                const color = this.getParam(block, 'VALUE', schema);
                return `runtime.setBrushColor(entity, ${color});`;
            },

            'set_thickness': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `runtime.setBrushThickness(entity, ${value});`;
            },
            
            'change_thickness': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `runtime.changeBrushThickness(entity, ${value});`;
            },
            
            'set_brush_tranparency': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `runtime.setBrushTransparency(entity, ${value});`;
            },
            
            'change_brush_transparency': function(block, schema) {
                const value = this.getParam(block, 'VALUE', schema);
                return `runtime.changeBrushTransparency(entity, ${value});`;
            },
            
            'set_random_color': () => 'runtime.setRandomBrushColor(entity);',

            'brush_erase_all': () => 'runtime.clearBrush(entity);',
            'brush_stamp': () => 'runtime.stamp(entity);',
            
            // === 타이머 ===
            'choose_project_timer_action': function(block, schema) {
                const action = block.params?.[0];
                return `runtime.timerAction('${action}');`;
            },
            
            'set_visible_project_timer': function(block, schema) {
                const visible = block.params?.[0];
                return `runtime.setTimerVisible('${visible}');`;
            },

            // === 묻고 답하기 ===
            'ask_and_wait': function(block, schema) {
                const question = this.getParam(block, 'VALUE', schema);
                return `yield* runtime.askAndWait(entity, ${question});`;
            },
        },

        /**
         * 함수 블록 동적 컴파일러 등록
         * func_XXXX 형태의 사용자 정의 함수 블록 처리
         */
        getFunctionCompiler(type) {
            // func_ 로 시작하는 블록은 함수 호출
            if (!type.startsWith('func_')) return null;
            
            return function(block, schema) {
                const funcId = type.replace('func_', '');
                // 함수 블록의 파라미터들을 컴파일
                const params = (block.params || []).filter(p => p && typeof p === 'object' && p.type);
                const compiledParams = params.map(p => this.compileExpression(p)).join(', ');
                
                return `yield* runtime.callFunction('${funcId}', entity, [${compiledParams}]);`;
            };
        },

        // ============================================================
        // 표현식(값 블록) 컴파일러
        // ============================================================

        expressionCompilers: {
            // 기본 값
            'number': (block) => block.params?.[0] ?? 0,
            'text': (block) => JSON.stringify(block.params?.[0] ?? ''),
            'angle': (block) => block.params?.[0] ?? 0,
            'True': () => 'true',
            'False': () => 'false',

            // 변수/리스트
            'get_variable': function(block) {
                const varId = block.params?.[0];
                return `runtime.getVariable('${varId}')`;
            },

            'value_of_index_from_list': function(block, schema) {
                const listId = block.params?.[1];
                const index = this.getParam(block, 'VALUE', schema);
                return `runtime.getListItem('${listId}', ${index})`;
            },

            'length_of_list': function(block) {
                const listId = block.params?.[1];
                return `runtime.getListLength('${listId}')`;
            },

            // 계산
            'calc_basic': function(block, schema) {
                const left = this.compileParamValue(block.params?.[0]);
                const op = block.params?.[1];
                const right = this.compileParamValue(block.params?.[2]);
                const ops = { 'PLUS': '+', 'MINUS': '-', 'MULTI': '*', 'DIVIDE': '/' };
                return `((${left}) ${ops[op] || '+'} (${right}))`;
            },

            'calc_rand': function(block, schema) {
                const min = this.compileParamValue(block.params?.[1]);
                const max = this.compileParamValue(block.params?.[3]);
                return `runtime.random(${min}, ${max})`;
            },

            'calc_operation': function(block, schema) {
                const value = this.compileParamValue(block.params?.[1]);
                const op = block.params?.[3];
                const ops = {
                    'sin': `Math.sin((${value}) * Math.PI / 180)`,
                    'cos': `Math.cos((${value}) * Math.PI / 180)`,
                    'tan': `Math.tan((${value}) * Math.PI / 180)`,
                    'asin_radian': `(Math.asin(${value}) * 180 / Math.PI)`,
                    'acos_radian': `(Math.acos(${value}) * 180 / Math.PI)`,
                    'atan_radian': `(Math.atan(${value}) * 180 / Math.PI)`,
                    'square': `((${value}) * (${value}))`,
                    'root': `Math.sqrt(${value})`,
                    'abs': `Math.abs(${value})`,
                    'round': `Math.round(${value})`,
                    'floor': `Math.floor(${value})`,
                    'ceil': `Math.ceil(${value})`,
                    'ln': `Math.log(${value})`,
                    'log': `(Math.log(${value}) / Math.LN10)`,
                };
                return ops[op] || `Math.round(${value})`;
            },

            'quotient_and_mod': function(block, schema) {
                const left = this.compileParamValue(block.params?.[1]);
                const right = this.compileParamValue(block.params?.[3]);
                const op = block.params?.[5];
                return op === 'MOD' 
                    ? `((${left}) % (${right}))`
                    : `Math.floor((${left}) / (${right}))`;
            },

            // 판단
            'boolean_basic_operator': function(block, schema) {
                const left = this.compileParamValue(block.params?.[0]);
                const op = block.params?.[1];
                const right = this.compileParamValue(block.params?.[2]);
                const ops = { 
                    'EQUAL': '==', 'NOT_EQUAL': '!=', 
                    'GREATER': '>', 'LESS': '<',
                    'GREATER_OR_EQUAL': '>=', 'LESS_OR_EQUAL': '<='
                };
                return `((${left}) ${ops[op] || '=='} (${right}))`;
            },

            'boolean_and_or': function(block, schema) {
                const left = this.compileParamValue(block.params?.[0]);
                const op = block.params?.[1];
                const right = this.compileParamValue(block.params?.[2]);
                return `((${left}) ${op === 'OR' ? '||' : '&&'} (${right}))`;
            },

            'boolean_not': function(block, schema) {
                const value = this.compileParamValue(block.params?.[1]);
                return `(!(${value}))`;
            },

            // 좌표/속성
            'coordinate_mouse': function(block) {
                const coord = block.params?.[1];
                return coord === 'x' ? 'runtime.mouseX' : 'runtime.mouseY';
            },

            'coordinate_object': function(block, schema) {
                const targetId = this.compileParamValue(block.params?.[1]);
                const coord = block.params?.[3];
                return `runtime.getObjectCoord(${targetId}, '${coord}')`;
            },

            'is_press_some_key': function(block, schema) {
                const keyCode = this.compileParamValue(block.params?.[1]);
                return `runtime.isKeyPressed(${keyCode})`;
            },

            'is_clicked': () => 'runtime.isMouseDown',

            'reach_something': function(block, schema) {
                const targetId = this.compileParamValue(block.params?.[1]);
                return `runtime.isTouching(entity, ${targetId})`;
            },

            // 문자열
            'length_of_string': function(block, schema) {
                const str = this.compileParamValue(block.params?.[1]);
                return `String(${str}).length`;
            },

            'combine_something': function(block, schema) {
                const str1 = this.compileParamValue(block.params?.[1]);
                const str2 = this.compileParamValue(block.params?.[3]);
                return `(String(${str1}) + String(${str2}))`;
            },

            'char_at': function(block, schema) {
                const str = this.compileParamValue(block.params?.[1]);
                const index = this.compileParamValue(block.params?.[3]);
                return `String(${str}).charAt((${index}) - 1)`;
            },

            // 타이머
            'get_project_timer_value': () => 'runtime.getTimer()',
            'get_canvas_input_value': () => 'runtime.getAnswer()',
        },

        clearCache() {
            this.cache.clear();
        }
    };

    // ============================================================
    // TurboRuntime - 컴파일된 코드 실행 런타임
    // ============================================================

    class TurboRuntime {
        constructor() {
            this.entities = new Map();
            this.executors = [];
            this.variables = {};
            this.lists = {};
            this.clones = [];
            
            this.mouseX = 0;
            this.mouseY = 0;
            this.isMouseDown = false;
            this.pressedKeys = new Set();
            this.answer = '';
            
            this.timerStart = 0;
            this.running = false;
        }

        // === 변수/리스트 ===
        getVariable(id) {
            if (typeof Entry !== 'undefined' && Entry.variableContainer) {
                const v = Entry.variableContainer.getVariable(id);
                return v ? v.getValue() : 0;
            }
            return this.variables[id] ?? 0;
        }

        setVariable(id, value) {
            if (typeof Entry !== 'undefined' && Entry.variableContainer) {
                const v = Entry.variableContainer.getVariable(id);
                if (v) v.setValue(value);
            }
            this.variables[id] = value;
        }

        changeVariable(id, delta) {
            this.setVariable(id, (Number(this.getVariable(id)) || 0) + Number(delta));
        }

        getListItem(id, index) {
            if (typeof Entry !== 'undefined' && Entry.variableContainer) {
                const list = Entry.variableContainer.getList(id);
                if (list) return list.getValueByIndex(index - 1) ?? 0;
            }
            return (this.lists[id] || [])[index - 1] ?? 0;
        }

        getListLength(id) {
            if (typeof Entry !== 'undefined' && Entry.variableContainer) {
                const list = Entry.variableContainer.getList(id);
                if (list) return list.length();
            }
            return (this.lists[id] || []).length;
        }

        addToList(id, value) {
            if (typeof Entry !== 'undefined' && Entry.variableContainer) {
                const list = Entry.variableContainer.getList(id);
                if (list) list.appendValue(value);
            }
            if (!this.lists[id]) this.lists[id] = [];
            this.lists[id].push(value);
        }

        removeFromList(id, index) {
            if (typeof Entry !== 'undefined' && Entry.variableContainer) {
                const list = Entry.variableContainer.getList(id);
                if (list) list.deleteValueByIndex(index - 1);
            }
            if (this.lists[id]) this.lists[id].splice(index - 1, 1);
        }

        showVariable(id) {
            if (typeof Entry !== 'undefined' && Entry.variableContainer) {
                const v = Entry.variableContainer.getVariable(id);
                if (v) v.setVisible(true);
            }
        }

        hideVariable(id) {
            if (typeof Entry !== 'undefined' && Entry.variableContainer) {
                const v = Entry.variableContainer.getVariable(id);
                if (v) v.setVisible(false);
            }
        }

        // === 유틸리티 ===
        random(min, max) {
            min = Number(min); max = Number(max);
            if (min > max) [min, max] = [max, min];
            if (Number.isInteger(min) && Number.isInteger(max)) {
                return Math.floor(Math.random() * (max - min + 1)) + min;
            }
            return Math.random() * (max - min) + min;
        }

        isKeyPressed(keyCode) {
            return this.pressedKeys.has(Number(keyCode));
        }

        getTimer() {
            return (performance.now() - this.timerStart) / 1000;
        }

        getAnswer() {
            if (typeof Entry !== 'undefined' && Entry.container) {
                return Entry.container.getInputValue() ?? '';
            }
            return this.answer;
        }

        // === 움직임/형태 ===
        locateTo(entity, targetId) {
            if (targetId === 'mouse') {
                entity.setX(this.mouseX);
                entity.setY(this.mouseY);
            } else {
                const target = this.findEntity(targetId);
                if (target) {
                    entity.setX(target.getX());
                    entity.setY(target.getY());
                }
            }
        }

        lookAt(entity, targetId) {
            let tx, ty;
            if (targetId === 'mouse') {
                tx = this.mouseX; ty = this.mouseY;
            } else {
                const target = this.findEntity(targetId);
                if (!target) return;
                tx = target.getX(); ty = target.getY();
            }
            const dx = tx - entity.getX();
            const dy = ty - entity.getY();
            entity.setDirection(Math.atan2(dy, dx) * 180 / Math.PI + 90);
        }

        *glide(entity, x, y, duration) {
            const startX = entity.getX(), startY = entity.getY();
            const startTime = performance.now();
            const endTime = startTime + duration * 1000;
            
            while (performance.now() < endTime) {
                const progress = (performance.now() - startTime) / (duration * 1000);
                entity.setX(startX + (x - startX) * progress);
                entity.setY(startY + (y - startY) * progress);
                yield { type: 'tick' };
            }
            entity.setX(x); entity.setY(y);
        }

        bounceWall(entity) {
            const x = entity.getX(), y = entity.getY();
            const dir = entity.getDirection();
            
            if (x > 240 || x < -240) entity.setDirection(180 - dir);
            if (y > 180 || y < -180) entity.setDirection(-dir);
            
            entity.setX(Math.max(-240, Math.min(240, x)));
            entity.setY(Math.max(-180, Math.min(180, y)));
        }

        getObjectCoord(targetId, coord) {
            const target = this.findEntity(targetId);
            if (!target) return 0;
            switch(coord) {
                case 'x': return target.getX();
                case 'y': return target.getY();
                case 'rotation': return target.getRotation();
                case 'direction': return target.getDirection();
                case 'size': return target.getSize();
            }
            return 0;
        }

        isTouching(entity, targetId) {
            if (typeof Entry !== 'undefined') {
                // Entry 원본 충돌 감지 사용
                const object = entity.parent;
                if (object?.script) {
                    return Entry.Utils.isTouching(entity, targetId);
                }
            }
            return false;
        }

        // === 대화 ===
        showDialog(entity, text, type) {
            if (entity.dialog) entity.dialog.remove();
            entity.dialog = new Entry.Dialog(entity, String(text), type);
        }

        removeDialog(entity) {
            if (entity.dialog) {
                entity.dialog.remove();
                entity.dialog = null;
            }
        }

        // === 소리 ===
        playSound(entity, soundId) {
            if (typeof Entry === 'undefined') return;
            const object = entity.parent;
            const sound = object?.getSound(soundId);
            if (sound) createjs.Sound.play(sound.id);
        }

        *playSoundWait(entity, soundId) {
            this.playSound(entity, soundId);
            const object = entity.parent;
            const sound = object?.getSound(soundId);
            if (sound?.duration) {
                yield { type: 'wait', duration: sound.duration * 1000 };
            }
        }

        setVolume(value) {
            if (typeof createjs !== 'undefined') {
                createjs.Sound.setVolume(Math.max(0, Math.min(100, value)) / 100);
            }
        }

        changeVolume(delta) {
            if (typeof createjs !== 'undefined') {
                const current = createjs.Sound.getVolume() * 100;
                this.setVolume(current + delta);
            }
        }

        stopAllSounds() {
            if (typeof createjs !== 'undefined') {
                createjs.Sound.stop();
            }
        }

        // === 복제 ===
        createClone(entity, targetId) {
            if (typeof Entry === 'undefined') return;
            const object = targetId === 'self' ? entity.parent : Entry.container.getObject(targetId);
            if (object) object.addCloneEntity(object, entity);
        }

        removeClone(entity) {
            if (entity.isClone && entity.removeClone) {
                entity.removeClone();
            }
        }

        // === 신호 ===
        broadcast(messageId) {
            if (typeof Entry !== 'undefined' && Entry.engine) {
                Entry.engine.raiseMessage(messageId);
            }
        }

        *broadcastWait(messageId) {
            this.broadcast(messageId);
            yield { type: 'tick' };
            // 메시지 수신 실행자가 끝날 때까지 대기
            while (this.hasActiveMessageHandlers(messageId)) {
                yield { type: 'tick' };
            }
        }

        hasActiveMessageHandlers(messageId) {
            // 간단한 구현 - 한 프레임 대기
            return false;
        }

        // === 묻고 답하기 ===
        *askAndWait(entity, question) {
            if (typeof Entry === 'undefined') return;
            Entry.container.showProjectAnswer();
            this.showDialog(entity, question, 'speak');
            Entry.stage.showInputField();
            
            yield { type: 'waitInput' };
            
            this.removeDialog(entity);
        }

        // === 붓 (Entry API 사용) ===
        startDrawing(entity) {
            if (typeof Entry === 'undefined') return;
            
            if (entity.brush) {
                entity.brush.stop = false;
            } else {
                Entry.setBasicBrush(entity);
            }
            entity.brush.moveTo(entity.getX(), entity.getY() * -1);
        }
        
        stopDrawing(entity) {
            if (entity.brush) {
                entity.brush.stop = true;
            }
        }
        
        setBrushColor(entity, color) {
            if (typeof Entry === 'undefined') return;
            
            if (!entity.brush || !entity.shapes?.length) {
                Entry.setBasicBrush(entity);
                entity.brush.stop = true;
            }
            
            if (entity.brush) {
                const rgb = Entry.hex2rgb(color);
                entity.brush.rgb = rgb;
                entity.brush.endStroke();
                entity.brush.beginStroke(
                    `rgba(${rgb.r},${rgb.g},${rgb.b},${1 - entity.brush.opacity / 100})`
                );
                entity.brush.moveTo(entity.getX(), entity.getY() * -1);
            }
        }

        setBrushThickness(entity, value) {
            if (typeof Entry === 'undefined') return;
            
            if (!entity.brush || !entity.shapes?.length) {
                Entry.setBasicBrush(entity);
                entity.brush.stop = true;
            }
            
            if (entity.brush) {
                entity.brush.thickness = value;
                entity.brush.setStrokeStyle(value);
                entity.brush.moveTo(entity.getX(), entity.getY() * -1);
            }
        }
        
        changeBrushThickness(entity, value) {
            if (typeof Entry === 'undefined') return;
            
            if (!entity.brush || !entity.shapes?.length) {
                Entry.setBasicBrush(entity);
                entity.brush.stop = true;
            }
            
            if (entity.brush) {
                entity.brush.thickness = Math.max(1, (entity.brush.thickness || 1) + value);
                entity.brush.setStrokeStyle(entity.brush.thickness);
                entity.brush.moveTo(entity.getX(), entity.getY() * -1);
            }
        }
        
        setBrushTransparency(entity, value) {
            if (typeof Entry === 'undefined') return;
            
            if (!entity.brush || !entity.shapes?.length) {
                Entry.setBasicBrush(entity);
                entity.brush.stop = true;
            }
            
            if (entity.brush) {
                const opacity = Entry.adjustValueWithMaxMin(value, 0, 100);
                entity.brush.opacity = opacity;
                entity.brush.endStroke();
                const rgb = entity.brush.rgb;
                entity.brush.beginStroke(
                    `rgba(${rgb.r},${rgb.g},${rgb.b},${1 - opacity / 100})`
                );
                entity.brush.moveTo(entity.getX(), entity.getY() * -1);
            }
        }
        
        changeBrushTransparency(entity, value) {
            if (typeof Entry === 'undefined') return;
            
            if (!entity.brush || !entity.shapes?.length) {
                Entry.setBasicBrush(entity);
                entity.brush.stop = true;
            }
            
            if (entity.brush) {
                const newOpacity = Entry.adjustValueWithMaxMin(
                    (entity.brush.opacity || 0) + value, 0, 100
                );
                entity.brush.opacity = newOpacity;
                entity.brush.endStroke();
                const rgb = entity.brush.rgb;
                entity.brush.beginStroke(
                    `rgba(${rgb.r},${rgb.g},${rgb.b},${1 - newOpacity / 100})`
                );
                entity.brush.moveTo(entity.getX(), entity.getY() * -1);
            }
        }
        
        setRandomBrushColor(entity) {
            if (typeof Entry === 'undefined') return;
            
            if (!entity.brush || !entity.shapes?.length) {
                Entry.setBasicBrush(entity);
                entity.brush.stop = true;
            }
            
            if (entity.brush) {
                const rgb = Entry.generateRgb();
                entity.brush.rgb = rgb;
                entity.brush.endStroke();
                entity.brush.beginStroke(
                    `rgba(${rgb.r},${rgb.g},${rgb.b},${1 - entity.brush.opacity / 100})`
                );
                entity.brush.moveTo(entity.getX(), entity.getY() * -1);
            }
        }

        clearBrush(entity) {
            if (typeof Entry === 'undefined') return;
            entity.eraseBrush?.();
            entity.erasePaint?.();
            entity.removeStamps?.();
        }

        stamp(entity) {
            entity.addStamp?.();
        }
        
        // === 타이머 ===
        timerAction(action) {
            if (typeof Entry === 'undefined') return;
            
            if (action === 'start') {
                Entry.engine.toggleProjectTimer();
            } else if (action === 'stop') {
                Entry.engine.toggleProjectTimer(false);
            } else if (action === 'reset') {
                Entry.engine.resetProjectTimer();
            }
        }
        
        setTimerVisible(visible) {
            if (typeof Entry === 'undefined') return;
            
            const timer = Entry.variableContainer?.getTimerView?.();
            if (timer) {
                timer.style.display = (visible === 'show') ? 'block' : 'none';
            }
        }

        // === 프로젝트 제어 ===
        stopAll() {
            if (typeof Entry !== 'undefined' && Entry.engine) {
                Entry.engine.toggleStop();
            }
        }

        restartProject() {
            if (typeof Entry !== 'undefined' && Entry.engine) {
                Entry.engine.toggleStop();
                setTimeout(() => Entry.engine.toggleRun(), 100);
            }
        }

        // === 코스튬 ===
        setCostume(entity, pictureId) {
            const object = entity.parent;
            if (object) {
                const picture = object.getPicture(pictureId);
                if (picture) entity.setImage(picture);
            }
        }

        // === 헬퍼 ===
        findEntity(id) {
            if (typeof Entry === 'undefined') return null;
            
            if (id === 'mouse') return null;
            
            const object = Entry.container.getObject(id);
            return object?.entity;
        }

        // === 함수 호출 ===
        *callFunction(funcId, entity, params) {
            if (typeof Entry === 'undefined') return;
            
            const func = Entry.variableContainer?.getFunction(funcId);
            if (!func?.content) {
                console.warn('[TurboRuntime] Function not found:', funcId);
                return;
            }
            
            // 함수의 funcDef 이벤트 실행자 생성
            const funcCode = func.content;
            const executors = funcCode.raiseEvent('funcDef', entity);
            
            if (!executors || executors.length === 0) return;
            
            const funcExecutor = executors[0];
            
            // 파라미터 설정
            funcExecutor.register.params = params;
            funcExecutor.register.paramMap = func.paramMap;
            
            // 함수 실행 (기존 Entry 실행기 사용)
            while (!funcExecutor.isEnd()) {
                funcExecutor.execute();
                yield { type: 'tick' };
            }
            
            funcCode.removeExecutor(funcExecutor);
        }
        
        *callFunctionValue(funcId, entity, params) {
            if (typeof Entry === 'undefined') return 0;
            
            const func = Entry.variableContainer?.getFunction(funcId);
            if (!func?.content) {
                console.warn('[TurboRuntime] Function not found:', funcId);
                return 0;
            }
            
            const funcCode = func.content;
            const executors = funcCode.raiseEvent('funcDef', entity);
            
            if (!executors || executors.length === 0) return 0;
            
            const funcExecutor = executors[0];
            funcExecutor.register.params = params;
            funcExecutor.register.paramMap = func.paramMap;
            
            while (!funcExecutor.isEnd()) {
                funcExecutor.execute();
                yield { type: 'tick' };
            }
            
            // 반환 값 가져오기
            const result = funcExecutor.result;
            funcCode.removeExecutor(funcExecutor);
            
            if (result && result.getValue) {
                return result.getValue('VALUE', result);
            }
            return 0;
        }
        
        // 함수 파라미터 가져오기
        getFunctionParam(entity, paramType) {
            // 현재 실행 중인 executor의 register에서 파라미터 값 가져오기
            // 이건 컴파일된 코드에서는 직접 접근이 어려우므로 0 반환
            // TODO: executor context를 통해 파라미터 접근 구현
            return 0;
        }

        // === Entry 블록 폴백 실행 ===
        *executeEntryBlock(block, entity) {
            console.warn('[TurboRuntime] Skipping unsupported block:', block?.type);
            return;
        }

        *evalBlock(block, entity) {
            console.warn('[TurboRuntime] Skipping unsupported expression:', block?.type);
            return 0;
        }
    }

    // ============================================================
    // EntryTurbo - 메인 API
    // ============================================================

    const EntryTurbo = {
        version: '2.0.0',
        compiler: TurboCompiler,
        runtime: null,
        
        injected: false,
        active: false,
        overlayCanvas: null,
        
        _originalToggleRun: null,
        _originalToggleStop: null,
        _originalTick: null,

        /**
         * Entry 시스템에 주입
         */
        inject() {
            if (this.injected) return this;

            if (typeof Entry === 'undefined' || !Entry.engine) {
                const poll = setInterval(() => {
                    if (typeof Entry !== 'undefined' && Entry.engine) {
                        clearInterval(poll);
                        this.inject();
                    }
                }, 100);
                return this;
            }

            this.runtime = new TurboRuntime();
            this._createOverlay();
            this._hookEntryEngine();
            this._hookCodeExecution();

            this.injected = true;
            console.log('[EntryTurbo] ✓ JIT 컴파일러 주입 완료');
            
            return this;
        },

        _createOverlay() {
            const entryCanvas = document.getElementById('entryCanvas');
            if (!entryCanvas) return;

            this.overlayCanvas = document.createElement('canvas');
            this.overlayCanvas.id = 'entry-turbo-overlay';
            this.overlayCanvas.width = entryCanvas.width || 480;
            this.overlayCanvas.height = entryCanvas.height || 360;
            this.overlayCanvas.style.cssText = `
                position: absolute; top: 0; left: 0;
                width: 100%; height: 100%;
                z-index: 9999; pointer-events: none;
                display: none; background: transparent;
            `;

            const parent = entryCanvas.parentElement;
            if (parent) {
                if (getComputedStyle(parent).position === 'static') {
                    parent.style.position = 'relative';
                }
                parent.appendChild(this.overlayCanvas);
            }
        },

        _hookEntryEngine() {
            const self = this;

            this._originalToggleRun = Entry.engine.toggleRun.bind(Entry.engine);
            this._originalToggleStop = Entry.engine.toggleStop.bind(Entry.engine);

            Entry.engine.toggleRun = function(disableAchieve) {
                console.log('[EntryTurbo] ▶ JIT 컴파일 실행');
                self.active = true;
                self.runtime.timerStart = performance.now();
                self._showOverlay();
                return self._originalToggleRun(disableAchieve);
            };

            Entry.engine.toggleStop = function() {
                console.log('[EntryTurbo] ■ 정지');
                self.active = false;
                self._hideOverlay();
                self.compiler.clearCache();
                return self._originalToggleStop();
            };
        },

        /**
         * Entry Code 실행을 후킹하여 JIT 컴파일된 코드 실행
         */
        _hookCodeExecution() {
            const self = this;

            // Entry.Code.prototype.tick 후킹
            if (Entry.Code?.prototype) {
                const originalTick = Entry.Code.prototype.tick;
                
                Entry.Code.prototype.tick = function() {
                    if (!self.active) {
                        return originalTick.call(this);
                    }

                    // Turbo 모드: 컴파일된 실행자 사용
                    const executors = this.executors;
                    for (let i = executors.length - 1; i >= 0; i--) {
                        const executor = executors[i];
                        
                        if (executor.isPause?.()) continue;
                        
                        if (executor.isEnd?.()) {
                            executors.splice(i, 1);
                            continue;
                        }

                        // 컴파일된 실행자가 있으면 사용
                        if (executor._turboGenerator) {
                            self._runTurboExecutor(executor);
                        } else {
                            // 기존 실행
                            executor.execute(true);
                        }
                    }
                };
            }

            // Executor 생성 시 JIT 컴파일
            if (Entry.Executor) {
                const OriginalExecutor = Entry.Executor;
                
                Entry.Executor = function(block, entity, code) {
                    const executor = new OriginalExecutor(block, entity, code);
                    
                    if (self.active && block) {
                        try {
                            // 스레드의 블록들을 JIT 컴파일
                            const thread = block.thread;
                            if (thread) {
                                const blocks = thread.getBlocks().map(b => b.toJSON ? b.toJSON() : b);
                                const compiledFn = self.compiler.compileThread(blocks, entity.parent?.id);
                                executor._turboGenerator = compiledFn(entity, self.runtime);
                            }
                        } catch (e) {
                            console.warn('[EntryTurbo] JIT 컴파일 실패, 폴백:', e);
                        }
                    }
                    
                    return executor;
                };
                
                // 프로토타입 복사
                Entry.Executor.prototype = OriginalExecutor.prototype;
            }
        },

        _runTurboExecutor(executor) {
            const gen = executor._turboGenerator;
            if (!gen) return;

            try {
                const result = gen.next();
                
                if (result.done) {
                    executor.end();
                    return;
                }

                const value = result.value;
                if (value) {
                    if (value.type === 'wait') {
                        executor._turboWaitUntil = performance.now() + value.duration;
                    } else if (value.type === 'tick') {
                        // 다음 틱에서 계속
                    } else if (value.type === 'promise') {
                        executor.paused = true;
                        value.promise.then(() => {
                            executor.paused = false;
                        });
                    }
                }
            } catch (e) {
                console.error('[EntryTurbo] 실행 오류:', e);
                executor.end();
            }
        },

        _showOverlay() {
            if (this.overlayCanvas) {
                this.overlayCanvas.style.display = 'block';
                this._updateOverlay();
            }
        },

        _hideOverlay() {
            if (this.overlayCanvas) {
                this.overlayCanvas.style.display = 'none';
            }
        },

        _updateOverlay() {
            if (!this.active || !this.overlayCanvas) return;

            const ctx = this.overlayCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Turbo 인디케이터
            ctx.fillStyle = 'rgba(0, 200, 100, 0.8)';
            ctx.fillRect(5, 5, 80, 20);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.fillText('⚡ TURBO', 10, 18);

            requestAnimationFrame(() => this._updateOverlay());
        },

        eject() {
            if (!this.injected) return this;

            if (this._originalToggleRun) {
                Entry.engine.toggleRun = this._originalToggleRun;
            }
            if (this._originalToggleStop) {
                Entry.engine.toggleStop = this._originalToggleStop;
            }

            if (this.overlayCanvas?.parentElement) {
                this.overlayCanvas.parentElement.removeChild(this.overlayCanvas);
            }

            this.injected = false;
            this.active = false;
            this.compiler.clearCache();

            console.log('[EntryTurbo] 주입 해제 완료');
            return this;
        },

        // 디버그 모드
        setDebug(enabled) {
            this.compiler.debug = enabled;
        }
    };

    // 자동 주입
    if (typeof document !== 'undefined') {
        const autoInject = () => {
            if (typeof Entry !== 'undefined' && Entry.engine) {
                EntryTurbo.inject();
            } else {
                const observer = new MutationObserver(() => {
                    if (typeof Entry !== 'undefined' && Entry.engine && document.getElementById('entryCanvas')) {
                        observer.disconnect();
                        setTimeout(() => EntryTurbo.inject(), 500);
                    }
                });
                if (document.body) {
                    observer.observe(document.body, { childList: true, subtree: true });
                }
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', autoInject);
        } else {
            autoInject();
        }
    }

    // 전역 노출
    global.EntryTurbo = EntryTurbo;
    global.TurboCompiler = TurboCompiler;
    global.TurboRuntime = TurboRuntime;

})(typeof window !== 'undefined' ? window : global);
