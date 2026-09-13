# 프로젝트 정보

## 범위와 실행 환경

- 목적: PDF·DOCX·DOC·UTF-8 TXT를 사용자 PC에서 한국어 MP3로 변환한다.
- 웹: React·TypeScript·Vite, ONNX Runtime Web/WASM, IndexedDB. 기본 모델은 Supertonic 3이다.
- CLI·로컬 서버: Python 3.12, Apple Silicon macOS, MLX-Audio, FastAPI, SQLite, ffmpeg. 기본 모델은 Qwen3-TTS 1.7B CustomVoice MLX 8bit·Sohee이며 Qwen 0.6B와 Supertonic 3도 지원한다.
- 코드 위치: `apps/web/`, `apps/cli/`, `apps/server/`, `packages/engine/`. 패키지 관리는 npm workspaces와 uv workspace를 사용한다.
- 설치와 사용자 설명의 원본은 [설치 안내](../docs/installation.md)와 [사용 안내](../docs/usage.md)이다. README는 이 두 문서의 진입점으로 유지한다.

## 실행과 검증

프로젝트 루트에서 실행한다. 지원하는 Node 버전은 `package.json`, Python·의존성은 각 `pyproject.toml`과 잠금 파일을 기준으로 확인한다.

| 용도 | 명령 |
| --- | --- |
| 공통 AI 환경 확인 | `python3 scripts/ai-env.py check` |
| Python 의존성 설치 | `uv sync --locked` |
| 모델 다운로드·환경 확인 | `uv run doc2audio download`, `uv run doc2audio doctor` |
| 문서 변환 | `uv run doc2audio "문서.pdf" -o "결과.mp3"` |
| 로컬 웹 서버 | `uv run doc2audio-server` → `http://127.0.0.1:8010/?runtime=local` |
| 웹 의존성·빌드 | `npm ci`, `npm run build` |
| 웹 개발·미리보기 | `npm run dev` (5173), `npm run preview` (4173) |
| Docker 웹 배포 | `docker compose up -d --build` → `http://localhost:8080`; `docker compose ps`, 종료 `docker compose down` |
| Docker 구성 확인 | `docker compose config --quiet`; 이미지 빌드 후 정적 파일·서비스 워커·MIME·404 응답 확인 |
| 웹 검사 | `npm run check`, `npm run format:check`, `npm run test:web` |
| Python 검사 | `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest` |
| Python 패키지 빌드 | `uv build --all-packages` |
| 실제 모델·서버 검증 | `scripts/verify_models.py`, `scripts/verify_server_runtime.py`, `scripts/verify_runtime.py`를 필요한 범위에서 `uv run python`으로 실행 |
| 실제 음성 옵션·캐시·발화 속도 검증 | 모델 설치 후 `uv run --offline python scripts/verify_options.py` (한 모델만: `--model supertonic-3`). 결과는 실행별 `output/options/` 하위 폴더에 저장 |
| 웹 배포 경로·공유 메타데이터 검증 | `node scripts/verify-web-metadata.mjs` (기존 빌드 파일을 변경하지 않음) |

## 유지할 동작

- 원문을 수정하지 않는다. 기존 출력 교체는 `--overwrite`를 명시한다. 실제 변환에 테스트 톤이나 가짜 성공을 사용하지 않는다.
- 기본 웹은 문서·음성을 외부 서버에 전송하지 않는다. 실행 파일은 서비스 워커 캐시, 모델·등록한 작업은 IndexedDB에 보관한다. 창을 닫으면 계산이 멈추며 같은 사이트·프로필에서 완료 구간을 재사용한다.
- Docker는 웹 정적 파일만 제공한다. 모델·사용자 데이터·Python/MLX 서버를 이미지에 포함하지 않는다. 외부 공개는 HTTPS 프록시를 사용하며 `DOC2AUDIO_BASE`·`DOC2AUDIO_SITE_URL`은 이미지 빌드 인자다.
- 로컬 서버는 `127.0.0.1`에 바인딩한다. 웹과 로컬 서버 사이에 문서·작업을 자동 이전하지 않는다.
- 모델 명세는 `apps/web/src/browser/model-manifest.json`과 `packages/engine/src/doc2audio/catalog.json`을 기준으로 한다. 브라우저의 일반 모델 폴더 지정 기능은 현재 없다.
- 모델 보관함은 저장 위치·용량 확인과 모델만 삭제하는 기능을 제공한다. 삭제는 문서·작업·음성을 보존하며, 해당 모델의 대기·실행 중 작업과 충돌하지 않도록 보호한다.
- 로컬 음성 캐시는 모델의 내부 분할 조각을 각각 저장한다. 구간 사이 쉼과 출력 배속은 최종 인코딩에 적용하며, 이 두 설정만 바꾸면 합성 조각을 재사용한다.
- `.models/`, `.doc2audio/`, `input/`, `output/`은 사용자 로컬 데이터이며 Git에서 제외한다.
- 제품용 합성 음성은 `apps/web/public/voice-samples/`에 둔다. 모델·화자·옵션·리비전·해시는 `manifest.json`에 기록한다. 배포 라이선스 고지를 보존한다.
- 사용자 문서는 설치와 사용에 필요한 내용만 유지한다. 과거 조사·설계·검증 보고서와 완료된 작업 기록을 별도 문서로 쌓지 않는다.
