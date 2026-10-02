#!/usr/bin/env bash
# The rollback proof of the sync-time fix:
# 1. writes src/__tests__/fixtures/new-saves.json with the store code of this
#    checkout (new-saves.test.ts);
# 2. loads those saves with the store code of an older commit and writes
#    src/__tests__/fixtures/rollback-loads.json (rollback.test.ts). The
#    default is the merge base of this checkout and origin/master: the code
#    that a rollback of this branch's deploy runs.
# src/__tests__/rollback-safety.test.ts checks both files. After a run with
# a new commit, set ROLLBACK_COMMIT in that test to the commit that this
# script prints.
# Run it from anywhere: bash apps/web/scripts/legacy-saves/rollback.sh [commit]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web="$(cd "$here/../.." && pwd)"
repo="$(git -C "$web" rev-parse --show-toplevel)"

if [ "$#" -ge 1 ]; then
  commit="$1"
elif ! commit="$(git -C "$repo" merge-base HEAD origin/master)"; then
  echo "rollback.sh: no merge base with origin/master; pass a commit" >&2
  exit 1
fi

cd "$web"
TEST_FILE=new-saves.test.ts pnpm exec vitest run --config scripts/legacy-saves/vitest.config.ts

# The old src goes inside apps/web, so its imports find apps/web/node_modules.
# It is removed on exit, also when the run fails.
legacy="$web/.legacy-src-$$"
trap 'rm -rf "$legacy"' EXIT
mkdir -p "$legacy"
git -C "$repo" archive "$commit" apps/web/src | tar -x -C "$legacy"

LEGACY_SRC="$legacy/apps/web/src" LEGACY_COMMIT="$(git -C "$repo" rev-parse --short "$commit")" TEST_FILE=rollback.test.ts \
  pnpm exec vitest run --config scripts/legacy-saves/vitest.config.ts
echo "Wrote $web/src/__tests__/fixtures/new-saves.json and rollback-loads.json (old code: $(git -C "$repo" rev-parse --short "$commit"))"
