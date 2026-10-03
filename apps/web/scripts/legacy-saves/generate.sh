#!/usr/bin/env bash
# Writes src/__tests__/fixtures/legacy-saves.json from the store code of an
# older commit (default: 86a1fe0, the last commit before the sync-time fix).
# LEGACY_SAVES_OUT names another output file (the no-worse-than-master test
# reads fixtures/legacy-saves-904bc09.json, the saves of master's code).
# Run it from anywhere: bash apps/web/scripts/legacy-saves/generate.sh [commit]
set -euo pipefail

commit="${1:-86a1fe0}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web="$(cd "$here/../.." && pwd)"
repo="$(git -C "$web" rev-parse --show-toplevel)"

# The old src goes inside apps/web, so its imports find apps/web/node_modules.
# It is removed on exit, also when the run fails.
legacy="$web/.legacy-src-$$"
trap 'rm -rf "$legacy"' EXIT
mkdir -p "$legacy"
git -C "$repo" archive "$commit" apps/web/src | tar -x -C "$legacy"

cd "$web"
LEGACY_SRC="$legacy/apps/web/src" LEGACY_COMMIT="$(git -C "$repo" rev-parse --short "$commit")" \
  pnpm exec vitest run --config scripts/legacy-saves/vitest.config.ts
echo "Wrote ${LEGACY_SAVES_OUT:-$web/src/__tests__/fixtures/legacy-saves.json} from $commit"
