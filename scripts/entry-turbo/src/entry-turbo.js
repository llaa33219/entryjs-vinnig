/**
 * Entry Turbo - 고성능 EntryJS 런타임
 * 
 * Entry 프로젝트를 최적화된 방식으로 실행합니다.
 * 기존 EntryJS 없이 독립적으로 작동합니다.
 * 
 * @version 1.0.0
 * @license MIT
 */

(function(global) {
    'use strict';

    // ============================================================
    // BlockCompiler - 블록을 JavaScript로 컴파일
    // ============================================================
    
    const BlockCompiler = {
        compilers: {},
        cache: new Map(),

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

        generateCode(blocks, context) {
            const lines = [
                'return async function*(entity, runtime) {',
                '  const vars = runtime.variables;',
                '  const lists = runtime.lists;',
                '  let _loopCount = 0;'
            ];
            
            for (const block of blocks) {
                const blockCode = this.compileBlock(block, context);
                if (blockCode) {
                    lines.push('  ' + blockCode);
                }
            }
            
            lines.push('};');
            return lines.join('\n');
        },

        compileBlock(block, context) {
            if (!block || typeof block !== 'object') return '';
            
            const { type, params = [], statements = [] } = block;

            if (this.compilers[type]) {
                return this.compilers[type](params, statements, context, this);
            }

            return this.compileDefaultBlock(type, params, statements, context);
        },

        compileDefaultBlock(type, params, statements, context) {
            const p = (i) => this.compileParam(params[i]);
            
            const blockMap = {
                // 시작
                'when_run_button_click': '// start',
                'when_some_key_pressed': `if (runtime.pressedKey !== ${p(0)}) return;`,
                
                // 흐름
                'wait_second': `yield { type: 'wait', duration: ${p(0)} * 1000 };`,
                'repeat_basic': this.compileRepeat(params, statements, context),
                'repeat_inf': this.compileRepeatInf(statements, context),
                'repeat_while_true': this.compileRepeatWhile(params, statements, context),
                '_if': this.compileIf(params, statements, context),
                'if_else': this.compileIfElse(params, statements, context),
                'stop_repeat': 'break;',
                'stop_object': 'return;',
                
                // 움직임
                'move_direction': `entity.move(${p(0)});`,
                'move_x': `entity.setX(entity.x + ${p(0)});`,
                'move_y': `entity.setY(entity.y + ${p(0)});`,
                'locate_x': `entity.setX(${p(0)});`,
                'locate_y': `entity.setY(${p(0)});`,
                'locate_xy': `entity.setX(${p(0)}); entity.setY(${p(1)});`,
                'locate': `entity.moveTo(${p(0)});`,
                'rotate_by_angle': `entity.rotate(${p(0)});`,
                'direction_relative': `entity.setDirection(entity.direction + ${p(0)});`,
                'rotate_by_angle_time': `yield* runtime.rotateDuring(entity, ${p(0)}, ${p(1)});`,
                'move_to_angle': `entity.moveToAngle(${p(0)}, ${p(1)});`,
                
                // 형태
                'show': 'entity.setVisible(true);',
                'hide': 'entity.setVisible(false);',
                'dialog_time': `yield* runtime.sayForSecs(entity, ${p(0)}, ${p(1)});`,
                'dialog': `runtime.say(entity, ${p(0)});`,
                'remove_dialog': 'runtime.removeDialog(entity);',
                'change_to_next_shape': 'entity.nextCostume();',
                'change_to_prev_shape': 'entity.prevCostume();',
                'add_effect_amount': `entity.addEffect('${params[0]}', ${p(1)});`,
                'change_effect_amount': `entity.setEffect('${params[0]}', ${p(1)});`,
                'erase_all_effects': 'entity.clearEffects();',
                'change_scale_size': `entity.setSize(entity.size + ${p(0)});`,
                'set_scale_size': `entity.setSize(${p(0)});`,
                
                // 소리
                'sound_something': `runtime.playSound(entity, ${p(0)});`,
                'sound_something_wait': `yield* runtime.playSoundAndWait(entity, ${p(0)});`,
                'sound_volume_change': `runtime.changeVolume(${p(0)});`,
                'sound_volume_set': `runtime.setVolume(${p(0)});`,
                'sound_silent_all': 'runtime.stopAllSounds();',
                
                // 판단
                'is_press_some_key': `(runtime.isKeyPressed(${p(0)}))`,
                'is_clicked': '(runtime.isMouseDown)',
                'reach_something': `(entity.isTouching(${p(0)}))`,
                
                // 계산
                'calc_basic': this.compileCalcBasic(params),
                'calc_rand': `runtime.random(${p(0)}, ${p(1)})`,
                'coordinate_mouse': `runtime.mouse${params[0] === 'x' ? 'X' : 'Y'}`,
                'coordinate_object': `runtime.getObjectCoord(${p(0)}, '${params[1]}')`,
                'calc_operation': this.compileCalcOperation(params),
                'get_project_timer_value': 'runtime.getTimer()',
                'length_of_string': `String(${p(0)}).length`,
                'combine_something': `(String(${p(0)}) + String(${p(1)}))`,
                'char_at': `String(${p(1)}).charAt(${p(0)} - 1)`,
                
                // 변수
                'set_variable': `vars['${params[1]}'] = ${p(0)};`,
                'change_variable': `vars['${params[1]}'] = (Number(vars['${params[1]}']) || 0) + ${p(0)};`,
                'get_variable': `vars['${params[0]}']`,
                'show_variable': `runtime.showVariable('${params[0]}');`,
                'hide_variable': `runtime.hideVariable('${params[0]}');`,
                
                // 리스트
                'add_value_to_list': `lists['${params[1]}'].push(${p(0)});`,
                'remove_value_from_list': `lists['${params[1]}'].splice(${p(0)} - 1, 1);`,
                'insert_value_to_list': `lists['${params[2]}'].splice(${p(1)} - 1, 0, ${p(0)});`,
                'change_value_list_index': `lists['${params[2]}'][${p(1)} - 1] = ${p(0)};`,
                'value_of_index_from_list': `(lists['${params[1]}'][${p(0)} - 1] || 0)`,
                'length_of_list': `lists['${params[0]}'].length`,
                
                // 붓
                'start_drawing': 'entity.startDrawing();',
                'stop_drawing': 'entity.stopDrawing();',
                'set_color': `entity.setBrushColor(${p(0)});`,
                'set_thickness': `entity.setBrushThickness(${p(0)});`,
                'clear_stamp': 'runtime.clearCanvas();',
                'stamp': 'entity.stamp();',
                
                // 신호
                'when_message_cast': `// message: ${params[0]}`,
                'message_cast': `runtime.broadcast('${params[0]}');`,
                'message_cast_wait': `yield* runtime.broadcastAndWait('${params[0]}');`,
                
                // 복제
                'create_clone': `runtime.createClone(${p(0)});`,
                'when_clone_start': '// clone start',
                'delete_clone': 'if (entity.isClone) { entity.destroy(); return; }'
            };
            
            return blockMap[type] || `/* ${type} */`;
        },

        compileParam(param) {
            if (param === null || param === undefined) return '0';
            if (typeof param === 'number') return String(param);
            if (typeof param === 'string') return JSON.stringify(param);
            if (typeof param === 'boolean') return String(param);
            if (typeof param === 'object' && param.type) {
                return this.compileBlock(param, {});
            }
            return JSON.stringify(param);
        },

        compileRepeat(params, statements, context) {
            const count = this.compileParam(params[0]);
            const body = this.compileStatements(statements[0] || [], context);
            return `for (let _i = 0; _i < ${count}; _i++) { if (++_loopCount > 100000) { yield { type: 'tick' }; _loopCount = 0; }\n${body}\n}`;
        },

        compileRepeatInf(statements, context) {
            const body = this.compileStatements(statements[0] || [], context);
            return `while (true) { if (++_loopCount > 1000) { yield { type: 'tick' }; _loopCount = 0; }\n${body}\n}`;
        },

        compileRepeatWhile(params, statements, context) {
            const condition = this.compileParam(params[0]);
            const body = this.compileStatements(statements[0] || [], context);
            return `while (${condition}) { if (++_loopCount > 100000) { yield { type: 'tick' }; _loopCount = 0; }\n${body}\n}`;
        },

        compileIf(params, statements, context) {
            return `if (${this.compileParam(params[0])}) {\n${this.compileStatements(statements[0] || [], context)}\n}`;
        },

        compileIfElse(params, statements, context) {
            const ifBody = this.compileStatements(statements[0] || [], context);
            const elseBody = this.compileStatements(statements[1] || [], context);
            return `if (${this.compileParam(params[0])}) {\n${ifBody}\n} else {\n${elseBody}\n}`;
        },

        compileStatements(blocks, context) {
            return blocks.map(b => '  ' + this.compileBlock(b, context)).join('\n');
        },

        compileCalcBasic(params) {
            const ops = { 'PLUS': '+', 'MINUS': '-', 'MULTI': '*', 'DIVIDE': '/' };
            return `(${this.compileParam(params[0])} ${ops[params[1]] || '+'} ${this.compileParam(params[2])})`;
        },

        compileCalcOperation(params) {
            const v = this.compileParam(params[1]);
            const ops = {
                'sin': `Math.sin(${v} * Math.PI / 180)`,
                'cos': `Math.cos(${v} * Math.PI / 180)`,
                'tan': `Math.tan(${v} * Math.PI / 180)`,
                'sqrt': `Math.sqrt(${v})`,
                'abs': `Math.abs(${v})`,
                'round': `Math.round(${v})`,
                'floor': `Math.floor(${v})`,
                'ceil': `Math.ceil(${v})`
            };
            return ops[params[0]] || v;
        },

        createFunction(code, context) {
            try {
                return new Function(code)();
            } catch (e) {
                console.error('Compile error:', e);
                return async function*() {};
            }
        },

        clearCache() {
            this.cache.clear();
        }
    };

    // ============================================================
    // TurboRenderer - 고성능 렌더러
    // ============================================================
    
    class TurboRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { alpha: false });
            this.textureCache = new Map();
            this.spriteBatch = [];
            
            this.penCanvas = document.createElement('canvas');
            this.penCanvas.width = canvas.width;
            this.penCanvas.height = canvas.height;
            this.penCtx = this.penCanvas.getContext('2d');
            
            this.dialogCanvas = document.createElement('canvas');
            this.dialogCanvas.width = canvas.width;
            this.dialogCanvas.height = canvas.height;
            this.dialogCtx = this.dialogCanvas.getContext('2d');
        }

        async loadTexture(url) {
            if (this.textureCache.has(url)) {
                return this.textureCache.get(url);
            }
            
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const info = { image: img, width: img.width, height: img.height };
                    this.textureCache.set(url, info);
                    resolve(info);
                };
                img.onerror = reject;
                img.src = url;
            });
        }

        beginFrame() {
            this.spriteBatch = [];
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        addSprite(sprite) {
            this.spriteBatch.push(sprite);
        }

        endFrame() {
            this.spriteBatch.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
            
            for (const sprite of this.spriteBatch) {
                if (!sprite.visible || !sprite.textureInfo) continue;
                
                const tex = sprite.textureInfo;
                const ctx = this.ctx;
                
                ctx.save();
                ctx.translate(this.canvas.width / 2 + sprite.x, this.canvas.height / 2 - sprite.y);
                ctx.rotate(-sprite.rotation * Math.PI / 180);
                ctx.scale(sprite.scaleX, sprite.scaleY);
                ctx.globalAlpha = 1 - (sprite.ghost || 0) / 100;
                
                if (sprite.brightness) {
                    ctx.filter = `brightness(${100 + sprite.brightness}%)`;
                }
                
                ctx.drawImage(tex.image, -tex.width / 2, -tex.height / 2, tex.width, tex.height);
                ctx.restore();
            }
            
            this.ctx.drawImage(this.penCanvas, 0, 0);
            this.ctx.drawImage(this.dialogCanvas, 0, 0);
        }

        drawPenLine(x1, y1, x2, y2, color, thickness) {
            const ctx = this.penCtx;
            const cx = this.penCanvas.width / 2;
            const cy = this.penCanvas.height / 2;
            
            ctx.strokeStyle = color;
            ctx.lineWidth = thickness;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(cx + x1, cy - y1);
            ctx.lineTo(cx + x2, cy - y2);
            ctx.stroke();
        }

        clearPen() {
            this.penCtx.clearRect(0, 0, this.penCanvas.width, this.penCanvas.height);
        }

        stamp(sprite) {
            if (!sprite.textureInfo) return;
            const ctx = this.penCtx;
            const tex = sprite.textureInfo;
            
            ctx.save();
            ctx.translate(this.penCanvas.width / 2 + sprite.x, this.penCanvas.height / 2 - sprite.y);
            ctx.rotate(-sprite.rotation * Math.PI / 180);
            ctx.scale(sprite.scaleX, sprite.scaleY);
            ctx.globalAlpha = 1 - (sprite.ghost || 0) / 100;
            ctx.drawImage(tex.image, -tex.width / 2, -tex.height / 2);
            ctx.restore();
        }

        renderDialog(entity, text) {
            const ctx = this.dialogCtx;
            ctx.clearRect(0, 0, this.dialogCanvas.width, this.dialogCanvas.height);
            if (!text) return;
            
            const x = this.dialogCanvas.width / 2 + entity.x;
            const y = this.dialogCanvas.height / 2 - entity.y - 50;
            
            ctx.font = '14px sans-serif';
            const textWidth = ctx.measureText(text).width;
            const boxWidth = textWidth + 20;
            const boxHeight = 30;
            
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(x - boxWidth/2, y - boxHeight, boxWidth, boxHeight, 8);
            ctx.fill();
            ctx.stroke();
            
            ctx.fillStyle = '#000000';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x, y - boxHeight/2);
        }

        clearDialog() {
            this.dialogCtx.clearRect(0, 0, this.dialogCanvas.width, this.dialogCanvas.height);
        }

        resize(width, height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.penCanvas.width = width;
            this.penCanvas.height = height;
            this.dialogCanvas.width = width;
            this.dialogCanvas.height = height;
        }

        destroy() {
            this.textureCache.clear();
        }
    }

    // ============================================================
    // TurboEntity - 최적화된 엔티티
    // ============================================================
    
    class TurboEntity {
        constructor(runtime, data) {
            this.runtime = runtime;
            this.id = data.id;
            this.name = data.name;
            
            this.x = 0;
            this.y = 0;
            this.rotation = 0;
            this.direction = 90;
            this.scaleX = 1;
            this.scaleY = 1;
            this.size = 100;
            this.visible = true;
            this.zIndex = 0;
            this.ghost = 0;
            this.brightness = 0;
            
            this.costumes = [];
            this.currentCostumeIndex = 0;
            this.textureInfo = null;
            
            this.penDown = false;
            this.penColor = '#000000';
            this.penThickness = 1;
            this.lastPenX = 0;
            this.lastPenY = 0;
            
            this.dialog = null;
            this.isClone = false;
            this.initialState = null;
            
            if (data.entity) {
                const e = data.entity;
                this.x = e.x || 0;
                this.y = e.y || 0;
                this.rotation = e.rotation || 0;
                this.direction = e.direction || 90;
                this.scaleX = e.scaleX || 1;
                this.scaleY = e.scaleY || 1;
                this.visible = e.visible !== false;
            }
            
            this.saveInitialState();
        }

        saveInitialState() {
            this.initialState = {
                x: this.x, y: this.y, rotation: this.rotation,
                direction: this.direction, scaleX: this.scaleX, scaleY: this.scaleY,
                visible: this.visible, ghost: this.ghost, brightness: this.brightness,
                currentCostumeIndex: this.currentCostumeIndex
            };
        }

        reset() {
            if (this.initialState) {
                Object.assign(this, this.initialState);
                this.setCostume(this.initialState.currentCostumeIndex);
            }
            this.penDown = false;
            this.dialog = null;
        }

        setX(x) {
            if (this.penDown) this.drawPen(x, this.y);
            this.x = x;
        }

        setY(y) {
            if (this.penDown) this.drawPen(this.x, y);
            this.y = y;
        }

        move(distance) {
            const rad = (this.direction - 90) * Math.PI / 180;
            this.setX(this.x + distance * Math.cos(rad));
            this.setY(this.y + distance * Math.sin(rad));
        }

        moveTo(targetId) {
            if (targetId === 'mouse') {
                this.setX(this.runtime.mouseX);
                this.setY(this.runtime.mouseY);
            } else {
                const target = this.runtime.objects.get(targetId);
                if (target) {
                    this.setX(target.x);
                    this.setY(target.y);
                }
            }
        }

        moveToAngle(angle, distance) {
            const rad = (angle - 90) * Math.PI / 180;
            this.setX(this.x + distance * Math.cos(rad));
            this.setY(this.y + distance * Math.sin(rad));
        }

        rotate(angle) { this.rotation = (this.rotation + angle) % 360; }
        setRotation(r) { this.rotation = r % 360; }
        setDirection(d) { this.direction = d % 360; }
        setVisible(v) { this.visible = v; }
        
        setSize(size) {
            const scale = size / this.size;
            this.scaleX *= scale;
            this.scaleY *= scale;
            this.size = size;
        }

        setCostume(index) {
            if (index >= 0 && index < this.costumes.length) {
                this.currentCostumeIndex = index;
                this.textureInfo = this.costumes[index].textureInfo;
            }
        }

        nextCostume() { this.setCostume((this.currentCostumeIndex + 1) % this.costumes.length); }
        prevCostume() { this.setCostume((this.currentCostumeIndex - 1 + this.costumes.length) % this.costumes.length); }

        setEffect(effect, value) {
            if (effect === 'ghost') this.ghost = Math.max(0, Math.min(100, value));
            else if (effect === 'brightness') this.brightness = Math.max(-100, Math.min(100, value));
        }

        addEffect(effect, value) {
            if (effect === 'ghost') this.ghost = Math.max(0, Math.min(100, this.ghost + value));
            else if (effect === 'brightness') this.brightness = Math.max(-100, Math.min(100, this.brightness + value));
        }

        clearEffects() { this.ghost = 0; this.brightness = 0; }

        startDrawing() { this.penDown = true; this.lastPenX = this.x; this.lastPenY = this.y; }
        stopDrawing() { this.penDown = false; }
        setBrushColor(color) { this.penColor = color; }
        setBrushThickness(t) { this.penThickness = t; }
        
        drawPen(newX, newY) {
            this.runtime.renderer.drawPenLine(this.lastPenX, this.lastPenY, newX, newY, this.penColor, this.penThickness);
            this.lastPenX = newX;
            this.lastPenY = newY;
        }

        stamp() { this.runtime.renderer.stamp(this); }

        isTouching(targetId) {
            if (targetId === 'mouse') return this.containsPoint(this.runtime.mouseX, this.runtime.mouseY);
            if (targetId === 'wall' || targetId.startsWith('wall_')) return this.isTouchingWall(targetId);
            const target = this.runtime.objects.get(targetId);
            return target ? this.getBounds().intersects(target.getBounds()) : false;
        }

        isTouchingWall(wallType) {
            const b = this.getBounds();
            switch (wallType) {
                case 'wall': return b.left < -240 || b.right > 240 || b.top > 180 || b.bottom < -180;
                case 'wall_up': return b.top > 180;
                case 'wall_down': return b.bottom < -180;
                case 'wall_left': return b.left < -240;
                case 'wall_right': return b.right > 240;
            }
            return false;
        }

        getBounds() {
            const hw = (this.textureInfo?.width || 100) * Math.abs(this.scaleX) / 2;
            const hh = (this.textureInfo?.height || 100) * Math.abs(this.scaleY) / 2;
            return {
                left: this.x - hw, right: this.x + hw, top: this.y + hh, bottom: this.y - hh,
                intersects(o) { return !(this.left > o.right || this.right < o.left || this.top < o.bottom || this.bottom > o.top); }
            };
        }

        containsPoint(px, py) {
            const b = this.getBounds();
            return px >= b.left && px <= b.right && py >= b.bottom && py <= b.top;
        }

        clone() {
            const c = new TurboEntity(this.runtime, { id: `${this.id}_clone_${Date.now()}`, name: this.name });
            Object.assign(c, { x: this.x, y: this.y, rotation: this.rotation, direction: this.direction,
                scaleX: this.scaleX, scaleY: this.scaleY, size: this.size, visible: this.visible,
                ghost: this.ghost, brightness: this.brightness, costumes: this.costumes,
                currentCostumeIndex: this.currentCostumeIndex, textureInfo: this.textureInfo, isClone: true });
            return c;
        }

        destroy() {
            if (this.isClone) {
                const idx = this.runtime.clones.indexOf(this);
                if (idx !== -1) this.runtime.clones.splice(idx, 1);
            }
            this.visible = false;
        }
    }

    // ============================================================
    // TurboRuntime - 메인 런타임
    // ============================================================
    
    class TurboRuntime {
        constructor(renderer) {
            this.renderer = renderer;
            this.compiler = BlockCompiler;
            
            this.running = false;
            this.paused = false;
            this.startTime = 0;
            this.timer = 0;
            this.timerRunning = false;
            
            this.objects = new Map();
            this.entities = [];
            this.clones = [];
            this.executors = [];
            
            this.variables = {};
            this.lists = {};
            this.eventListeners = new Map();
            
            this.pressedKeys = new Set();
            this.mouseX = 0;
            this.mouseY = 0;
            this.isMouseDown = false;
            
            this.audioContext = null;
            this.sounds = new Map();
            this.activeSounds = [];
            this.volume = 1;
            
            this.rafId = null;
            
            this.initInput();
            this.initAudio();
        }

        initInput() {
            document.addEventListener('keydown', e => {
                this.pressedKeys.add(e.keyCode);
                if (this.running) this.fireEvent(`keyPress_${e.keyCode}`);
            });
            document.addEventListener('keyup', e => this.pressedKeys.delete(e.keyCode));
            
            if (this.renderer?.canvas) {
                const canvas = this.renderer.canvas;
                canvas.addEventListener('mousemove', e => {
                    const rect = canvas.getBoundingClientRect();
                    this.mouseX = (e.clientX - rect.left) / rect.width * 480 - 240;
                    this.mouseY = -((e.clientY - rect.top) / rect.height * 360 - 180);
                });
                canvas.addEventListener('mousedown', () => { this.isMouseDown = true; });
                canvas.addEventListener('mouseup', () => { this.isMouseDown = false; });
            }
        }

        initAudio() {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {}
        }

        async loadProject(data) {
            if (data.variables) {
                for (const v of data.variables) this.variables[v.id] = v.value;
            }
            if (data.lists) {
                for (const l of data.lists) this.lists[l.id] = [...(l.array || [])];
            }
            if (data.objects) {
                for (const obj of data.objects) await this.loadObject(obj);
            }
        }

        async loadObject(objData) {
            const entity = new TurboEntity(this, objData);
            
            if (objData.sprite?.pictures) {
                for (const pic of objData.sprite.pictures) {
                    const url = this.getPictureUrl(pic);
                    const textureInfo = await this.renderer.loadTexture(url);
                    entity.costumes.push({ id: pic.id, name: pic.name, textureInfo });
                }
                entity.setCostume(0);
            }
            
            if (objData.script) {
                const scripts = typeof objData.script === 'string' ? JSON.parse(objData.script) : objData.script;
                for (const thread of scripts) {
                    if (!thread?.length) continue;
                    const firstBlock = thread[0];
                    const eventType = this.getEventType(firstBlock);
                    if (eventType) {
                        const compiledFn = this.compiler.compileThread(thread.slice(1));
                        this.registerEvent(eventType, entity, compiledFn, firstBlock.params);
                    }
                }
            }
            
            this.objects.set(objData.id, entity);
            this.entities.push(entity);
            return entity;
        }

        getEventType(block) {
            if (!block) return null;
            const map = {
                'when_run_button_click': 'start',
                'when_some_key_pressed': 'keyPress',
                'when_object_click': 'click',
                'when_message_cast': 'message',
                'when_clone_start': 'clone'
            };
            return map[block.type] || null;
        }

        registerEvent(eventType, entity, fn, params = []) {
            let key = eventType;
            if (eventType === 'keyPress') key = `keyPress_${params[0]}`;
            else if (eventType === 'message') key = `message_${params[0]}`;
            
            if (!this.eventListeners.has(key)) this.eventListeners.set(key, []);
            this.eventListeners.get(key).push({ entity, fn });
        }

        fireEvent(key) {
            const listeners = this.eventListeners.get(key);
            if (listeners) {
                for (const { entity, fn } of listeners) {
                    if (entity.visible) this.startExecutor(entity, fn);
                }
            }
        }

        startExecutor(entity, fn) {
            this.executors.push({ entity, generator: fn(entity, this), waitUntil: 0 });
        }

        start() {
            if (this.running) return;
            this.running = true;
            this.paused = false;
            this.startTime = performance.now();
            this.fireEvent('start');
            this.mainLoop();
        }

        stop() {
            this.running = false;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.executors = [];
            for (const c of this.clones) c.destroy();
            this.clones = [];
            this.stopAllSounds();
            for (const e of this.entities) e.reset();
            this.render();
        }

        togglePause() { this.paused = !this.paused; }

        mainLoop() {
            if (!this.running) return;
            const now = performance.now();
            
            if (!this.paused) {
                this.updateExecutors(now);
                if (this.timerRunning) this.timer = (now - this.startTime) / 1000;
            }
            
            this.render();
            this.rafId = requestAnimationFrame(() => this.mainLoop());
        }

        updateExecutors(now) {
            const completed = [];
            for (let i = 0; i < this.executors.length; i++) {
                const exec = this.executors[i];
                if (exec.waitUntil > now) continue;
                
                try {
                    const result = exec.generator.next();
                    if (result.done) completed.push(i);
                    else if (result.value?.type === 'wait') exec.waitUntil = now + result.value.duration;
                } catch (e) {
                    console.error('Executor error:', e);
                    completed.push(i);
                }
            }
            for (let i = completed.length - 1; i >= 0; i--) {
                this.executors.splice(completed[i], 1);
            }
        }

        render() {
            this.renderer.beginFrame();
            const all = [...this.entities, ...this.clones].filter(e => e.visible).sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
            for (const e of all) this.renderer.addSprite(e);
            this.renderer.endFrame();
        }

        // Runtime utilities
        random(min, max) {
            min = Number(min); max = Number(max);
            if (min > max) [min, max] = [max, min];
            return Number.isInteger(min) && Number.isInteger(max)
                ? Math.floor(Math.random() * (max - min + 1)) + min
                : Math.random() * (max - min) + min;
        }

        isKeyPressed(keyCode) { return this.pressedKeys.has(Number(keyCode)); }
        getTimer() { return this.timer; }
        startTimer() { this.timerRunning = true; this.startTime = performance.now(); }
        resetTimer() { this.timer = 0; this.startTime = performance.now(); }
        
        broadcast(msgId) { this.fireEvent(`message_${msgId}`); }
        async *broadcastAndWait(msgId) {
            const before = this.executors.length;
            this.broadcast(msgId);
            while (this.executors.length > before) yield { type: 'tick' };
        }

        createClone(targetId) {
            const target = this.objects.get(targetId);
            if (!target || this.clones.length >= 360) return;
            const clone = target.clone();
            this.clones.push(clone);
        }

        say(entity, text) {
            entity.dialog = String(text);
            this.renderer.renderDialog(entity, entity.dialog);
        }

        async *sayForSecs(entity, text, seconds) {
            this.say(entity, text);
            yield { type: 'wait', duration: seconds * 1000 };
            this.removeDialog(entity);
        }

        removeDialog(entity) {
            entity.dialog = null;
            this.renderer.clearDialog();
        }

        async *rotateDuring(entity, angle, duration) {
            const start = entity.rotation;
            const startTime = performance.now();
            const endTime = startTime + duration * 1000;
            while (performance.now() < endTime) {
                const progress = (performance.now() - startTime) / (duration * 1000);
                entity.setRotation(start + angle * progress);
                yield { type: 'tick' };
            }
            entity.setRotation(start + angle);
        }

        playSound(entity, soundId) {
            const sound = this.sounds.get(soundId);
            if (!sound || !this.audioContext) return;
            const source = this.audioContext.createBufferSource();
            source.buffer = sound.buffer;
            const gain = this.audioContext.createGain();
            gain.gain.value = this.volume;
            source.connect(gain);
            gain.connect(this.audioContext.destination);
            source.start();
            this.activeSounds.push({ source, gain });
        }

        async *playSoundAndWait(entity, soundId) {
            const sound = this.sounds.get(soundId);
            if (!sound || !this.audioContext) return;
            this.playSound(entity, soundId);
            yield { type: 'wait', duration: sound.buffer.duration * 1000 };
        }

        stopAllSounds() {
            for (const { source } of this.activeSounds) {
                try { source.stop(); } catch (e) {}
            }
            this.activeSounds = [];
        }

        setVolume(vol) { this.volume = Math.max(0, Math.min(1, vol / 100)); }
        changeVolume(delta) { this.setVolume((this.volume + delta / 100) * 100); }
        clearCanvas() { this.renderer.clearPen(); }
        
        showVariable(id) {}
        hideVariable(id) {}
        
        getObjectCoord(id, coord) {
            const e = this.objects.get(id);
            if (!e) return 0;
            return { x: e.x, y: e.y, rotation: e.rotation, direction: e.direction, size: e.size }[coord] || 0;
        }

        getPictureUrl(pic) {
            if (pic.fileurl) return pic.fileurl;
            const f = pic.filename;
            return `https://playentry.org/uploads/${f.slice(0,2)}/${f.slice(2,4)}/image/${f}.png`;
        }

        destroy() {
            this.stop();
            if (this.audioContext) this.audioContext.close();
            this.renderer.destroy();
        }
    }

    // ============================================================
    // EntryTurbo - 메인 API
    // ============================================================
    
    const EntryTurbo = {
        version: '1.0.0',
        renderer: null,
        runtime: null,

        /**
         * 캔버스에 초기화
         */
        init(canvas) {
            if (typeof canvas === 'string') {
                canvas = document.getElementById(canvas) || document.querySelector(canvas);
            }
            
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.id = 'entry-turbo-canvas';
                canvas.width = 480;
                canvas.height = 360;
                document.body.appendChild(canvas);
            }
            
            this.renderer = new TurboRenderer(canvas);
            this.runtime = new TurboRuntime(this.renderer);
            
            return this;
        },

        /**
         * 프로젝트 JSON 로드
         */
        async load(projectJson) {
            if (!this.runtime) {
                throw new Error('EntryTurbo not initialized. Call init() first.');
            }
            
            const data = typeof projectJson === 'string' ? JSON.parse(projectJson) : projectJson;
            await this.runtime.loadProject(data);
            
            return this;
        },

        /**
         * 프로젝트 URL에서 로드
         */
        async loadFromUrl(url) {
            const response = await fetch(url);
            const data = await response.json();
            return this.load(data);
        },

        /**
         * 실행 시작
         */
        start() {
            if (this.runtime) {
                this.runtime.start();
            }
            return this;
        },

        /**
         * 실행 중지
         */
        stop() {
            if (this.runtime) {
                this.runtime.stop();
            }
            return this;
        },

        /**
         * 일시정지/재개
         */
        togglePause() {
            if (this.runtime) {
                this.runtime.togglePause();
            }
            return this;
        },

        /**
         * 실행 상태
         */
        get isRunning() {
            return this.runtime?.running || false;
        },

        get isPaused() {
            return this.runtime?.paused || false;
        },

        /**
         * 리소스 정리
         */
        destroy() {
            if (this.runtime) {
                this.runtime.destroy();
                this.runtime = null;
            }
            if (this.renderer) {
                this.renderer = null;
            }
        }
    };

    // 전역 노출
    global.EntryTurbo = EntryTurbo;
    global.TurboRenderer = TurboRenderer;
    global.TurboRuntime = TurboRuntime;
    global.TurboEntity = TurboEntity;
    global.BlockCompiler = BlockCompiler;

})(typeof window !== 'undefined' ? window : global);
