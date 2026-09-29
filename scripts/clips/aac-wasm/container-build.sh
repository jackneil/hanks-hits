#!/usr/bin/env bash
# Builds the AAC encoder module inside the pinned Emscripten image.
#
# Do not run this script on the host. build.sh starts it in Docker with:
#   /in/ffmpeg.tar.xz  the pinned FFmpeg source tarball (read-only)
#   /in/scripts        this directory (read-only)
#   /out               the output directory (written)
# The container has no network, so the build can use only these inputs.
#
# Output in /out:
#   ffmpeg-aac-enc.mjs     the ES module (JavaScript glue with the WASM inside)
#   licenses/              license texts copied from the pinned inputs
#   BUILD-INFO.txt         the versions, the commands, the input hashes and
#                          the output hash
set -euo pipefail
export LC_ALL=C
export TZ=UTC

# shellcheck source=pins.sh
source /in/scripts/pins.sh

# The files in /in/scripts that can change the output. BUILD-INFO.txt records
# the SHA-256 of each one, so only a real rebuild can agree with an edited
# file. When this script starts to read a new file from /in/scripts, add the
# file here. The artifact test fails when a read file is not in this list.
INPUT_FILES=(pins.sh configure-flags.txt emcc-flags.txt bridge.c notice.js container-build.sh)

fail() {
  echo "container-build: $*" >&2
  exit 1
}

# Reads a flags file: one argument per line. Empty lines and "#" lines are skipped.
read_flags() {
  local file=$1 line
  FLAGS=()
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "" | "#"*) continue ;;
    esac
    FLAGS+=("$line")
  done <"$file"
}

# 1. Check the toolchain and the source before anything runs.
emcc_version=$(emcc --version)
emcc_version=${emcc_version%%$'\n'*}
case "$emcc_version" in
  *" $EMSDK_VERSION "*) ;;
  *) fail "the image has '$emcc_version', but pins.sh says Emscripten $EMSDK_VERSION" ;;
esac
actual_sha=$(sha256sum /in/ffmpeg.tar.xz | cut -d ' ' -f 1)
[ "$actual_sha" = "$FFMPEG_SHA256" ] || fail "the FFmpeg tarball has SHA-256 $actual_sha, not $FFMPEG_SHA256"

read_flags /in/scripts/configure-flags.txt
CONFIGURE_FLAGS=("${FLAGS[@]}")
read_flags /in/scripts/emcc-flags.txt
EMCC_FLAGS=("${FLAGS[@]}")

# The shipped module must stay LGPL-2.1-or-later. Refuse the flags that change the license.
for flag in "${CONFIGURE_FLAGS[@]}"; do
  case "$flag" in
    --enable-gpl | --enable-nonfree | --enable-version3)
      fail "configure-flags.txt has $flag. The module must stay LGPL-2.1-or-later."
      ;;
  esac
done

# 2. Unpack the source at a fixed path. The same path gives the same output.
work=/work
src="$work/ffmpeg-$FFMPEG_VERSION"
rm -rf "$work"
mkdir -p "$work"
tar -xJf /in/ffmpeg.tar.xz -C "$work"
[ -f "$src/configure" ] || fail "the tarball has no ffmpeg-$FFMPEG_VERSION/configure"
[ "$(cat "$src/VERSION")" = "$FFMPEG_VERSION" ] || fail "the tarball VERSION file is not $FFMPEG_VERSION"

# 3. Configure and build libavcodec and libavutil.
cd "$src"
emconfigure ./configure "${CONFIGURE_FLAGS[@]}" >"$work/configure.log" 2>&1 ||
  { tail -n 40 "$work/configure.log" >&2; fail "configure failed"; }
grep -qx "License: LGPL version 2.1 or later" "$work/configure.log" ||
  fail "configure did not report 'License: LGPL version 2.1 or later'"
