/**
 * Entry Turbo Renderer
 * 고성능 WebGL/Canvas2D 하이브리드 렌더러
 */

class TurboRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = null;
        this.gl = null;
        this.isWebGL = false;
        
        // 스프라이트 배치 렌더링
        this.spriteBatch = [];
        this.maxBatchSize = 1000;
        
        // 텍스처 캐시
        this.textureCache = new Map();
        
        // 펜 레이어
        this.penCanvas = null;
        this.penCtx = null;
        
        // 다이얼로그 레이어
        this.dialogCanvas = null;
        this.dialogCtx = null;
        
        // 변환 행렬 풀
        this.matrixPool = [];
        
        // 더티 플래그
        this.dirty = true;
        
        this.init();
    }

    init() {
        // WebGL 시도
        try {
            this.gl = this.canvas.getContext('webgl2', {
                alpha: false,
                antialias: false,
                preserveDrawingBuffer: true
            }) || this.canvas.getContext('webgl', {
                alpha: false,
                antialias: false,
                preserveDrawingBuffer: true
            });
            
            if (this.gl) {
                this.isWebGL = true;
                this.initWebGL();
            }
        } catch (e) {
            console.warn('WebGL not available, falling back to Canvas2D');
        }
        
        // Canvas2D 폴백
        if (!this.isWebGL) {
            this.ctx = this.canvas.getContext('2d', {
                alpha: false,
                willReadFrequently: false
            });
            this.initCanvas2D();
        }
        
        // 펜 레이어 초기화
        this.initPenLayer();
        
        // 다이얼로그 레이어 초기화
        this.initDialogLayer();
    }

    initWebGL() {
        const gl = this.gl;
        
        // 셰이더 컴파일
        const vertexShader = this.compileShader(gl.VERTEX_SHADER, `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            attribute vec4 a_color;
            
            uniform vec2 u_resolution;
            uniform mat3 u_matrix;
            
            varying vec2 v_texCoord;
            varying vec4 v_color;
            
            void main() {
                vec2 position = (u_matrix * vec3(a_position, 1)).xy;
                vec2 clipSpace = (position / u_resolution) * 2.0 - 1.0;
                gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
                v_texCoord = a_texCoord;
                v_color = a_color;
            }
        `);
        
        const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, `
            precision mediump float;
            
            varying vec2 v_texCoord;
            varying vec4 v_color;
            
            uniform sampler2D u_texture;
            uniform float u_brightness;
            uniform float u_ghost;
            
            void main() {
                vec4 texColor = texture2D(u_texture, v_texCoord);
                texColor.rgb += u_brightness;
                texColor.a *= (1.0 - u_ghost);
                gl_FragColor = texColor * v_color;
            }
        `);
        
        // 프로그램 생성
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);
        
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Shader program failed to link');
            return;
        }
        
        gl.useProgram(this.program);
        
        // 어트리뷰트/유니폼 위치 저장
        this.locations = {
            position: gl.getAttribLocation(this.program, 'a_position'),
            texCoord: gl.getAttribLocation(this.program, 'a_texCoord'),
            color: gl.getAttribLocation(this.program, 'a_color'),
            resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            matrix: gl.getUniformLocation(this.program, 'u_matrix'),
            texture: gl.getUniformLocation(this.program, 'u_texture'),
            brightness: gl.getUniformLocation(this.program, 'u_brightness'),
            ghost: gl.getUniformLocation(this.program, 'u_ghost')
        };
        
        // 버퍼 생성
        this.positionBuffer = gl.createBuffer();
        this.texCoordBuffer = gl.createBuffer();
        this.colorBuffer = gl.createBuffer();
        
        // 블렌딩 설정
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        
        // 해상도 설정
        gl.uniform2f(this.locations.resolution, this.canvas.width, this.canvas.height);
    }

    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }

    initCanvas2D() {
        const ctx = this.ctx;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
    }

    initPenLayer() {
        this.penCanvas = document.createElement('canvas');
        this.penCanvas.width = this.canvas.width;
        this.penCanvas.height = this.canvas.height;
        this.penCtx = this.penCanvas.getContext('2d');
    }

    initDialogLayer() {
        this.dialogCanvas = document.createElement('canvas');
        this.dialogCanvas.width = this.canvas.width;
        this.dialogCanvas.height = this.canvas.height;
        this.dialogCtx = this.dialogCanvas.getContext('2d');
    }

    /**
     * 텍스처 로드 (캐시됨)
     */
    async loadTexture(url) {
        if (this.textureCache.has(url)) {
            return this.textureCache.get(url);
        }
        
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
                let texture;
                
                if (this.isWebGL) {
                    texture = this.createWebGLTexture(img);
                } else {
                    texture = img;
                }
                
                const textureInfo = {
                    texture,
                    width: img.width,
                    height: img.height,
                    image: img
                };
                
                this.textureCache.set(url, textureInfo);
                resolve(textureInfo);
            };
            
            img.onerror = reject;
            img.src = url;
        });
    }

    createWebGLTexture(image) {
        const gl = this.gl;
        const texture = gl.createTexture();
        
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        
        return texture;
    }

    /**
     * 프레임 시작
     */
    beginFrame() {
        this.spriteBatch = [];
        
        if (this.isWebGL) {
            const gl = this.gl;
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.clearColor(1, 1, 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
        } else {
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    /**
     * 스프라이트를 배치에 추가
     */
    addSprite(sprite) {
        this.spriteBatch.push(sprite);
        
        if (this.spriteBatch.length >= this.maxBatchSize) {
            this.flushBatch();
        }
    }

    /**
     * 배치 렌더링
     */
    flushBatch() {
        if (this.spriteBatch.length === 0) return;
        
        // Z-order로 정렬
        this.spriteBatch.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        
        if (this.isWebGL) {
            this.renderBatchWebGL();
        } else {
            this.renderBatchCanvas2D();
        }
        
        this.spriteBatch = [];
    }

    renderBatchWebGL() {
        const gl = this.gl;
        
        for (const sprite of this.spriteBatch) {
            if (!sprite.visible || !sprite.textureInfo) continue;
            
            const tex = sprite.textureInfo;
            const w = tex.width * sprite.scaleX;
            const h = tex.height * sprite.scaleY;
            
            // 위치 버퍼 설정
            const positions = new Float32Array([
                -w/2, -h/2,
                w/2, -h/2,
                -w/2, h/2,
                -w/2, h/2,
                w/2, -h/2,
                w/2, h/2
            ]);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(this.locations.position);
            gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
            
            // 텍스처 좌표 버퍼
            const texCoords = new Float32Array([
                0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1
            ]);
            
            gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(this.locations.texCoord);
            gl.vertexAttribPointer(this.locations.texCoord, 2, gl.FLOAT, false, 0, 0);
            
            // 변환 행렬 설정
            const matrix = this.createTransformMatrix(sprite);
            gl.uniformMatrix3fv(this.locations.matrix, false, matrix);
            
            // 이펙트 설정
            gl.uniform1f(this.locations.brightness, (sprite.brightness || 0) / 100);
            gl.uniform1f(this.locations.ghost, (sprite.ghost || 0) / 100);
            
            // 텍스처 바인딩 및 렌더링
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex.texture);
            gl.uniform1i(this.locations.texture, 0);
            
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }

    renderBatchCanvas2D() {
        const ctx = this.ctx;
        
        for (const sprite of this.spriteBatch) {
            if (!sprite.visible || !sprite.textureInfo) continue;
            
            const tex = sprite.textureInfo;
            
            ctx.save();
            
            // 변환 적용
            ctx.translate(
                this.canvas.width / 2 + sprite.x,
                this.canvas.height / 2 - sprite.y
            );
            ctx.rotate(-sprite.rotation * Math.PI / 180);
            ctx.scale(sprite.scaleX, sprite.scaleY);
            
            // 투명도
            ctx.globalAlpha = 1 - (sprite.ghost || 0) / 100;
            
            // 밝기 필터
            if (sprite.brightness) {
                ctx.filter = `brightness(${100 + sprite.brightness}%)`;
            }
            
            // 이미지 그리기
            ctx.drawImage(
                tex.image,
                -tex.width / 2,
                -tex.height / 2,
                tex.width,
                tex.height
            );
            
            ctx.restore();
        }
    }

    /**
     * 변환 행렬 생성 (WebGL용)
     */
    createTransformMatrix(sprite) {
        const cos = Math.cos(-sprite.rotation * Math.PI / 180);
        const sin = Math.sin(-sprite.rotation * Math.PI / 180);
        const tx = this.canvas.width / 2 + sprite.x;
        const ty = this.canvas.height / 2 - sprite.y;
        
        return new Float32Array([
            cos, sin, 0,
            -sin, cos, 0,
            tx, ty, 1
        ]);
    }

    /**
     * 펜 그리기
     */
    drawPenLine(x1, y1, x2, y2, color, thickness) {
        const ctx = this.penCtx;
        const cx = this.penCanvas.width / 2;
        const cy = this.penCanvas.height / 2;
        
        ctx.strokeStyle = color;
        ctx.lineWidth = thickness;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(cx + x1, cy - y1);
        ctx.lineTo(cx + x2, cy - y2);
        ctx.stroke();
        
        this.dirty = true;
    }

    /**
     * 펜 레이어 클리어
     */
    clearPen() {
        this.penCtx.clearRect(0, 0, this.penCanvas.width, this.penCanvas.height);
        this.dirty = true;
    }

    /**
     * 스탬프 찍기
     */
    stamp(sprite) {
        if (!sprite.textureInfo) return;
        
        const ctx = this.penCtx;
        const tex = sprite.textureInfo;
        
        ctx.save();
        ctx.translate(
            this.penCanvas.width / 2 + sprite.x,
            this.penCanvas.height / 2 - sprite.y
        );
        ctx.rotate(-sprite.rotation * Math.PI / 180);
        ctx.scale(sprite.scaleX, sprite.scaleY);
        ctx.globalAlpha = 1 - (sprite.ghost || 0) / 100;
        
        ctx.drawImage(
            tex.image,
            -tex.width / 2,
            -tex.height / 2,
            tex.width,
            tex.height
        );
        
        ctx.restore();
        this.dirty = true;
    }

    /**
     * 다이얼로그 렌더링
     */
    renderDialog(entity, text, type = 'speak') {
        const ctx = this.dialogCtx;
        const x = this.dialogCanvas.width / 2 + entity.x;
        const y = this.dialogCanvas.height / 2 - entity.y - 50;
        
        ctx.clearRect(0, 0, this.dialogCanvas.width, this.dialogCanvas.height);
        
        if (!text) return;
        
        // 말풍선 배경
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        
        const padding = 10;
        ctx.font = '14px sans-serif';
        const textWidth = ctx.measureText(text).width;
        const boxWidth = textWidth + padding * 2;
        const boxHeight = 30;
        
        // 둥근 사각형 그리기
        const boxX = x - boxWidth / 2;
        const boxY = y - boxHeight;
        
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
        ctx.fill();
        ctx.stroke();
        
        // 말풍선 꼬리
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // 텍스트
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y - boxHeight / 2);
        
        this.dirty = true;
    }

    /**
     * 다이얼로그 제거
     */
    clearDialog() {
        this.dialogCtx.clearRect(0, 0, this.dialogCanvas.width, this.dialogCanvas.height);
        this.dirty = true;
    }

    /**
     * 프레임 종료 및 합성
     */
    endFrame() {
        this.flushBatch();
        
        // 펜 레이어 합성
        if (this.isWebGL) {
            // WebGL에서는 2D 캔버스를 텍스처로 사용
            this.compositeCanvasToWebGL(this.penCanvas);
        } else {
            this.ctx.drawImage(this.penCanvas, 0, 0);
        }
        
        // 다이얼로그 레이어 합성
        if (this.isWebGL) {
            this.compositeCanvasToWebGL(this.dialogCanvas);
        } else {
            this.ctx.drawImage(this.dialogCanvas, 0, 0);
        }
        
        this.dirty = false;
    }

    compositeCanvasToWebGL(canvas) {
        // WebGL에 2D 캔버스 합성을 위한 별도 처리
        // 여기서는 간단히 2D 컨텍스트로 덮어쓰기
        const tempCtx = this.canvas.getContext('2d');
        if (tempCtx) {
            tempCtx.drawImage(canvas, 0, 0);
        }
    }

    /**
     * 리소스 정리
     */
    destroy() {
        if (this.isWebGL && this.gl) {
            // WebGL 리소스 정리
            this.textureCache.forEach(({ texture }) => {
                this.gl.deleteTexture(texture);
            });
            this.gl.deleteProgram(this.program);
            this.gl.deleteBuffer(this.positionBuffer);
            this.gl.deleteBuffer(this.texCoordBuffer);
            this.gl.deleteBuffer(this.colorBuffer);
        }
        
        this.textureCache.clear();
    }

    /**
     * 캔버스 크기 변경
     */
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.penCanvas.width = width;
        this.penCanvas.height = height;
        this.dialogCanvas.width = width;
        this.dialogCanvas.height = height;
        
        if (this.isWebGL) {
            this.gl.viewport(0, 0, width, height);
            this.gl.uniform2f(this.locations.resolution, width, height);
        }
        
        this.dirty = true;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TurboRenderer;
}
