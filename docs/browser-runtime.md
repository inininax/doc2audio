# 브라우저 실행과 정적 배포

## 운영 구조

서버는 `apps/web/dist/`의 HTML·JavaScript·WASM·문서 처리 파일을 제공하고, 사용자 브라우저가 모델 다운로드·문서 읽기·OCR·음성 생성·MP3 저장을 담당합니다. 기본 웹 모드에는 변환 API 서버, Python, MLX, ffmpeg를 설치하지 않습니다.

모델은 Supertonic 3이며 리비전 `3cadd1ee6394adea1bd021217a0e650ede09a323`과 파일별 크기·SHA-256을 `apps/web/src/browser/model-manifest.json`에 고정합니다. 추론은 Web Worker 안에서 ONNX Runtime Web의 WASM 실행기를 사용합니다. 단일 스레드 추론이므로 현재 구현에 SharedArrayBuffer용 COOP·COEP 헤더는 필수가 아닙니다.

## 빌드와 로컬 확인

Node.js 22.20 이상(22.x), 24.12 이상(24.x), 또는 26 이상에서 프로젝트 루트 기준으로 실행합니다. 이 범위는 잠금 파일에 포함된 PDF.js와 플랫폼별 빌드 의존성의 Node 요구사항을 함께 충족합니다.

```bash
npm ci
npm run build
npm run preview
```

`http://127.0.0.1:4173`에서 빌드 결과를 확인합니다. `npm run dev`는 `127.0.0.1:5173`이며 개발 모드에서는 서비스 워커를 등록하지 않습니다. 오프라인 준비·재접속 검증은 빌드 후 preview 또는 HTTPS 정적 호스팅에서 진행합니다.

빌드는 다음 작업을 포함합니다.

1. `scripts/prepare-web-runtime.mjs`: npm 패키지에서 ONNX WASM, PDF.js 워커·글꼴·CMap, Tesseract 워커·WASM·한국어/영어 데이터를 `apps/web/public/runtime/`으로 복사합니다. 이 실행 파일들을 원격 CDN에서 동적으로 가져오지 않습니다.
2. TypeScript 검사와 Vite 빌드: 화면·코드·실행 파일을 `apps/web/dist/`에 생성합니다.
3. `scripts/build-web-cache.mjs`: 배포 파일 내용으로 캐시 버전을 계산하고 `apps/web/dist/sw.js`를 만듭니다.

`public/runtime/`과 `dist/`는 생성물이며 Git에서 제외합니다. 깨끗한 체크아웃에서도 `npm ci` 후 빌드하면 준비됩니다. 최초 의존성 설치에는 인터넷이 필요하며 이후 빌드는 설치된 패키지 파일을 사용합니다.

## 정적 호스팅 설정

**`apps/web/dist/` 전체를 HTTPS 정적 호스팅에 배포합니다.** `runtime/`, 해시가 붙은 `assets/`, 라이선스 고지, `sw.js`를 포함합니다. localhost 개발 예외를 제외하면 HTTPS가 필요합니다. `file://`로 HTML을 여는 방식은 지원하지 않습니다.

| 파일 | 응답 설정 |
| --- | --- |
| `.wasm` | `Content-Type: application/wasm` |
| `.mjs`, `.js`, `sw.js` | `Content-Type: text/javascript` 또는 `application/javascript` |
| `.html` | `Content-Type: text/html` |
| `.traineddata.gz` | 압축된 OCR 데이터 자체를 제공하므로 보통 `application/octet-stream`을 사용합니다. 확장자만 보고 `Content-Encoding: gzip`을 붙이지 않습니다. |
| `sw.js`, `index.html` | 새 배포를 확인할 수 있도록 `Cache-Control: no-cache` 권장 |

누락된 `.wasm`·`.mjs` 경로에 SPA fallback으로 HTML을 반환하면 실행되지 않습니다. 정적 자산은 실제 파일을 제공하고 누락 시 404를 반환하도록 설정합니다. 화면 경로는 해시(`/#history` 등)를 사용하므로 별도 서버 라우팅이 필요하지 않습니다. 외부 CDN 스크립트나 변환 서버 API 주소를 추가하지 않아도 됩니다.

모델은 브라우저가 고정 Hugging Face 주소에서 직접 받습니다. 배포 호스트의 콘텐츠 보안 정책이나 사용자 네트워크가 이 연결을 차단하면 다운로드가 실패하므로 배포 환경에서 실제 다운로드를 확인하세요. 문서와 생성 음성은 모델 다운로드 요청에 포함하지 않습니다.

Vite preview는 로컬 확인용입니다. 이 문서는 배포 방법을 설명하며 실제 호스팅 계정 생성이나 외부 배포를 수행하지 않습니다.

### 하위 경로 배포

`https://example.com/doc2audio/`에 올릴 때는 빌드 단계에서 경로를 지정합니다. 끝의 `/`를 포함합니다.

```bash
DOC2AUDIO_BASE=/doc2audio/ npm run build
```

생성된 `dist/` 전체를 해당 경로에 올립니다. 런타임 자산과 서비스 워커 범위가 같은 경로를 사용합니다. 경로를 옮길 때는 맞는 `DOC2AUDIO_BASE`로 다시 빌드하세요.

