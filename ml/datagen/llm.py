"""Budgeted OpenAI chat client with on-disk cache and Batch API support.

    llm = LLM("situations")
    r = llm.chat([{"role": "user", "content": "…"}], role="bulk", max_output_tokens=400)
    bid = llm.submit_batch([{"custom_id": "p-1", "messages": [...], "max_output_tokens": 400}],
                           role="bulk")
    results = llm.collect_batch(bid)          # raises BatchPending while the batch runs
    llm.remaining()            # {"family": tokens, "total": tokens, "unit": "tokens"}

Budget unit: tokens (prompt + completion). Every sync call reserves its worst-case tokens
(estimated prompt tokens + max_output_tokens) in the shared ledger first and raises
BudgetExceeded if that would cross the family's pool share or the tranche; it settles with the
actual usage afterwards. Cache hits cost nothing and touch no budget.

Batches use the OpenAI Batch API when the backend supports it (config `batch_api: auto` probes
once and remembers the answer in <output_root>/backend.json). Otherwise `submit_batch` runs the
requests as concurrent sync calls with adaptive concurrency (halves on 429/5xx), blocking until
done, and returns a local id (`local-…`) that `collect_batch` reads back; each request is then
reserved and settled individually, and requests refused by the budget come back with
`error="budget_exceeded"`.
"""

from __future__ import annotations

import hashlib
import json
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import pricing
from .config import Config, default
from .ledger import BudgetExceeded, Ledger
from .transport import OpenAITransport, Transport, TransportError

__all__ = ["LLM", "ChatResult", "BudgetExceeded", "BatchPending", "QuotaError", "TransportError"]

ENDPOINT = "/v1/chat/completions"


class BatchPending(RuntimeError):
    def __init__(self, batch_id: str, status: str, counts: dict | None = None):
        super().__init__(f"batch {batch_id} is {status}")
        self.batch_id, self.status, self.counts = batch_id, status, counts or {}


class QuotaError(RuntimeError):
    """The API refused for billing/quota/key reasons; paid work must stop."""


@dataclass
class ChatResult:
    text: str
    parsed: Any = None
    usage: dict = field(default_factory=dict)
    cost_usd: float = 0.0
    model: str = ""
    cached: bool = False
    custom_id: str | None = None
    finish_reason: str | None = None
    error: str | None = None


def strict_schema(schema: dict) -> dict:
    """Make a JSON schema acceptable for strict structured outputs: every object closes
    additionalProperties and lists all properties as required."""
    schema = json.loads(json.dumps(schema))

    def walk(s):
        if isinstance(s, dict):
            if s.get("type") == "object" or "properties" in s:
                s["additionalProperties"] = False
                s["required"] = list(s.get("properties", {}).keys())
            s.pop("default", None)
            s.pop("title", None)
            for v in s.values():
                walk(v)
        elif isinstance(s, list):
            for v in s:
                walk(v)

    walk(schema)
    return schema


def response_format_of(fmt) -> tuple[dict | None, Any]:
    """Accepts None, a pydantic model class, a JSON schema dict ({"name","schema"} or a bare
    schema) or a ready `response_format` dict. Returns (api response_format, pydantic class)."""
    if fmt is None:
        return None, None
    if isinstance(fmt, type) and hasattr(fmt, "model_json_schema"):
        return {
            "type": "json_schema",
            "json_schema": {
                "name": fmt.__name__,
                "strict": True,
                "schema": strict_schema(fmt.model_json_schema()),
            },
        }, fmt
    if isinstance(fmt, dict):
        if fmt.get("type") in ("json_schema", "json_object", "text"):
            return fmt, None
        if "schema" in fmt:
            return {
                "type": "json_schema",
                "json_schema": {
                    "name": fmt.get("name", "output"),
                    "strict": True,
                    "schema": strict_schema(fmt["schema"]),
                },
            }, None
        return {
            "type": "json_schema",
            "json_schema": {"name": "output", "strict": True, "schema": strict_schema(fmt)},
        }, None
    raise TypeError(f"unsupported response_format {fmt!r}")


def _usage_of(resp: dict) -> tuple[dict, int, int, int]:
    u = resp.get("usage") or {}
    inp = int(u.get("prompt_tokens") or 0)
    out = int(u.get("completion_tokens") or 0)
    cached = int(((u.get("prompt_tokens_details") or {}).get("cached_tokens")) or 0)
    return u, inp, out, cached


