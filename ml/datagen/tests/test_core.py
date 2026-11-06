from __future__ import annotations

import multiprocessing as mp

import pytest
from pydantic import BaseModel

from datagen.ledger import BudgetExceeded, Ledger
from datagen.llm import LLM, BatchPending, QuotaError
from datagen.transport import FakeTransport, TransportError

MSG = [{"role": "user", "content": "Hallo, ich brauche Hilfe."}]


class Out(BaseModel):
    answer: str
    score: int


def test_pool_caps(cfg):
    assert cfg.family_cap("situations") == 2500
    assert cfg.family_cap("forms") == cfg.family_cap("legal_qa") == 1500
    with pytest.raises(KeyError):
        cfg.family_cap("nope")


def test_chat_settles_and_caches(cfg):
    fake = FakeTransport()
    llm = LLM("situations", transport=fake, config=cfg)
    r1 = llm.chat(MSG, max_output_tokens=100)
    assert r1.text.startswith("echo") and not r1.cached
    used = cfg.family_cap("situations") - llm.remaining()["family"]
    assert used == r1.usage["prompt_tokens"] + r1.usage["completion_tokens"]
    r2 = llm.chat(MSG, max_output_tokens=100)
    assert r2.cached and r2.cost_usd == 0 and len(fake.calls) == 1
    assert llm.remaining()["family"] == cfg.family_cap("situations") - used


def test_structured_output(cfg):
    llm = LLM("dialogues", transport=FakeTransport(), config=cfg)
    r = llm.chat(MSG, role="judge", response_format=Out, max_output_tokens=50)
    assert isinstance(r.parsed, Out)


def test_budget_refuses_worst_case(cfg):
    fake = FakeTransport()
    llm = LLM("situations", transport=fake, config=cfg)
    with pytest.raises(BudgetExceeded):
        llm.chat(MSG, max_output_tokens=2600)
    assert fake.calls == []
    llm.chat(MSG, max_output_tokens=500)  # still fine afterwards


def test_total_cap(cfg):
    led = Ledger(config=cfg)
    led.reserve("dialogues", "m", 3500)
    led.reserve("documents", "m", 2000)
    led.reserve("forms", "m", 1500)
    led.reserve("situations", "m", 2500)
    led.reserve("reserve", "m", 500)
    with pytest.raises(BudgetExceeded):
        led.reserve("check", "m", 1)


def test_release_on_error_and_retry(cfg, monkeypatch):
    monkeypatch.setattr("time.sleep", lambda s: None)
    fake = FakeTransport(fail=[TransportError("rate", status=429)])
    llm = LLM("situations", transport=fake, config=cfg)
    assert llm.chat(MSG, max_output_tokens=50).text
    fake.fail = [TransportError("no credits", status=429, code="insufficient_quota")]
    with pytest.raises(QuotaError):
        llm.chat([{"role": "user", "content": "other"}], max_output_tokens=50)
    assert llm.ledger.summary()["committed_tokens"] == llm.ledger.used()


def test_batch_round_trip(cfg):
    fake = FakeTransport()
    llm = LLM("documents", transport=fake, config=cfg)
    reqs = [
        {
            "custom_id": f"c{i}",
            "messages": [{"role": "user", "content": f"t{i}"}],
            "max_output_tokens": 40,
            "response_format": Out,
        }
        for i in range(5)
    ]
    bid = llm.submit_batch(reqs)
    assert not bid.startswith("local")
    res = llm.collect_batch(bid)
    assert [r.custom_id for r in res] == [f"c{i}" for i in range(5)]
    assert all(isinstance(r.parsed, Out) for r in res)
    e = llm.ledger.batch_entry(bid)
    assert e["status"] == "settled" and e["input_tokens"] > 0
    # responses are cached: a sync call with the same request is free
    r = llm.chat(reqs[0]["messages"], response_format=Out, max_output_tokens=40)
    assert r.cached


def test_batch_pending(cfg):
    llm = LLM("documents", transport=FakeTransport(batch_complete=False), config=cfg)
    bid = llm.submit_batch([{"messages": MSG, "max_output_tokens": 10}])
    with pytest.raises(BatchPending):
        llm.collect_batch(bid)


def test_local_batch_fallback(cfg):
    fake = FakeTransport(lambda body: "word " * 2000, batch_api=False)
    llm = LLM("situations", transport=fake, config=cfg)
    reqs = [
        {
            "custom_id": f"c{i}",
            "messages": [{"role": "user", "content": f"t{i}"}],
            "max_output_tokens": 300,
        }
        for i in range(12)
    ]
    bid = llm.submit_batch(reqs)
    assert bid.startswith("local-")
    res = llm.collect_batch(bid)
    assert [r.custom_id for r in res] == [f"c{i}" for i in range(12)]
    ok = [r for r in res if not r.error]
    over = [r for r in res if r.error]
    # 2500-token pool, ~330 worst case each -> some run, the rest stop on the budget
    assert ok and over and all(r.error in ("budget_exceeded", "stopped") for r in over)
    assert llm.remaining()["family"] >= 0


def _reserve_many(args):
    root, cfgpath, n = args
    import os

    os.environ["DATAGEN_ROOT"] = root
    from datagen import config as c

    led = Ledger(config=c.load(cfgpath))
    ok = 0
    for _ in range(n):
        try:
            led.reserve("situations", "m", 10)
            ok += 1
        except BudgetExceeded:
            pass
    return ok


def test_ledger_concurrency(cfg, tmp_path):
    import os

    args = (os.environ["DATAGEN_ROOT"], os.environ["DATAGEN_CONFIG"], 100)
    with mp.get_context("spawn").Pool(4) as pool:
        oks = pool.map(_reserve_many, [args] * 4)
    assert sum(oks) == 250  # 2500-token pool / 10 exactly, never over
    assert Ledger(config=cfg).committed("situations") == 2500
