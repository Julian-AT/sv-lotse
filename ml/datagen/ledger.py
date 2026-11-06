"""SQLite budget ledger (WAL) shared by all datagen processes.

The budget unit is TOKENS (prompt + completion; reasoning tokens are part of completion). Every
call or batch first *reserves* its worst-case token count (estimated prompt tokens +
max_output_tokens per request) inside a `BEGIN IMMEDIATE` transaction, so reservations from
concurrent processes are serialised; then it is *settled* with the actual usage or *released* if
it never ran. Committed tokens of a pool = actual tokens of settled entries + reserved tokens of
open reservations. A list-price USD equivalent is recorded when the model has a price; it is only
enforced when config `cap_usd` is set.
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from .config import Config, default


class BudgetExceeded(RuntimeError):
    pass


SCHEMA = """
create table if not exists entries (
  id integer primary key autoincrement,
  family text not null,
  pool text not null,
  kind text not null,              -- call | batch
  role text,
  model text not null,
  status text not null,            -- reserved | settled | released
  reserved_tokens integer not null,
  reserved_usd real not null default 0,
  input_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd real not null default 0,
  n_requests integer not null default 1,
  batch_id text,
  meta text,
  created_at real not null,
  settled_at real
);
create index if not exists entries_pool on entries(pool, status);
create index if not exists entries_batch on entries(batch_id);
"""

_TOK = (
    "coalesce(sum(case when status='reserved' then reserved_tokens "
    "when status='settled' then input_tokens + output_tokens else 0 end), 0)"
)
_USD = (
    "coalesce(sum(case when status='reserved' then reserved_usd "
    "when status='settled' then cost_usd else 0 end), 0)"
)


class Ledger:
    def __init__(self, path: Path | None = None, config: Config | None = None):
        self.config = config or default()
        self.path = Path(path or self.config.output_root / "ledger.sqlite")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(
            self.path, timeout=60, isolation_level=None, check_same_thread=False
        )
        self.db.execute("pragma busy_timeout=60000")
        for attempt in range(50):  # schema/WAL setup can race with other processes starting
            try:
                self.db.execute("pragma journal_mode=wal")
                self.db.executescript(SCHEMA)
                break
            except sqlite3.OperationalError:
                if attempt == 49:
                    raise
                time.sleep(0.05 * (attempt + 1))
        import threading

        self._lock = threading.Lock()

    def _one(self, q: str, args: tuple = ()) -> float:
        with self._lock:
            return self.db.execute(q, args).fetchone()[0]

    # --- queries -------------------------------------------------------------------------------
    def committed(self, pool: str | None = None) -> int:
        """Committed tokens (settled actual + open reservations), for a pool or in total."""
        if pool is None:
            return int(self._one(f"select {_TOK} from entries"))
        return int(self._one(f"select {_TOK} from entries where pool=?", (pool,)))

    def committed_usd(self, pool: str | None = None) -> float:
        if pool is None:
            return float(self._one(f"select {_USD} from entries"))
        return float(self._one(f"select {_USD} from entries where pool=?", (pool,)))

    def used(self, pool: str | None = None) -> int:
        q = "select coalesce(sum(input_tokens+output_tokens),0) from entries where status='settled'"
        if pool:
            return int(self._one(q + " and pool=?", (pool,)))
        return int(self._one(q))

    def remaining(self, family: str) -> dict:
        """Remaining TOKENS: {"family": pool budget left, "total": tranche budget left}."""
        pool = self.config.pool(family)
        return {
            "family": self.config.pool_cap(pool) - self.committed(pool),
            "total": self.config.tranche_tokens - self.committed(),
            "unit": "tokens",
        }

    def summary(self) -> dict:
        with self._lock:
            rows = self.db.execute(
                "select pool, family, model, status, count(*), sum(n_requests), "
                "sum(reserved_tokens), sum(input_tokens), sum(cached_tokens), sum(output_tokens), "
                "sum(cost_usd) from entries group by pool, family, model, status"
            ).fetchall()
        keys = (
            "pool",
            "family",
            "model",
            "status",
            "entries",
            "requests",
            "reserved_tokens",
            "input_tokens",
            "cached_tokens",
            "output_tokens",
            "list_price_usd",
        )
        return {
            "tranche_tokens": self.config.tranche_tokens,
            "committed_tokens": self.committed(),
            "used_tokens": self.used(),
            "rows": [dict(zip(keys, r, strict=True)) for r in rows],
        }

    # --- reservations --------------------------------------------------------------------------
    def reserve(
        self,
        family: str,
        model: str,
        tokens: int,
        *,
        usd: float = 0.0,
        kind: str = "call",
        role: str | None = None,
        n_requests: int = 1,
        meta: dict | None = None,
    ) -> int:
        pool = self.config.pool(family)
        pool_cap = self.config.pool_cap(pool)
        with self._lock:
            cur = self.db.cursor()
            cur.execute("begin immediate")
            try:
                pool_used = int(
                    cur.execute(f"select {_TOK} from entries where pool=?", (pool,)).fetchone()[0]
                )
                total_used = int(cur.execute(f"select {_TOK} from entries").fetchone()[0])
                if pool_used + tokens > pool_cap:
                    raise BudgetExceeded(
                        f"{family} (pool {pool}): {pool_used} + {tokens} tokens would exceed the "
                        f"pool share of {pool_cap} tokens"
                    )
                if total_used + tokens > self.config.tranche_tokens:
                    raise BudgetExceeded(
                        f"total: {total_used} + {tokens} tokens would exceed the tranche of "
                        f"{self.config.tranche_tokens} tokens"
                    )
                if self.config.cap_usd is not None:
                    pu = float(
                        cur.execute(f"select {_USD} from entries where pool=?", (pool,)).fetchone()[
                            0
                        ]
                    )
                    tu = float(cur.execute(f"select {_USD} from entries").fetchone()[0])
                    if pu + usd > self.config.pool_cap_usd(pool) + 1e-12 or (
                        tu + usd > self.config.cap_usd + 1e-12
                    ):
                        raise BudgetExceeded(f"{family}: USD cap reached ({tu:.4f} + {usd:.4f})")
                cur.execute(
                    "insert into entries (family,pool,kind,role,model,status,reserved_tokens,"
                    "reserved_usd,n_requests,meta,created_at) "
                    "values (?,?,?,?,?,'reserved',?,?,?,?,?)",
                    (
                        family,
                        pool,
                        kind,
                        role,
                        model,
                        int(tokens),
                        usd,
                        n_requests,
                        json.dumps(meta or {}, ensure_ascii=False),
                        time.time(),
                    ),
                )
                rid = int(cur.lastrowid)
                cur.execute("commit")
                return rid
            except BaseException:
                cur.execute("rollback")
                raise

    def attach_batch(self, entry_id: int, batch_id: str) -> None:
        with self._lock:
            self.db.execute("update entries set batch_id=? where id=?", (batch_id, entry_id))

    def settle(
        self,
        entry_id: int,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cached_tokens: int = 0,
        cost_usd: float = 0.0,
    ) -> None:
        with self._lock:
            self.db.execute(
                "update entries set status='settled', cost_usd=?, input_tokens=?, "
                "output_tokens=?, cached_tokens=?, settled_at=? where id=?",
                (cost_usd, input_tokens, output_tokens, cached_tokens, time.time(), entry_id),
            )

    def release(self, entry_id: int) -> None:
        with self._lock:
            self.db.execute(
                "update entries set status='released', settled_at=? "
                "where id=? and status='reserved'",
                (time.time(), entry_id),
            )

    def batch_entry(self, batch_id: str) -> dict | None:
        with self._lock:
            cur = self.db.execute("select * from entries where batch_id=?", (batch_id,))
            row = cur.fetchone()
            if row is None:
                return None
            return dict(zip([d[0] for d in cur.description], row, strict=True))
