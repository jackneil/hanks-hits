# AAC encoder for clips (FFmpeg as WebAssembly)

This directory builds the AAC-LC audio encoder that the clip maker uses on
browsers that cannot encode AAC themselves (plan tier W+: Firefox, Chrome on
Linux and ChromeOS, and Safari before version 26).

The encoder is the FFmpeg AAC encoder (`aacenc` in libavcodec). FFmpeg is
licensed under the LGPL-2.1-or-later. The module links FFmpeg statically, so
the site must give the complete source that made it. This build makes that
true: it uses one pinned FFmpeg release tarball, and the site serves the same
tarball at `/licenses/ffmpeg-<version>.tar.xz`.

## Files

| File | What it is |
|---|---|
| `pins.sh` | The pinned inputs: FFmpeg version, tarball SHA-256, Emscripten image with digest. |
| `configure-flags.txt` | The FFmpeg configure arguments, one per line. |
| `emcc-flags.txt` | The link arguments of the module, one per line. |
| `bridge.c` | The C functions that JavaScript calls (MPL-2.0, from Mediabunny 1.60.0, changed). |
| `container-build.sh` | The build steps. They run inside the Docker image only. |
| `build.sh` | Starts the build in Docker and installs the output. |
| `verify.sh` | Builds two times from clean and compares the hashes. |
| `ffmpeg-aac-enc.mjs.sha256` | The recorded SHA-256 of the committed module. |

## Output

- `apps/web/public/clips/aac/ffmpeg-aac-enc.mjs`: one ES module. The WASM is
  inside the file (`SINGLE_FILE`), so the browser does not fetch a second file.
- `apps/web/public/licenses/`: the license texts from the pinned inputs, and a
  copy of this directory (`aac-wasm/`) with `BUILD-INFO.txt`.

`NOTICE.txt` in `apps/web/public/licenses/` is written by hand. A test compares
it with the pins and the flags.

## Rebuild the module

Docker must run on the computer. The container has no network access, so the
build uses only the pinned inputs.

1. Run `scripts/clips/aac-wasm/build.sh` from the repo root.
2. Run `scripts/clips/aac-wasm/verify.sh` to prove that the build repeats.
3. Commit the module, the recorded hash, the license files and the copy in
   `apps/web/public/licenses/aac-wasm/`.

The test `aacWasmArtifact.node.test.ts` fails when the module, the recorded
hash, the tarball or the source copy do not agree. Thus an edit that is not
rebuilt cannot pass the test gate.

## Change the FFmpeg version

1. Download the new release tarball and its `.asc` signature from
   <https://ffmpeg.org/releases/>.
2. Check the signature with the FFmpeg release signing key
   (`FCF986EA15E6E293A5644F10B4322F04D67658D8`).
3. Put the new version, SHA-256 and URL in `pins.sh`.
4. Delete the old tarball from `apps/web/public/licenses/`.
5. Run `build.sh`. It downloads the tarball, checks the SHA-256, and builds.
6. Update the version, the hashes and the commands in `NOTICE.txt` and in
   `apps/web/src/apps/licenses/lib/components.ts`.
7. Run `verify.sh` and the tests.

## Rules

- Never add `--enable-gpl`, `--enable-nonfree` or `--enable-version3`. The
  module must stay LGPL-2.1-or-later. The build script refuses these flags,
  and it stops when configure does not report "LGPL version 2.1 or later".
- Do not patch the FFmpeg source. If a patch becomes necessary, the site must
  serve the patch with the tarball.
- Keep the byte rules in the repo `.gitattributes`. Git must not change the
  line endings of the module, the license files or these scripts, because
  the tests compare their SHA-256.
- When a function in `bridge.c` changes, increase `AAC_BRIDGE_ABI` in
  `bridge.c` and `AAC_WASM_BRIDGE_ABI` in
  `apps/web/src/shared/clips/engine/encode/audio/aacBackends.ts`.
