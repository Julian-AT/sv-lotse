"""Transports: the real OpenAI API and a deterministic fake for tests and dry runs.

A transport exposes raw JSON-level operations; datagen.llm adds budget, cache and retries.
"""

from __future__ import annotations

import hashlib
import json
from typing import Protocol


class TransportError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code

    @property
    def retryable(self) -> bool:
        if self.code in ("insufficient_quota", "invalid_api_key", "billing_hard_limit_reached"):
            return False
        return self.status is None or self.status == 429 or self.status >= 500


class Transport(Protocol):
    def chat(self, body: dict) -> dict: ...
    def upload_jsonl(self, data: bytes, filename: str) -> str: ...
    def create_batch(self, input_file_id: str, endpoint: str, metadata: dict) -> dict: ...
    def retrieve_batch(self, batch_id: str) -> dict: ...
    def file_content(self, file_id: str) -> bytes: ...
    def list_models(self) -> list[str]: ...


class OpenAITransport:
    """Thin wrapper over the official `openai` SDK pointed at DATAGEN_OPENAI_BASE_URL with
    DATAGEN_OPENAI_API_KEY (from config `env_file` via dotenv_values; never logged)."""

    def __init__(self, timeout: float = 180.0):
        from openai import OpenAI

        from .config import backend_env

        env = backend_env()
        key = env.get("DATAGEN_OPENAI_API_KEY")
        if not key:
            raise TransportError("DATAGEN_OPENAI_API_KEY missing (config env_file)", code="no_key")
        self.base_url = env.get("DATAGEN_OPENAI_BASE_URL")
        self.client = OpenAI(api_key=key, base_url=self.base_url, timeout=timeout, max_retries=0)

    @staticmethod
    def _wrap(e: Exception) -> TransportError:
        import openai

        status = getattr(e, "status_code", None)
        code = None
        body = getattr(e, "body", None)
        if isinstance(body, dict):
            code = body.get("code") or (body.get("error") or {}).get("code")
        msg = getattr(e, "message", None) or str(e)
        if isinstance(e, openai.APIConnectionError):
            status = None
        return TransportError(msg, status=status, code=code)

    def chat(self, body: dict) -> dict:
        import openai

        try:
            return self.client.chat.completions.create(**body).model_dump()
        except openai.OpenAIError as e:
            raise self._wrap(e) from e

    def upload_jsonl(self, data: bytes, filename: str) -> str:
        import openai

        try:
            return self.client.files.create(file=(filename, data), purpose="batch").id
        except openai.OpenAIError as e:
            raise self._wrap(e) from e

    def create_batch(self, input_file_id: str, endpoint: str, metadata: dict) -> dict:
        import openai

        try:
            return self.client.batches.create(
                input_file_id=input_file_id,
                endpoint=endpoint,
                completion_window="24h",
                metadata=metadata,
            ).model_dump()
        except openai.OpenAIError as e:
            raise self._wrap(e) from e

    def retrieve_batch(self, batch_id: str) -> dict:
        import openai

        try:
            return self.client.batches.retrieve(batch_id).model_dump()
        except openai.OpenAIError as e:
            raise self._wrap(e) from e

    def file_content(self, file_id: str) -> bytes:
        import openai

        try:
            return self.client.files.content(file_id).read()
        except openai.OpenAIError as e:
            raise self._wrap(e) from e

    def list_models(self) -> list[str]:
        import openai

        try:
            return sorted(m.id for m in self.client.models.list())
        except openai.OpenAIError as e:
            raise self._wrap(e) from e


class FakeTransport:
    """Deterministic in-memory transport. `responder(body) -> str` produces the content (default:
    echo of the last user message, or a minimal JSON object for structured output). `fail` is a
    list of TransportErrors raised by the next chat calls (to test retries)."""

    def __init__(
        self,
        responder=None,
        *,
        fail: list[TransportError] | None = None,
        batch_complete: bool = True,
        models: list[str] | None = None,
        batch_api: bool = True,
    ):
        self.batch_api = batch_api
        self.responder = responder or self._default
        self.fail = list(fail or [])
        self.batch_complete = batch_complete
        self.models = models or []
        self.calls: list[dict] = []
        self.files: dict[str, bytes] = {}
        self.batches: dict[str, dict] = {}

    @staticmethod
    def _default(body: dict) -> str:
        rf = body.get("response_format") or {}
        if rf.get("type") == "json_schema":
            return json.dumps(_example(rf["json_schema"]["schema"]))
        return "echo: " + str(body["messages"][-1]["content"])[:200]

    def _complete(self, body: dict) -> dict:
        content = self.responder(body)
        prompt = sum(len(str(m.get("content", ""))) for m in body["messages"]) // 4 + 5
        out = min(len(content) // 4 + 1, body.get("max_completion_tokens") or 10**9)
        rid = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:12]
        return {
            "id": f"chatcmpl-{rid}",
            "model": body["model"],
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": content},
                }
            ],
            "usage": {
                "prompt_tokens": prompt,
                "completion_tokens": out,
                "total_tokens": prompt + out,
                "prompt_tokens_details": {"cached_tokens": 0},
            },
        }

    def chat(self, body: dict) -> dict:
        self.calls.append(body)
        if self.fail:
            raise self.fail.pop(0)
        return self._complete(body)

    def upload_jsonl(self, data: bytes, filename: str) -> str:
        if not self.batch_api:
            raise TransportError("404 page not found", status=404)
        fid = f"file-{len(self.files)}"
        self.files[fid] = data
        return fid

    def create_batch(self, input_file_id: str, endpoint: str, metadata: dict) -> dict:
        bid = f"batch_{len(self.batches)}"
        self.batches[bid] = {
            "id": bid,
            "status": "validating",
            "input_file_id": input_file_id,
            "endpoint": endpoint,
            "metadata": metadata,
            "output_file_id": None,
            "error_file_id": None,
        }
        return dict(self.batches[bid])

    def retrieve_batch(self, batch_id: str) -> dict:
        b = self.batches[batch_id]
        if self.batch_complete and b["status"] != "completed":
            lines = []
            for line in self.files[b["input_file_id"]].decode().splitlines():
                req = json.loads(line)
                lines.append(
                    json.dumps(
                        {
                            "id": "r",
                            "custom_id": req["custom_id"],
                            "response": {"status_code": 200, "body": self._complete(req["body"])},
                            "error": None,
                        }
                    )
                )
            oid = f"file-{len(self.files)}"
            self.files[oid] = "\n".join(lines).encode()
            b.update(status="completed", output_file_id=oid)
        elif not self.batch_complete:
            b["status"] = "in_progress"
        return dict(b)

    def file_content(self, file_id: str) -> bytes:
        return self.files[file_id]

    def list_models(self) -> list[str]:
        return list(self.models)


def _example(schema: dict, defs: dict | None = None):
    defs = defs if defs is not None else schema.get("$defs", {})
    if "$ref" in schema:
        return _example(defs[schema["$ref"].split("/")[-1]], defs)
    if "enum" in schema:
        return schema["enum"][0]
    if "anyOf" in schema:
        return _example(schema["anyOf"][0], defs)
    t = schema.get("type")
    if isinstance(t, list):
        t = t[0]
    if t == "object":
        return {k: _example(v, defs) for k, v in schema.get("properties", {}).items()}
    if t == "array":
        return [_example(schema.get("items", {}), defs)]
    if t == "integer":
        return (
            max(int(schema.get("minimum", 3)), 3)
            if "maximum" not in schema
            else int(schema["maximum"])
        )
    if t == "number":
        return 1.0
    if t == "boolean":
        return True
    if t == "null":
        return None
    return "x"