for pair in "CONFIG_GPL 0" "CONFIG_NONFREE 0" "CONFIG_VERSION3 0" "CONFIG_AAC_ENCODER 1"; do
  grep -q "^#define $pair\$" config.h config_components.h 2>/dev/null ||
    fail "config.h does not define $pair"
done
# BUILD-INFO.txt records this command as text. Keep the two the same.
emmake make -j"$(nproc)" >"$work/make.log" 2>&1 ||
  { tail -n 40 "$work/make.log" >&2; fail "make failed"; }

# 4. Link the bridge with the two static libraries. The link runs in the
# source directory with bridge.c and notice.js copied into it, so the link
# command in BUILD-INFO.txt is the command that ran. notice.js is the license
# notice at the top of the module (--extern-pre-js in emcc-flags.txt).
cp /in/scripts/bridge.c /in/scripts/notice.js "$src/"
emcc bridge.c libavcodec/libavcodec.a libavutil/libavutil.a -I. "${EMCC_FLAGS[@]}" -o ffmpeg-aac-enc.mjs
mkdir -p "$work/out"
mv ffmpeg-aac-enc.mjs "$work/out/ffmpeg-aac-enc.mjs"
cmp -s -n "$(stat -c %s /in/scripts/notice.js)" /in/scripts/notice.js "$work/out/ffmpeg-aac-enc.mjs" ||
  fail "the module does not start with the license notice in notice.js"

# 5. Copy the license texts from the pinned inputs.
mkdir -p "$work/out/licenses"
cp "$src/COPYING.LGPLv2.1" "$work/out/licenses/LGPL-2.1.txt"
cp /emsdk/upstream/emscripten/LICENSE "$work/out/licenses/Emscripten-LICENSE.txt"
cp /emsdk/upstream/emscripten/system/lib/libc/musl/COPYRIGHT "$work/out/licenses/musl-COPYRIGHT.txt"

# 6. Record how the module was made. No dates: two builds must give the same file.
output_sha=$(sha256sum "$work/out/ffmpeg-aac-enc.mjs" | cut -d ' ' -f 1)
{
  echo "AAC encoder module: ffmpeg-aac-enc.mjs"
  echo "SHA-256: $output_sha"
  echo
  echo "FFmpeg $FFMPEG_VERSION (libavcodec and libavutil, LGPL-2.1-or-later)"
  echo "Source: ffmpeg-$FFMPEG_VERSION.tar.xz"
  echo "Source SHA-256: $FFMPEG_SHA256"
  echo "Upstream: $FFMPEG_URL"
  echo
  echo "Toolchain: $emcc_version"
  echo "Image: $EMSDK_IMAGE"
  echo
  echo "Inputs (SHA-256 of the build files in /licenses/aac-wasm/):"
  (cd /in/scripts && sha256sum "${INPUT_FILES[@]}")
  echo
  echo "Configure command (in the source directory):"
  printf 'emconfigure ./configure'
  printf " '%s'" "${CONFIGURE_FLAGS[@]}"
  echo
  echo
  echo "Build command (in the source directory):"
  # shellcheck disable=SC2016 # The text of the command, not its result.
  echo 'emmake make -j"$(nproc)"'
  echo "The -j option sets only the number of parallel jobs. It does not change the output."
  echo
  echo "Link command (in the source directory, with bridge.c and notice.js copied into it):"
  printf "emcc bridge.c libavcodec/libavcodec.a libavutil/libavutil.a -I."
  printf " '%s'" "${EMCC_FLAGS[@]}"
  echo " -o ffmpeg-aac-enc.mjs"
  echo
  echo "Configure result:"
  grep -x "License: LGPL version 2.1 or later" "$work/configure.log"
} >"$work/out/BUILD-INFO.txt"

# 7. Give the output to the host user. build.sh mounts a new, empty directory.
[ -z "$(ls -A /out)" ] || fail "/out is not empty"
cp -R "$work/out/." /out/
if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
  chown -R "$HOST_UID:$HOST_GID" /out
fi
echo "container-build: ffmpeg-aac-enc.mjs $output_sha"
