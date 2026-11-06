"""Polite async client for the RIS OGD API v2.6 with an on-disk cache of raw responses."""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

import httpx

API = "https://data.bka.gv.at/ris/api/v2.6"
USER_AGENT = "lotse-ml-corpus/0.1 (research; https://github.com/Julian-AT/sv-lotse)"
PAGE_SIZE = "OneHundred"


class RisClient:
    def __init__(self, cache_dir: Path, concurrency: int = 4, retries: int = 5) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.sem = asyncio.Semaphore(min(concurrency, 4))
        self.retries = retries
        self.http = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0),
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        )
        self.fetched = 0
        self.cached = 0

    async def close(self) -> None:
        await self.http.aclose()

    def _path(self, key: str, suffix: str) -> Path:
        digest = hashlib.sha1(key.encode()).hexdigest()
        return self.cache_dir / digest[:2] / f"{digest}{suffix}"

    async def get(self, url: str, params: dict | None = None, suffix: str = ".bin") -> bytes:
        key = url + ("?" + json.dumps(params, sort_keys=True) if params else "")
        path = self._path(key, suffix)
        if path.exists():
            self.cached += 1
            return path.read_bytes()
        delay = 1.0
        for attempt in range(self.retries):
            try:
                async with self.sem:
                    resp = await self.http.get(url, params=params)
                if resp.status_code == 200:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(resp.content)
                    self.fetched += 1
                    return resp.content
                if resp.status_code not in (429, 500, 502, 503, 504):
                    resp.raise_for_status()
            except (httpx.TransportError, httpx.TimeoutException):
                if attempt == self.retries - 1:
                    raise
            await asyncio.sleep(delay)
            delay *= 2
        raise RuntimeError(f"giving up on {url}")

    async def search_page(self, params: dict, page: int) -> dict:
        query = {**params, "Seitennummer": str(page), "DokumenteProSeite": PAGE_SIZE}
        raw = await self.get(f"{API}/Bundesrecht", query, suffix=".json")
        return json.loads(raw)
