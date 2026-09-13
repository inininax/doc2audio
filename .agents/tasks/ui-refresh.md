# Material 관리자 UI 개선

- 목표와 완료 조건: 인터넷에서 Material Design admin/system 템플릿을 참고하여 웹 디자인과 UI를 실제 개선. 주요 동작 오류·화면 깨짐·글자/버튼 크기를 실제 브라우저에서 검증하고 수정.
- 담당: root 디자인 결정·브라우저 QA·통합/보고, ui_shell App/theme/styles, audit_engine NewJob/OptionsForm/BrowserStorage, design_references 리서치+JobCard/JobDetail/Models.
- 상태: 구현·검증 완료
- 브랜치: main, 기존 미커밋 구현 보존. commit/push/배포 미실행.
- 브라우저: 목표 전용 TaskSpace8. p1 최종 결과 http://127.0.0.1:4182/#new, p2 리서치·UI fixture 검증. 기존 사용자 결과 탭과4173서버 보존.5190개발 서버는 종료하고4182최종 미리보기를 유지한다.

## 근거와 방향

- 공식 MUI Dashboard, Mantis, Materio 데모를 검색하고 실제 화면·계산 스타일 확인. Material 접근성 원칙과 구분하여 적용: output/ui-refresh/design-references.md, reference-*.png.
- 중립 배경·흰 패널·파란 강조색, 일관된 카드와 상태 표시. 마케팅용 큰 안내를 줄여 문서 입력과 실제 작업을 우선한다.
- 본문14~16px/보조13px, 떠 있는 입력 라벨은 실제12px 이상. 버튼 최소44px·모바일48px. 320/390/768/1024/1440px·확대·키보드 점검.
- 초기 모바일390에서 form 시작810px, 버튼40~~41px, 일부10~~11px문구. before-desktop/mobile.png와 before-metrics.json.
- 메뉴 이동으로 작성 중인 텍스트 소실을 실제 재현했다: draft-loss-before.json. 저장 보호 거절이 성공 스타일, 상세 오류가 Drawer 뒤에 숨는 문제도 코드 감사에서 확인했다.

## 구현·검증 계획

1. shell·입력/설정·기록/모델 패널을 파일별로 병렬 개선.
2. 새 입력은 화면 이동 중 유지, 성공 등록 후 초기화. 고급 옵션은 접기 영역으로 정리. 오류는 발생한 작업 표면에서 표시.
3. 실제 브라우저에서 새 작업/기록/모델/상세/오류·빈 상태·긴 문구·모바일·키보드 검증. UI 전용 fixture는 명확히 구분하고 실제 모델 성공처럼 표시하지 않는다.
4. 타입·포맷·웹/PWA 회귀·빌드, 작성자와 다른 리뷰어 검토. 최종 보고와 새 미리보기 화면 제공.

## 완료 결과

- App/theme/styles와 NewJob/OptionsForm/BrowserStorage, JobCard/JobDetail/Models 9개 UI 파일 개선. 런타임/엔진/의존성 변경 없음.
- 메뉴 이동 draft 소실, 저장 보호 상태 색상, Drawer 오류 위치/소유권, 고급 입력 오류, PDF전용 옵션, 좁은 버튼/카드, 화면 전환 스크롤 문제 수정.
- 320/390/768/1024/1440 및720 CSSpx 재배치 확인.390px form시작810→412px. 실제 input/combobox/button44px·모바일48px 확인.
- 실제 Supertonic F2/3단계/출력1.1로5.642초 MP3생성,듣기1.5배 시간진행·파일다운로드·ffprobe확인.
- TypeScript/Prettier/85웹+6PWA테스트/build/diff검사 통과.최종UI청크index-C2MdYq-P.js, SW2f218b661a9c048b.
- 독립검토 review-components.md/review-shell.md통과. scroll-qa.json에서Drawer600→600,페이지/화면/제출후0확인.
- docs/ui-refresh.md에공식출처·측정·제한·증거기록. output/ui-refresh/final-desktop.png/final-mobile.png와ui-verified.mp3제공.
- placeholder의null문자열은고수준자동화경로외부DOM변경과연관(nativeDOMclick재현없음);제품우회수정없음.실제브라우저확대/Safari/Firefox/실기기미검증.남은구현작업없음.
