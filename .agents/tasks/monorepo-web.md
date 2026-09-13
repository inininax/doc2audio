# 로컬 음성 변환 모노레포·웹 업그레이드

- 목표와 완료 조건: 엔진/CLI/서버/Material UI 웹을 분리하고, 영구 작업 기록·진행·모델 다운로드·모델별 옵션·오프라인 실행을 실제 검증한다.
- 담당 도구·세션: Codex root, cli_fixes, final_review, 별도 `codex review --uncommitted` 프로세스
- 상태: 완료
- 담당 파일·디렉터리: apps/, packages/, 루트 lock/config, docs/, tests/, scripts/verify_models.py, scripts/verify_server_runtime.py
- 브랜치·기준 커밋: main / 90826ff (commit/push 요청 없음, 변경은 작업 트리에 유지)

## 결정 사항

- uv workspace: packages/engine (doc2audio-core), apps/cli (doc2audio), apps/server (doc2audio-server)
- npm workspace: apps/web, React 19 / TypeScript / Material UI 9 / Vite 7
- FastAPI localhost:8010; SQLite WAL 작업 기록; 작업당 별도 Python 프로세스, 한 번에 한 작업
- 모델 카탈로그 고정: Qwen3-TTS 1.7B/0.6B CustomVoice MLX 8bit, Supertonic 3 ONNX. 모두 실제 다운로드 완료.
- 자동 신모델 검색 대신 2026-09-13 검토한 카탈로그, 모델별 옵션을 서버 스키마로 검증·웹 렌더링
- ego-browser taskSpace 2의 p1을 변환 중 닫고 p2로 재접속 검증함. 완료 시 최종 웹 화면 p2를 사용자에게 유지.
- 초기 분업 MCP 인증 오류 후 연결 복구. CLI 수정과 독립 최종 리뷰를 별도 에이전트로 수행했으며 최종 리뷰 승인 확인.

## 변경한 내용

- 기존 src/doc2audio 소스를 packages/engine/src/doc2audio로 이동, CLI는 apps/cli/src/doc2audio_cli로 분리
- 설치·변환·취소·재시도·오디오 다운로드·히스토리 HTTP API
- 웹 새 변환/작업 기록/모델 보관함/상세 재생·배속
- 웹 보관함·문서 원본·MP3·진행 로그는 서버 영구 저장
- 모델 다운로드와 생성 환경 분리, 인코딩 배속·쉼 변경 시 구간 캐시 재사용
- 모노레포·웹 안내 문서와 README/PROJECT 업데이트
- 리뷰 지적 수정: Supertonic 내부 분할 파형의 끝부분 보존과 짧은 입력 최소 길이, 100만 자 한글 multipart 입력, CLI JSON 설정 우선순위, 명시적 모델/데이터 `~/` 경로, 실제 검증의 구간 캐시 배제
- 파이프라인 캐시 리비전 갱신으로 이전 Supertonic 잘린 구간 재사용 방지, 새 변환 폼의 모델 선택 유지

## 검증

- `uv run pytest -q`: 62 passed
- `uv run ruff check .`, `uv run ruff format --check .`, `uv lock --check`, `git diff --check`: 통과
- `npm run check`, `npm run format:check`, `npm run build`: 타입·포맷 검사·프로덕션 빌드 통과 (초기 JS bundle 523.26KB 경고)
- `uv build --all-packages --offline`: 3개 Python 패키지 sdist/wheel 생성 통과
- `python3 scripts/ai-env.py check`: 통과
- `uv run python scripts/verify_models.py`: 새 작업 폴더에서 세 모델 실제 생성+ffprobe 성공, reused_chunks=0, Python IPv4/IPv6 socket.connect 차단 하에서 검증. 결과 output/upgrade/*-verified.json. 물리적 네트워크 차단 검증은 아님.
- `uv run python scripts/verify_server_runtime.py`: 실제 Supertonic 작업 중 서버 종료·재시작·구간 캐시 재사용·취소·최종 기록 보존 통과. 결과 output/upgrade/server-recovery-results.json
- ego-browser: 텍스트 및 파일 업로드, 모델 옵션 변경, 실제 변환 등록, 오디오 응답200/readyState4, 변환 중 탭 종료 후 새 탭에 running복구 확인
- ego-browser: 별도 보관함 localhost:8011에서 실제 Supertonic 다운로드 버튼 → completed 확인
- 모바일 390px: 가로 overflow 없음. 데스크톱/모바일 screenshot /tmp/doc2audio-desktop.png, /tmp/doc2audio-mobile.png
- ego-browser: 상세 플레이어에서 실제 playbackRate=1.5, 최종 모델 보관함 3개 설치됨, 외부 웹 리소스 요청 없음 확인
- Supertonic 실제 SDK: 591자/내부 6구간의 입력·최종 파형 보존, 짧은 두 문장 생성 확인
- 별도 final_review 승인: 미해결 구현 지적 없음. 최신 62개 전체 테스트는 root가 실행.
- 상세 범위와 재현 명령은 docs/validation.md의 v0.2 절에 기록. 새 모델 모든 화자의 청취 평가·ASR 내용 비교, 새 Mac 최초 설치 전체 과정은 미검증.

## 다음 작업·질문

- 구현·검증의 남은 작업 없음. 모델 목록은 검토한 3개 카탈로그이며 신모델 자동 검색은 제공하지 않음.
- 로컬 서버는 127.0.0.1:8010. 서버가 꺼지면 프로젝트 루트에서 `uv run --offline doc2audio-server`로 다시 실행.
- 임시 다운로드 검증 서버8011 종료 확인. 로컬 검증 음성·기록·다운로드한 모델은 보존.
