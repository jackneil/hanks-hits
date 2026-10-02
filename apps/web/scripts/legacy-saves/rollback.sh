#!/usr/bin/env bash
# The rollback proof of the sync-time fix:
# 1. writes src/__tests__/fixtures/new-saves.json with the store code of this
#    checkout (new-saves.test.ts);
# 2. loads those saves with the store code of an older commit and writes
#    src/__tests__/fixtures/rollback-loads.json (rollback.test.ts). The
#    default is ROLLBACK_COMMIT in src/__tests__/rollback-commit.ts: the
#    master commit that a rollback of this branch's deploy runs.
# src/__tests__/rollback-safety.test.ts checks both files. To use a new
# commit, change ROLLBACK_COMMIT, then run this script and no-worse.sh.
# Run it from anywhere: bash apps/web/scripts/legacy-saves/rollback.sh [commit]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web="$(cd "$here/../.." && pwd)"
repo="$(git -C "$web" rev-parse --show-toplevel)"

if [ "$#" -ge 1 ]; then
  commit="$1"
else
  commit="$(sed -n 's/^export const ROLLBACK_COMMIT = "\([0-9a-f]*\)";$/\1/p' "$web/src/__tests__/rollback-commit.ts")"
  if [ -z "$commit" ]; then
    echo "rollback.sh: no ROLLBACK_COMMIT in src/__tests__/rollback-commit.ts; pass a commit" >&2
    exit 1
  fi
fi
if ! git -C "$repo" merge-base --is-ancestor "$commit" HEAD; then
  echo "rollback.sh: $commit is not an ancestor of HEAD, so a rollback of this branch does not run it" >&2
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
