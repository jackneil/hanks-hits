// Prototype main thread: compositor frames -> VideoFrame -> transfer to worker.
const W = 1280, H = 720;
const results = { ua: navigator.userAgent, when: new Date().toISOString(), logs: [] };
const el = document.getElementById('out');
const show = (s) => { el.textContent += s + '\n'; };
const tag = new URLSearchParams(location.search).get('tag') || 'run';
const SECS = Number(new URLSearchParams(location.search).get('secs') || 30);

async function upload(name, data) {
  await fetch('/upload?name=' + encodeURIComponent(name), { method: 'POST', body: data });
}

function drawFrame(ctx, i) {
  const t = i / 30;
  const flash = i % 30 === 0; // sync flash on each whole second
  ctx.fillStyle = flash ? '#ffffff' : '#123040';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f5a623';
  const x = (Math.sin(t * 1.3) * 0.5 + 0.5) * (W - 200);
  const y = (Math.cos(t * 0.9) * 0.5 + 0.5) * (H - 200);
  ctx.fillRect(x, y, 200, 200);
  ctx.fillStyle = flash ? '#000' : '#fff';
  ctx.font = 'bold 72px sans-serif';
  ctx.fillText('frame ' + i + '  t=' + t.toFixed(2), 40, 100);
}

function drawTitle(ctx, k) {
  ctx.fillStyle = '#0b3d2e';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffe066';
  ctx.font = 'bold 96px sans-serif';
  ctx.fillText("Hank's Hits", 80, 300);
  ctx.font = 'bold 56px sans-serif';
  ctx.fillText('TurboRacer42  score 12,345  #' + k, 80, 420);
}

async function main() {
  const caps = {
    VideoEncoder: typeof VideoEncoder, AudioEncoder: typeof AudioEncoder, AudioDecoder: typeof AudioDecoder,
    VideoFrame: typeof VideoFrame, OffscreenCanvas: typeof OffscreenCanvas,
    SharedArrayBuffer: typeof SharedArrayBuffer, crossOriginIsolated: self.crossOriginIsolated,
    MediaRecorder: typeof MediaRecorder,
  };
  if (typeof MediaRecorder !== 'undefined') {
    caps.mr = {};
    for (const t of ['video/mp4', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/mp4;codecs=avc1', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2']) caps.mr[t] = MediaRecorder.isTypeSupported(t);
  }
  if (typeof AudioEncoder !== 'undefined') {
    caps.audioEnc = {};
    for (const codec of ['mp4a.40.2', 'opus']) for (const sampleRate of [44100, 48000]) for (const ch of [1, 2]) {
      try { caps.audioEnc[`${codec}/${sampleRate}/${ch}`] = (await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: ch, bitrate: 128000 })).supported; } catch (e) { caps.audioEnc[`${codec}/${sampleRate}/${ch}`] = 'throw:' + e; }
    }
  }
  results.caps = caps;
  show(JSON.stringify(caps));

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false });
  const worker = new Worker(new URLSearchParams(location.search).get('poly') ? 'worker-poly.js' : 'worker.js');
  let resolveInit, resolveAck, resolveClip, resolveTitle, resolveClipPcm;
  const inflight = { n: 0 };
  const files = {};
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'log') { results.logs.push(m.msg); show('worker: ' + m.msg); }
    else if (m.type === 'error') { results.logs.push('ERROR ' + m.msg); show('ERROR ' + m.msg); }
    else if (m.type === 'inited') resolveInit(m);
    else if (m.type === 'ack') { inflight.n--; if (resolveAck && inflight.n <= 0) { const r = resolveAck; resolveAck = null; r(); } }
    else if (m.type === 'clip') resolveClip(m);
    else if (m.type === 'clippcm') resolveClipPcm(m);
    else if (m.type === 'titleinfo') resolveTitle(m);
    else if (m.type === 'file') { files[m.name] = m.buffer; if (m.ms) results[m.name + '_ms'] = m.ms; }
  };
  const inited = await new Promise(r => { resolveInit = r; worker.postMessage({ type: 'init', width: W, height: H }); });
  results.init = inited;
  show('init ' + JSON.stringify(inited));

  // transfer test + frame pump
  let transferOk = true;
  const tPump = performance.now();
  let createMs = 0;
  const N = 36 * 30;
  for (let i = 0; i < N; i++) {
    drawFrame(ctx, i);
    const c0 = performance.now();
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / 30), duration: 33333, alpha: 'discard' });
    createMs += performance.now() - c0;
    try {
      worker.postMessage({ type: 'frame', frame }, [frame]);
      inflight.n++;
    } catch (err) {
      transferOk = false; frame.close(); results.transferError = String(err); break;
    }
    if (inflight.n > 0) await new Promise(r => { resolveAck = r; });
  }
  results.transferOk = transferOk;
  results.pumpMs = performance.now() - tPump;
  results.avgVideoFrameCreateMs = createMs / N;
  show('pumped ' + N + ' frames in ' + results.pumpMs.toFixed(0) + 'ms');

  const clip = await new Promise(r => { resolveClip = r; worker.postMessage({ type: 'clip', seconds: SECS, name: tag + '-clip30.mp4' }); });
  results.clip = clip;
  show('clip ' + JSON.stringify(clip));

  const cp = await new Promise(r => { resolveClipPcm = r; worker.postMessage({ type: 'clippcm', seconds: SECS, name: tag + '-clippcm.mp4' }); });
  results.clipPcm = cp;
  show('clippcm ' + JSON.stringify(cp));

  const titleFrames = [];
  for (let k = 0; k < 45; k++) { drawTitle(ctx, k); titleFrames.push(new VideoFrame(canvas, { timestamp: Math.round(k * 1e6 / 30), duration: 33333, alpha: 'discard' })); }
  const ti = await new Promise(r => { resolveTitle = r; worker.postMessage({ type: 'title', frames: titleFrames, seconds: 30, name: tag + '-title-clip.mp4' }, titleFrames); });
  results.title = ti;
  show('title ' + JSON.stringify(ti));
  await new Promise(r => setTimeout(r, 500));

  for (const [name, buf] of Object.entries(files)) await upload(name, buf);
  await upload(tag + '-results.json', JSON.stringify(results, null, 1));
  show('DONE');
  document.title = 'DONE';
}
main().catch(async (e) => { show('FATAL ' + e.stack); results.fatal = String(e.stack || e); await upload(tag + '-results.json', JSON.stringify(results, null, 1)); document.title = 'FATAL'; });
