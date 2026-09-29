/**
 * Synthetic lab-pattern files with known A/V offsets, made with ffmpeg
 * (plan 15.1 "Node" tier: synthetic-timestamp files).
 *
 * The picture: a dark frame with a band at the top (as the clip compositor
 * paints it). Once each second, at 0.5 s, 1.5 s, ..., the game area under
 * the band flashes white for one frame. The sound: a 1 kHz beep of 60 ms
 * that starts `offsetMs` after each flash (a negative offset starts it
 * before the flash). Every beep and every flash has quiet before it, so the
 * start of the file is measured like the rest.
 *
 * `dropFrames` removes a run of frames and keeps the time stamps of the
 * others, so the file has a real gap in its video track.
 *
 * `rateStep` keeps one frame in `every` from frame `from` on, with the time
 * stamps of the frames it keeps: the frame rate steps down in the file, as it
 * does when the governor steps the capture rung down (plan 7). Flash frames
 * sit at n = fps * k + fps / 2, so keep them with an `every` that divides
 * fps / 2.
 */
import { spawnSync } from "node:child_process";

/** True when this ffmpeg has the encoders the fixtures use. */
export function fixtureToolsReason(ffmpeg = "ffmpeg") {
  const version = spawnSync(ffmpeg, ["-hide_banner", "-version"], { encoding: "utf8" });
  if (version.error || version.status !== 0) return "ffmpeg not found";
  const probe = spawnSync("ffprobe", ["-hide_banner", "-version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return "ffprobe not found";
  const encoders = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
  if (!/\blibx264\b/.test(encoders)) return "ffmpeg has no libx264";
  if (!/\baac\b/.test(encoders)) return "ffmpeg has no aac encoder";
  return "";
}

/**
 * Makes one fixture file.
 *
 * @param {string} out the .mp4 path
 * @param {{ offsetMs?: number, seconds?: number, fps?: number, dropFrames?: [number, number] | null, rateStep?: { from: number, every: number } | null, ffmpeg?: string }} [options]
 */
export function makeLabFixture(out, options = {}) {
  const offset = (options.offsetMs ?? 0) / 1000;
  const seconds = options.seconds ?? 4;
  const fps = options.fps ?? 30;
  const half = Math.round(fps / 2);
  const band = 40;
  const video = [
    `color=c=0x14202b:s=320x240:r=${fps}:d=${seconds}`,
    `drawbox=x=0:y=0:w=iw:h=${band}:color=0x2a3f55:t=fill`,
    `drawbox=x=0:y=${band}:w=iw:h=ih-${band}:color=white:t=fill:enable='eq(mod(n\\,${fps})\\,${half})'`,
  ];
  // One select: a second select would number its frames again from 0.
  const keep = [];
  if (options.dropFrames) {
    const [from, to] = options.dropFrames;
    keep.push(`not(between(n\\,${from}\\,${to}))`);
  }
  if (options.rateStep) {
    const { from, every } = options.rateStep;
    keep.push(`(lt(n\\,${from})+not(mod(n\\,${every})))`);
  }
  if (keep.length) video.push(`select='${keep.join("*")}'`);
  video.push("format=yuv420p");
  const u = `(t-(${offset.toFixed(4)}))`;
  const tone = `0.5*sin(2*PI*1000*${u})*gte(mod(${u}\\,1)\\,0.5)*lt(mod(${u}\\,1)\\,0.56)*gte(${u}\\,0)`;
  const made = spawnSync(
    options.ffmpeg ?? "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", video.join(","),
      "-f", "lavfi", "-i", `aevalsrc=exprs='${tone}|${tone}':s=48000:d=${seconds}`,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "veryfast", "-g", String(fps), "-bf", "0", "-fps_mode", "passthrough",
      "-c:a", "aac", "-b:a", "128k",
      out,
    ],
    { encoding: "utf8" },
  );
  if (made.error || made.status !== 0) throw new Error(`ffmpeg could not make ${out}: ${made.stderr || made.error}`);
  return out;
}
