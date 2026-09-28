// Prototype of the hosted-clip visual prescreen: decode keyframes only (ffmpeg -skip_frame nokey),
// letterbox to 640x640, run YuNet (OpenCV Zoo, 232 KB ONNX) and report the best real-face score.
// Measures wall time and CPU so the cost model uses real numbers.
import { spawn } from 'node:child_process';
import ort from 'onnxruntime-node';

const S = 640;
const session = await ort.InferenceSession.create(new URL('./models/yunet.onnx', import.meta.url).pathname, { intraOpNumThreads: 1 });

function keyframes(src, maxFrames = 12) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-skip_frame', 'nokey', '-i', src, '-an', '-vsync', 'vfr',
      '-vf', `scale=w=${S}:h=${S}:force_original_aspect_ratio=decrease,pad=${S}:${S}:(ow-iw)/2:(oh-ih)/2`,
      '-frames:v', String(maxFrames), '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1'];
    const p = spawn('ffmpeg', args);
    const chunks = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg ${code}: ${err.slice(0, 200)}`));
      const buf = Buffer.concat(chunks); const fsz = S * S * 3; const frames = [];
      for (let o = 0; o + fsz <= buf.length; o += fsz) frames.push(buf.subarray(o, o + fsz));
      resolve(frames);
    });
  });
}

async function bestFace(bgr) {
  const plane = S * S; const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) { data[i] = bgr[i * 3]; data[plane + i] = bgr[i * 3 + 1]; data[2 * plane + i] = bgr[i * 3 + 2]; }
  const out = await session.run({ input: new ort.Tensor('float32', data, [1, 3, S, S]) });
  let best = 0, box = null;
  for (const s of [8, 16, 32]) {
    const cls = out[`cls_${s}`].data, obj = out[`obj_${s}`].data, bb = out[`bbox_${s}`].data;
    const cols = S / s;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score > best) {
        const r = Math.floor(i / cols), c = i % cols;
        const cx = (c + bb[i * 4]) * s, cy = (r + bb[i * 4 + 1]) * s, w = Math.exp(bb[i * 4 + 2]) * s, h = Math.exp(bb[i * 4 + 3]) * s;
        best = score; box = { cx: Math.round(cx), cy: Math.round(cy), w: Math.round(w), h: Math.round(h) };
      }
    }
  }
  return { best: +best.toFixed(3), box };
}

for (const src of process.argv.slice(2)) {
  const t0 = performance.now(); const c0 = process.cpuUsage();
  const frames = await keyframes(src);
  const t1 = performance.now();
  const scores = [];
  for (const f of frames) scores.push(await bestFace(f));
  const t2 = performance.now(); const cpu = process.cpuUsage(c0);
  const max = scores.reduce((m, x) => (x.best > m.best ? x : m), { best: 0 });
  console.log(JSON.stringify({ src: src.split('/').pop(), frames: frames.length, decodeMs: Math.round(t1 - t0), inferMs: Math.round(t2 - t1), perFrameMs: +((t2 - t1) / Math.max(1, frames.length)).toFixed(1), nodeCpuMs: Math.round((cpu.user + cpu.system) / 1000), maxFace: max.best, box: max.box, scores: scores.map((x) => x.best) }));
}
