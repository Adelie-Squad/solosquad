#!/usr/bin/env bash
# Compile the ICML paper and name the PDF after its main title (\icmltitle,
# text before the \\ line break). Re-run whenever the title changes.
set -euo pipefail
cd "$(dirname "$0")"

# 1) extract main title (up to the first \\), 2) slugify.
title=$(sed -n 's/.*\\icmltitle{\(.*\)\\\\.*/\1/p' main.tex | head -1)
[ -n "$title" ] || { echo "no \\icmltitle found in main.tex"; exit 1; }
slug=$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')

# 3) compile, then rename output to <slug>.pdf (no leftover main.pdf).
tectonic main.tex "$@"
mv -f main.pdf "$slug.pdf"
echo "→ reports/paper/$slug.pdf"
