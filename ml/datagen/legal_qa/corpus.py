"""RIS law corpus (JulianAT/at-sv-law) loading, Absatz splitting and BM25 for hard negatives."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import CountVectorizer

from datagen.config import ML

ATTRIBUTION = "Datenquelle: Rechtsinformationssystem des Bundes (RIS), Bundeskanzleramt Österreich"
LICENCE = "CC-BY-4.0"
MAX_CHARS = 8_000
MIN_CHARS = 150
REPEALED = re.compile(r"^\(Anm\.:.*(aufgehoben|entfällt)", re.S)
ABSATZ = re.compile(r"(?m)^(?:§\s*\d+[a-z]*\.\s*)?\((\d+[a-z]?)\)\s")

STOP = set(
    [
        "aber",
        "alle",
        "allem",
        "allen",
        "aller",
        "alles",
        "als",
        "also",
        "am",
        "an",
        "ander",
        "andere",
        "anderem",
        "anderen",
        "anderer",
        "anderes",
        "anderm",
        "andern",
        "anderr",
        "anders",
        "auch",
        "auf",
        "aus",
        "bei",
        "bin",
        "bis",
        "bist",
        "da",
        "damit",
        "dann",
        "der",
        "den",
        "des",
        "dem",
        "die",
        "das",
        "dass",
        "daß",
        "derselbe",
        "derselben",
        "denselben",
        "desselben",
        "demselben",
        "dieselbe",
        "dieselben",
        "dasselbe",
        "dazu",
        "dein",
        "deine",
        "deinem",
        "deinen",
        "deiner",
        "deines",
        "denn",
        "derer",
        "dessen",
        "dich",
        "dir",
        "du",
        "dies",
        "diese",
        "diesem",
        "diesen",
        "dieser",
        "dieses",
        "doch",
        "dort",
        "durch",
        "ein",
        "eine",
        "einem",
        "einen",
        "einer",
        "eines",
        "einig",
        "einige",
        "einigem",
        "einigen",
        "einiger",
        "einiges",
        "einmal",
        "er",
        "ihn",
        "ihm",
        "es",
        "etwas",
        "euer",
        "eure",
        "eurem",
        "euren",
        "eurer",
        "eures",
        "für",
        "gegen",
        "gewesen",
        "hab",
        "habe",
        "haben",
        "hat",
        "hatte",
        "hatten",
        "hier",
        "hin",
        "hinter",
        "ich",
        "mich",
        "mir",
        "ihr",
        "ihre",
        "ihrem",
        "ihren",
        "ihrer",
        "ihres",
        "euch",
        "im",
        "in",
        "indem",
        "ins",
        "ist",
        "jede",
        "jedem",
        "jeden",
        "jeder",
        "jedes",
        "jene",
        "jenem",
        "jenen",
        "jener",
        "jenes",
        "jetzt",
        "kann",
        "kein",
        "keine",
        "keinem",
        "keinen",
        "keiner",
        "keines",
        "können",
        "könnte",
        "machen",
        "man",
        "manche",
        "manchem",
        "manchen",
        "mancher",
        "manches",
        "mein",
        "meine",
        "meinem",
        "meinen",
        "meiner",
        "meines",
        "mit",
        "muss",
        "musste",
        "nach",
        "nicht",
        "nichts",
        "noch",
        "nun",
        "nur",
        "ob",
        "oder",
        "ohne",
        "sehr",
        "sein",
        "seine",
        "seinem",
        "seinen",
        "seiner",
        "seines",
        "selbst",
        "sich",
        "sie",
        "ihnen",
        "sind",
        "so",
        "solche",
        "solchem",
        "solchen",
        "solcher",
        "solches",
        "soll",
        "sollte",
        "sondern",
        "sonst",
        "über",
        "um",
        "und",
        "uns",
        "unsere",
        "unserem",
        "unseren",
        "unser",
        "unseres",
        "unter",
        "viel",
        "vom",
        "von",
        "vor",
        "während",
        "war",
        "waren",
        "warst",
        "was",
        "weg",
        "weil",
        "weiter",
        "welche",
        "welchem",
        "welchen",
        "welcher",
        "welches",
        "wenn",
        "werde",
        "werden",
        "wie",
        "wieder",
        "will",
        "wir",
        "wird",
        "wirst",
        "wo",
        "wollen",
        "wollte",
        "würde",
        "würden",
        "zu",
        "zum",
        "zur",
        "zwar",
        "zwischen",
        "abs",
        "bgbl",
        "nr",
        "z",
    ]
)


def corpus_path() -> Path:
    env = os.environ.get("DATAGEN_LAW_CORPUS")
    return Path(env) if env else ML / "data/corpus/at-sv-law.parquet"


@dataclass
class Section:
    doc_id: str
    act: str
    act_title: str
    paragraph: str
    title: str
    text: str
    url: str
    version_as_of: str
    absaetze: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return f"{self.paragraph} {self.act}"


def split_absaetze(text: str) -> list[str]:
    """Absatz numbers in order of appearance, e.g. ["1", "2", "2a", "3"]."""
    seen = []
    for m in ABSATZ.finditer(text):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    return seen


def eligible(text: str) -> bool:
    t = text.strip()
    return len(t) >= MIN_CHARS and not REPEALED.match(t)


def load_sections(path: Path | None = None) -> list[Section]:
    frame = pd.read_parquet(path or corpus_path())
    out = []
    for r in frame.itertuples(index=False):
        out.append(
            Section(
                doc_id=r.doc_id,
                act=r.act,
                act_title=r.act_title,
                paragraph=r.paragraph,
                title=r.title or "",
                text=r.text,
                url=r.url,
                version_as_of=r.version_as_of,
                absaetze=split_absaetze(r.text),
            )
        )
    return out


def truncate(text: str, limit: int = MAX_CHARS) -> str:
    if len(text) <= limit:
        return text
    cut = text.rfind("\n", 0, limit)
    return text[: cut if cut > limit // 2 else limit] + "\n[…]"


def tokenize(text: str) -> list[str]:
    return [
        t
        for t in re.findall(r"[a-zäöüß0-9]+", text.lower())
        if len(t) > 1 and t not in STOP and not t.isdigit()
    ]


class BM25:
    """Okapi BM25 over the corpus (k1 = 1.5, b = 0.75), sparse matrix implementation."""

    def __init__(self, docs: list[str], k1: float = 1.5, b: float = 0.75):
        self.vec = CountVectorizer(tokenizer=tokenize, lowercase=False, token_pattern=None)
        tf = self.vec.fit_transform(docs).tocsr().astype(np.float32)
        n = tf.shape[0]
        dl = np.asarray(tf.sum(axis=1)).ravel()
        avg = dl.mean() if n else 1.0
        df = np.asarray((tf > 0).sum(axis=0)).ravel()
        self.idf = np.log(1 + (n - df + 0.5) / (df + 0.5)).astype(np.float32)
        rows = np.repeat(np.arange(n), np.diff(tf.indptr))
        norm = k1 * (1 - b + b * dl[rows] / avg)
        data = tf.data * (k1 + 1) / (tf.data + norm)
        self.w = sparse.csr_matrix((data, tf.indices, tf.indptr), shape=tf.shape)
        self.w = self.w.multiply(self.idf[None, :]).tocsc().T.tocsr()  # vocab x docs

    def scores(self, queries: list[str]) -> np.ndarray:
        q = self.vec.transform(queries)
        q.data[:] = 1.0  # binary query terms
        return np.asarray((q @ self.w).todense())

    def top(self, query: str, k: int, exclude: set[int] = frozenset()) -> list[tuple[int, float]]:
        s = self.scores([query])[0]
        order = np.argsort(-s)
        out = []
        for i in order:
            if int(i) in exclude:
                continue
            if s[i] <= 0 or len(out) >= k:
                break
            out.append((int(i), float(s[i])))
        return out

    def rank_of(self, query: str, target: int) -> int | None:
        """1-based BM25 rank of the target document; None if it shares no query term."""
        s = self.scores([query])[0]
        return int((s > s[target]).sum()) + 1 if s[target] > 0 else None
