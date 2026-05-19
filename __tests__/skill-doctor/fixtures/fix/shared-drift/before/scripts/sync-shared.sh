#!/usr/bin/env bash
set -euo pipefail

mkdir -p local skill-a/references
printf "ran\n" > local/sync-ran.txt
cp _shared/template.md skill-a/references/template.md
