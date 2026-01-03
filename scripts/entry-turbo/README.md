# Entry Turbo Runtime

EntryJS 프로젝트를 최적화하여 실행하는 독립 런타임입니다.

## 특징

- **독립 실행**: 기존 EntryJS 없이도 Entry 프로젝트 실행 가능
- **JIT 컴파일**: 블록을 최적화된 JavaScript로 컴파일
- **고성능 렌더러**: WebGL 기반 렌더링
- **최소 의존성**: 단일 스크립트 파일로 로드 가능

## 사용법

```html
<canvas id="entry-turbo-canvas" width="480" height="360"></canvas>
<script src="entry-turbo.min.js"></script>
<script>
  // 프로젝트 JSON 로드
  EntryTurbo.load(projectJson).then(runtime => {
    runtime.start();
  });
</script>
```

## API

- `EntryTurbo.load(projectJson)` - 프로젝트 로드
- `EntryTurbo.start()` - 실행 시작
- `EntryTurbo.stop()` - 실행 중지
- `EntryTurbo.pause()` - 일시정지

## 라이선스

MIT License
