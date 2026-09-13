# doc2audio 모노레포 설계

## 디렉터리와 실행 경로

```text
apps/
  cli/                    기존 Python CLI (배포 이름: doc2audio)
  server/                 선택적 FastAPI·SQLite 로컬 서버
  web/                    React·TypeScript·Material UI 웹
    src/
      api.ts              기본 browser / 명시적 runtime=local 선택
      browser/
        catalog.ts        브라우저 모델 옵션·입력 검증
        model-manifest.json  Supertonic 3 리비전·파일 SHA-256
        storage.ts        IndexedDB 원문·기록·모델·음성 구간
        download.ts       HTTP Range 다운로드·저장 지점 복구
        documents.ts      PDF·DOCX·DOC·TXT·한국어/영어 OCR
        ocr-client.ts     초기화 전부터 OCR 워커 소유·종료
        ocr.worker.ts     Tesseract 공개 API 실행 브리지
        service.ts        브라우저 대기열·복구·수명 관리
        speech-client.ts  추론 워커 호출·종료
        tts.worker.ts     모델 추론 Web Worker
        tts.ts            Supertonic ONNX/WASM 추론
        encode.ts         배속 조절·스트리밍 MP3 인코딩
        offline.ts        서비스 워커 등록
    public/runtime/       빌드 전 복사하는 실행 파일 (Git 제외)
    dist/                 정적 배포 결과·생성 sw.js (Git 제외)
packages/
  engine/                 기존 Python 공용 엔진 (doc2audio-core)
    src/doc2audio/        Qwen·Supertonic, 문서 처리·캐시·ffmpeg
scripts/
  prepare-web-runtime.mjs  WASM·PDF·OCR 파일 복사
  build-web-cache.mjs      오프라인 서비스 워커 생성
  verify_*.py             실제 Python 실행 검증
```

기본 웹 모드는 HTTP API 대신 `browser/service.ts`를 통해 사용자 브라우저에서 작업을 실행합니다. 문서·모델·음성을 Python 서버와 공유하지 않습니다. 추론은 Web Worker의 ONNX Runtime Web WASM 실행기를 사용하며 Python·MLX·ffmpeg가 필요하지 않습니다. 모델 다운로드에는 고정한 공개 Hugging Face 주소를 사용합니다.

`?runtime=local`을 명시하면 웹이 기존 `/api`를 호출합니다. 이 경로의 CLI와 서버는 `packages/engine`에 의존하며, 엔진은 웹·HTTP·SQLite에 의존하지 않습니다. Python은 uv workspace의 `uv.lock`, 웹은 npm workspace의 `package-lock.json`을 사용합니다.

## 브라우저 작업과 복구

신규 작업은 설정과 원문 Blob을 IndexedDB에 저장한 뒤 대기열에 추가합니다. 추출·분할한 본문과 모델 리비전·설정·파이프라인 버전으로 입력 지문을 만들고, 구간마다 PCM과 SHA-256을 저장합니다. 구간 저장과 완료 구간 수 갱신은 하나의 트랜잭션으로 처리합니다.

| 상태 | 브라우저에서의 의미 |
| --- | --- |
| queued | 실행 대기. 접속한 실행 탭이 순서대로 처리 |
| running | 모델 다운로드·문서 추출·음성 생성·MP3 결합 중 |
| paused | 사용자가 일시정지. 수동으로 이어하기 |
| completed | 완성 MP3까지 저장 |
| failed | 오류 기록. 원인 해결 후 수동 재시도 |
| cancelled | 사용자 취소. 완료 구간을 유지하고 재시도 가능 |

Web Locks의 `doc2audio-browser-runner` 잠금으로 같은 출처의 여러 탭 중 하나만 실행합니다. 실행마다 발급한 토큰과 예상 상태를 검사하는 조건부 갱신으로, 이전 실행이 늦게 반환한 결과가 일시정지·취소된 작업을 덮어쓰지 못하게 합니다. BroadcastChannel은 탭 사이 변경 알림에 사용합니다.

닫힌 탭의 `running` 작업은 다음 실행 잠금 획득 후 `queued`로 복구되어 자동 재개합니다. `paused`, `failed`, `cancelled`는 임의로 시작하지 않습니다. 완료 구간은 입력 지문·버전·샘플레이트·SHA-256을 확인하여 재사용하고, 없거나 손상된 구간만 재생성합니다. MP3 인코더에는 IndexedDB에서 읽은 구간을 순차 전달하여 문서 전체 PCM을 한꺼번에 메모리에 합치지 않습니다.

