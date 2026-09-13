# 브라우저 실행과 영구 이어하기

- 목표와 완료 조건: 정적 웹 배포만으로 사용자 PC 브라우저에서 모델 다운로드·문서 추출·음성 생성·MP3 저장. 탭 종료/재접속 자동 이어하기, 오프라인 및 실제 모델 검증. 프로젝트 밖 생성 파일 위치 보고.
- 담당 도구·세션: Codex root (UI·큐·PWA·통합 검증), browser_tts (ONNX·다른 구현 독립 리뷰), browser_documents (문서·MP3·사용 문서), final_review (저장소·다운로드 작성 후 다른 구현 독립 리뷰)
- 상태: 완료
- 담당 파일·디렉터리: apps/web/, scripts/, docs/, .agents/PROJECT.md
- 브랜치·기준 커밋: main / 90826ff. 이전 모노레포 변경 미커밋 상태 보존. commit/push/외부 배포 미실행.

## 결정 사항

- 기본 웹 실행은 브라우저 전용. 기존 Python 서버 모드는 ?runtime=local에서 명시적으로 선택. 원격 처리 자동 fallback 없음.
- 브라우저 모델은 Supertonic 3 ONNX WASM. 기존 Qwen MLX 모델은 Python 모드에서 유지.
- IndexedDB에 모델·원문·작업·구간 PCM·MP3 저장. 구간 저장 트랜잭션 완료 뒤 진행률 확정.
- Web Locks 단일 실행자 + 실행 토큰 CAS로 다중 탭과 pause/retry 경합 방지. 창 닫히면 중단, 재접속 시 대기/진행 작업 자동 복구. 명시적 일시정지·실패·취소는 수동 재개.
- 다운로드는 고정 리비전·크기·SHA256 검증 및 Range 구간 저장. 재실행 시 체크포인트 재사용.
- 서비스 워커로 화면·worker·WASM·OCR 자산 캐시. 업데이트는 실행 중 강제 활성화하지 않음.

## 변경한 내용

- 브라우저 모델 manifest 18파일, 모델 카탈로그·10개 목소리·31개 언어·생성/출력/듣기 속도 설정.
- IndexedDB 저장소, 4MiB 다운로드 체크포인트, 영구 보관 요청, 단일 작업 대기열, 복구·취소·삭제.
- 실제 ONNX TTS worker와 OCR 소유 worker, PDF/DOCX/Word97 DOC/TXT 추출 및 MP3 인코딩.
- WSOLA 배속 필터의 마지막 음성 보존과 실제 프레임 길이 메타데이터.
- npm 런타임 파일 복사·정적 빌드·서비스 워커 캐시 생성 스크립트, HTTPS·하위 경로 지원.
- README, 웹 사용/배포/구조/검증 문서와 프로젝트 정보 갱신.

## 검증

- 실행 명령: npm run test:web (69개), npm run check, npm run format:check, npm run build; uv run pytest (62개), uv run ruff check ., uv run ruff format --check ., uv lock --check, git diff --check, python3 scripts/ai-env.py check.
- 실제 모델: 브라우저에서 401,291,925바이트 다운로드, 39개 Range 조각 저장 후 탭 종료·다운로드 재개 성공.
- 실제 생성: 8구간 중5개 저장 후 종료·자동재개, 기존5개SHA유지·재사용. 수동정지2/16→재접속paused유지→두탭한실행자→16개완료, 기존2개SHA유지.
- 실제 PDF2쪽선택, DOCX/DOC 본문·표순서, TXT 신규변환, 스캔PDF OCR→MP3, 출력배속·듣기배속 검증.
- 정적/Python 서버 정지 뒤 SW새로고침·재접속, CDPoffline=true 상태에서 새OCR·ONNX·MP3 완료(재사용0). 최신OCR소유worker에서도재확인.
- 실제 OCR20쪽진행취소→다음TXT완료. 별도테스트출처에서 실제언어파일503실패→오류반환·worker대상0확인.
- 데스크톱1440px·모바일390px 화면 확인, 모바일가로넘침없음.
- 독립리뷰지적수정: 늦은결과덮어쓰기/삭제경합, 오프라인설치실패·상태이벤트누락, OCR취소대기열정지·초기화worker누수·정리Promise오류, WSOLA끝부분손실.
- 한계: OCR일부한글오인식관측·문서명시. 모든브라우저/모바일기기/복잡문서/31언어품질및이번브라우저음성의ASR·사람청취평가미실행. 닫힌동안계산은멈추고데이터삭제시보존불가.
- 상세 근거: docs/validation.md, 로컬 output/browser/의 JSON·문서·MP3·스크린샷. 임시 failure proxy와dev서버는종료하고최종preview만유지.

## 다음 작업·질문

- 최종 빌드·69개 웹 테스트·독립 리뷰 완료. 미해결 구현 지적 없음. 외부 서버 배포는 실행하지 않았으며 배포 산출물은 apps/web/dist/.
- 이번명시적검증파일은output/browser/ 내부. 앞선웹검증의/tmp스크린샷3개와도구관리캐시위치는docs/validation.md에기록.
