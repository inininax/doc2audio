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
| 웹 검사 | `npm run check`, `npm run format:check`, `npm run test:web` |
| Python 검사 | `uv run ruff check .`, `uv run ruff format --check .`, `uv run pytest` |
| Python 패키지 빌드 | `uv build --all-packages` |
| 실제 모델·서버 검증 | `scripts/verify_models.py`, `scripts/verify_server_runtime.py`, `scripts/verify_runtime.py`를 필요한 범위에서 `uv run python`으로 실행 |

## 유지할 동작

- 원문을 수정하지 않는다. 기존 출력 교체는 `--overwrite`를 명시한다. 실제 변환에 테스트 톤이나 가짜 성공을 사용하지 않는다.
- 기본 웹은 문서·음성을 외부 서버에 전송하지 않는다. 실행 파일은 서비스 워커 캐시, 모델·등록한 작업은 IndexedDB에 보관한다. 창을 닫으면 계산이 멈추며 같은 사이트·프로필에서 완료 구간을 재사용한다.
- 로컬 서버는 `127.0.0.1`에 바인딩한다. 웹과 로컬 서버 사이에 문서·작업을 자동 이전하지 않는다.
- 모델 명세는 `apps/web/src/browser/model-manifest.json`과 `packages/engine/src/doc2audio/catalog.json`을 기준으로 한다. 브라우저의 일반 모델 폴더 지정 기능은 현재 없다.
- `.models/`, `.doc2audio/`, `input/`, `output/`은 사용자 로컬 데이터이며 Git에서 제외한다.
- 제품용 합성 음성은 `apps/web/public/voice-samples/`에 둔다. 모델·화자·옵션·리비전·해시는 `manifest.json`에 기록한다. 배포 라이선스 고지를 보존한다.
- 사용자 문서는 설치와 사용에 필요한 내용만 유지한다. 과거 조사·설계·검증 보고서와 완료된 작업 기록을 별도 문서로 쌓지 않는다.
