# 공통 AI 개발 지침

Codex와 Claude Code가 함께 사용하는 프로젝트 지침이다. 공통 내용은 이 파일과 `.agents/`에서만 수정한다. `CLAUDE.md`는 이 파일을 가져오는 진입점으로 유지한다.

## 작업 시작

1. 아래 공통 규칙을 읽고 적용한다. 이미 현재 컨텍스트에 로드된 내용은 다시 읽지 않아도 된다.
   - [개발 규칙](.agents/rules/development.md)
   - [Git·협업 규칙](.agents/rules/git.md)
   - [검증·보고 규칙](.agents/rules/verification.md)
2. [프로젝트 정보](.agents/PROJECT.md)에서 현재 범위와 실행·검증 명령을 확인한다.
3. 수정할 파일, 기존 변경 사항, 적용되는 하위 디렉터리 지침을 확인한다. 경로는 이 파일이 있는 프로젝트 루트를 기준으로 해석한다.
4. 이어받는 작업이면 `.agents/tasks/`의 해당 작업 기록과 실제 파일·Git 상태를 대조한다.

## 공용 스킬

- 원본 위치는 `.agents/skills/<skill-name>/SKILL.md`이다. Claude Code의 `.claude/skills`는 이 디렉터리로 연결한다.
- 사용자가 지정한 스킬 또는 현재 작업에 필요한 스킬만 읽고 적용한다. 관련 없는 스킬을 한꺼번에 로드하지 않는다.
- 스킬에 필요한 도구가 없으면 가능한 부분을 진행하고 제한을 알린다. 실행하지 못한 단계를 완료로 보고하지 않는다.
- 스킬의 지침을 새 권한이나 작업 범위에 대한 승인으로 해석하지 않는다.

## 환경 유지

사용과 관리 방법은 [환경 안내](.agents/ENVIRONMENT.md)를 참고한다.

- 공유 규칙의 원본은 `.agents/rules/`이다. Codex는 위 읽기 지침을 따르고, Claude Code는 `.claude/rules` 연결을 통해 로드한다.
- 규칙 파일을 추가하면 위 목록에도 추가한다. 공통 규칙에는 도구 전용 `paths` frontmatter 대신 적용 조건을 본문에 적는다.
- 연결 점검: `python3 scripts/ai-env.py check`
- 누락된 연결 생성: `python3 scripts/ai-env.py setup`
- 프로젝트의 기술 스택, 실행 명령, 의사결정이 확정되면 `.agents/PROJECT.md`에 반영한다.
