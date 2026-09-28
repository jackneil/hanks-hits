// Hank's Hits clips capability + function probe (scratch prototype).
// Every step is isolated: a throw or a hang in one step never hides the others.
const qs = new URLSearchParams(location.search);
const label = qs.get('label') || 'manual';
const quick = qs.get('quick') === '1';
const R = { label, startedAt: new Date().toISOString(), timings: {} };
const $o = document.getElementById('o');
const $s = document.getElementById('s');
const render = () => { $o.textContent = JSON.stringify(R, null, 1); };
const timeout = (p, ms, name) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + name + ' ' + ms + 'ms')), ms))]);
async function step(name, fn, ms = 30000) {
  $s.textContent = 'running ' + name + '...';
  const t0 = performance.now();
  try { R[name] = await timeout(fn(), ms, name); } catch (e) { R[name] = { error: String((e && e.message) || e) }; }
  R.timings[name] = Math.round(performance.now() - t0);
  render();
}
const post = (path, body) => fetch(path + '?label=' + encodeURIComponent(label) + (path === '/clip' ? '&name=' + encodeURIComponent(body.name) : ''), { method: 'POST', body: body.data || body });

// ---------------------------------------------------------------- meta
await step('meta', async () => {
  let gpu = null;
  try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); const ext = gl && gl.getExtension('WEBGL_debug_renderer_info'); gpu = gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null; } catch (e) { gpu = 'err ' + e; }
  let brands = null; try { brands = navigator.userAgentData ? (await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'model', 'fullVersionList', 'mobile'])) : null; } catch (e) { brands = 'err'; }
  return {
    ua: navigator.userAgent, uaData: brands, isSecureContext, crossOriginIsolated: self.crossOriginIsolated,
    dpr: devicePixelRatio, screen: [screen.width, screen.height], viewport: [innerWidth, innerHeight],
    hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory ?? null, gpu,
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    maxTouchPoints: navigator.maxTouchPoints,
  };
});

// ---------------------------------------------------------------- typeof
await step('apis', async () => {
  const t = (x) => { try { return typeof x(); } catch { return 'undefined'; } };
  return {
    VideoEncoder: t(() => VideoEncoder), VideoDecoder: t(() => VideoDecoder), AudioEncoder: t(() => AudioEncoder), AudioDecoder: t(() => AudioDecoder),
    VideoFrame: t(() => VideoFrame), AudioData: t(() => AudioData), EncodedVideoChunk: t(() => EncodedVideoChunk), ImageDecoder: t(() => ImageDecoder),
    MediaRecorder: t(() => MediaRecorder), OffscreenCanvas: t(() => OffscreenCanvas), AudioWorkletNode: t(() => AudioWorkletNode),
    MediaStreamTrackProcessor: t(() => MediaStreamTrackProcessor), VideoTrackGenerator: t(() => VideoTrackGenerator),
    canvasCaptureStream: typeof HTMLCanvasElement.prototype.captureStream, requestVideoFrameCallback: typeof HTMLVideoElement.prototype.requestVideoFrameCallback,
    createMediaStreamDestination: typeof (window.AudioContext && AudioContext.prototype.createMediaStreamDestination),
    share: typeof navigator.share, canShare: typeof navigator.canShare, storageGetDirectory: typeof (navigator.storage && navigator.storage.getDirectory),
    storagePersist: typeof (navigator.storage && navigator.storage.persist), createWritable: typeof (window.FileSystemFileHandle && FileSystemFileHandle.prototype.createWritable),
    showSaveFilePicker: typeof window.showSaveFilePicker, SharedArrayBuffer: typeof window.SharedArrayBuffer, wakeLock: typeof (navigator.wakeLock && navigator.wakeLock.request),
    getDisplayMedia: typeof (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia), userActivation: typeof navigator.userActivation,
    WebAssembly: typeof WebAssembly, CompressionStream: t(() => CompressionStream),
  };
});

