# 프로젝트 정보

환경을 구성한 뒤 실제로 확정된 정보만 채운다. `미정`은 실행 명령이 아니며, AI가 임의로 기술 스택을 선택하라는 뜻도 아니다.

## 현재 범위

- 프로젝트명: `doc2audio`
- 현재 단계: 개인용 로컬 문서 낭독 CLI 구현
- 목적: 사용자가 지정한 PDF·DOCX·DOC·UTF-8 TXT 파일을 자연스러운 한국어 MP3로 변환
- 애플리케이션 요구사항: 무료 공개 음성 모델, 한국어 기본 화자, 로컬 처리, 긴 문서 분할과 이어하기
- 기술 스택·런타임: Python 3.12, Apple Silicon macOS, MLX-Audio 0.5.3, PyMuPDF, python-docx, macOS Vision OCR, ffmpeg
- 패키지 관리자: uv (`uv.lock` 유지)
- 주요 소스 경로: `src/doc2audio/`, `tests/`, `scripts/verify_runtime.py`
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
| 개발 서버 | 없음, 로컬 CLI |
| lint·format | `uv run ruff check .`, `uv run ruff format --check .` |
| 타입 검사 | 별도 도구 미구성 |
| 단위·통합 테스트 | `uv run pytest` |
| 실제 모델 통합 검증 | `uv run python scripts/verify_runtime.py` (모델 다운로드 후 실행) |
| 빌드 | `uv build` |

## 프로젝트별 규칙·결정

- 기본 모델은 Qwen3-TTS 1.7B CustomVoice MLX 8bit, 한국어 화자는 Sohee이다. 모델 ID·리비전은 `model.py`에 고정한다.
- 모델 선택은 `docs/model-research.md`, 실제 검증은 `docs/validation.md`를 근거로 판단한다.
- 초보자 설치·일상 사용은 `README.md`, 모델 사용법은 `docs/model-usage.md`, 내부 호출과 처리 구조는 `docs/architecture.md`에서 설명한다. 사용 문서는 HTML 없이 순수 Markdown으로 유지한다.
- `.models/`, `.doc2audio/`, `output/`, `input/`은 로컬 전용이며 Git에 포함하지 않는다.
- 테스트용 합성 톤은 pytest에서만 사용한다. 실제 TTS 검증 및 사용자 변환에 대체 음성·mock 성공을 사용하지 않는다.
- 문서 원본을 수정하지 않으며, 기존 출력 파일 교체는 `--overwrite`로 명시한다.
- 채팅으로 문서 경로를 받으면 이 CLI를 실제 실행하고 결과 MP3 경로를 전달한다.
