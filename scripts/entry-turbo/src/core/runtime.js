/**
 * Entry Turbo Runtime
 * 최적화된 실행 엔진 (VM 스타일)
 */

class TurboRuntime {
    constructor(renderer) {
        this.renderer = renderer;
        
        // 상태
        this.running = false;
        this.paused = false;
        this.startTime = 0;
        this.frameCount = 0;
        this.targetFPS = 60;
        
        // 오브젝트 및 엔티티
        this.objects = new Map();
        this.entities = [];
        this.clones = [];
        
        // 변수 및 리스트
        this.variables = {};
        this.lists = {};
        this.variableViews = new Map();
        
        // 실행 스택
        this.executors = [];
        this.pendingExecutors = [];
        
        // 이벤트
        this.eventListeners = new Map();
        this.messageQueue = [];
        
        // 입력
        this.pressedKeys = new Set();
        this.mouseX = 0;
        this.mouseY = 0;
        this.isMouseDown = false;
        
        // 사운드
        this.audioContext = null;
        this.sounds = new Map();
        this.activeSounds = [];
        this.volume = 1;
        
        // 타이머
        this.timer = 0;
        this.timerRunning = false;
        
        // 애니메이션 프레임 ID
        this.rafId = null;
        
        // 컴파일러 참조
        this.compiler = null;
        
        this.initInput();
        this.initAudio();
    }

    /**
     * 입력 초기화
     */
    initInput() {
        document.addEventListener('keydown', (e) => {
            this.pressedKeys.add(e.keyCode);
            if (this.running) {
                this.fireEvent('when_some_key_pressed', e.keyCode);
            }
        });
        
        document.addEventListener('keyup', (e) => {
            this.pressedKeys.delete(e.keyCode);
        });
        
        if (this.renderer && this.renderer.canvas) {
            const canvas = this.renderer.canvas;
            
            canvas.addEventListener('mousemove', (e) => {
                const rect = canvas.getBoundingClientRect();
                this.mouseX = (e.clientX - rect.left) / rect.width * 480 - 240;
                this.mouseY = -((e.clientY - rect.top) / rect.height * 360 - 180);
            });
            
            canvas.addEventListener('mousedown', (e) => {
                this.isMouseDown = true;
                if (this.running) {
                    this.fireEvent('mouse_clicked');
                    this.checkEntityClick(e);
                }
            });
            
            canvas.addEventListener('mouseup', () => {
                this.isMouseDown = false;
            });
        }
    }

