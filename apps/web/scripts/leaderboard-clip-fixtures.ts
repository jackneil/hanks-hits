/**
 * Makes the MP4 fixtures of the leaderboard clip upload check
 * (src/lib/leaderboard-clips/__tests__/fixtures/).
 *
 * Every "good" fixture goes through the clip engine's own muxer path:
 * muxClip (mediabunny, fast start, no metadata tags) and then
 * addAacRollGroups (the moov patch). So the check is tested on the bytes
 * that a phone really uploads, not on a hand-made file.
 *
 * - real-1280x720.mp4: 2 s of a real iPhone SE clip (Asteroids, h264
 *   1280x720 30 fps, AAC 48 kHz stereo), cut at a keyframe and muxed again
 *   with the engine muxer. The packets are the phone's own bytes.
 * - engine-<w>x<h>.mp4: the other sizes that the engine makes (portrait
 *   720x1280, software 960x544 and 544x960), and a clip with no audio.
 *   ffmpeg (libx264, AAC) makes the packets; the engine muxer makes the file.
 * - engine-1920x1080.mp4 and engine-62s.mp4: engine files that the check
 *   must reject (a size the engine never makes; too long).
 * - ffmpeg-*.mp4: ffmpeg's own output (-c copy of an engine file), which
 *   the check must reject: the default (an encoder tag in udta), fragmented,
 *   and moov at the end.
 *
 * Run from apps/web (needs ffmpeg with libx264):
 *   npx tsx scripts/leaderboard-clip-fixtures.ts /path/to/real-clip.mp4
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BufferSource, EncodedPacketSink, Input, MP4 } from "mediabunny";

import type { ClipPackets, PacketDTO } from "../src/shared/clips/protocol";
import { addAacRollGroups } from "../src/shared/clips/engine/io/moovPatch";
import { muxClip } from "../src/shared/clips/engine/io/mux";

const OUT = path.join(__dirname, "../src/lib/leaderboard-clips/__tests__/fixtures");
const REAL = process.argv[2] ?? "/tmp/hh-se/clip-asteroids-end.mp4";

function ffmpeg(args: string[]): void {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

/** Demux an MP4 into ClipPackets in the encode worker's form, from the first keyframe at or after fromSec. */
async function clipPackets(source: Uint8Array, fromSec: number, seconds: number): Promise<ClipPackets> {
  const input = new Input({ formats: [MP4], source: new BufferSource(source) });
  try {
    const videoTrack = (await input.getPrimaryVideoTrack())!;
    const audioTrack = await input.getPrimaryAudioTrack();
    const videoConfig = (await videoTrack.getDecoderConfig())!;
    const baseUs = 9_000_000;
    const video: PacketDTO[] = [];
    let startSec = -1;
    for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
      if (startSec < 0) {
        if (packet.type !== "key" || packet.timestamp < fromSec - 1e-6) continue;
        startSec = packet.timestamp;
      }
      if (packet.timestamp >= startSec + seconds - 1e-6) break;
      video.push({
        kind: "video",
        type: packet.type,
        tsUs: baseUs + Math.round((packet.timestamp - startSec) * 1e6),
        durUs: Math.round(packet.duration * 1e6),
        data: packet.data.slice().buffer,
        epoch: 1,
      });
    }
    if (video.length === 0) throw new Error("no keyframe in the window");
    const audio: PacketDTO[] = [];
    let audioConfig: ClipPackets["audioConfig"] = null;
    if (audioTrack) {
      const config = (await audioTrack.getDecoderConfig())!;
      const rate = config.sampleRate;
      for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
        const t = packet.timestamp - startSec;
        if (t < -0.1 || t >= seconds) continue;
        audio.push({
          kind: "audio",
          type: "key",
          tsUs: baseUs + Math.round((Math.round(t * rate) * 1e6) / rate),
          durUs: Math.round((1024 * 1e6) / rate),
          data: packet.data.slice().buffer,
          epoch: 0,
        });
      }
      audioConfig = {
        codec: "mp4a.40.2",
        sampleRate: rate,
        numberOfChannels: config.numberOfChannels,
        description: new Uint8Array(config.description as ArrayBuffer).slice().buffer,
      };
    }
    return {
      requestId: "fixture",
      video,
      audio,
      videoEpochs: [
        {
          epoch: 1,
          codec: videoConfig.codec,
          codedWidth: videoConfig.codedWidth!,
          codedHeight: videoConfig.codedHeight!,
          description: new Uint8Array(videoConfig.description as ArrayBuffer).slice().buffer,
        },
      ],
      audioConfig,
      primingSamples: 0,
      startUs: video[0].tsUs,
      endUs: baseUs + seconds * 1e6,
      cutToNewestEpoch: false,
      coveredSec: seconds,
    };
  } finally {
    input.dispose();
  }
}

