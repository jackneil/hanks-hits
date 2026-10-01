const tag = new URLSearchParams(location.search).get('tag') || 'mr';
const o = document.getElementById('o'); const show = s => o.textContent += s + '\n';
const c = document.getElementById('c'); const ctx = c.getContext('2d');
let i = 0, running = true;
function draw() { const t = performance.now() / 1000; ctx.fillStyle = '#123'; ctx.fillRect(0, 0, 960, 540); ctx.fillStyle = '#fa3'; ctx.fillRect((Math.sin(t) * .5 + .5) * 760, (Math.cos(t * .7) * .5 + .5) * 340, 200, 200); ctx.fillStyle = '#fff'; ctx.font = '48px sans-serif'; ctx.fillText('f ' + (i++), 20, 60); if (running) requestAnimationFrame(draw); }
requestAnimationFrame(draw);
async function run(label, opts, ms) {
  const ac = new AudioContext(); const osc = ac.createOscillator(); const g = ac.createGain(); g.gain.value = 0.2; const dst = ac.createMediaStreamDestination(); osc.connect(g).connect(dst); osc.start();
  const stream = c.captureStream(30); stream.addTrack(dst.stream.getAudioTracks()[0]);
  const chunks = []; const times = [];
  let rec;
  try { rec = new MediaRecorder(stream, opts); } catch (e) { return { label, error: String(e) }; }
  rec.ondataavailable = e => { if (e.data.size) { chunks.push(e.data); times.push([performance.now(), e.data.size]); } };
  const t0 = performance.now();
  rec.start(1000);
  await new Promise(r => setTimeout(r, ms));
  await new Promise(r => { rec.onstop = r; rec.stop(); });
  osc.stop(); ac.close();
  const blob = new Blob(chunks, { type: rec.mimeType });
  await fetch('/upload?name=' + tag + '-' + label + '.' + (rec.mimeType.includes('mp4') ? 'mp4' : 'webm'), { method: 'POST', body: blob });
  // also upload chunk #3 alone to test independent decodability of a mid-stream chunk
  return { label, mime: rec.mimeType, chunks: chunks.length, sizes: times.map(x => x[1]), bytes: blob.size, videoBitsPerSecond: rec.videoBitsPerSecond, audioBitsPerSecond: rec.audioBitsPerSecond };
}
(async () => {
  const res = { ua: navigator.userAgent, runs: [] };
  const mp4 = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2') ? 'video/mp4;codecs=avc1,mp4a.40.2' : 'video/mp4';
  res.runs.push(await run('default', { mimeType: mp4, videoBitsPerSecond: 2_500_000 }, 12000));
  res.runs.push(await run('kf1s', { mimeType: mp4, videoBitsPerSecond: 2_500_000, videoKeyFrameIntervalDuration: 1000 }, 12000));
  running = false;
  await fetch('/upload?name=' + tag + '-results.json', { method: 'POST', body: JSON.stringify(res, null, 1) });
  show(JSON.stringify(res)); show('DONE'); document.title = 'DONE';
})().catch(async e => { await fetch('/upload?name=' + tag + '-results.json', { method: 'POST', body: String(e.stack || e) }); document.title = 'FATAL'; });
