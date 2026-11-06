# Build the Lotse-RL preprint. Tables are regenerated from result files on every build.
PYTHON   ?= python3
TECTONIC ?= tectonic

.PHONY: all tables pdf clean

all: pdf

tables:
	$(PYTHON) scripts/tables.py

pdf: tables
	mkdir -p build
	$(TECTONIC) --keep-logs --outdir build main.tex
	cp build/main.pdf lotse-rl.pdf

clean:
	rm -rf build
