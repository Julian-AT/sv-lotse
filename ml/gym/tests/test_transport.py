from __future__ import annotations

import httpx

from gym.transport import HttpTransport


def _transport(status: int, body: object) -> HttpTransport:
    t = HttpTransport("http://test")
    t._client = httpx.Client(
        base_url="http://test",
        transport=httpx.MockTransport(lambda request: httpx.Response(status, json=body)),
    )
    return t


def test_ok_output_is_returned_raw():
    result = _transport(200, [{"id": "pflegegeld"}]).call_tool("catalog.findBenefits", {})
    assert result.ok and result.output == [{"id": "pflegegeld"}]


def test_invalid_input_is_malformed():
    body = {"error": "invalid_input", "issues": [{"message": "Required"}]}
    result = _transport(400, body).call_tool("office.resolve", {})
    assert not result.ok and result.malformed and result.code == "invalid_input"


def test_domain_error_is_not_malformed():
    body = {"error": "OFFICE_CONTEXT_REQUIRED", "message": "ask for region"}
    result = _transport(422, body).call_tool("office.resolve", {})
    assert not result.ok and not result.malformed
    assert result.code == "OFFICE_CONTEXT_REQUIRED" and "region" in result.error


def test_unknown_tool_is_malformed():
    result = _transport(404, {"error": "unknown_tool", "message": "x"}).call_tool("x.y", {})
    assert result.malformed