// ---------------------------------------------------------------- VideoEncoder config matrix
const V_CODECS = ['avc1.42001f', 'avc1.42e01f', 'avc1.4d401f', 'avc1.4d0028', 'avc1.640028', 'hvc1.1.6.L93.B0', 'vp8', 'vp09.00.31.08', 'av01.0.05M.08'];
const DIMS = quick ? [[1280, 720], [720, 1280]] : [[1280, 720], [720, 1280], [960, 540], [540, 960], [1920, 1080]];
await step('videoConfigs', async () => {
  if (typeof VideoEncoder === 'undefined') return { unsupported: true };
  const out = {};
  for (const codec of V_CODECS) for (const [w, h] of DIMS) {
    const cfg = { codec, width: w, height: h, bitrate: 3_000_000, framerate: 30, latencyMode: 'realtime' };
    if (codec.startsWith('avc1')) cfg.avc = { format: 'avc' };
    try { const r = await VideoEncoder.isConfigSupported(cfg); out[`${codec}@${w}x${h}`] = r.supported; } catch (e) { out[`${codec}@${w}x${h}`] = 'throw:' + e.name; }
  }
  for (const hw of ['prefer-hardware', 'prefer-software']) {
    for (const codec of ['avc1.42001f', 'avc1.640028']) {
      const cfg = { codec, width: 1280, height: 720, bitrate: 3_000_000, framerate: 30, latencyMode: 'realtime', hardwareAcceleration: hw, avc: { format: 'avc' } };
      try { const r = await VideoEncoder.isConfigSupported(cfg); out[`${codec}@1280x720/${hw}`] = r.supported; } catch (e) { out[`${codec}@1280x720/${hw}`] = 'throw:' + e.name; }
    }
  }
  return out;
});

// ---------------------------------------------------------------- AudioEncoder config matrix
await step('audioConfigs', async () => {
  if (typeof AudioEncoder === 'undefined') return { unsupported: true };
  const list = [['mp4a.40.2', 48000, 2, 128000], ['mp4a.40.2', 44100, 2, 128000], ['mp4a.40.2', 48000, 1, 96000], ['mp4a.40.5', 48000, 2, 64000], ['opus', 48000, 2, 128000], ['flac', 48000, 2, undefined], ['mp3', 44100, 2, 128000]];
  const out = {};
  for (const [codec, sampleRate, numberOfChannels, bitrate] of list) {
    try { const r = await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels, bitrate }); out[`${codec}@${sampleRate}/${numberOfChannels}`] = r.supported; } catch (e) { out[`${codec}@${sampleRate}/${numberOfChannels}`] = 'throw:' + e.name; }
  }
  return out;
});

// ---------------------------------------------------------------- MediaRecorder types
await step('mediaRecorderTypes', async () => {
  if (typeof MediaRecorder === 'undefined') return { unsupported: true };
  const types = ['video/mp4', 'video/mp4;codecs=avc1', 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4;codecs="avc1.640028,mp4a.40.2"', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=hvc1', 'video/webm', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=h264', 'video/webm;codecs=av1', 'video/x-matroska;codecs=avc1', 'audio/mp4', 'audio/webm;codecs=opus'];
  const out = {}; for (const t of types) out[t] = MediaRecorder.isTypeSupported(t); return out;
});

// ---------------------------------------------------------------- Web Share (canShare only; share() itself needs a real tap)
await step('share', async () => {
  if (typeof navigator.canShare !== 'function') return { canShare: 'absent', share: typeof navigator.share };
  const f = (name, type) => new File([new Uint8Array(1024)], name, { type });
  return {
    mp4: navigator.canShare({ files: [f('hanks-hits-clip.mp4', 'video/mp4')] }),
    mp4WithText: navigator.canShare({ files: [f('hanks-hits-clip.mp4', 'video/mp4')], title: 'My clip', text: 'hankshits.com' }),
    mp4WrongExt: navigator.canShare({ files: [f('clip.bin', 'video/mp4')] }),
    webm: navigator.canShare({ files: [f('clip.webm', 'video/webm')] }),
    mov: navigator.canShare({ files: [f('clip.mov', 'video/quicktime')] }),
    png: navigator.canShare({ files: [f('card.png', 'image/png')] }),
    url: navigator.canShare({ url: 'https://hankshits.com/c/abc' }),
    userActivationNow: navigator.userActivation ? navigator.userActivation.isActive : 'n/a',
  };
});

// ---------------------------------------------------------------- Storage + OPFS (main thread)
await step('storage', async () => {
  const out = {};
  try { const e = await navigator.storage.estimate(); out.quotaMB = Math.round(e.quota / 1048576); out.usageMB = +(e.usage / 1048576).toFixed(2); } catch (e) { out.estimateError = String(e); }
  try { out.persisted = await navigator.storage.persisted(); } catch (e) { out.persistedError = String(e); }
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('hh-probe-main.bin', { create: true });
    if (fh.createWritable) {
      const w = await fh.createWritable(); await w.write(new Uint8Array(1024 * 1024)); await w.close();
      const file = await fh.getFile(); out.opfsCreateWritable = file.size === 1048576;
    } else out.opfsCreateWritable = 'absent';
    await root.removeEntry('hh-probe-main.bin'); out.opfsMain = true;
  } catch (e) { out.opfsError = String(e && e.message || e); }
  return out;
});

