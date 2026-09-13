# 프로젝트 정보

환경을 구성한 뒤 실제로 확정된 정보만 채운다. `미정`은 실행 명령이 아니며, AI가 임의로 기술 스택을 선택하라는 뜻도 아니다.

## 현재 범위

- 프로젝트명: `doc2audio`
- 현재 단계: 브라우저 실행 웹 v0.3 + 선택적 로컬 엔진·CLI·API 모노레포
- 목적: 사용자가 지정한 PDF·DOCX·DOC·UTF-8 TXT 파일을 자연스러운 한국어 MP3로 변환
- 애플리케이션 요구사항: 무료 공개 음성 모델, 한국어 기본 화자, 로컬 처리, 긴 문서 분할과 이어하기
- 웹 기술 스택: React 19, Material UI 9, Vite 7, TypeScript, ONNX Runtime Web 1.29 WASM, IndexedDB, Web Locks, Service Worker, PDF.js, Mammoth/CFB, Tesseract 7, LAME/SoundTouch
- 선택적 로컬 런타임: Python 3.12, Apple Silicon macOS, MLX-Audio 0.5.3, Supertonic 1.3.1 / ONNX Runtime, FastAPI, SQLite, PyMuPDF, python-docx, macOS Vision OCR, ffmpeg
- 패키지 관리자: Python: uv (`uv.lock`), 웹: npm workspaces (`package-lock.json`)
- 주요 소스 경로: `packages/engine/`, `apps/cli/`, `apps/server/`, `apps/web/`, `tests/`
- 외부 서비스·필수 환경변수: 최초 공개 모델 다운로드에 Hugging Face 사용, 필수 환경변수·API 키 없음

## 실행·검증 명령

명령은 프로젝트 루트에서 실행한다.

| 용도 | 명령 또는 상태 |
| --- | --- |
| AI 환경 점검 | `python3 scripts/ai-env.py check` |
| 누락된 공유 연결 생성 | `python3 scripts/ai-env.py setup` |
| 의존성 설치 | `uv sync --locked` |
| 모델 설치·환경 점검 | `uv run doc2audio download`, `uv run doc2audio doctor` |
| 문서 변환 | `uv run doc2audio "/절대/경로/문서.pdf"` |
| 본문 미리 확인 | `uv run doc2audio extract "/절대/경로/문서.pdf"` |
| 브라우저 웹 | `npm ci`, `npm run build`, `npm run preview` (127.0.0.1:4173), Node.js 22.12+ |
| 웹 정적 배포 | `apps/web/dist/` 전체를 HTTPS 정적 호스팅에 제공. 세부 설정은 `docs/browser-runtime.md` |
| 선택적 로컬 서버 | `uv run doc2audio-server`, `http://127.0.0.1:8010/?runtime=local` |
| 웹 개발 서버 | `npm run dev` (127.0.0.1:5173), 기본 모드에는 API 서버 불필요 |
| 웹 타입 검사·빌드 | `npm run check`, `npm run build` |
| 웹·오프라인 캐시 테스트·포맷 | `npm run test:web`, `npm run format:check` |
| lint·format | `uv run ruff check .`, `uv run ruff format --check .` |
| Python 타입 검사 | 별도 도구 미구성 |
| 단위·통합 테스트 | `uv run pytest` |
| 모델별 실제 검증 | `uv run python scripts/verify_models.py` (세 모델 설치 후, 캐시 재사용 금지) |
| 서버 재시작·취소 검증 | `uv run python scripts/verify_server_runtime.py` (Supertonic 설치 후) |
| 실제 모델 통합 검증 | `uv run python scripts/verify_runtime.py` (모델 다운로드 후 실행) |
| 빌드 | `uv build --all-packages` |

## 프로젝트별 규칙·결정

- 기본 웹 모델은 Supertonic 3 (10개 목소리, 31개 언어, 한국어 F1 기본)이다. 고정 리비전·18개 파일 크기·SHA256은 `apps/web/src/browser/model-manifest.json`에 둔다.
- CLI·로컬 서버의 기본 모델은 Qwen3-TTS 1.7B CustomVoice MLX 8bit, 한국어 화자는 Sohee이다. 모델 ID·리비전·필수 파일은 `packages/engine/src/doc2audio/catalog.json`에 고정한다. Qwen 0.6B와 Supertonic 3도 지원한다.
- 모델 선택은 `docs/model-research.md`, 실제 검증은 `docs/validation.md`와 후속 전체 점검 `docs/five-pass-audit.md`를 근거로 판단한다.
- 초보자 설치·일상 사용은 `README.md`, 모델 사용법은 `docs/model-usage.md`, 내부 호출과 처리 구조는 `docs/architecture.md`에서 설명한다. 사용 문서는 HTML 없이 순수 Markdown으로 유지한다.
- `.models/`, `.doc2audio/`, `output/`, `input/`은 로컬 전용이며 Git에 포함하지 않는다.
- 테스트용 합성 톤은 자동 테스트에서만 사용한다. 실제 TTS 검증 및 사용자 변환에 대체 음성·mock 성공을 사용하지 않는다.
- 문서 원본을 수정하지 않으며, 기존 출력 파일 교체는 `--overwrite`로 명시한다.
- 채팅으로 문서 경로를 받으면 이 CLI를 실제 실행하고 결과 MP3 경로를 전달한다.

- 기본 웹은 모델·원문·작업·PCM·MP3를 같은 출처·브라우저 프로필의 IndexedDB `doc2audio-browser`에 저장한다. Web Locks로 한 탭만 실행하고 완료 구간을 검증해 자동 이어간다. 창을 닫은 동안 계산은 멈춘다. 명시적 일시정지·실패·취소는 수동 재개한다.
- 브라우저 화면·OCR·WASM 실행 파일은 Service Worker로 캐시한다. 첫 화면 준비와 모델 다운로드 완료 후 오프라인 실행 가능. 기본 웹에는 Python API로 자동 전송하는 fallback이 없다.
- 선택적 로컬 서버 작업은 `.doc2audio/jobs.sqlite3`와 `.doc2audio/jobs/`에 저장한다. `DOC2AUDIO_DATA_DIR`, `DOC2AUDIO_MODELS_DIR`로 변경 가능하다.
- 로컬 Python 서버는 127.0.0.1에만 바인딩한다. 모델 추론은 별도 프로세스의 단일 대기열에서 실행하며 외부 요청은 모델 설치 시에만 허용한다.
- 웹 UI는 Material 관리자 화면 구성을 사용한다. 기본/고급 음성 옵션, 메뉴 이동 중 입력 보존, 작은 화면의 1열 배치와 모바일 48px 조작 영역을 유지한다. 디자인 근거와 UI 검증은 `docs/ui-refresh.md`에 기록한다.
