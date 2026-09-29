#!/usr/bin/env bash
# Builds the clip AAC encoder (FFmpeg aacenc as WebAssembly) from the pinned
# FFmpeg source, inside the pinned Emscripten Docker image.
#
# Usage:
#   scripts/clips/aac-wasm/build.sh
#       Build, then install the module, the license texts and the build
#       sources into apps/web/public, and record the output hash.
#   scripts/clips/aac-wasm/build.sh --out DIR [--platform linux/amd64]
#       Build into the empty or missing directory DIR only. Change nothing in
#       the repo. verify.sh uses this form.
#
# Needs: Docker, curl (only when the tarball is not in the repo), shasum or
# sha256sum.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
# shellcheck source=pins.sh
source "$HERE/pins.sh"

WEB_PUBLIC="$ROOT/apps/web/public"
TARBALL="$WEB_PUBLIC/licenses/ffmpeg-$FFMPEG_VERSION.tar.xz"
MODULE_DIR="$WEB_PUBLIC/clips/aac"
LICENSE_DIR="$WEB_PUBLIC/licenses"
SOURCE_COPY_DIR="$LICENSE_DIR/aac-wasm"
RECORDED_HASH="$HERE/ffmpeg-aac-enc.mjs.sha256"
# The files that make "the work that uses the Library" (LGPL-2.1 section 6).
# build.sh copies them next to the FFmpeg source, so both come from one place.
SOURCE_FILES=(README.md bridge.c notice.js build.sh container-build.sh verify.sh pins.sh configure-flags.txt emcc-flags.txt)

out=""
platform=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --platform) platform=$2; shift 2 ;;
    *) echo "build.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

fail() {
  echo "build.sh: $*" >&2
  exit 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed"
docker info >/dev/null 2>&1 || fail "Docker is not running"

# 1. Get the pinned source tarball and check its hash before it is used.
# The site serves the files in apps/web/public, so the download goes to a
# temporary directory first. Only a download with the pinned SHA-256 moves to
# the served path.
if [ ! -f "$TARBALL" ]; then
  echo "build.sh: downloading $FFMPEG_URL"
  download_dir=$(mktemp -d "${TMPDIR:-/tmp}/aac-wasm-download.XXXXXX")
  trap 'rm -rf "$download_dir"' EXIT
  partial="$download_dir/ffmpeg-$FFMPEG_VERSION.tar.xz"
  curl -sSfL "$FFMPEG_URL" -o "$partial" || fail "the download from $FFMPEG_URL failed"
  partial_sha=$(sha256_of "$partial")
  if [ "$partial_sha" != "$FFMPEG_SHA256" ]; then
    fail "the download from $FFMPEG_URL has SHA-256 $partial_sha, but pins.sh says $FFMPEG_SHA256. build.sh deleted it and did not build."
  fi
  mkdir -p "$(dirname "$TARBALL")"
  mv "$partial" "$TARBALL"
  rm -rf "$download_dir"
  trap - EXIT
fi
tarball_sha=$(sha256_of "$TARBALL")
if [ "$tarball_sha" != "$FFMPEG_SHA256" ]; then
  fail "$TARBALL has SHA-256 $tarball_sha, but pins.sh says $FFMPEG_SHA256. Do not build from it. Delete it, then run build.sh again to download the pinned tarball."
fi

# 2. Build in Docker with no network. The container writes to a new directory.
install=0
if [ -z "$out" ]; then
  install=1
  out=$(mktemp -d "${TMPDIR:-/tmp}/aac-wasm-build.XXXXXX")
  trap 'rm -rf "$out"' EXIT
else
  mkdir -p "$out"
  [ -z "$(ls -A "$out")" ] || fail "$out is not empty"
  out=$(cd "$out" && pwd)
fi

echo "build.sh: building FFmpeg $FFMPEG_VERSION AAC in $EMSDK_IMAGE${platform:+ ($platform)}"
# ${platform:+...} gives no argument when no platform is set (also in bash 3.2 with set -u).
docker run --rm --network none ${platform:+--platform "$platform"} \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$TARBALL:/in/ffmpeg.tar.xz:ro" \
  -v "$HERE:/in/scripts:ro" \
  -v "$out:/out" \
  "$EMSDK_IMAGE" bash /in/scripts/container-build.sh

[ -s "$out/ffmpeg-aac-enc.mjs" ] || fail "the build made no ffmpeg-aac-enc.mjs"
module_sha=$(sha256_of "$out/ffmpeg-aac-enc.mjs")
echo "build.sh: ffmpeg-aac-enc.mjs SHA-256 $module_sha"

[ "$install" = 1 ] || exit 0

# 3. Install into the repo.
mkdir -p "$MODULE_DIR" "$LICENSE_DIR" "$SOURCE_COPY_DIR"
cp "$out/ffmpeg-aac-enc.mjs" "$MODULE_DIR/ffmpeg-aac-enc.mjs"
cp "$out/licenses/"* "$LICENSE_DIR/"
echo "$module_sha  ffmpeg-aac-enc.mjs" >"$RECORDED_HASH"
rm -rf "$SOURCE_COPY_DIR"
mkdir -p "$SOURCE_COPY_DIR"
for f in "${SOURCE_FILES[@]}"; do
  cp "$HERE/$f" "$SOURCE_COPY_DIR/$f"
done
cp "$RECORDED_HASH" "$SOURCE_COPY_DIR/ffmpeg-aac-enc.mjs.sha256"
cp "$out/BUILD-INFO.txt" "$SOURCE_COPY_DIR/BUILD-INFO.txt"
echo "build.sh: installed. Commit the module, the tarball, the licenses and $RECORDED_HASH."