// ---------------------------------------------------------------- helpers for encode tests
function pickAvc() { return ['avc1.640028', 'avc1.4d0028', 'avc1.42001f']; }
async function firstSupportedAvc(w, h) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of pickAvc()) {
    try { const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 3_000_000, framerate: 30, latencyMode: 'realtime', avc: { format: 'avc' } }); if (r.supported) return codec; } catch { /* next */ }
  }
  return null;
}
function drawTestFrame(g, w, h, i, fps) {
  // Mid-grey background, a moving bar, a big frame counter and a full white flash on the first frame of every second.
  const flash = i % fps === 0;
  g.fillStyle = flash ? '#fff' : '#303848'; g.fillRect(0, 0, w, h);
  if (!flash) {
    g.fillStyle = '#e8a33a'; g.fillRect(((i * 12) % (w + 80)) - 80, h * 0.7, 80, h * 0.1);
    g.fillStyle = '#fff'; g.font = `bold ${Math.round(Math.min(w, h) / 5)}px sans-serif`; g.textBaseline = 'middle'; g.fillText(String(i).padStart(3, '0'), w * 0.25, h * 0.4);
  }
}

// ---------------------------------------------------------------- VideoEncoder functional test (main thread)
async function encodeTest(w, h, frames) {
  const codec = await firstSupportedAvc(w, h);
  if (!codec) return { skipped: 'no avc config supported' };
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
  let chunks = 0, keys = 0, bytes = 0, desc = null, maxQ = 0, encErr = null, cfgOut = null, tFirst = null;
  const enc = new VideoEncoder({ output: (c, m) => { if (tFirst === null) tFirst = performance.now(); chunks++; bytes += c.byteLength; if (c.type === 'key') keys++; if (m && m.decoderConfig) { cfgOut = { codec: m.decoderConfig.codec, codedWidth: m.decoderConfig.codedWidth, codedHeight: m.decoderConfig.codedHeight }; if (m.decoderConfig.description) desc = m.decoderConfig.description.byteLength; } }, error: (e) => { encErr = String(e); } });
  enc.configure({ codec, width: w, height: h, bitrate: 3_000_000, framerate: 30, latencyMode: 'realtime', avc: { format: 'avc' } });
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    drawTestFrame(g, w, h, i, 30);
    const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / 30), duration: Math.round(1e6 / 30) });
    enc.encode(vf, { keyFrame: i % 30 === 0 }); vf.close();
    maxQ = Math.max(maxQ, enc.encodeQueueSize);
    if (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
  }
  await enc.flush(); enc.close();
  const ms = performance.now() - t0;
  return { codec, w, h, frames, chunks, keys, timeToFirstChunkMs: tFirst === null ? null : Math.round(tFirst - t0), kb: Math.round(bytes / 1024), descBytes: desc, decoderConfig: cfgOut, maxQueue: maxQ, wallMs: Math.round(ms), throughputFps: +(frames / (ms / 1000)).toFixed(1), error: encErr };
}
await step('encodeMain720', () => encodeTest(1280, 720, quick ? 60 : 150), 60000);
await step('encodeMainPortrait', () => encodeTest(720, 1280, 60), 60000);

// ---------------------------------------------------------------- VideoEncoder in a Worker + OPFS sync handle
await step('worker', async () => {
  const codec = (await firstSupportedAvc(1280, 720)) || 'avc1.42001f';
  const wk = new Worker('/worker.js');
  const res = await new Promise((resolve, reject) => { wk.onmessage = (e) => resolve(e.data); wk.onerror = (e) => reject(new Error('worker error ' + (e.message || ''))); wk.postMessage({ w: 1280, h: 720, frames: 90, codec }); });
  wk.terminate(); return res;
}, 60000);

