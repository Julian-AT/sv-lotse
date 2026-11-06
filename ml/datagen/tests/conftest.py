from __future__ import annotations

import pytest
import yaml

from datagen import config as cfgmod


@pytest.fixture
def cfg(tmp_path, monkeypatch):
    raw = yaml.safe_load(cfgmod.Path(cfgmod.__file__).with_name("config.yaml").read_text())
    raw.update(
        tranche_tokens=10_000,
        cap_usd=None,
        output_root=str(tmp_path / "out"),
        batch_api="auto",
        concurrency={"start": 4, "max": 8, "min": 1},
    )
    p = tmp_path / "config.yaml"
    p.write_text(yaml.safe_dump(raw))
    monkeypatch.setenv("DATAGEN_CONFIG", str(p))
    monkeypatch.setenv("DATAGEN_ROOT", str(tmp_path / "out"))
    monkeypatch.setenv("DATAGEN_ENV_FILE", str(tmp_path / "missing.env"))
    for k in ("DATAGEN_MODEL_BULK", "DATAGEN_MODEL_STRONG", "DATAGEN_MODEL_JUDGE"):
        monkeypatch.delenv(k, raising=False)
    cfgmod.default.cache_clear()
    yield cfgmod.load(p)
    cfgmod.default.cache_clear()
