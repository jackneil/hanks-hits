import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const srv = spawn(process.execPath, ['server.mjs'], { cwd: new URL('.', import.meta.url).pathname, env: { ...process.env, PORT: '47812' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage();
await p.goto('http://localhost:47812/nonexistent'); // 404 page on our origin, secure context
const r = await p.evaluate(async () => {
  const out = [];
  const enc = new AudioEncoder({ output: (c, m) => { if (out.length < 4) out.push({ ts: c.timestamp, dur: c.duration, bytes: c.byteLength, desc: !!(m && m.decoderConfig) }); }, error: e => out.push(String(e)) });
  enc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
  for (let f = 0; f < 48000; f += 1024) { const d = new Float32Array(2048); const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: 1024, numberOfChannels: 2, timestamp: Math.round(f * 1e6 / 48000), data: d }); enc.encode(ad); ad.close(); }
  await enc.flush();
  return out;
});
console.log(JSON.stringify(r));
await b.close(); srv.kill();
