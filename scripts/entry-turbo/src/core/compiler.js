/**
 * Entry Turbo Compiler
 * 블록을 최적화된 JavaScript 코드로 컴파일합니다.
 */

const BlockCompiler = {
    // 블록 타입별 컴파일러
    compilers: {},

    // 컴파일된 코드 캐시
    cache: new Map(),

    /**
     * 스레드(블록 배열)를 JavaScript 함수로 컴파일
     * @param {Array} thread - 블록 배열
     * @param {Object} context - 컴파일 컨텍스트
     * @returns {Function} 컴파일된 함수
     */
    compileThread(thread, context = {}) {
        const cacheKey = JSON.stringify(thread);
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const code = this.generateCode(thread, context);
        const compiledFn = this.createFunction(code, context);
        
        this.cache.set(cacheKey, compiledFn);
        return compiledFn;
    },

    /**
     * 블록 배열을 JavaScript 코드 문자열로 변환
     */
    generateCode(blocks, context) {
        const lines = [];
        lines.push('return async function*(entity, runtime) {');
        lines.push('  const vars = runtime.variables;');
        lines.push('  const lists = runtime.lists;');
        lines.push('  let _loopCount = 0;');
        
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const blockCode = this.compileBlock(block, context);
            if (blockCode) {
                lines.push('  ' + blockCode);
            }
        }
        
        lines.push('};');
        return lines.join('\n');
    },

    /**
     * 단일 블록을 JavaScript 코드로 컴파일
     */
    compileBlock(block, context) {
        if (!block || typeof block !== 'object') return '';
        
        const type = block.type;
        const params = block.params || [];
        const statements = block.statements || [];

        // 블록 타입별 컴파일러 사용
        if (this.compilers[type]) {
            return this.compilers[type](params, statements, context, this);
        }

        // 기본 블록 컴파일러
        return this.compileDefaultBlock(type, params, statements, context);
    },

    /**
     * 기본 블록 컴파일러
     */
    compileDefaultBlock(type, params, statements, context) {
        switch (type) {
            // === 시작 블록 ===
            case 'when_run_button_click':
                return '// 시작 버튼 클릭';
            
            case 'when_some_key_pressed':
                return `if (runtime.pressedKey !== ${this.compileParam(params[0])}) return;`;

            // === 흐름 제어 ===
            case 'wait_second':
                return `yield { type: 'wait', duration: ${this.compileParam(params[0])} * 1000 };`;
            
            case 'repeat_basic':
                return this.compileRepeat(params, statements, context);
            
            case 'repeat_inf':
                return this.compileRepeatInf(statements, context);
            
            case 'repeat_while_true':
                return this.compileRepeatWhile(params, statements, context);
            
            case '_if':
                return this.compileIf(params, statements, context);
            
            case 'if_else':
                return this.compileIfElse(params, statements, context);
            
            case 'stop_repeat':
                return 'break;';
            
            case 'stop_object':
                return 'return;';

            // === 움직임 ===
            case 'move_direction':
                return `entity.move(${this.compileParam(params[0])});`;
            
            case 'move_x':
                return `entity.setX(entity.x + ${this.compileParam(params[0])});`;
            
            case 'move_y':
                return `entity.setY(entity.y + ${this.compileParam(params[0])});`;
            
            case 'locate_x':
                return `entity.setX(${this.compileParam(params[0])});`;
            
            case 'locate_y':
                return `entity.setY(${this.compileParam(params[0])});`;
            
            case 'locate_xy':
                return `entity.setX(${this.compileParam(params[0])}); entity.setY(${this.compileParam(params[1])});`;
            
            case 'locate':
                return `entity.moveTo(${this.compileParam(params[0])});`;
            
            case 'rotate_by_angle':
                return `entity.rotate(${this.compileParam(params[0])});`;
            
            case 'direction_relative':
                return `entity.setDirection(entity.direction + ${this.compileParam(params[0])});`;
            
            case 'rotate_by_angle_time':
                return `yield* runtime.rotateDuring(entity, ${this.compileParam(params[0])}, ${this.compileParam(params[1])});`;
            
            case 'move_to_angle':
                return `entity.moveToAngle(${this.compileParam(params[0])}, ${this.compileParam(params[1])});`;

            // === 형태 ===
            case 'show':
                return 'entity.setVisible(true);';
            
            case 'hide':
                return 'entity.setVisible(false);';
            
            case 'dialog_time':
                return `yield* runtime.sayForSecs(entity, ${this.compileParam(params[0])}, ${this.compileParam(params[1])});`;
            
            case 'dialog':
                return `runtime.say(entity, ${this.compileParam(params[0])});`;
            
            case 'remove_dialog':
                return 'runtime.removeDialog(entity);';
            
            case 'change_to_next_shape':
                return 'entity.nextCostume();';
            
            case 'change_to_prev_shape':
                return 'entity.prevCostume();';
            
            case 'add_effect_amount':
                return `entity.addEffect('${params[0]}', ${this.compileParam(params[1])});`;
            
            case 'change_effect_amount':
                return `entity.setEffect('${params[0]}', ${this.compileParam(params[1])});`;
            
            case 'erase_all_effects':
                return 'entity.clearEffects();';
            
            case 'change_scale_size':
                return `entity.setSize(entity.size + ${this.compileParam(params[0])});`;
            
            case 'set_scale_size':
                return `entity.setSize(${this.compileParam(params[0])});`;

            // === 소리 ===
            case 'sound_something':
                return `runtime.playSound(entity, ${this.compileParam(params[0])});`;
            
            case 'sound_something_wait':
                return `yield* runtime.playSoundAndWait(entity, ${this.compileParam(params[0])});`;
            
            case 'sound_volume_change':
                return `runtime.changeVolume(${this.compileParam(params[0])});`;
            
            case 'sound_volume_set':
                return `runtime.setVolume(${this.compileParam(params[0])});`;
            
            case 'sound_silent_all':
                return 'runtime.stopAllSounds();';

            // === 판단 ===
            case 'is_press_some_key':
                return `(runtime.isKeyPressed(${this.compileParam(params[0])}))`;
            
            case 'is_clicked':
                return '(runtime.isMouseDown)';
            
            case 'reach_something':
                return `(entity.isTouching(${this.compileParam(params[0])}))`;

            // === 계산 ===
            case 'calc_basic':
                return this.compileCalcBasic(params);
            
            case 'calc_rand':
                return `runtime.random(${this.compileParam(params[0])}, ${this.compileParam(params[1])})`;
            
            case 'coordinate_mouse':
                return `runtime.mouse${params[0] === 'x' ? 'X' : 'Y'}`;
            
            case 'coordinate_object':
                return `runtime.getObjectCoord(${this.compileParam(params[0])}, '${params[1]}')`;
            
            case 'calc_operation':
                return this.compileCalcOperation(params);
            
            case 'get_project_timer_value':
                return 'runtime.getTimer()';
            
            case 'length_of_string':
                return `String(${this.compileParam(params[0])}).length`;
            
            case 'combine_something':
                return `(String(${this.compileParam(params[0])}) + String(${this.compileParam(params[1])}))`;
            
            case 'char_at':
                return `String(${this.compileParam(params[1])}).charAt(${this.compileParam(params[0])} - 1)`;

            // === 변수 ===
            case 'set_variable':
                return `vars['${params[1]}'] = ${this.compileParam(params[0])};`;
            
            case 'change_variable':
                return `vars['${params[1]}'] = (Number(vars['${params[1]}']) || 0) + ${this.compileParam(params[0])};`;
            
            case 'get_variable':
                return `vars['${params[0]}']`;
            
            case 'show_variable':
                return `runtime.showVariable('${params[0]}');`;
            
            case 'hide_variable':
                return `runtime.hideVariable('${params[0]}');`;

            // === 리스트 ===
            case 'add_value_to_list':
                return `lists['${params[1]}'].push(${this.compileParam(params[0])});`;
            
            case 'remove_value_from_list':
                return `lists['${params[1]}'].splice(${this.compileParam(params[0])} - 1, 1);`;
            
            case 'insert_value_to_list':
                return `lists['${params[2]}'].splice(${this.compileParam(params[1])} - 1, 0, ${this.compileParam(params[0])});`;
            
            case 'change_value_list_index':
                return `lists['${params[2]}'][${this.compileParam(params[1])} - 1] = ${this.compileParam(params[0])};`;
            
            case 'value_of_index_from_list':
                return `(lists['${params[1]}'][${this.compileParam(params[0])} - 1] || 0)`;
            
            case 'length_of_list':
                return `lists['${params[0]}'].length`;

            // === 붓 ===
            case 'start_drawing':
                return 'entity.startDrawing();';
            
            case 'stop_drawing':
                return 'entity.stopDrawing();';
            
            case 'set_color':
                return `entity.setBrushColor(${this.compileParam(params[0])});`;
            
            case 'set_thickness':
                return `entity.setBrushThickness(${this.compileParam(params[0])});`;
            
            case 'clear_stamp':
                return 'runtime.clearCanvas();';
            
            case 'stamp':
                return 'entity.stamp();';

            // === 신호 ===
            case 'when_message_cast':
                return `// 신호 수신: ${params[0]}`;
            
            case 'message_cast':
                return `runtime.broadcast('${params[0]}');`;
            
            case 'message_cast_wait':
                return `yield* runtime.broadcastAndWait('${params[0]}');`;

            // === 복제 ===
            case 'create_clone':
                return `runtime.createClone(${this.compileParam(params[0])});`;
            
            case 'when_clone_start':
                return '// 복제되었을 때';
            
            case 'delete_clone':
                return 'if (entity.isClone) { entity.destroy(); return; }';

            default:
                return `/* Unknown block: ${type} */`;
        }
    },

    /**
     * 파라미터 컴파일
     */
    compileParam(param) {
        if (param === null || param === undefined) return '0';
        if (typeof param === 'number') return param.toString();
        if (typeof param === 'string') return JSON.stringify(param);
        if (typeof param === 'boolean') return param.toString();
        
        // 중첩된 블록인 경우
        if (typeof param === 'object' && param.type) {
            return this.compileBlock(param, {});
        }
        
        return JSON.stringify(param);
    },

    /**
     * 반복 블록 컴파일
     */
    compileRepeat(params, statements, context) {
        const count = this.compileParam(params[0]);
        const body = this.compileStatements(statements[0] || [], context);
        
        return `
for (let _i = 0; _i < ${count}; _i++) {
  if (++_loopCount > 100000) { yield { type: 'tick' }; _loopCount = 0; }
${body}
}`;
    },

    /**
     * 무한 반복 컴파일
     */
    compileRepeatInf(statements, context) {
        const body = this.compileStatements(statements[0] || [], context);
        
        return `
while (true) {
  if (++_loopCount > 1000) { yield { type: 'tick' }; _loopCount = 0; }
${body}
}`;
    },

    /**
     * 조건 반복 컴파일
     */
    compileRepeatWhile(params, statements, context) {
        const condition = this.compileParam(params[0]);
        const body = this.compileStatements(statements[0] || [], context);
        
        return `
while (${condition}) {
  if (++_loopCount > 100000) { yield { type: 'tick' }; _loopCount = 0; }
${body}
}`;
    },

    /**
     * 조건문 컴파일
     */
    compileIf(params, statements, context) {
        const condition = this.compileParam(params[0]);
        const body = this.compileStatements(statements[0] || [], context);
        
        return `
if (${condition}) {
${body}
}`;
    },

    /**
     * 조건-아니면 컴파일
     */
    compileIfElse(params, statements, context) {
        const condition = this.compileParam(params[0]);
        const ifBody = this.compileStatements(statements[0] || [], context);
        const elseBody = this.compileStatements(statements[1] || [], context);
        
        return `
if (${condition}) {
${ifBody}
} else {
${elseBody}
}`;
    },

    /**
     * 문장 배열 컴파일
     */
    compileStatements(blocks, context) {
        if (!blocks || !Array.isArray(blocks)) return '';
        
        return blocks.map(block => '  ' + this.compileBlock(block, context)).join('\n');
    },

    /**
     * 기본 연산 컴파일
     */
    compileCalcBasic(params) {
        const left = this.compileParam(params[0]);
        const op = params[1];
        const right = this.compileParam(params[2]);
        
        const ops = {
            'PLUS': '+',
            'MINUS': '-',
            'MULTI': '*',
            'DIVIDE': '/'
        };
        
        return `(${left} ${ops[op] || '+'} ${right})`;
    },

    /**
     * 수학 연산 컴파일
     */
    compileCalcOperation(params) {
        const value = this.compileParam(params[1]);
        const op = params[0];
        
        const ops = {
            'sin': `Math.sin(${value} * Math.PI / 180)`,
            'cos': `Math.cos(${value} * Math.PI / 180)`,
            'tan': `Math.tan(${value} * Math.PI / 180)`,
            'asin': `Math.asin(${value}) * 180 / Math.PI`,
            'acos': `Math.acos(${value}) * 180 / Math.PI`,
            'atan': `Math.atan(${value}) * 180 / Math.PI`,
            'log': `Math.log(${value}) / Math.LN10`,
            'ln': `Math.log(${value})`,
            'unnatural': `Math.round(${value})`,
            'floor': `Math.floor(${value})`,
            'ceil': `Math.ceil(${value})`,
            'round': `Math.round(${value})`,
            'factorial': `runtime.factorial(${value})`,
            'sqrt': `Math.sqrt(${value})`,
            'abs': `Math.abs(${value})`,
            'square': `Math.pow(${value}, 2)`
        };
        
        return ops[op] || value;
    },

    /**
     * 컴파일된 코드를 함수로 변환
     */
    createFunction(code, context) {
        try {
            const factory = new Function(code);
            return factory();
        } catch (e) {
            console.error('Compilation error:', e, '\nCode:', code);
            return async function*() {};
        }
    },

    /**
     * 캐시 클리어
     */
    clearCache() {
        this.cache.clear();
    },

    /**
     * 커스텀 블록 컴파일러 등록
     */
    registerCompiler(blockType, compiler) {
        this.compilers[blockType] = compiler;
    }
};

// 모듈 내보내기
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BlockCompiler;
}
