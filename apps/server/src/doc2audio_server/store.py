"""SQLite job ledger. Browser sessions never own work or its history."""

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

TERMINAL = {"completed", "failed", "cancelled", "interrupted"}


def now():
    return datetime.now(UTC).isoformat()


class Store:
    def __init__(self, root: Path):
        self.root = root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.root / "jobs.sqlite3"
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, model_id TEXT NOT NULL,
                    title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0,
                    message TEXT NOT NULL DEFAULT '', source TEXT, options TEXT NOT NULL,
                    result TEXT, error TEXT, attempt INTEGER NOT NULL DEFAULT 1
                );
                CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, created_at);
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_download ON jobs(model_id)
                    WHERE kind='download' AND status IN ('queued','running','cancelling');
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL REFERENCES jobs(id),
                    created_at TEXT NOT NULL, message TEXT NOT NULL
                );
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def decode(row):
        if row is None:
            return None
        value = dict(row)
        for key in ("options", "result"):
            value[key] = json.loads(value[key]) if value[key] else None
        return value

    def create(self, *, kind, model_id, title, source=None, options=None, job_id=None):
        job_id = job_id or uuid.uuid4().hex
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if kind == "download":
                existing = db.execute(
                    "SELECT * FROM jobs WHERE kind='download' AND model_id=? "
                    "AND status IN ('queued','running','cancelling')",
                    (model_id,),
                ).fetchone()
                if existing:
                    return self.decode(existing)
            db.execute(
                """INSERT INTO jobs
                (id,kind,model_id,title,status,created_at,updated_at,source,options,message)
                VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    job_id,
                    kind,
                    model_id,
                    title,
                    "queued",
                    now(),
                    now(),
                    source,
                    json.dumps(options or {}, ensure_ascii=False),
                    "대기열에 등록했습니다.",
                ),
            )
            # Build the response before committing. A later independent read
            # failure must not make the API delete an already-registered source.
            created = self.decode(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())
        return created

    def get(self, job_id):
        with self.connection() as db:
            return self.decode(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def list(self, limit=100, offset=0):
        with self.connection() as db:
            return [
                self.decode(row)
                for row in db.execute(
                    "SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
                    (limit, offset),
                )
            ]

    def events(self, job_id):
        with self.connection() as db:
            return [
                dict(r)
                for r in db.execute(
                    "SELECT * FROM (SELECT * FROM events WHERE job_id=? "
                    "ORDER BY id DESC LIMIT 200) "
                    "ORDER BY id",
                    (job_id,),
                )
            ]

    def update(self, job_id, *, expected=None, **fields):
        allowed = {"status", "progress", "message", "error", "result", "attempt"}
        if not fields.keys() <= allowed:
            raise ValueError("Unsupported job update")
        fields["updated_at"] = now()
        if "result" in fields and fields["result"] is not None:
            fields["result"] = json.dumps(fields["result"], ensure_ascii=False)
        query = "UPDATE jobs SET " + ", ".join(f"{k}=?" for k in fields) + " WHERE id=?"
        args = [*fields.values(), job_id]
        if expected:
            query += " AND status IN (" + ",".join("?" for _ in expected) + ")"
            args.extend(expected)
        with self.connection() as db:
            changed = db.execute(query, args).rowcount > 0
            if changed and fields.get("message"):
                db.execute(
                    "INSERT INTO events(job_id,created_at,message) VALUES (?,?,?)",
                    (job_id, now(), fields["message"]),
                )
        return changed

    def claim(self):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM jobs WHERE status='queued' ORDER BY created_at, rowid LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            db.execute(
                "UPDATE jobs SET status='running',updated_at=? WHERE id=?", (now(), row["id"])
            )
            return self.decode(row)

    def recover(self):
        with self.connection() as db:
            db.execute(
                "UPDATE jobs SET status='interrupted',updated_at=?,message=? "
                "WHERE status IN ('running','cancelling')",
                (now(), "서버가 중단되었습니다. 재시도하면 저장된 구간부터 이어갑니다."),
            )