// ---------------------------------------------------------------- AudioEncoder AAC functional test (+ WebKit 302253 detector)
function parseAsc(u8) {
  if (!u8 || u8.length < 2) return { invalid: 'short', len: u8 ? u8.length : 0 };
  const bits = (u8[0] << 8) | u8[1];
  const objectType = bits >> 11, freqIndex = (bits >> 7) & 15, channelConfig = (bits >> 3) & 15;
  return { hex: Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''), objectType, freqIndex, channelConfig, valid: objectType === 2 && freqIndex === 3 && channelConfig === 2 };
}
await step('aacEncode', async () => {
  if (typeof AudioEncoder === 'undefined') return { unsupported: true };
  const sr = 48000, ch = 2, secs = 2;
  const sup = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: ch, bitrate: 128000 });
  if (!sup.supported) return { unsupported: 'isConfigSupported false' };
  let chunks = 0, bytes = 0, asc = null, err = null;
  const enc = new AudioEncoder({ output: (c, m) => { chunks++; bytes += c.byteLength; if (m && m.decoderConfig) asc = parseAsc(m.decoderConfig.description ? new Uint8Array(m.decoderConfig.description instanceof ArrayBuffer ? m.decoderConfig.description : m.decoderConfig.description.buffer) : null); }, error: (e) => { err = String(e); } });
  enc.configure({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: ch, bitrate: 128000 });
  const t0 = performance.now(); const block = 1024;
  for (let f = 0; f < sr * secs; f += block) {
    const data = new Float32Array(block * ch);
    for (let c = 0; c < ch; c++) for (let i = 0; i < block; i++) data[c * block + i] = 0.3 * Math.sin(2 * Math.PI * 440 * (f + i) / sr);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: block, numberOfChannels: ch, timestamp: Math.round(f * 1e6 / sr), data });
    enc.encode(ad); ad.close();
  }
  await enc.flush(); enc.close();
  return { chunks, kb: +(bytes / 1024).toFixed(1), asc, wallMs: Math.round(performance.now() - t0), error: err };
});

// ---------------------------------------------------------------- AudioWorklet tap (OfflineAudioContext, no gesture needed)
await step('audioWorklet', async () => {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, 48000, 48000);
  if (!ctx.audioWorklet) return { audioWorklet: 'absent' };
  await ctx.audioWorklet.addModule('/worklet.js');
  const node = new AudioWorkletNode(ctx, 'hh-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  const msg = new Promise(r => { node.port.onmessage = (e) => r(e.data); });
  const osc = ctx.createOscillator(); osc.connect(node); node.connect(ctx.destination); osc.start();
  await ctx.startRendering();
  const m = await timeout(msg, 3000, 'worklet message');
  const live = new (window.AudioContext || window.webkitAudioContext)();
  const liveState = live.state; live.close();
  return { tapMessage: m, liveContextStateWithoutGesture: liveState };
});

