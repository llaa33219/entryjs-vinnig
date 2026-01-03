# Entry Turbo Runtime ⚡

EntryJS 프로젝트를 최적화하여 실행하는 **단일 파일** 독립 런타임입니다.

## 특징

- 🚀 **단일 파일**: `entry-turbo.min.js` 하나만 배포하면 끝
- 🔧 **독립 실행**: 기존 EntryJS 없이도 Entry 프로젝트 실행 가능
- ⚡ **JIT 컴파일**: 블록을 최적화된 JavaScript로 컴파일
- 🎨 **고성능 렌더러**: Canvas2D/WebGL 하이브리드 렌더링
- 📦 **최소 의존성**: 외부 라이브러리 없음 (20KB gzipped)

## 파일 구조

```
entry-turbo/
├── src/
│   └── entry-turbo.js    # 소스 (단일 파일)
├── dist/
│   ├── entry-turbo.js    # 개발용
│   └── entry-turbo.min.js # 배포용 (압축)
├── example/
│   └── index.html        # 데모
├── build.sh              # 빌드 스크립트
└── README.md
```

## 빠른 시작

```html
<canvas id="entry-canvas" width="480" height="360"></canvas>
<script src="entry-turbo.min.js"></script>
<script>
  // 초기화 → 로드 → 실행
  EntryTurbo.init('#entry-canvas');
  EntryTurbo.load(projectJson).then(() => {
    EntryTurbo.start();
  });
</script>
```

## 다른 서버에서 사용하기

```html
<!-- CDN이나 자체 서버에서 로드 -->
<script src="https://your-server.com/entry-turbo.min.js"></script>
<script>
  // Entry 프로젝트 ID로 직접 로드
  EntryTurbo.init('#canvas');
  EntryTurbo.loadFromUrl('https://playentry.org/api/project/PROJECT_ID')
    .then(() => EntryTurbo.start());
</script>
```

## API

| 메서드 | 설명 |
|--------|------|
| `EntryTurbo.init(canvas)` | 캔버스 초기화 |
| `EntryTurbo.load(json)` | 프로젝트 JSON 로드 |
| `EntryTurbo.loadFromUrl(url)` | URL에서 로드 |
| `EntryTurbo.start()` | 실행 시작 |
| `EntryTurbo.stop()` | 실행 중지 |
| `EntryTurbo.togglePause()` | 일시정지/재개 |
| `EntryTurbo.destroy()` | 리소스 정리 |

## 빌드

```bash
cd scripts/entry-turbo
./build.sh
```

## 라이선스

MIT License
