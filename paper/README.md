# Lotse-RL preprint

LaTeX source of *Lotse-RL: Executable Eligibility Rules as Verifiable Ground Truth for Benefits
Navigation in Austrian Social Insurance* (arXiv, cs.CL / cs.AI). The research plan is in
[docs/research/lotse-rl.md](../docs/research/lotse-rl.md).

```sh
make -C paper        # regenerate tables, build with tectonic, copy the PDF to paper/lotse-rl.pdf
```

Requirements: Python 3 (standard library only) and [tectonic](https://tectonic-typesetting.github.io/).

## How numbers get into the paper

`scripts/tables.py` writes every table into `generated/` from these inputs:

| Input | Tables |
| --- | --- |
| `packages/knowledge/` | World statistics (catalog, processes, offices, forms) |
| `docs/evals/results.md` | Product evaluation baseline (labelled as product evals) |
| `ml/results/*persona*.json`, `*corpus*.json`, `*selftest*`/`*gym*.json`, `*sft*.json` | Personas, corpus, gym self-test, SFT smoke run |
| `ml/results/*.json` (by table id or name) | Status of planned tables T1–T8 |
| `ml/quantum/results.json` | T9 quantum study |
| `ml/results/datagen-*.json`, `publish-*.json`, `sources/hf-at-benefits-README.md` | Data release table (`tab_data.tex`); the card snapshot supplies only the documents counts |
| all of the above | `generated/numbers.tex`: macros for every number quoted in the prose |

A table without an input file prints a single *not run* row. The abstract, limitations and
conclusion use generated macros (`generated/status.tex`, `generated/numbers.tex`), so the text never claims a
result the tables do not contain. Do not type numbers into `main.tex` by hand.

`refs.bib` only cites sources listed in section 15 of the research plan; metadata comes from arXiv,
the ACL Anthology, DOI records and the projects' own citation blocks.

`build/` is ignored; `lotse-rl.pdf` and `generated/` are committed.
