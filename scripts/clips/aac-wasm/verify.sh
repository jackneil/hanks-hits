#!/usr/bin/env bash
# Proves that the AAC WASM build is reproducible.
#
# The script builds the module two times, each time from a clean, empty
# directory in a new container. Then it compares:
#   1. the SHA-256 of the two outputs (the build is repeatable),
#   2. that hash with the recorded hash in ffmpeg-aac-enc.mjs.sha256,
#   3. that hash with the committed module in apps/web/public/clips/aac,
#   4. the license texts and BUILD-INFO.txt with the installed copies.
#
# Usage:
#   scripts/clips/aac-wasm/verify.sh [--cross-platform]
# --cross-platform also builds one time for the other CPU platform
# (linux/amd64 on an arm64 host, linux/arm64 on an amd64 host) and compares
# that output too. Docker must be able to run the other platform.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
WEB_PUBLIC="$ROOT/apps/web/public"
RECORDED_HASH="$HERE/ffmpeg-aac-enc.mjs.sha256"

cross=0
for arg in "$@"; do
  case "$arg" in
    --cross-platform) cross=1 ;;
    *) echo "verify.sh: unknown argument $arg" >&2; exit 2 ;;
  esac
done

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

failures=0
check() {
  local name=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    echo "PASS  $name"
  else
    echo "FAIL  $name: expected $expected, got $actual"
    failures=$((failures + 1))
  fi
}

# Compares two files byte for byte.
check_same() {
  local name=$1 a=$2 b=$3
  if cmp -s "$a" "$b"; then
    echo "PASS  $name"
  else
    echo "FAIL  $name: $a and $b are different"
    failures=$((failures + 1))
  fi
}

scratch=$(mktemp -d "${TMPDIR:-/tmp}/aac-wasm-verify.XXXXXX")
trap 'rm -rf "$scratch"' EXIT

"$HERE/build.sh" --out "$scratch/a"
"$HERE/build.sh" --out "$scratch/b"

hash_a=$(sha256_of "$scratch/a/ffmpeg-aac-enc.mjs")
hash_b=$(sha256_of "$scratch/b/ffmpeg-aac-enc.mjs")
[ -f "$RECORDED_HASH" ] || { echo "FAIL  no recorded hash: run build.sh first"; exit 1; }
recorded=$(cut -d ' ' -f 1 "$RECORDED_HASH")

check "two clean builds give the same module" "$hash_a" "$hash_b"
check "the build matches the recorded hash" "$recorded" "$hash_a"
if [ -f "$WEB_PUBLIC/clips/aac/ffmpeg-aac-enc.mjs" ]; then
  check "the committed module matches the recorded hash" "$recorded" "$(sha256_of "$WEB_PUBLIC/clips/aac/ffmpeg-aac-enc.mjs")"
else
  echo "FAIL  no committed module in apps/web/public/clips/aac"
  failures=$((failures + 1))
fi
check_same "two clean builds give the same BUILD-INFO.txt" "$scratch/a/BUILD-INFO.txt" "$scratch/b/BUILD-INFO.txt"
check_same "BUILD-INFO.txt matches the installed copy" "$scratch/a/BUILD-INFO.txt" "$WEB_PUBLIC/licenses/aac-wasm/BUILD-INFO.txt"
for f in LGPL-2.1.txt Emscripten-LICENSE.txt musl-COPYRIGHT.txt; do
  check_same "$f matches the installed copy" "$scratch/a/licenses/$f" "$WEB_PUBLIC/licenses/$f"
done

if [ "$cross" = 1 ]; then
  case "$(docker version --format '{{.Server.Arch}}')" in
    arm64 | aarch64) other=linux/amd64 ;;
    *) other=linux/arm64 ;;
  esac
  "$HERE/build.sh" --out "$scratch/c" --platform "$other"
  check "the $other build gives the same module" "$hash_a" "$(sha256_of "$scratch/c/ffmpeg-aac-enc.mjs")"
fi

if [ "$failures" -gt 0 ]; then
  echo "verify.sh: $failures check(s) failed"
  exit 1
fi
echo "verify.sh: the build is reproducible ($hash_a)"
