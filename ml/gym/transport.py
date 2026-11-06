"""Transport to the research tool server (packages/brain/research-server.ts).

Contract: ``POST /tools/<name>`` runs a brain tool with its Zod contract, ``POST /gold {persona}``
returns the engine's ground truth, ``GET /catalog/summary`` and ``GET /health``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from gym.paths import DEFAULT_SERVER

# Server codes meaning the call itself was malformed (research server: invalid_input, invalid_json,
# unknown_tool). Domain errors such as OFFICE_CONTEXT_REQUIRED (HTTP 422) are not malformed.
MALFORMED_CODES = ("INVALID_INPUT", "INVALID_JSON", "UNKNOWN_TOOL", "VALIDATION")
CASE_HEADER = "x-research-case"


@dataclass
class ToolResult:
    ok: bool
    output: Any = None
    error: str | None = None
    code: str | None = None
    malformed: bool = False

    def as_message_content(self) -> dict[str, Any]:
        if self.ok:
            return {"ok": True, "output": self.output}
        return {"ok": False, "error": {"code": self.code, "message": self.error}}


class Transport(Protocol):
    def call_tool(
        self, name: str, tool_input: dict[str, Any], case_id: str | None = None
    ) -> ToolResult: ...

    def gold(self, persona: dict[str, Any]) -> dict[str, Any]: ...


def _strip_gold(persona: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in persona.items() if k != "gold"}


def _error_fields(body: Any) -> tuple[str | None, str]:
    if isinstance(body, dict):
        err = body.get("error", body)
        if isinstance(err, dict):
            code = err.get("code") or err.get("name")
            message = err.get("message") or err.get("detail") or str(err)
            return (str(code) if code else None), str(message)
        message = body.get("message") or body.get("issues") or err
        if isinstance(message, list):
            message = "; ".join(
                str(i.get("message", i)) if isinstance(i, dict) else str(i) for i in message[:5]
            )
        code = body.get("code") or (err if isinstance(err, str) else None)
        return (str(code) if code else None), str(message)
    return None, str(body)


@dataclass
class HttpTransport:
    base_url: str = field(
        default_factory=lambda: os.environ.get("LOTSE_GYM_SERVER", DEFAULT_SERVER)
    )
    timeout: float = 60.0

    def __post_init__(self) -> None:
        self._client = httpx.Client(base_url=self.base_url, timeout=self.timeout)

    def health(self) -> bool:
        try:
            return self._client.get("/health", timeout=3.0).status_code == 200
        except httpx.HTTPError:
            return False

    def new_episode(self, **patch: Any) -> dict[str, str] | None:
        """Fresh case and subject on the server (``POST /episodes``); None when unsupported."""
        try:
            response = self._client.post("/episodes", json=patch)
        except httpx.HTTPError:
            return None
        return response.json() if response.status_code in (200, 201) else None

    def call_tool(
        self, name: str, tool_input: dict[str, Any], case_id: str | None = None
    ) -> ToolResult:
        headers = {CASE_HEADER: case_id} if case_id else None
        try:
            response = self._client.post(f"/tools/{name}", json=tool_input, headers=headers)
        except httpx.HTTPError as exc:
            return ToolResult(ok=False, error=f"transport: {exc}", code="TRANSPORT")
        try:
            body = response.json()
        except ValueError:
            body = response.text
        if response.status_code < 400:
            if isinstance(body, dict) and "ok" in body:
                if body["ok"]:
                    return ToolResult(ok=True, output=body.get("output", body.get("result")))
                code, message = _error_fields(body)
                return ToolResult(ok=False, error=message, code=code, malformed=_is_malformed(code))
            return ToolResult(ok=True, output=body)
        code, message = _error_fields(body)
        malformed = _is_malformed(code) or (response.status_code == 400 and code is None)
        return ToolResult(ok=False, error=message, code=code, malformed=malformed)

    def gold(self, persona: dict[str, Any]) -> dict[str, Any]:
        response = self._client.post("/gold", json={"persona": _strip_gold(persona)})
        response.raise_for_status()
        return response.json()

    def catalog_summary(self) -> Any:
        response = self._client.get("/catalog/summary")
        response.raise_for_status()
        return response.json()

    def tool_schemas(self) -> Any | None:
        """Optional JSON schemas of the tools, if the server publishes them at GET /tools."""
        try:
            response = self._client.get("/tools")
        except httpx.HTTPError:
            return None
        return response.json() if response.status_code == 200 else None


def _is_malformed(code: str | None) -> bool:
    return bool(code) and any(marker in code.upper() for marker in MALFORMED_CODES)


@dataclass
class FakeTransport:
    """In-memory transport for tests: ``handlers`` map tool names to callables or fixed outputs."""

    handlers: dict[str, Any] = field(default_factory=dict)
    gold_by_persona: dict[str, dict[str, Any]] = field(default_factory=dict)
    calls: list[tuple[str, dict[str, Any]]] = field(default_factory=list)

    def call_tool(
        self, name: str, tool_input: dict[str, Any], case_id: str | None = None
    ) -> ToolResult:
        self.calls.append((name, tool_input))
        handler = self.handlers.get(name)
        if handler is None:
            return ToolResult(ok=False, error=f"no fake for {name}", code="NOT_IMPLEMENTED")
        result = handler(tool_input) if callable(handler) else handler
        if isinstance(result, ToolResult):
            return result
        return ToolResult(ok=True, output=result)

    def gold(self, persona: dict[str, Any]) -> dict[str, Any]:
        if persona["id"] in self.gold_by_persona:
            return self.gold_by_persona[persona["id"]]
        return persona["gold"]