    /**
     * 오디오 초기화
     */
    initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('Web Audio API not available');
        }
    }

    /**
     * 프로젝트 로드
     */
    async loadProject(projectData) {
        // 변수 로드
        if (projectData.variables) {
            for (const v of projectData.variables) {
                this.variables[v.id] = v.value;
                if (v.visible) {
                    this.variableViews.set(v.id, { name: v.name, visible: true });
                }
            }
        }
        
        // 리스트 로드
        if (projectData.lists) {
            for (const l of projectData.lists) {
                this.lists[l.id] = [...(l.array || [])];
            }
        }
        
        // 사운드 프리로드
        if (projectData.objects) {
            for (const obj of projectData.objects) {
                if (obj.sprite && obj.sprite.sounds) {
                    for (const sound of obj.sprite.sounds) {
                        await this.loadSound(sound);
                    }
                }
            }
        }
        
        // 오브젝트 로드
        if (projectData.objects) {
            for (const objData of projectData.objects) {
                await this.loadObject(objData);
            }
        }
        
        // 메시지 로드
        if (projectData.messages) {
            for (const msg of projectData.messages) {
                this.eventListeners.set(`message_${msg.id}`, []);
            }
        }
    }

    /**
     * 오브젝트 로드
     */
    async loadObject(objData) {
        const entity = new TurboEntity(this, objData);
        
        // 이미지 로드
        if (objData.sprite && objData.sprite.pictures) {
            for (const pic of objData.sprite.pictures) {
                const url = this.getPictureUrl(pic);
                const textureInfo = await this.renderer.loadTexture(url);
                entity.costumes.push({
                    id: pic.id,
                    name: pic.name,
                    textureInfo,
                    rotationCenterX: pic.dimension ? pic.dimension.width / 2 : 0,
                    rotationCenterY: pic.dimension ? pic.dimension.height / 2 : 0
                });
            }
            entity.setCostume(0);
        }
        
        // 스크립트 컴파일
        if (objData.script) {
            const scripts = typeof objData.script === 'string' 
                ? JSON.parse(objData.script) 
                : objData.script;
            
            for (const thread of scripts) {
                if (!thread || thread.length === 0) continue;
                
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

    /**
     * 이벤트 타입 추출
     */
    getEventType(block) {
        if (!block) return null;
        
        const eventMap = {
            'when_run_button_click': 'start',
            'when_some_key_pressed': 'keyPress',
            'when_object_click': 'click',
            'when_message_cast': 'message',
            'when_clone_start': 'clone'
        };
        
        return eventMap[block.type] || null;
    }

    /**
     * 이벤트 등록
     */
    registerEvent(eventType, entity, compiledFn, params = []) {
        let key = eventType;
        
        if (eventType === 'keyPress') {
            key = `keyPress_${params[0]}`;
        } else if (eventType === 'message') {
            key = `message_${params[0]}`;
        }
        
        if (!this.eventListeners.has(key)) {
            this.eventListeners.set(key, []);
        }
        
        this.eventListeners.get(key).push({ entity, fn: compiledFn });
    }

    /**
     * 이벤트 발생
     */
    fireEvent(eventType, value) {
        let key = eventType;
        
        if (eventType === 'when_some_key_pressed') {
            key = `keyPress_${value}`;
        } else if (eventType === 'message') {
            key = `message_${value}`;
        }
        
        const listeners = this.eventListeners.get(key);
        if (!listeners) return;
        
        for (const { entity, fn } of listeners) {
            if (entity.visible || eventType === 'clone') {
                this.startExecutor(entity, fn);
            }
        }
    }

    /**
     * 실행기 시작
     */
    startExecutor(entity, compiledFn) {
        const generator = compiledFn(entity, this);
        this.executors.push({
            entity,
            generator,
            waitUntil: 0
        });
    }

    /**
     * 실행 시작
     */
    start() {
        if (this.running) return;
        
        this.running = true;
        this.paused = false;
        this.startTime = performance.now();
        this.timer = 0;
        this.timerRunning = false;
        
        // 시작 이벤트 발생
        this.fireEvent('start');
        
        // 메인 루프 시작
        this.mainLoop();
    }

    /**
     * 정지
     */
    stop() {
        this.running = false;
        this.paused = false;
        
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        
        // 실행기 클리어
        this.executors = [];
        this.pendingExecutors = [];
        
        // 클론 제거
        for (const clone of this.clones) {
            clone.destroy();
        }
        this.clones = [];
        
        // 모든 사운드 정지
        this.stopAllSounds();
        
        // 엔티티 초기 상태로 복원
        for (const entity of this.entities) {
            entity.reset();
        }
        
        // 렌더링
        this.render();
    }

    /**
     * 일시정지/재개
     */
    togglePause() {
        this.paused = !this.paused;
    }

    /**
     * 메인 루프
     */
    mainLoop() {
        if (!this.running) return;
        
        const now = performance.now();
        
        if (!this.paused) {
            // 실행기 업데이트
            this.updateExecutors(now);
            
            // 타이머 업데이트
            if (this.timerRunning) {
                this.timer = (now - this.startTime) / 1000;
            }
        }
        
        // 렌더링
        this.render();
        
        this.frameCount++;
        this.rafId = requestAnimationFrame(() => this.mainLoop());
    }

    /**
     * 실행기 업데이트
     */
    updateExecutors(now) {
        const completedExecutors = [];
        
        for (let i = 0; i < this.executors.length; i++) {
            const executor = this.executors[i];
            
            // 대기 중인 경우 스킵
            if (executor.waitUntil > now) continue;
            
            try {
                const result = executor.generator.next();
                
                if (result.done) {
                    completedExecutors.push(i);
                } else if (result.value) {
                    // yield 값 처리
                    if (result.value.type === 'wait') {
                        executor.waitUntil = now + result.value.duration;
                    } else if (result.value.type === 'tick') {
                        // 다음 프레임에 계속
                    }
                }
            } catch (e) {
                console.error('Executor error:', e);
                completedExecutors.push(i);
            }
        }
        
        // 완료된 실행기 제거 (역순으로)
        for (let i = completedExecutors.length - 1; i >= 0; i--) {
            this.executors.splice(completedExecutors[i], 1);
        }
        
        // 대기 중인 실행기 추가
        if (this.pendingExecutors.length > 0) {
            this.executors.push(...this.pendingExecutors);
            this.pendingExecutors = [];
        }
    }

    /**
     * 렌더링
     */
    render() {
        this.renderer.beginFrame();
        
        // 모든 엔티티 렌더링 (zIndex 순)
        const allEntities = [...this.entities, ...this.clones]
            .filter(e => e.visible)
            .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        
        for (const entity of allEntities) {
            this.renderer.addSprite(entity);
        }
        
        this.renderer.endFrame();
    }

    // ========== 런타임 함수들 ==========

    /**
     * 랜덤 숫자
     */
    random(min, max) {
        min = Number(min);
        max = Number(max);
        if (min > max) [min, max] = [max, min];
        
        if (Number.isInteger(min) && Number.isInteger(max)) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
        return Math.random() * (max - min) + min;
    }

    /**
     * 팩토리얼
     */
    factorial(n) {
        n = Math.floor(n);
        if (n < 0) return 0;
        if (n <= 1) return 1;
        let result = 1;
        for (let i = 2; i <= n; i++) result *= i;
        return result;
    }

    /**
     * 키 입력 확인
     */
    isKeyPressed(keyCode) {
        return this.pressedKeys.has(Number(keyCode));
    }

    /**
     * 타이머 관련
     */
    getTimer() {
        return this.timer;
    }

    startTimer() {
        this.timerRunning = true;
        this.startTime = performance.now();
    }

    resetTimer() {
        this.timer = 0;
        this.startTime = performance.now();
    }

    /**
     * 신호 보내기
     */
    broadcast(messageId) {
        this.fireEvent('message', messageId);
    }

    /**
     * 신호 보내고 기다리기
     */
    async *broadcastAndWait(messageId) {
        const executorsBefore = this.executors.length;
        this.broadcast(messageId);
        
        // 새로 시작된 실행기들이 완료될 때까지 대기
        while (this.executors.length > executorsBefore) {
            yield { type: 'tick' };
        }
    }

    /**
     * 복제 생성
     */
    createClone(targetId) {
        let targetEntity;
        
        if (targetId === 'self') {
            // 현재 실행 중인 엔티티 (컨텍스트에서 가져와야 함)
            return;
        } else {
            targetEntity = this.objects.get(targetId);
        }
        
        if (!targetEntity) return;
        if (this.clones.length >= 360) return; // 최대 복제 수 제한
        
        const clone = targetEntity.clone();
        this.clones.push(clone);
        
        // 복제 이벤트 발생
        const listeners = this.eventListeners.get('clone');
        if (listeners) {
            for (const { entity, fn } of listeners) {
                if (entity.id === targetEntity.id) {
                    this.startExecutor(clone, fn);
                }
            }
        }
    }

    /**
     * 말하기
     */
    say(entity, text) {
        entity.dialog = String(text);
        this.renderer.renderDialog(entity, entity.dialog);
    }

    /**
     * 말하기 (시간 제한)
     */
    async *sayForSecs(entity, text, seconds) {
        this.say(entity, text);
        yield { type: 'wait', duration: seconds * 1000 };
        this.removeDialog(entity);
    }

    /**
     * 대화 제거
     */
    removeDialog(entity) {
        entity.dialog = null;
        this.renderer.clearDialog();
    }

    /**
     * 회전 애니메이션
     */
    async *rotateDuring(entity, angle, duration) {
        const startRotation = entity.rotation;
        const startTime = performance.now();
        const endTime = startTime + duration * 1000;
        
        while (performance.now() < endTime) {
            const progress = (performance.now() - startTime) / (duration * 1000);
            entity.setRotation(startRotation + angle * progress);
            yield { type: 'tick' };
        }
        
        entity.setRotation(startRotation + angle);
    }

    /**
     * 사운드 로드
     */
    async loadSound(soundData) {
        if (!this.audioContext) return;
        
        const url = this.getSoundUrl(soundData);
        
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            this.sounds.set(soundData.id, {
                buffer: audioBuffer,
                name: soundData.name
            });
        } catch (e) {
            console.warn('Failed to load sound:', soundData.name);
        }
    }

    /**
     * 사운드 재생
     */
    playSound(entity, soundId) {
        const sound = this.sounds.get(soundId);
        if (!sound || !this.audioContext) return;
        
        const source = this.audioContext.createBufferSource();
        source.buffer = sound.buffer;
        
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = this.volume;
        
        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        source.start();
        
        this.activeSounds.push({ source, gainNode });
        
        source.onended = () => {
            const idx = this.activeSounds.findIndex(s => s.source === source);
            if (idx !== -1) this.activeSounds.splice(idx, 1);
        };
    }

    /**
     * 사운드 재생하고 기다리기
     */
    async *playSoundAndWait(entity, soundId) {
        const sound = this.sounds.get(soundId);
        if (!sound || !this.audioContext) return;
        
        this.playSound(entity, soundId);
        yield { type: 'wait', duration: sound.buffer.duration * 1000 };
    }

    /**
     * 모든 사운드 정지
     */
    stopAllSounds() {
        for (const { source } of this.activeSounds) {
            try {
                source.stop();
            } catch (e) {}
        }
        this.activeSounds = [];
    }

    /**
     * 볼륨 설정
     */
    setVolume(vol) {
        this.volume = Math.max(0, Math.min(1, vol / 100));
        for (const { gainNode } of this.activeSounds) {
            gainNode.gain.value = this.volume;
        }
    }

    /**
     * 볼륨 변경
     */
    changeVolume(delta) {
        this.setVolume((this.volume + delta / 100) * 100);
    }

    /**
     * 캔버스 클리어 (펜)
     */
    clearCanvas() {
        this.renderer.clearPen();
    }

    /**
     * 변수 표시
     */
    showVariable(varId) {
        const view = this.variableViews.get(varId);
        if (view) view.visible = true;
    }

    /**
     * 변수 숨기기
     */
    hideVariable(varId) {
        const view = this.variableViews.get(varId);
        if (view) view.visible = false;
    }

    /**
     * 오브젝트 좌표 가져오기
     */
    getObjectCoord(objectId, coord) {
        const entity = this.objects.get(objectId);
        if (!entity) return 0;
        
        switch (coord) {
            case 'x': return entity.x;
            case 'y': return entity.y;
            case 'rotation': return entity.rotation;
            case 'direction': return entity.direction;
            case 'size': return entity.size;
            default: return 0;
        }
    }

    /**
     * 엔티티 클릭 확인
     */
    checkEntityClick(e) {
        const rect = this.renderer.canvas.getBoundingClientRect();
        const clickX = (e.clientX - rect.left) / rect.width * 480 - 240;
        const clickY = -((e.clientY - rect.top) / rect.height * 360 - 180);
        
        // 역순으로 검사 (위에 있는 것부터)
        const allEntities = [...this.entities, ...this.clones].reverse();
        
        for (const entity of allEntities) {
            if (!entity.visible) continue;
            
            if (entity.containsPoint(clickX, clickY)) {
                this.fireEvent('when_object_click', entity.id);
                return;
            }
        }
    }

    // ========== URL 헬퍼 ==========

    getPictureUrl(picture) {
        if (picture.fileurl) return picture.fileurl;
        const filename = picture.filename;
        return `https://playentry.org/uploads/${filename.slice(0,2)}/${filename.slice(2,4)}/image/${filename}.png`;
    }

    getSoundUrl(sound) {
        if (sound.fileurl) return sound.fileurl;
        const filename = sound.filename;
        return `https://playentry.org/uploads/${filename.slice(0,2)}/${filename.slice(2,4)}/sound/${filename}${sound.ext || '.mp3'}`;
    }

    /**
     * 리소스 정리
     */
    destroy() {
        this.stop();
        
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        this.renderer.destroy();
    }
}

/**
 * 터보 엔티티 클래스
 */
class TurboEntity {
    constructor(runtime, objData) {
        this.runtime = runtime;
        this.id = objData.id;
        this.name = objData.name;
        this.objectType = objData.objectType || 'sprite';
        
        // 위치/변환
        this.x = 0;
        this.y = 0;
        this.rotation = 0;
        this.direction = 90;
        this.scaleX = 1;
        this.scaleY = 1;
        this.size = 100;
        
        // 렌더링
        this.visible = true;
        this.zIndex = 0;
        this.ghost = 0;
        this.brightness = 0;
        
        // 코스튬
        this.costumes = [];
        this.currentCostumeIndex = 0;
        this.textureInfo = null;
        
        // 펜
        this.penDown = false;
        this.penColor = '#000000';
        this.penThickness = 1;
        this.lastPenX = 0;
        this.lastPenY = 0;
        
        // 다이얼로그
        this.dialog = null;
        
        // 복제 관련
        this.isClone = false;
        
        // 초기 상태 저장
        this.initialState = null;
        
        // 엔티티 데이터 로드
        if (objData.entity) {
            const e = objData.entity;
            this.x = e.x || 0;
            this.y = e.y || 0;
            this.rotation = e.rotation || 0;
            this.direction = e.direction || 90;
            this.scaleX = e.scaleX || 1;
            this.scaleY = e.scaleY || 1;
            this.visible = e.visible !== false;
        }
        
        // 초기 상태 저장
        this.saveInitialState();
    }

    saveInitialState() {
        this.initialState = {
            x: this.x,
            y: this.y,
            rotation: this.rotation,
            direction: this.direction,
            scaleX: this.scaleX,
            scaleY: this.scaleY,
            visible: this.visible,
            ghost: this.ghost,
            brightness: this.brightness,
            currentCostumeIndex: this.currentCostumeIndex
        };
    }

    reset() {
        if (!this.initialState) return;
        
        Object.assign(this, this.initialState);
        this.setCostume(this.initialState.currentCostumeIndex);
        this.penDown = false;
        this.dialog = null;
    }

    // ========== 이동 ==========

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
        const newX = this.x + distance * Math.cos(rad);
        const newY = this.y + distance * Math.sin(rad);
        this.setX(newX);
        this.setY(newY);
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

    // ========== 회전 ==========

    rotate(angle) {
        this.rotation = (this.rotation + angle) % 360;
    }

    setRotation(rotation) {
        this.rotation = rotation % 360;
    }

    setDirection(direction) {
        this.direction = direction % 360;
    }

    // ========== 형태 ==========

    setVisible(visible) {
        this.visible = visible;
    }

    setSize(size) {
        const scale = size / this.size;
        this.scaleX *= scale;
        this.scaleY *= scale;
        this.size = size;
    }

    setCostume(index) {
        if (index < 0 || index >= this.costumes.length) return;
        this.currentCostumeIndex = index;
        this.textureInfo = this.costumes[index].textureInfo;
    }

    nextCostume() {
        const next = (this.currentCostumeIndex + 1) % this.costumes.length;
        this.setCostume(next);
    }

    prevCostume() {
        const prev = (this.currentCostumeIndex - 1 + this.costumes.length) % this.costumes.length;
        this.setCostume(prev);
    }

    // ========== 효과 ==========

    setEffect(effect, value) {
        switch (effect) {
            case 'ghost':
                this.ghost = Math.max(0, Math.min(100, value));
                break;
            case 'brightness':
                this.brightness = Math.max(-100, Math.min(100, value));
                break;
        }
    }

    addEffect(effect, value) {
        switch (effect) {
            case 'ghost':
                this.ghost = Math.max(0, Math.min(100, this.ghost + value));
                break;
            case 'brightness':
                this.brightness = Math.max(-100, Math.min(100, this.brightness + value));
                break;
        }
    }

    clearEffects() {
        this.ghost = 0;
        this.brightness = 0;
    }

    // ========== 펜 ==========

    startDrawing() {
        this.penDown = true;
        this.lastPenX = this.x;
        this.lastPenY = this.y;
    }

    stopDrawing() {
        this.penDown = false;
    }

    setBrushColor(color) {
        this.penColor = color;
    }

    setBrushThickness(thickness) {
        this.penThickness = thickness;
    }

    drawPen(newX, newY) {
        this.runtime.renderer.drawPenLine(
            this.lastPenX, this.lastPenY,
            newX, newY,
            this.penColor, this.penThickness
        );
        this.lastPenX = newX;
        this.lastPenY = newY;
    }

    stamp() {
        this.runtime.renderer.stamp(this);
    }

    // ========== 충돌 ==========

    isTouching(targetId) {
        if (targetId === 'mouse') {
            return this.containsPoint(this.runtime.mouseX, this.runtime.mouseY);
        }
        
        if (targetId === 'wall' || targetId.startsWith('wall_')) {
            return this.isTouchingWall(targetId);
        }
        
        const target = this.runtime.objects.get(targetId);
        if (!target) return false;
        
        // 간단한 바운딩 박스 충돌
        return this.getBounds().intersects(target.getBounds());
    }

    isTouchingWall(wallType) {
        const bounds = this.getBounds();
        
        switch (wallType) {
            case 'wall':
                return bounds.left < -240 || bounds.right > 240 ||
                       bounds.top > 180 || bounds.bottom < -180;
            case 'wall_up':
                return bounds.top > 180;
            case 'wall_down':
                return bounds.bottom < -180;
            case 'wall_left':
                return bounds.left < -240;
            case 'wall_right':
                return bounds.right > 240;
        }
        return false;
    }

    getBounds() {
        const hw = (this.textureInfo?.width || 100) * Math.abs(this.scaleX) / 2;
        const hh = (this.textureInfo?.height || 100) * Math.abs(this.scaleY) / 2;
        
        return {
            left: this.x - hw,
            right: this.x + hw,
            top: this.y + hh,
            bottom: this.y - hh,
            intersects(other) {
                return !(this.left > other.right || this.right < other.left ||
                        this.top < other.bottom || this.bottom > other.top);
            }
        };
    }

    containsPoint(px, py) {
        const bounds = this.getBounds();
        return px >= bounds.left && px <= bounds.right &&
               py >= bounds.bottom && py <= bounds.top;
    }

    // ========== 복제 ==========

    clone() {
        const cloneEntity = new TurboEntity(this.runtime, {
            id: `${this.id}_clone_${Date.now()}`,
            name: this.name,
            objectType: this.objectType
        });
        
        cloneEntity.x = this.x;
        cloneEntity.y = this.y;
        cloneEntity.rotation = this.rotation;
        cloneEntity.direction = this.direction;
        cloneEntity.scaleX = this.scaleX;
        cloneEntity.scaleY = this.scaleY;
        cloneEntity.size = this.size;
        cloneEntity.visible = this.visible;
        cloneEntity.ghost = this.ghost;
        cloneEntity.brightness = this.brightness;
        cloneEntity.costumes = this.costumes;
        cloneEntity.currentCostumeIndex = this.currentCostumeIndex;
        cloneEntity.textureInfo = this.textureInfo;
        cloneEntity.isClone = true;
        
        return cloneEntity;
    }

    destroy() {
        if (this.isClone) {
            const idx = this.runtime.clones.indexOf(this);
            if (idx !== -1) {
                this.runtime.clones.splice(idx, 1);
            }
        }
        this.visible = false;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TurboRuntime, TurboEntity };
}