class LLM:
    def __init__(
        self,
        family: str,
        *,
        transport: Transport | None = None,
        config: Config | None = None,
        ledger: Ledger | None = None,
        cache: bool = True,
        max_retries: int = 5,
    ):
        self.family = family
        self.config = config or default()
        self.config.family_cap(family)  # fail fast on unknown families
        self.ledger = ledger or Ledger(config=self.config)
        self._transport = transport
        self.use_cache = cache
        self.max_retries = max_retries
        self.cache_dir = self.config.output_root / "cache" / family
        self.batch_dir = self.config.output_root / "batches" / family

    @property
    def transport(self) -> Transport:
        if self._transport is None:
            self._transport = OpenAITransport()
        return self._transport

    # --- request building --------------------------------------------------------------------
    def body(
        self,
        messages: list[dict],
        *,
        role: str = "bulk",
        response_format=None,
        max_output_tokens: int = 1024,
        temperature: float | None = None,
    ) -> tuple[dict, Any]:
        r = self.config.role(role)
        model = r["model"]
        rf, cls = response_format_of(response_format)
        body: dict = {
            "model": model,
            "messages": messages,
            "max_completion_tokens": int(max_output_tokens),
        }
        if r.get("reasoning_effort"):
            body["reasoning_effort"] = r["reasoning_effort"]
        if temperature is not None and r.get("temperature"):
            body["temperature"] = temperature
        if rf is not None:
            body["response_format"] = rf
        return body, cls

    def estimate_input_tokens(self, body: dict) -> int:
        chars = len(json.dumps(body["messages"], ensure_ascii=False))
        if "response_format" in body:
            chars += len(json.dumps(body["response_format"]))
        return int(chars / self.config.chars_per_token) + 16 * len(body["messages"]) + 16

    def worst_case(self, body: dict, *, batch: bool = False) -> tuple[int, float]:
        """(worst-case tokens, list-price USD equivalent)."""
        tin = self.estimate_input_tokens(body)
        tout = int(body["max_completion_tokens"])
        return tin + tout, pricing.cost(body["model"], tin, tout, 0, batch=batch)

    # --- cache ---------------------------------------------------------------------------------
    @staticmethod
    def key(body: dict) -> str:
        return hashlib.sha256(
            json.dumps(body, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()

    def _cache_path(self, key: str) -> Path:
        return self.cache_dir / key[:2] / f"{key}.json"

    def cache_get(self, body: dict) -> dict | None:
        if not self.use_cache:
            return None
        p = self._cache_path(self.key(body))
        if p.exists():
            try:
                return json.loads(p.read_text())
            except json.JSONDecodeError:
                return None
        return None

    def cache_put(self, body: dict, resp: dict) -> None:
        if not self.use_cache:
            return
        p = self._cache_path(self.key(body))
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(resp, ensure_ascii=False))
        tmp.replace(p)

    # --- results -------------------------------------------------------------------------------
    @staticmethod
    def _result(resp: dict, cls, *, cost: float, cached: bool, custom_id=None) -> ChatResult:
        choice = (resp.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        text = msg.get("content") or ""
        parsed = None
        err = None
        if msg.get("refusal"):
            err = f"refusal: {msg['refusal']}"
        if cls is not None or (text and text.lstrip().startswith(("{", "["))):
            try:
                parsed = json.loads(text) if text else None
                if cls is not None and parsed is not None:
                    parsed = cls.model_validate(parsed)
            except Exception as e:  # noqa: BLE001 - malformed model output is data, not a crash
                if cls is not None:
                    err = err or f"parse_error: {e}"
                parsed = None
        return ChatResult(
            text=text,
            parsed=parsed,
            usage=resp.get("usage") or {},
            cost_usd=cost,
            model=resp.get("model", ""),
            cached=cached,
            custom_id=custom_id,
            finish_reason=choice.get("finish_reason"),
            error=err,
        )

    # --- sync ----------------------------------------------------------------------------------
    def chat(
        self,
        messages: list[dict],
        *,
        role: str = "bulk",
        response_format=None,
        max_output_tokens: int = 1024,
        temperature: float | None = None,
    ) -> ChatResult:
        body, cls = self.body(
            messages,
            role=role,
            response_format=response_format,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
        )
        return self._chat_body(body, cls, role)

    def _chat_body(
        self,
        body: dict,
        cls,
        role: str,
        custom_id: str | None = None,
        limiter: AdaptiveLimiter | None = None,
    ) -> ChatResult:
        hit = self.cache_get(body)
        if hit is not None:
            return self._result(hit, cls, cost=0.0, cached=True, custom_id=custom_id)
        tokens, usd = self.worst_case(body)
        rid = self.ledger.reserve(
            self.family, body["model"], tokens, usd=usd, kind="call", role=role
        )
        try:
            resp = self._call_with_retries(body, limiter)
        except BaseException:
            self.ledger.release(rid)
            raise
        _, inp, out, cached = _usage_of(resp)
        cost = pricing.cost(body["model"], inp, out, cached)
        self.ledger.settle(rid, inp, out, cached, cost)
        self.cache_put(body, resp)
        return self._result(resp, cls, cost=cost, cached=False, custom_id=custom_id)

    def _call_with_retries(self, body: dict, limiter: AdaptiveLimiter | None = None) -> dict:
        delay = 2.0  # min 2 s, exponential; a 429 also pauses every worker (AdaptiveLimiter)
        for attempt in range(self.max_retries + 1):
            try:
                if limiter is None:
                    return self.transport.chat(body)
                with limiter:
                    resp = self.transport.chat(body)
                limiter.success()
                return resp
            except TransportError as e:
                if not e.retryable:
                    if e.status in (401, 402, 403) or e.code:
                        raise QuotaError(str(e)) from e
                    raise
                if limiter is not None:
                    limiter.penalize(rate_limited=e.status == 429)
                if attempt == self.max_retries:
                    raise
                time.sleep(delay + random.random() * delay * 0.25)
                delay = min(delay * 2, 120)
        raise AssertionError("unreachable")

    # --- batch ---------------------------------------------------------------------------------
    def batch_supported(self) -> bool:
        mode = self.config.batch_api
        if mode in ("on", "off"):
            return mode == "on"
        if self._batch_ok is not None:
            return self._batch_ok
        state_path = self.config.output_root / "backend.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        base = getattr(self.transport, "base_url", None) or "fake"
        key = f"batch_api:{base}"
        if key not in state:
            try:
                self.transport.upload_jsonl(b"", "probe.jsonl")
                state[key] = True
            except TransportError as e:
                # 4xx other than auth/quota = endpoint missing on this backend
                if e.status in (401, 402, 403) or e.code in ("insufficient_quota",):
                    raise QuotaError(str(e)) from e
                state[key] = False
            state_path.write_text(json.dumps(state))
        self._batch_ok = bool(state[key])
        return self._batch_ok

    _batch_ok: bool | None = None

    def submit_batch(self, requests: list[dict], *, role: str = "bulk") -> str:
        """requests: dicts with `messages` and optional `custom_id`, `response_format`,
        `max_output_tokens` (default 1024), `temperature`. Returns a batch id (OpenAI batch id,
        or `local-…` when the backend has no Batch API and the requests ran synchronously)."""
        if not requests:
            raise ValueError("empty batch")
        lines, bodies, formats, seen = [], {}, {}, set()
        for i, req in enumerate(requests):
            cid = str(req.get("custom_id") or f"r{i}")
            if cid in seen:
                raise ValueError(f"duplicate custom_id {cid}")
            seen.add(cid)
            body, cls = self.body(
                req["messages"],
                role=role,
                response_format=req.get("response_format"),
                max_output_tokens=req.get("max_output_tokens", 1024),
                temperature=req.get("temperature"),
            )
            bodies[cid] = (body, cls)
            formats[cid] = cls.__module__ + ":" + cls.__qualname__ if cls else None
            lines.append(
                json.dumps(
                    {"custom_id": cid, "method": "POST", "url": ENDPOINT, "body": body},
                    ensure_ascii=False,
                )
            )
        model = self.config.role(role)["model"]
        self.batch_dir.mkdir(parents=True, exist_ok=True)
        data = ("\n".join(lines) + "\n").encode()
        if not self.batch_supported():
            return self._run_local(bodies, formats, data, role, model)
        tokens = usd = 0
        for body, _ in bodies.values():
            t, u = self.worst_case(body, batch=True)
            tokens, usd = tokens + t, usd + u
        rid = self.ledger.reserve(
            self.family, model, tokens, usd=usd, kind="batch", role=role, n_requests=len(lines)
        )
        try:
            local = self.batch_dir / f"ledger-{rid}.input.jsonl"
            local.write_bytes(data)
            fid = self.transport.upload_jsonl(data, local.name)
            b = self.transport.create_batch(
                fid, ENDPOINT, {"family": self.family, "ledger_id": str(rid)}
            )
        except TransportError as e:
            self.ledger.release(rid)
            if not e.retryable:
                raise QuotaError(str(e)) from e
            raise
        except BaseException:
            self.ledger.release(rid)
            raise
        bid = b["id"]
        self.ledger.attach_batch(rid, bid)
        (self.batch_dir / f"{bid}.meta.json").write_text(
            json.dumps(
                {
                    "batch_id": bid,
                    "ledger_id": rid,
                    "role": role,
                    "model": model,
                    "n": len(lines),
                    "input": local.name,
                    "formats": formats,
                    "submitted_at": time.time(),
                },
                ensure_ascii=False,
            )
        )
        return bid

    def _run_local(self, bodies: dict, formats: dict, data: bytes, role: str, model: str) -> str:
        bid = f"local-{int(time.time() * 1000)}-{hashlib.sha256(data).hexdigest()[:10]}"
        inp = self.batch_dir / f"{bid}.input.jsonl"
        inp.write_bytes(data)
        cc = self.config.concurrency
        limiter = AdaptiveLimiter(cc["start"], cc["min"], cc["max"])
        stop = threading.Event()
        out_lines: dict[str, str] = {}

        def one(cid: str) -> None:
            body, cls = bodies[cid]
            if stop.is_set():
                rec = {
                    "custom_id": cid,
                    "response": None,
                    "error": {"code": "stopped", "message": stop_reason[0]},
                }
            else:
                try:
                    r = self._chat_body(body, cls, role, custom_id=cid, limiter=limiter)
                    resp = self.cache_get(body) if self.use_cache else None
                    rec = {
                        "custom_id": cid,
                        "response": {
                            "status_code": 200,
                            "body": resp
                            or {
                                "model": r.model,
                                "usage": r.usage,
                                "choices": [
                                    {
                                        "finish_reason": r.finish_reason,
                                        "message": {"role": "assistant", "content": r.text},
                                    }
                                ],
                            },
                        },
                        "error": None,
                        "cached": r.cached,
                    }
                except BudgetExceeded as e:
                    stop.set()
                    stop_reason[0] = f"budget_exceeded: {e}"
                    rec = {
                        "custom_id": cid,
                        "response": None,
                        "error": {"code": "budget_exceeded", "message": str(e)},
                    }
                except QuotaError as e:
                    stop.set()
                    stop_reason[0] = f"quota: {e}"
                    rec = {
                        "custom_id": cid,
                        "response": None,
                        "error": {"code": "quota", "message": str(e)},
                    }
                except TransportError as e:
                    rec = {
                        "custom_id": cid,
                        "response": None,
                        "error": {"code": e.code or str(e.status), "message": str(e)[:300]},
                    }
            out_lines[cid] = json.dumps(rec, ensure_ascii=False)

        stop_reason = [""]
        with ThreadPoolExecutor(max_workers=cc["max"]) as ex:
            list(ex.map(one, list(bodies)))
        (self.batch_dir / f"{bid}.output.jsonl").write_text(
            "\n".join(out_lines[c] for c in bodies) + "\n"
        )
        (self.batch_dir / f"{bid}.meta.json").write_text(
            json.dumps(
                {
                    "batch_id": bid,
                    "local": True,
                    "role": role,
                    "model": model,
                    "n": len(bodies),
                    "input": inp.name,
                    "formats": formats,
                    "submitted_at": time.time(),
                    "stopped": stop_reason[0] or None,
                },
                ensure_ascii=False,
            )
        )
        return bid

    def batch_status(self, batch_id: str) -> dict:
        return self.transport.retrieve_batch(batch_id)

    def collect_batch(
        self, batch_id: str, *, wait: bool = False, poll_seconds: float = 60.0
    ) -> list[ChatResult]:
        """Results in submission order. Raises BatchPending while running (unless wait=True).
        Settles the ledger with the actual usage on completion (or partial output when the
        batch failed, expired or was cancelled) and writes every response into the cache."""
        meta_path = self.batch_dir / f"{batch_id}.meta.json"
        meta = json.loads(meta_path.read_text())
        results_path = self.batch_dir / f"{batch_id}.output.jsonl"
        if meta.get("local"):
            return self._collect_local(meta, results_path)
        while True:
            b = self.transport.retrieve_batch(batch_id)
            status = b["status"]
            if status in ("completed", "failed", "expired", "cancelled"):
                break
            if not wait:
                raise BatchPending(batch_id, status, b.get("request_counts"))
            time.sleep(poll_seconds)
        out_lines: list[str] = []
        for key in ("output_file_id", "error_file_id"):
            if b.get(key):
                out_lines += self.transport.file_content(b[key]).decode().splitlines()
        results_path.write_text("\n".join(out_lines) + "\n")
        bodies = {}
        for line in (self.batch_dir / meta["input"]).read_text().splitlines():
            if line.strip():
                req = json.loads(line)
                bodies[req["custom_id"]] = req["body"]
        by_id: dict[str, dict] = {}
        for line in out_lines:
            if line.strip():
                rec = json.loads(line)
                by_id[rec["custom_id"]] = rec
        tot_cost, tin, tout, tcached = 0.0, 0, 0, 0
        results: list[ChatResult] = []
        for cid, body in bodies.items():
            rec = by_id.get(cid)
            cls = _load_cls(meta["formats"].get(cid))
            if rec is None:
                results.append(
                    ChatResult(
                        text="",
                        custom_id=cid,
                        model=body["model"],
                        error=f"missing (batch {status})",
                    )
                )
                continue
            resp = (rec.get("response") or {}).get("body") or {}
            code = (rec.get("response") or {}).get("status_code")
            if rec.get("error") or code != 200:
                err = rec.get("error") or resp.get("error") or {"status_code": code}
                results.append(
                    ChatResult(
                        text="", custom_id=cid, model=body["model"], error=json.dumps(err)[:500]
                    )
                )
                continue
            _, inp, out, cached = _usage_of(resp)
            cost = pricing.cost(body["model"], inp, out, cached, batch=True)
            tot_cost += cost
            tin, tout, tcached = tin + inp, tout + out, tcached + cached
            self.cache_put(body, resp)
            results.append(self._result(resp, cls, cost=cost, cached=False, custom_id=cid))
        entry = self.ledger.batch_entry(batch_id)
        if entry and entry["status"] == "reserved":
            self.ledger.settle(entry["id"], tin, tout, tcached, tot_cost)
        return results

    def _collect_local(self, meta: dict, path: Path) -> list[ChatResult]:
        results = []
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            cls = _load_cls(meta["formats"].get(rec["custom_id"]))
            if rec.get("error"):
                results.append(
                    ChatResult(
                        text="",
                        custom_id=rec["custom_id"],
                        model=meta["model"],
                        error=rec["error"].get("code") or "error",
                    )
                )
                continue
            resp = rec["response"]["body"]
            _, inp, out, cached = _usage_of(resp)
            cost = 0.0 if rec.get("cached") else pricing.cost(meta["model"], inp, out, cached)
            results.append(
                self._result(
                    resp, cls, cost=cost, cached=bool(rec.get("cached")), custom_id=rec["custom_id"]
                )
            )
        return results

    def remaining(self) -> dict:
        return self.ledger.remaining(self.family)


def _load_cls(ref: str | None):
    if not ref:
        return None
    import importlib

    mod, _, qual = ref.partition(":")
    try:
        obj = importlib.import_module(mod)
        for part in qual.split("."):
            obj = getattr(obj, part)
        return obj
    except (ImportError, AttributeError):
        return None


class AdaptiveLimiter:
    """Concurrency limit for one family process. On 429/5xx the limit halves; on 429 every worker
    additionally pauses for an exponential cooldown (2 s, 4 s, ... up to 120 s) that resets after
    successes. The limit grows by one after `grow_after` successes, up to `hi`."""

    def __init__(self, start: int = 4, lo: int = 1, hi: int = 4, grow_after: int = 50):
        self.limit, self.lo, self.hi, self.grow_after = min(start, hi), lo, hi, grow_after
        self.active = 0
        self.ok = 0
        self.cooldown = 0.0
        self.pause_until = 0.0
        self.cv = threading.Condition()

    def __enter__(self):
        with self.cv:
            while True:
                wait = self.pause_until - time.monotonic()
                if wait > 0:
                    self.cv.wait(wait)
                    continue
                if self.active < self.limit:
                    break
                self.cv.wait()
            self.active += 1
        return self

    def __exit__(self, *exc):
        with self.cv:
            self.active -= 1
            self.cv.notify_all()

    def success(self) -> None:
        with self.cv:
            self.ok += 1
            if self.ok >= 10:
                self.cooldown = 0.0
            if self.ok >= self.grow_after and self.limit < self.hi:
                self.limit += 1
                self.ok = 0
                self.cv.notify_all()

    def penalize(self, rate_limited: bool = False) -> None:
        with self.cv:
            self.limit = max(self.lo, self.limit // 2)
            self.ok = 0
            if rate_limited:
                self.cooldown = min(120.0, max(2.0, self.cooldown * 2))
                self.pause_until = max(self.pause_until, time.monotonic() + self.cooldown)
