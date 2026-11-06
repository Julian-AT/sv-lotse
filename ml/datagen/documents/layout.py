# ruff: noqa: E501
"""Deterministic A4 layout engine: blocks of tagged runs -> positioned text items -> PDF.

Gold positions come from here. Every text item is drawn with one `drawString` call at a known
baseline and x, so each tagged span maps to exact page-text offsets and bounding boxes. The page
text follows the E12 / brain serialization: items sorted top to bottom by baseline, grouped into a
row when within 5 pt of the row's first baseline, left to right inside a row, joined with one space;
rows joined with one newline. Bounding boxes are normalised to the page with a top-left origin
(x, y, width, height in [0, 1]); an item's box spans baseline - 0.8 * size to baseline + 0.2 * size,
as in `packages/brain/src/documents/text-layer.ts`.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Any

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

ROW_TOLERANCE = 5.0
PAGE_W, PAGE_H = A4
MM = 72 / 25.4

FONTS = {
    "Helvetica": ("Helvetica", "Helvetica-Bold", "Helvetica-Oblique"),
    "Times-Roman": ("Times-Roman", "Times-Bold", "Times-Italic"),
    "Courier": ("Courier", "Courier-Bold", "Courier-Oblique"),
}


@dataclass
class Tag:
    """A gold or exclusion span. `data` holds type, fact_type and provenance."""

    id: str
    data: dict[str, Any]


@dataclass
class Run:
    text: str
    tags: list[tuple[int, int, Tag]] = field(default_factory=list)  # spans within `text`

    @classmethod
    def whole(cls, text: str, tag: Tag | None = None) -> Run:
        return cls(text, [(0, len(text), tag)] if tag else [])

    def tag_sub(self, value: str, tag: Tag) -> bool:
        i = self.text.find(value)
        if i < 0 or not value:
            return False
        self.tags.append((i, i + len(value), tag))
        return True


@dataclass
class Para:
    runs: list[Run]
    style: str = "body"  # body | bold | italic | small | heading | title
    indent: float = 0.0  # extra left indent in pt
    bullet: str | None = None
    space_before: float = 0.0
    align: str = "left"  # left | right | center
    x: float | None = None  # absolute left (pt) overriding the margin
    width: float | None = None


@dataclass
class Fields:
    rows: list[tuple[str, Run]]  # label, value run
    label_width: float = 110.0
    x: float | None = None
    width: float | None = None
    style: str = "body"
    space_before: float = 0.0


@dataclass
class Table:
    header: list[str]
    rows: list[list[Run]]
    widths: list[float]  # fractions of the text width
    space_before: float = 4.0
    align_right: tuple[int, ...] = ()


@dataclass
class Rule:
    space_before: float = 2.0


@dataclass
class Space:
    height: float


@dataclass
class Item:
    text: str
    x: float
    baseline: float  # PDF coordinates (origin bottom-left)
    font: str
    size: float
    width: float
    offset: int = -1  # in page text, set at serialization


@dataclass
class Page:
    number: int
    items: list[Item] = field(default_factory=list)
    rules: list[tuple[float, float, float]] = field(default_factory=list)  # x0, x1, y
    text: str = ""
    lines: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Piece:
    page: int
    item: int
    start: int
    end: int


@dataclass
class Layout:
    font: str = "Helvetica"
    size: float = 10.0
    margin: float = 20 * MM
    top: float = 18 * MM
    bottom: float = 22 * MM
    leading: float = 1.32
    footer: list[str] = field(default_factory=list)
    running_header: str | None = None


class Engine:
    def __init__(self, layout: Layout):
        self.l = layout
        self.pages: list[Page] = []
        self.spans: dict[str, list[Piece]] = {}
        self.tags: dict[str, Tag] = {}
        self._new_page()

    # --- geometry -------------------------------------------------------------------------
    @property
    def text_width(self) -> float:
        return PAGE_W - 2 * self.l.margin

    def font_for(self, style: str) -> tuple[str, float]:
        regular, bold, italic = FONTS[self.l.font]
        s = self.l.size
        return {
            "body": (regular, s),
            "bold": (bold, s),
            "italic": (italic, s),
            "small": (regular, max(6.5, s - 2)),
            "tiny": (regular, max(6.0, s - 3)),
            "heading": (bold, s + 0.5),
            "title": (bold, s + 4),
            "letterhead": (bold, s + 5),
        }[style]

    def _new_page(self) -> None:
        self.pages.append(Page(number=len(self.pages) + 1))
        self.y = PAGE_H - self.l.top
        if self.l.running_header and len(self.pages) > 1:
            font, size = self.font_for("small")
            self._item(self.l.running_header, self.l.margin, self.y - size, font, size)
            self.y -= size * 2.2

    @property
    def page(self) -> Page:
        return self.pages[-1]

    def _room(self, height: float) -> bool:
        return self.y - height >= self.l.bottom

    def ensure(self, height: float) -> None:
        if not self._room(height) and self.y < PAGE_H - self.l.top - 1:
            self._new_page()

    def _item(self, text: str, x: float, baseline: float, font: str, size: float) -> int:
        self.page.items.append(Item(text, x, baseline, font, size, stringWidth(text, font, size)))
        return len(self.page.items) - 1

    def _record(self, tag: Tag | None, piece: Piece) -> None:
        if tag is None:
            return
        self.tags[tag.id] = tag
        self.spans.setdefault(tag.id, []).append(piece)

    # --- wrapping ---------------------------------------------------------------------------
    @staticmethod
    def _join(runs: list[Run]) -> tuple[str, list[tuple[int, int, Tag]]]:
        text, tags, pos = [], [], 0
        for i, r in enumerate(runs):
            if i:
                text.append(" ")
                pos += 1
            text.append(r.text)
            tags.extend((pos + a, pos + b, t) for a, b, t in r.tags)
            pos += len(r.text)
        return "".join(text), tags

    @staticmethod
    def wrap(text: str, font: str, size: float, width: float) -> list[tuple[int, int]]:
        """Greedy word wrap -> [start, end) ranges; the breaking space belongs to no line."""
        lines: list[tuple[int, int]] = []
        start, last_space, i = 0, -1, 0
        n = len(text)
        while i <= n:
            if i == n or text[i] == " ":
                if stringWidth(text[start:i], font, size) > width and last_space > start:
                    lines.append((start, last_space))
                    start = last_space + 1
                    last_space = -1
                    continue
                if i == n:
                    break
                last_space = i
            i += 1
        lines.append((start, n))
        out = []
        for a, b in lines:
            # hard-split words longer than the width
            while stringWidth(text[a:b], font, size) > width * 1.15 and b - a > 8:
                cut = a + max(1, int((b - a) * width / stringWidth(text[a:b], font, size)))
                out.append((a, cut))
                a = cut
            out.append((a, b))
        return [(a, b) for a, b in out if b > a]

    # --- blocks -----------------------------------------------------------------------------
    def para(self, p: Para) -> None:
        font, size = self.font_for(p.style)
        lead = size * self.l.leading
        x0 = (p.x if p.x is not None else self.l.margin) + p.indent
        width = p.width if p.width is not None else self.text_width - (x0 - self.l.margin)
        bullet_w = 0.0
        if p.bullet:
            bullet_w = stringWidth(p.bullet + " ", font, size) + 2
        text, tags = self._join(p.runs)
        if not text:
            return
        lines = self.wrap(text, font, size, width - bullet_w)
        self.ensure(p.space_before + lead * len(lines))
        self.y -= p.space_before
        for li, (a, b) in enumerate(lines):
            baseline = self.y - size
            seg = text[a:b]
            w = stringWidth(seg, font, size)
            x = x0 + bullet_w
            if p.align == "right":
                x = x0 + width - w
            elif p.align == "center":
                x = x0 + (width - w) / 2
            if p.bullet and li == 0:
                self._item(p.bullet, x0, baseline, font, size)
            idx = self._item(seg, x, baseline, font, size)
            for ta, tb, tag in tags:
                s, e = max(ta, a), min(tb, b)
                if s < e:
                    self._record(tag, Piece(self.page.number, idx, s - a, e - a))
            self.y -= lead

    def fields(self, f: Fields) -> None:
        font, size = self.font_for(f.style)
        bold = FONTS[self.l.font][1]
        lead = size * self.l.leading
        x0 = f.x if f.x is not None else self.l.margin
        width = f.width if f.width is not None else self.text_width
        label_width = max([f.label_width] + [stringWidth(lab, bold, size) + 6 for lab, _ in f.rows])
        self.ensure(f.space_before + lead * len(f.rows))
        self.y -= f.space_before
        for label, run in f.rows:
            baseline = self.y - size
            if label:
                self._item(label, x0, baseline, bold, size)
            vx = x0 + label_width
            lines = self.wrap(run.text, font, size, width - label_width)
            if run.tags and len(lines) > 1:  # gold-bearing values stay on one line
                lines = [(0, len(run.text))]
            for li, (a, b) in enumerate(lines):
                bl = baseline - li * lead
                idx = self._item(run.text[a:b], vx, bl, font, size)
                for ta, tb, tag in run.tags:
                    s, e = max(ta, a), min(tb, b)
                    if s < e:
                        self._record(tag, Piece(self.page.number, idx, s - a, e - a))
            self.y -= lead * max(1, len(lines))

    def table(self, t: Table) -> None:
        font, size = self.font_for("body")
        bold = FONTS[self.l.font][1]
        lead = size * self.l.leading
        # column widths: at least the widest cell (+ gutter); the slack goes to the widest column
        need = []
        for i, h in enumerate(t.header):
            cells = [stringWidth(h, bold, size)] + [
                stringWidth(r[i].text, font, size) for r in t.rows
            ]
            need.append(max(cells) + 10)
        widths = [w * self.text_width for w in t.widths]
        if sum(need) <= self.text_width:
            widths = [max(w, n) for w, n in zip(widths, need, strict=True)]
            over = sum(widths) - self.text_width
            if over > 0:
                widest = max(range(len(widths)), key=lambda i: widths[i] - need[i])
                widths[widest] -= over
        else:
            flex = max(range(len(need)), key=lambda i: need[i])
            widths = list(need)
            widths[flex] = max(40.0, self.text_width - (sum(need) - need[flex]))
        t.widths = [w / self.text_width for w in widths]
        xs, x = [], self.l.margin
        for w in t.widths:
            xs.append(x)
            x += w * self.text_width
        self.ensure(t.space_before + lead * 2.5)
        self.y -= t.space_before
        baseline = self.y - size
        for i, h in enumerate(t.header):
            self._item(h, xs[i], baseline, bold, size)
        self.y -= lead * 0.95
        self.page.rules.append((self.l.margin, self.l.margin + self.text_width, self.y + 1))
        self.y -= lead * 0.25
        for row in t.rows:
            self.ensure(lead)
            baseline = self.y - size
            for i, run in enumerate(row):
                if not run.text:
                    continue
                colw = t.widths[i] * self.text_width - 4
                text = run.text
                while stringWidth(text, font, size) > colw and len(text) > 4:
                    text = text[:-1]
                if text != run.text and run.tags:  # never truncate gold-bearing cells
                    text = run.text
                x = xs[i]
                if i in t.align_right:
                    x = xs[i] + colw - stringWidth(text, font, size)
                idx = self._item(text, x, baseline, font, size)
                for ta, tb, tag in run.tags:
                    s, e = max(ta, 0), min(tb, len(text))
                    if s < e:
                        self._record(tag, Piece(self.page.number, idx, s, e))
            self.y -= lead

    def rule(self, r: Rule) -> None:
        self.y -= r.space_before
        self.page.rules.append((self.l.margin, PAGE_W - self.l.margin, self.y))
        self.y -= 4

    def add(self, block: Any) -> None:
        if isinstance(block, Para):
            self.para(block)
        elif isinstance(block, Fields):
            self.fields(block)
        elif isinstance(block, Table):
            self.table(block)
        elif isinstance(block, Rule):
            self.rule(block)
        elif isinstance(block, Space):
            self.y -= block.height
        else:
            raise TypeError(block)

    # --- finish -----------------------------------------------------------------------------
    def finish(self) -> None:
        total = len(self.pages)
        font, size = self.font_for("tiny")
        for page in self.pages:
            y = self.l.bottom - size * 2.2
            for k, text in enumerate([*self.l.footer, f"Seite {page.number} von {total}"]):
                page.items.append(
                    Item(
                        text,
                        self.l.margin,
                        y - k * size * 1.3,
                        font,
                        size,
                        stringWidth(text, font, size),
                    )
                )
            serialize(page)


def serialize(page: Page) -> None:
    order = sorted(range(len(page.items)), key=lambda i: (-page.items[i].baseline, page.items[i].x))
    rows: list[list[int]] = []
    first = None
    for i in order:
        bl = page.items[i].baseline
        if rows and first is not None and first - bl <= ROW_TOLERANCE:
            rows[-1].append(i)
        else:
            rows.append([i])
            first = bl
    parts: list[str] = []
    lines: list[dict[str, Any]] = []
    pos = 0
    for r, row in enumerate(rows):
        row.sort(key=lambda i: page.items[i].x)
        if r:
            pos += 1  # newline
        texts = []
        for k, i in enumerate(row):
            if k:
                pos += 1
            page.items[i].offset = pos
            texts.append(page.items[i].text)
            pos += len(page.items[i].text)
        line_text = " ".join(texts)
        parts.append(line_text)
        lines.append({"text": line_text, "bbox": union([item_box(page.items[i]) for i in row])})
    page.text = "\n".join(parts)
    page.lines = lines


def item_box(
    item: Item, start: int = 0, end: int | None = None
) -> tuple[float, float, float, float]:
    """(x0, top, x1, bottom) in PDF points with a top-left origin."""
    end = len(item.text) if end is None else end
    x0 = item.x + stringWidth(item.text[:start], item.font, item.size)
    x1 = item.x + stringWidth(item.text[:end], item.font, item.size)
    top = PAGE_H - (item.baseline + 0.8 * item.size)
    bottom = PAGE_H - (item.baseline - 0.2 * item.size)
    return (x0, top, x1, bottom)


def union(boxes: list[tuple[float, float, float, float]]) -> dict[str, float]:
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[2] for b in boxes)
    y1 = max(b[3] for b in boxes)
    return norm((x0, y0, x1, y1))


def norm(b: tuple[float, float, float, float]) -> dict[str, float]:
    x0, y0, x1, y1 = (max(0.0, b[0]), max(0.0, b[1]), min(PAGE_W, b[2]), min(PAGE_H, b[3]))
    return {
        "x": round(x0 / PAGE_W, 6),
        "y": round(y0 / PAGE_H, 6),
        "width": round(max(x1 - x0, 0.5) / PAGE_W, 6),
        "height": round(max(y1 - y0, 0.5) / PAGE_H, 6),
    }


def resolve(engine: Engine) -> list[dict[str, Any]]:
    """Tagged spans -> page, offsets, verbatim quote, union bbox and per-line boxes."""
    out = []
    for tid, pieces in engine.spans.items():
        tag = engine.tags[tid]
        pages = {p.page for p in pieces}
        if len(pages) != 1:
            out.append({"id": tid, **tag.data, "error": "spans_pages"})
            continue
        page = engine.pages[pieces[0].page - 1]
        pieces = sorted(pieces, key=lambda p: (page.items[p.item].offset, p.start))
        first, last = pieces[0], pieces[-1]
        start = page.items[first.item].offset + first.start
        end = page.items[last.item].offset + last.end
        quote = page.text[start:end]
        joined = "\n".join(page.items[p.item].text[p.start : p.end] for p in pieces)
        boxes = [item_box(page.items[p.item], p.start, p.end) for p in pieces]
        rec = {
            "id": tid,
            **tag.data,
            "quote": quote,
            "page": page.number,
            "position": {"start": start, "end": end},
            "bbox": union(boxes),
            "boxes": [norm(b) for b in boxes],
        }
        if quote != joined:
            rec["error"] = "non_contiguous"
        out.append(rec)
    return out


def draw_pdf(engine: Engine, title: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4, pageCompression=1, invariant=1)
    c.setTitle(title)
    c.setAuthor("AT-Benefits synthetic documents")
    c.setCreator("datagen.documents")
    for page in engine.pages:
        for x0, x1, y in page.rules:
            c.setLineWidth(0.6)
            c.line(x0, y, x1, y)
        for it in page.items:
            c.setFont(it.font, it.size)
            c.drawString(it.x, it.baseline, it.text)
        c.showPage()
    c.save()
    return buf.getvalue()
