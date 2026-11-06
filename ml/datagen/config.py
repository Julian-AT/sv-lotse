"""Config loader (datagen/config.yaml; DATAGEN_CONFIG and DATAGEN_ROOT override for tests)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

ML = Path(__file__).resolve().parents[1]
REPO = ML.parent
ENV_FILE = REPO / ".env.local"


@dataclass(frozen=True)
class Config:
    raw: dict = field(repr=False)

    @property
    def tranche_tokens(self) -> int:
        return int(self.raw["tranche_tokens"])

    @property
    def cap_usd(self) -> float | None:
        v = self.raw.get("cap_usd")
        return None if v is None else float(v)

    @property
    def batch_api(self) -> str:
        return str(self.raw.get("batch_api", "auto"))

    @property
    def concurrency(self) -> dict:
        return {"start": 4, "max": 4, "min": 1, **(self.raw.get("concurrency") or {})}

    @property
    def version(self) -> str:
        return str(self.raw.get("version", "v0.2"))

    @property
    def hf_repo(self) -> str:
        return str(self.raw["hf_repo"])

    @property
    def chars_per_token(self) -> float:
        return float(self.raw.get("chars_per_token", 2.0))

    @property
    def languages(self) -> list[dict]:
        return list(self.raw["languages"])

    def pool(self, family: str) -> str:
        return self.raw.get("pools", {}).get(family, family)

    def share(self, pool: str) -> float:
        shares = self.raw["shares"]
        if pool not in shares:
            raise KeyError(f"no budget share for pool {pool!r} (config.yaml shares)")
        return float(shares[pool]) / 100.0

    def pool_cap(self, pool: str) -> int:
        """Token budget of a pool."""
        return int(self.tranche_tokens * self.share(pool))

    def pool_cap_usd(self, pool: str) -> float | None:
        return None if self.cap_usd is None else self.cap_usd * self.share(pool)

    def family_cap(self, family: str) -> int:
        return self.pool_cap(self.pool(family))

    def role(self, role: str) -> dict:
        if role not in self.raw["models"]:
            raise KeyError(f"unknown role {role!r}")
        r = dict(self.raw["models"][role])
        env_model = backend_env().get(f"DATAGEN_MODEL_{role.upper()}")
        if env_model:
            r["model"] = env_model
        if "/" in r["model"]:
            raise ValueError(f"model {r['model']!r}: only plain GPT model ids are allowed")
        return r

    @property
    def env_file(self) -> Path:
        return Path(os.environ.get("DATAGEN_ENV_FILE") or self.raw.get("env_file") or ENV_FILE)

    @property
    def output_root(self) -> Path:
        """Relative output_root resolves against ml/ of the MAIN checkout (git common dir), so
        every worktree shares one ledger, cache and release tree."""
        env = os.environ.get("DATAGEN_ROOT")
        p = Path(env) if env else main_ml() / self.raw.get("output_root", "data/datagen")
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache(maxsize=1)
def main_ml() -> Path:
    import subprocess

    try:
        common = subprocess.check_output(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=ML,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        main = Path(common).parent / "ml"
        if main.is_dir():
            return main
    except (OSError, subprocess.CalledProcessError):
        pass
    return ML


def load(path: str | Path | None = None) -> Config:
    p = Path(path or os.environ.get("DATAGEN_CONFIG") or Path(__file__).with_name("config.yaml"))
    return Config(yaml.safe_load(p.read_text()))


@lru_cache(maxsize=1)
def default() -> Config:
    return load()


def backend_env() -> dict:
    """DATAGEN_* backend settings: the process environment wins over the env file. Values are
    secrets-bearing (API key) and must never be printed or logged."""
    from dotenv import dotenv_values

    path = Path(os.environ.get("DATAGEN_ENV_FILE") or default().raw.get("env_file") or ENV_FILE)
    vals: dict = {}
    if path.exists():
        vals = {k: v for k, v in dotenv_values(path).items() if k.startswith("DATAGEN_") and v}
    vals.update({k: v for k, v in os.environ.items() if k.startswith("DATAGEN_") and v})
    return vals


def load_env() -> None:
    """Load HF_TOKEN etc. from the repo's .env.local into os.environ (never printed)."""
    from dotenv import load_dotenv

    if ENV_FILE.exists():
        load_dotenv(ENV_FILE, override=False)
