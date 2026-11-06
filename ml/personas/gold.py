"""Gold labels from the product engine (`POST /gold`), cached on disk."""

from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
from pathlib import Path

import httpx

from .vocab import GOLD_URL


def card_key(card: dict) -> str:
    return hashlib.sha256(json.dumps(card, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


# Dropped from the stored gold because they are derivable: `facts` (from the card),
# `documents_status` (from documents_held and the catalog) and citation quotes (from the catalog
# by benefitId and criterionId). This keeps 55k personas at a few hundred MB.
DROP_KEYS = ("facts", "documents_status")


def trim(gold: dict) -> dict:
    out = {k: v for k, v in gold.items() if k not in DROP_KEYS}
    out["citations"] = [
        {k: v for k, v in c.items() if k != "quote"} if isinstance(c, dict) else c
        for c in gold.get("citations") or []
    ]
    return out


def server_up(url: str = GOLD_URL) -> bool:
    try:
        return httpx.get(f"{url}/health", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


class GoldCache:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("create table if not exists gold (k text primary key, v text)")

    def get_many(self, keys: list[str]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for i in range(0, len(keys), 900):
            chunk = keys[i : i + 900]
            q = f"select k, v from gold where k in ({','.join('?' * len(chunk))})"
            out.update({k: json.loads(v) for k, v in self.db.execute(q, chunk)})
        return out

    def put_many(self, items: dict[str, dict]) -> None:
        self.db.executemany(
            "insert or replace into gold values (?, ?)",
            [(k, json.dumps(v, ensure_ascii=False)) for k, v in items.items()],
        )
        self.db.commit()


async def _fetch_all(cards: dict[str, dict], url: str, concurrency: int) -> tuple[dict, dict]:
    sem = asyncio.Semaphore(concurrency)
    ok: dict[str, dict] = {}
    errors: dict[str, str] = {}
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    async with httpx.AsyncClient(base_url=url, timeout=60, limits=limits) as client:

        async def one(k: str, card: dict) -> None:
            async with sem:
                for attempt in range(3):
                    try:
                        r = await client.post("/gold", json={"persona": card})
                        if r.status_code == 200:
                            ok[k] = trim(r.json())
                            return
                        errors[k] = f"{r.status_code}: {r.text[:200]}"
                        if r.status_code < 500:
                            return
                    except httpx.HTTPError as e:
                        errors[k] = repr(e)
                    await asyncio.sleep(0.5 * (attempt + 1))

        await asyncio.gather(*(one(k, c) for k, c in cards.items()))
    for k in ok:
        errors.pop(k, None)
    return ok, errors


def fetch_gold(
    cards: list[dict], cache: GoldCache, url: str = GOLD_URL, concurrency: int = 32
) -> tuple[list[dict | None], dict[str, str]]:
    """Gold for each card (None if the server failed for it); results are cached by card hash."""
    keys = [card_key(c) for c in cards]
    have = cache.get_many(list(set(keys)))
    missing = {k: c for k, c in zip(keys, cards, strict=True) if k not in have}
    errors: dict[str, str] = {}
    if missing:
        ok, errors = asyncio.run(_fetch_all(missing, url, concurrency))
        cache.put_many(ok)
        have.update(ok)
    return [have.get(k) for k in keys], errors
