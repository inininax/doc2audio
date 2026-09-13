# 공통 개발 지침 관리

Codex와 Claude Code는 `AGENTS.md`와 `.agents/`의 같은 지침을 사용한다.

| 경로 | 역할 |
| --- | --- |
| `AGENTS.md` | 작업 시작 시 읽을 공통 지침 |
| `CLAUDE.md` | `@AGENTS.md`를 가져오는 진입점 |
| `.agents/rules/` | 개발·Git·검증 규칙의 원본 |
| `.agents/PROJECT.md` | 현재 프로젝트의 실행·검증 명령 |
| `.agents/skills/` | 프로젝트 공용 스킬 원본 |

`.claude/rules`와 `.claude/skills`는 각각 공통 원본을 가리키는 상대 링크다. 규칙을 추가하면 `AGENTS.md`의 읽기 목록도 갱신한다.

프로젝트 루트에서 연결을 확인하거나 누락된 링크를 만든다.

```bash
python3 scripts/ai-env.py check
python3 scripts/ai-env.py setup
```

`check`는 파일과 연결만 검사한다. `setup`은 누락된 링크만 만들며 기존 파일이나 잘못된 링크를 덮어쓰지 않는다. 프로젝트를 옮길 때 숨김 파일과 상대 링크를 함께 보존한다.
