#!/usr/bin/env bash
# The master side of the no-worse-than-master proof of the sync-time fix
# (src/__tests__/no-worse-than-master.test.tsx): unpacks the src of master
# (default: ROLLBACK_COMMIT in src/__tests__/rollback-commit.ts) and runs
# no-worse-master.test.ts against it. That run makes the inputs, runs every
# cell of src/__tests__/no-worse/harness.ts with master's useAuthSync and
# stores, and writes src/__tests__/fixtures/no-worse-master.json.
# Run it again after a change to the harness, the fake server or the legacy
# fixtures (the test fails until then).
# Run it from anywhere: bash apps/web/scripts/legacy-saves/no-worse.sh [commit]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web="$(cd "$here/../.." && pwd)"
repo="$(git -C "$web" rev-parse --show-toplevel)"

if [ "$#" -ge 1 ]; then
  commit="$1"
else
  commit="$(sed -n 's/^export const ROLLBACK_COMMIT = "\([0-9a-f]*\)";$/\1/p' "$web/src/__tests__/rollback-commit.ts")"
  if [ -z "$commit" ]; then
    echo "no-worse.sh: no ROLLBACK_COMMIT in src/__tests__/rollback-commit.ts; pass a commit" >&2
    exit 1
  fi
fi
if ! git -C "$repo" merge-base --is-ancestor "$commit" HEAD; then
  echo "no-worse.sh: $commit is not an ancestor of HEAD" >&2
  exit 1
fi

# The old src goes inside apps/web, so its imports find apps/web/node_modules.
# It is removed on exit, also when the run fails.
legacy="$web/.legacy-src-$$"
trap 'rm -rf "$legacy"' EXIT
mkdir -p "$legacy"
git -C "$repo" archive "$commit" apps/web/src | tar -x -C "$legacy"

cd "$web"
LEGACY_SRC="$legacy/apps/web/src" LEGACY_COMMIT="$(git -C "$repo" rev-parse --short "$commit")" TEST_FILE=no-worse-master.test.ts \
  pnpm exec vitest run --config scripts/legacy-saves/vitest.config.ts
echo "Wrote $web/src/__tests__/fixtures/no-worse-master.json (master: $(git -C "$repo" rev-parse --short "$commit"))"
