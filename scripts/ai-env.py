#!/usr/bin/env python3
"""Check the shared AI layout; setup creates missing relative links only."""

import argparse
import os
from pathlib import Path
import shutil
import sys


ROOT = Path(__file__).resolve().parent.parent
LINKS = {
    ".claude/rules": "../.agents/rules",
    ".claude/skills": "../.agents/skills",
}


def validate_sources():
    errors = []
    for name in (".agents", ".agents/rules", ".agents/skills", ".agents/tasks"):
        path = ROOT / name
        if path.is_symlink() or not path.is_dir():
            errors.append(f"{name}: 프로젝트 안의 실제 디렉터리가 필요합니다.")
    for name in ("AGENTS.md", "CLAUDE.md", ".agents/PROJECT.md", ".agents/ENVIRONMENT.md",
                 ".agents/rules/development.md", ".agents/rules/git.md",
                 ".agents/rules/verification.md", ".agents/skills/README.md",
                 ".agents/tasks/README.md"):
        path = ROOT / name
        if path.is_symlink() or not path.is_file():
            errors.append(f"{name}: 프로젝트 안의 실제 파일이 필요합니다.")
    if errors:
        return errors

    if (ROOT / "CLAUDE.md").read_text(encoding="utf-8").strip() != "@AGENTS.md":
        errors.append("CLAUDE.md: 공통 진입점은 @AGENTS.md 한 줄로 유지하세요.")
    guide = (ROOT / "AGENTS.md").read_text(encoding="utf-8")
    for rule in sorted((ROOT / ".agents/rules").rglob("*.md")):
        relative = rule.relative_to(ROOT).as_posix()
        if rule.is_symlink():
            errors.append(f"{relative}: 공통 규칙은 실제 파일로 관리하세요.")
        if f"]({relative})" not in guide:
            errors.append(f"{relative}: AGENTS.md 읽기 목록에 링크를 추가하세요.")
    return errors


def prepare_links(setup):
    errors = []
    missing = []
    parent = ROOT / ".claude"
    if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
        return [".claude: 실제 디렉터리가 필요합니다. 기존 경로는 변경하지 않았습니다."]

    for name, target in LINKS.items():
        path = ROOT / name
        if path.is_symlink():
            if os.readlink(path) != target:
                errors.append(f"{name}: 링크 대상이 {target}이어야 합니다. 기존 링크는 보존합니다.")
            elif not path.is_dir():
                errors.append(f"{name}: 링크 대상 디렉터리가 없습니다.")
        elif path.exists():
            errors.append(f"{name}: 일반 파일/디렉터리와 충돌합니다. 기존 내용은 보존합니다.")
        else:
            missing.append((path, target))

    # Preflight all managed paths before creating anything.
    if errors:
        return errors
    if missing and not setup:
        return [f"{path.relative_to(ROOT)}: 연결 누락; setup을 실행하세요."
                for path, _ in missing]
    for path, target in missing:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.symlink_to(target, target_is_directory=True)
        print(f"CREATED {path.relative_to(ROOT)} -> {target}")
    return []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "setup"), nargs="?", default="check")
    args = parser.parse_args()
    try:
        errors = validate_sources()
        if not errors:
            errors = prepare_links(args.command == "setup")
    except (OSError, UnicodeError) as error:
        print(f"FAIL 환경 점검 중 오류: {error}", file=sys.stderr)
        return 1
    if errors:
        for error in errors:
            print(f"FAIL {error}", file=sys.stderr)
        return 1

    print("OK 공통 지침, 규칙 목록, 상대 링크 연결")
    for name, target in LINKS.items():
        print(f"OK {name} -> {target}")
    for command in ("codex", "claude"):
        state = "PATH에서 확인" if shutil.which(command) else "PATH에 없음; 해당 CLI 사용 시 설치 필요"
        print(f"INFO {command}: {state}")
    print("INFO 정적 환경 점검입니다. 로그인·세션 내 로딩·실제 스킬 실행은 검사하지 않습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
