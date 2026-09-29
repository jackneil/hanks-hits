/*!
 * ffmpeg-aac-enc.mjs: the AAC audio encoder of the Hank's Hits clip maker.
 *
 * This file contains software from other authors. Each part has its own
 * license:
 *
 * - FFmpeg 8.1.3 (libavcodec and libavutil), linked statically.
 *   License: GNU Lesser General Public License, version 2.1 or later
 *   (LGPL-2.1-or-later).
 *   Copyright (c) 2000-2026 the FFmpeg developers.
 *   Source code: the unchanged FFmpeg 8.1.3 release tarball,
 *   https://ffmpeg.org/releases/ffmpeg-8.1.3.tar.xz
 *   (SHA-256 7138d28c96d9d3e3af4ee3d8cad72741f8ffb40da90c1112235dea3ecd3178a3).
 *
 * - bridge.c, from Mediabunny 1.60.0, changed by Hank's Hits.
 *   License: Mozilla Public License 2.0 (MPL-2.0).
 *   Copyright (c) 2026-present, Vanilagy and contributors.
 *
 * - The Emscripten 6.0.10 runtime and parts of the musl C library.
 *   License: MIT License.
 *
 * The site that serves this file also serves the license texts, the FFmpeg
 * source code and the build files at /licenses/. Start with
 * /licenses/NOTICE.txt.
 */