// ---------------------------------------------------------------- End-to-end: VideoEncoder packets + AAC samples -> mediabunny fast-start MP4
await step('muxMp4', async () => {
  const MB = await import('mediabunny');
  const w = 1280, h = 720, fps = 30, secs = quick ? 3 : 5, sr = 48000;
  let aacPath = 'native';
  const nativeAac = await MB.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: sr, bitrate: 128000 });
  if (!nativeAac || qs.get('forceWasmAac') === '1') { const { registerAacEncoder } = await import('/aac.mjs'); registerAacEncoder(); aacPath = 'wasm'; }
  const codec = await firstSupportedAvc(w, h);
  if (!codec) return { skipped: 'no avc' };
  const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
  const vsrc = new MB.EncodedVideoPacketSource('avc');
  const asrc = new MB.AudioSampleSource({ codec: 'aac', bitrate: 128000 });
  output.addVideoTrack(vsrc, { frameRate: fps }); output.addAudioTrack(asrc); await output.start();
  const pending = []; let first = true, encErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => { pending.push(vsrc.add(MB.EncodedPacket.fromEncodedChunk(chunk), first ? meta : undefined)); first = false; }, error: (e) => { encErr = String(e); } });
  enc.configure({ codec, width: w, height: h, bitrate: 3_000_000, framerate: fps, latencyMode: 'realtime', avc: { format: 'avc' } });
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
  const t0 = performance.now();
  for (let i = 0; i < fps * secs; i++) { drawTestFrame(g, w, h, i, fps); const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) }); enc.encode(vf, { keyFrame: i % fps === 0 }); vf.close(); if (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0)); }
  await enc.flush(); enc.close(); await Promise.all(pending);
  // Audio: silence with a 1 kHz, 60 ms beep starting exactly on each whole second (same instant as the white flash).
  const block = Number(qs.get('ablock') || 4800);
  for (let f = 0; f < sr * secs; f += block) {
    const data = new Float32Array(block * 2);
    for (let i = 0; i < block; i++) { const t = (f + i) / sr; const inBeep = (t % 1) < 0.06; const s = inBeep ? 0.5 * Math.sin(2 * Math.PI * 1000 * t) : 0; data[i] = s; data[block + i] = s; }
    await asrc.add(new MB.AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: sr, timestamp: f / sr - (qs.get('aacShift') === '1' ? 2112 / sr : 0) }));
  }
  await output.finalize();
  const buf = output.target.buffer; const ms = Math.round(performance.now() - t0);
  const blob = new Blob([buf], { type: 'video/mp4' });
  let server = null; try { server = await (await post('/clip', { name: 'mux' + (qs.get('forceWasmAac') === '1' ? '-wasm' : '') + (qs.get('aacShift') === '1' ? '-shift' : '') + (qs.get('ablock') ? '-ab' + qs.get('ablock') : '') + '.mp4', data: blob })).json(); } catch (e) { server = { error: String(e) }; }
  // Play it back in THIS browser: metadata + a decoded frame at 2.5 s.
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.style.width = '160px'; document.body.appendChild(v); v.src = URL.createObjectURL(blob);
  await timeout(new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('video error ' + (v.error && v.error.code))); }), 10000, 'loadedmetadata');
  const meta = { duration: v.duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight };
  v.currentTime = 2.5; await timeout(new Promise(r => { v.onseeked = r; }), 10000, 'seeked');
  // WebKit only paints a decoded frame into a canvas after it has been presented: play muted and wait for a presented frame.
  await v.play().catch(() => {}); if (v.requestVideoFrameCallback) await timeout(new Promise(r => v.requestVideoFrameCallback(() => r())), 5000, 'rvfc').catch(() => {}); v.pause();
  const c2 = document.createElement('canvas'); c2.width = 160; c2.height = 90; const g2 = c2.getContext('2d'); g2.drawImage(v, 0, 0, 160, 90);
  const px = g2.getImageData(0, 0, 160, 90).data; let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
  v.remove();
  return { codec, aacPath, bytesKB: Math.round(buf.byteLength / 1024), buildMs: ms, encError: encErr, playback: { ...meta, meanLumaAt2_5s: +(sum / (px.length / 4) / 3).toFixed(1) }, serverCheck: server && { atoms: server.atoms, streams: server.ffprobe && server.ffprobe.streams && server.ffprobe.streams.map(s => ({ type: s.codec_type, codec: s.codec_name, profile: s.profile, w: s.width, h: s.height, frames: s.nb_read_frames, dur: s.duration, sr: s.sample_rate, ch: s.channels })), error: server.error || (server.ffprobe && server.ffprobe.error) } };
}, 90000);

// ---------------------------------------------------------------- MediaRecorder fallback path (canvas.captureStream, 2 s)
await step('mediaRecorderClip', async () => {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return { unsupported: true };
  const type = ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) return { unsupported: 'no type' };
  const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; document.body.appendChild(cv); cv.style.width = '160px';
  const g = cv.getContext('2d'); const stream = cv.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_000_000 });
  const parts = []; rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  let i = 0, running = true; const loop = () => { if (!running) return; drawTestFrame(g, 640, 360, i++, 30); requestAnimationFrame(loop); }; loop();
  rec.start(); await new Promise(r => setTimeout(r, 2000)); running = false;
  await new Promise(r => { rec.onstop = r; rec.stop(); });
  cv.remove();
  const blob = new Blob(parts, { type: rec.mimeType || type });
  let server = null; try { server = await (await post('/clip', { name: 'mediarecorder.' + (blob.type.includes('mp4') ? 'mp4' : 'webm'), data: blob })).json(); } catch (e) { server = { error: String(e) }; }
  return { requested: type, actualMime: rec.mimeType, kb: Math.round(blob.size / 1024), framesDrawn: i, serverCheck: server && { atoms: server.atoms, streams: server.ffprobe && server.ffprobe.streams && server.ffprobe.streams.map(s => ({ type: s.codec_type, codec: s.codec_name, w: s.width, h: s.height, frames: s.nb_read_frames, dur: s.duration })), formatDur: server.ffprobe && server.ffprobe.format && server.ffprobe.format.duration } };
}, 30000);

R.finishedAt = new Date().toISOString();
render();
try { await post('/result', JSON.stringify(R)); } catch (e) { R.postError = String(e); }
$s.textContent = 'DONE';
window.__probe = R;