OCR은 앱이 직접 소유하는 워커 안에서 Tesseract를 초기화합니다. SDK가 초기화 실패 후 Promise를 해결하지 않아도 브리지가 오류를 전달하고 소유 워커를 종료하므로 작업 대기열을 붙잡지 않습니다.

브라우저가 닫힌 동안 추론이 계속되는 구조는 아닙니다. 재접속 시 저장된 지점부터 계산을 다시 진행합니다. 본문 추출 도중 닫혔다면 원문에서 다시 추출하고, MP3 결합 도중 닫혔다면 완료 구간으로 다시 결합합니다.

## 브라우저 저장 영역

사이트 출처별 IndexedDB `doc2audio-browser`의 저장소는 다음과 같습니다.

| 저장소 | 내용 |
| --- | --- |
| jobs | 설정·원문·분할 본문·상태·진행 기록·완성 MP3 |
| chunks | 구간별 PCM, 샘플레이트·입력 지문·SHA-256 |
| assets | 리비전별 검증된 모델 Blob과 크기·SHA-256 |
| assetParts | 모델 파일별 다운로드 오프셋과 부분 Blob |

모델 다운로드는 4 MiB 단위 HTTP Range와 부분 저장을 사용합니다. 재접속 시 연속 저장된 부분 다음부터 요청합니다. 서버가 Range를 무시하고 전체 응답을 주면 해당 파일의 부분 데이터를 초기화하고 다시 받습니다. 잘못된 응답 범위·크기는 거부하며, 완성 파일의 SHA-256이 일치한 뒤에만 준비된 모델로 등록합니다. 모델을 실제로 읽을 때도 해시를 확인합니다.

웹 화면·실행 WASM·PDF·OCR 데이터는 서비스 워커 Cache Storage에 보관합니다. 원문·모델 다운로드 요청을 일반 웹 캐시에 넣지는 않습니다. 저장 공간·출처·업데이트 정책은 [브라우저 실행·배포 안내](browser-runtime.md)에 설명합니다.

## 선택적 Python 실행 경로

Python 서버는 원본을 로컬 디렉터리에 저장하고 SQLite에 요청을 기록합니다. 스케줄러는 대기 작업을 하나씩 별도 Python 프로세스에서 실행합니다. 브라우저를 닫아도 서버가 실행 중이면 계속 진행하며, 서버 재시작 시 중단 작업은 수동 재시도합니다.

- 작업 DB: `.doc2audio/jobs.sqlite3` (SQLite WAL)
- 원문·MP3·로그: `.doc2audio/jobs/<job-id>/`
- 모델: `.models/`
- 경로 설정: `DOC2AUDIO_DATA_DIR`, `DOC2AUDIO_MODELS_DIR`

서버는 `127.0.0.1`에 바인딩하는 로컬 사용 경로이며 쓰기 요청의 전용 헤더·Origin과 업로드 이름을 검증합니다. 공개 웹 배포에서 이 서버를 실행할 필요는 없습니다. 브라우저 보관함과 Python 폴더를 자동 동기화하지 않습니다.

## 개발·배포와 모델 확장

```bash
npm ci
npm run dev          # 127.0.0.1:5173, 기본 브라우저 모드
npm run check
npm run test:web
npm run build
npm run preview      # 127.0.0.1:4173, 빌드·오프라인 확인
```

공개 배포 단위는 `apps/web/dist/` 전체입니다. 개발 서버의 `/api` 프록시는 선택적 로컬 모드에만 필요합니다. Python 개발·배포 명령은 기존대로 유지합니다.

```bash
uv sync --locked
uv run doc2audio-server
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv build --all-packages
```

브라우저 카탈로그에는 실제 브라우저 런타임으로 지원·검증한 모델만 추가합니다. 현재는 Supertonic 3이며 기존 Python 카탈로그를 그대로 노출하지 않습니다. 확장하려면 모델 카드·사용 조건, 고정 리비전·파일 해시, 브라우저 추론 어댑터, 옵션 검증, 실제 생성·오프라인·복구 검증을 함께 추가해야 합니다. Qwen의 Python·MLX 구현을 브라우저에서 그대로 실행하지는 않습니다.

실제 실행 환경과 검증 결과는 [검증 기록](validation.md)을 기준으로 확인합니다.