async function engineFile(source: Uint8Array, fromSec: number, seconds: number): Promise<Uint8Array> {
  const muxed = await muxClip(await clipPackets(source, fromSec, seconds));
  return muxed.hasAudio ? addAacRollGroups(muxed.bytes).bytes : muxed.bytes;
}

function write(name: string, bytes: Uint8Array): void {
  writeFileSync(path.join(OUT, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const dir = mkdtempSync(path.join(tmpdir(), "hh-lb-fixtures-"));
  try {
    // 1. The real phone clip, cut to 3 s.
    const real = new Uint8Array(readFileSync(REAL));
    write("real-1280x720.mp4", await engineFile(real, 20, 2));

    // 2. Engine files at every size the engine makes, from ffmpeg packets.
    const synth = (w: number, h: number, seconds: number, audio: boolean): string => {
      const out = path.join(dir, `src-${w}x${h}-${seconds}-${audio ? "a" : "n"}.mp4`);
      ffmpeg([
        "-f", "lavfi", "-i", `testsrc2=s=${w}x${h}:r=30:d=${seconds}`,
        ...(audio ? ["-f", "lavfi", "-i", `sine=f=440:r=48000:d=${seconds}`, "-ac", "2"] : []),
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "51", "-g", "30", "-bf", "0", "-pix_fmt", "yuv420p",
        "-profile:v", "high",
        ...(audio ? ["-c:a", "aac", "-b:a", "32k"] : []),
        "-shortest", out,
      ]);
      return out;
    };
    for (const [w, h] of [[720, 1280], [960, 544], [544, 960]] as const) {
      write(`engine-${w}x${h}.mp4`, await engineFile(new Uint8Array(readFileSync(synth(w, h, 2, true))), 0, 1.2));
    }
    write("engine-1280x720-noaudio.mp4", await engineFile(new Uint8Array(readFileSync(synth(1280, 720, 2, false))), 0, 1.2));
    write("engine-1920x1080.mp4", await engineFile(new Uint8Array(readFileSync(synth(1920, 1080, 2, true))), 0, 1.2));
    // A long run: 62 s at a tiny size per frame (black frames compress to almost nothing).
    const long = path.join(dir, "long.mp4");
    ffmpeg([
      "-f", "lavfi", "-i", "color=c=black:s=1280x720:r=30:d=63",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "51", "-g", "300", "-bf", "0", "-pix_fmt", "yuv420p", long,
    ]);
    write("engine-62s.mp4", await engineFile(new Uint8Array(readFileSync(long)), 0, 62));

    // 3. ffmpeg's own files from engine packets (-c copy), which the check rejects.
    const realCut = path.join(dir, "engine-cut.mp4");
    writeFileSync(realCut, await engineFile(new Uint8Array(readFileSync(synth(544, 960, 2, true))), 0, 1.2));
    const ffDefault = path.join(dir, "ffmpeg-default.mp4");
    ffmpeg(["-i", realCut, "-c", "copy", "-movflags", "+faststart", ffDefault]);
    write("ffmpeg-faststart-udta.mp4", new Uint8Array(readFileSync(ffDefault)));
    const ffFrag = path.join(dir, "ffmpeg-frag.mp4");
    ffmpeg(["-i", realCut, "-c", "copy", "-map_metadata", "-1", "-fflags", "+bitexact", "-movflags", "frag_keyframe+empty_moov", ffFrag]);
    write("ffmpeg-fragmented.mp4", new Uint8Array(readFileSync(ffFrag)));
    const ffEnd = path.join(dir, "ffmpeg-moov-at-end.mp4");
    ffmpeg(["-i", realCut, "-c", "copy", "-map_metadata", "-1", "-fflags", "+bitexact", ffEnd]);
    write("ffmpeg-moov-at-end.mp4", new Uint8Array(readFileSync(ffEnd)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