IndexedDB는 경로가 아닌 **프로토콜·호스트·포트**로 구분됩니다. 같은 출처에서 하위 경로만 변경하면 `doc2audio-browser` 보관함을 공유합니다. 다른 도메인, HTTP→HTTPS, 포트 변경은 다른 보관함이므로 기존 기록이 자동 이동하지 않습니다. 개발 서버 5173, preview 4173, Python 서버 8010도 서로 다른 출처입니다. 하위 경로마다 서비스 워커 캐시는 따로 준비됩니다.

## 종료·재접속과 데이터 보관

브라우저 종료 중에는 추론이 실행되지 않습니다. 다시 사이트를 열면 실행 잠금을 획득한 탭이 이전 `running` 작업을 대기열로 복구하고 완료 구간을 검증하여 이어갑니다. `queued`도 순서대로 자동 실행합니다. `paused`, `failed`, `cancelled`는 사용자가 이어하기·재시도를 선택합니다.

원문·설정·분할 본문·완성 MP3는 IndexedDB `doc2audio-browser`의 `jobs`, 중간 PCM은 `chunks`, 모델은 `assets`, 다운로드 조각은 `assetParts`에 저장합니다. 프로젝트의 `.models/` 폴더에 모델이 있어도 브라우저에서는 별도 다운로드가 필요합니다. 작업은 같은 브라우저 프로필과 같은 출처에서 확인할 수 있으며 PC·브라우저 간 자동 동기화는 제공하지 않습니다.

구간 저장은 해시 검증과 트랜잭션을 사용합니다. Web Locks와 실행 토큰 검사는 탭 중복 실행이나 중단 전 작업의 늦은 결과가 현재 상태를 덮어쓰는 것을 막습니다. 최종 MP3 인코딩은 구간을 순차 읽어 처리하며, 도중 종료되면 다음 실행에서 완료 구간으로 MP3를 다시 결합합니다. 배속 필터의 마지막 음성도 모두 저장한 뒤 완료합니다.

모델 다운로드는 4 MiB 단위로 저장하고 서버의 HTTP Range 지원에 맞춰 이어받습니다. Range를 무시하는 응답에서는 해당 파일을 처음부터 다시 받습니다. 완료된 파일은 SHA-256과 크기가 고정 명세와 일치해야 사용합니다.

`navigator.storage.persist()`는 브라우저에 영구 보관을 요청하는 기능입니다. 브라우저가 거절할 수 있으며 거절해도 일반 IndexedDB 저장이 가능하면 앱을 사용할 수 있습니다. 허용되어도 사용자의 사이트 데이터 삭제·프로필 삭제를 막지는 않습니다. 저장 공간 부족 시 오류를 표시하고 완료 구간을 보관합니다. 필요한 MP3를 파일로 내보낸 뒤 불필요한 작업을 삭제할 수 있습니다.

## 오프라인 준비와 업데이트

서비스 워커는 배포된 화면·코드·PDF/OCR·WASM 파일을 먼저 캐시에 저장합니다. 활성화 이후 해당 파일은 캐시를 우선 사용합니다. 모델은 별도 IndexedDB 저장이므로 **화면의 오프라인 준비와 모델 다운로드가 모두 끝나야** 인터넷 없이 신규 변환과 이어하기를 실행할 수 있습니다. 준비 전에 네트워크가 끊기거나 브라우저가 캐시를 제거하면 다시 온라인으로 준비해야 합니다.

새 배포의 서비스 워커는 준비가 끝나도 `skipWaiting()`으로 현재 작업 화면을 강제로 교체하지 않습니다. 기존 서비스 워커를 사용하는 탭을 닫은 뒤 새 버전이 활성화되며, 활성화 시 같은 배포 경로의 오래된 화면 캐시를 정리합니다. 모델·작업 IndexedDB는 이 정리 대상이 아닙니다. 파이프라인이나 모델 리비전이 달라 이어갈 수 없는 작업은 오류로 안내하며 임의로 다른 모델 결과를 섞지 않습니다.

## 지원 범위와 검증

보안 컨텍스트의 IndexedDB, Web Locks, Web Worker, WebAssembly, Web Crypto를 사용하며 오프라인 재접속에는 Service Worker와 Cache Storage가 필요합니다. 최신 브라우저라도 기기 메모리, 저장 공간, 시크릿 모드, 조직 정책에 따라 기능이 제한될 수 있습니다. 모든 브라우저·모바일 기기에서 동작한다고 보장하지 않습니다. 실제 검사한 환경과 작업 결과는 [검증 기록](validation.md)을 확인하세요.

배포 전에는 실제 모델 다운로드, 각 문서 형식과 스캔 OCR, 변환 중 탭 종료·재접속, 수동 일시정지·재시도, 여러 탭, MP3 재생, 오프라인 새로고침을 확인합니다. 다음 명령은 코드 수준 검사이며 실제 브라우저 검증을 대체하지 않습니다.

```bash
npm run check
npm run test:web
npm run format:check
npm run build
```

검증용 문서·음성·보고서의 프로젝트 내 위치는 `output/browser/`입니다. 브라우저의 IndexedDB·Cache Storage는 운영체제의 브라우저 프로필에 있고, npm·uv·브라우저 자체 캐시도 각 도구가 관리하는 사용자 캐시 위치를 사용할 수 있습니다. 사용자가 MP3 저장 위치를 선택하면 그 위치에 일반 파일로 내보냅니다.
