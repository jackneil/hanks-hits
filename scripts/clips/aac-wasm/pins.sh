# Pinned inputs of the AAC WASM build. build.sh reads this file.
# Keep one KEY=VALUE per line with no quotes: a test reads this file too.
#
# FFmpeg: the newest 8.x point release on 2026-09-28 (8.1.3, released
# 2026-09-21, the newest release by date). The 9.0 major line (9.0.2,
# 2026-09-18) also exists; this build stays on the 8.x stable series.
# The release is signed by the FFmpeg release signing key
# FCF986EA15E6E293A5644F10B4322F04D67658D8 (https://ffmpeg.org/ffmpeg-devel.asc).
# The signature was checked when this pin was made. build.sh checks the SHA-256.
FFMPEG_VERSION=8.1.3
FFMPEG_SHA256=7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3
FFMPEG_URL=https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz
FFMPEG_SIGNER_FINGERPRINT=FCF986EA15E6E293A5644F10B4322F04D67658D8
#
# Emscripten toolchain image. The digest is the multi-platform index, so
# Docker picks the linux/amd64 or linux/arm64 image of the same release.
# verify.sh proves that both give the same output.
EMSDK_VERSION=6.0.10
EMSDK_IMAGE=emscripten/emsdk:6.0.10@sha256:e077d54e2b8970575ebc4f185ac1de0b95c05f2b266134d4ba27449af7aebf65
