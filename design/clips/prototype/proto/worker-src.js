// Prototype of the clip encoder worker (scratch only, not repo code).
import {
  Output, Mp4OutputFormat, BufferTarget, NullTarget,
  EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket,
  AudioSampleSource, AudioSample, Quality, canEncodeAudio,
} from 'mediabunny';

const post = (m, t) => self.postMessage(m, t || []);
const SR = 48000;
const log = (...a) => post({ type: 'log', msg: a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') });

let venc = null, vcfg = null, curEpoch = null;
const epochs = [];
const gops = [];
let curGop = null;
let lastKeyReq = -Infinity;
const stats = { framesIn: 0, dropped: 0, chunks: 0, keys: 0, bytes: 0, maxQueue: 0 };

const copyBytes = (src) => {
  if (!src) return null;
  const u8 = src instanceof ArrayBuffer ? new Uint8Array(src) : new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  return u8.slice();
};
const hex = (u8) => u8 ? Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('') : null;

async function pickVideoConfig(w, h) {
  const tried = [];
  for (const codec of ['avc1.64001f', 'avc1.4d401f', 'avc1.42001f']) {
    for (const bitrateMode of ['variable', 'constant']) {
      const c = { codec, width: w, height: h, bitrate: 3_000_000, bitrateMode, framerate: 30, latencyMode: 'realtime', avc: { format: 'avc' } };
      let ok = false, err = null;
      try { ok = !!(await VideoEncoder.isConfigSupported(c)).supported; } catch (e) { err = String(e); }
      tried.push({ codec, bitrateMode, ok, err });
      if (ok) return { cfg: c, tried };
    }
  }
  return { cfg: null, tried };
}

function makeEncoder(cfg, onChunk) {
  const e = new VideoEncoder({ output: onChunk, error: (err) => log('VIDEO ENCODER ERROR', String(err)) });
  e.configure(cfg);
  return e;
}

function onLiveChunk(chunk, meta) {
  if (meta && meta.decoderConfig) {
    const d = meta.decoderConfig;
    const desc = copyBytes(d.description);
    const prev = epochs[epochs.length - 1];
    if (!prev || hex(prev.description) !== hex(desc) || prev.codec !== d.codec) {
      curEpoch = { id: epochs.length, codec: d.codec, codedWidth: d.codedWidth, codedHeight: d.codedHeight, description: desc, colorSpace: d.colorSpace };
      epochs.push(curEpoch);
    }
  }
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  stats.chunks++; stats.bytes += data.byteLength;
  const pkt = { type: chunk.type, ts: chunk.timestamp, dur: chunk.duration || 33333, data, epoch: curEpoch.id };
  if (chunk.type === 'key') stats.keys++;
  if (chunk.type === 'key' || !curGop) {
    curGop = { start: chunk.timestamp, end: chunk.timestamp, epoch: curEpoch.id, bytes: 0, packets: [] };
    gops.push(curGop);
  }
  curGop.packets.push(pkt);
  curGop.bytes += data.byteLength;
  curGop.end = chunk.timestamp + pkt.dur;
  // Ring trim: keep <= 62 s and <= 40 MB, never drop the newest GOP.
  let total = gops.reduce((s, g) => s + g.bytes, 0);
  while (gops.length > 1 && (curGop.end - gops[1].start > 62e6 || total > 40e6)) {
    total -= gops[0].bytes;
    gops.shift();
  }
}

// ---- audio harness: mediabunny AudioSampleSource on a NullTarget, harvesting packets ----
let aOut = null, aSrc = null, audioConfig = null;
const audioPackets = [];
let audioFramesFed = 0;
let primingSec = 0;
const pcmRing = [];

async function initAudio() {
  const native = await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: SR, quality: new Quality(128000) });
  aOut = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new NullTarget() });
  aSrc = new AudioSampleSource({
    codec: 'aac',
    quality: new Quality(128000),
    onEncodedPacket: (packet, meta) => {
      if (meta && meta.decoderConfig) audioConfig = { ...meta.decoderConfig, description: copyBytes(meta.decoderConfig.description) };
      audioPackets.push(packet);
    },
  });
  aOut.addAudioTrack(aSrc);
  await aOut.start();
  return native;
}

// Synthetic game audio: 1 kHz beep of 50 ms starting at every whole second.
function synth(startFrame, n) {
  const d = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const f = startFrame + i;
    const posInSec = f % SR;
    const v = posInSec < SR * 0.05 ? 0.6 * Math.sin(2 * Math.PI * 1000 * f / SR) : 0;
    d[i] = v; d[n + i] = v; // planar
  }
  return d;
}

async function feedAudioUntil(tUs) {
  const target = Math.floor(tUs / 1e6 * SR);
  while (audioFramesFed + 2048 <= target) {
    const data = synth(audioFramesFed, 2048);
    const i16 = new Int16Array(2048 * 2);
    for (let k = 0; k < 2048; k++) { i16[2 * k] = Math.max(-32768, Math.min(32767, Math.round(data[k] * 32767))); i16[2 * k + 1] = Math.max(-32768, Math.min(32767, Math.round(data[2048 + k] * 32767))); }
    pcmRing.push({ startFrame: audioFramesFed, frames: 2048, pcm: i16 });
    const s = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: SR, timestamp: audioFramesFed / SR });
    await aSrc.add(s);
    s.close();
    audioFramesFed += 2048;
  }
}

// Build an ASC (AudioSpecificConfig) for AAC-LC when the platform returns a bad one (WebKit 302253).
function ascFor(sampleRate, channels) {
  const idx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(sampleRate);
  return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (channels << 3)]);
}

async function measurePriming() {
  if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') return { ok: false, reason: 'no AudioEncoder/AudioDecoder' };
  const chunks = []; let dc = null;
  const enc = new AudioEncoder({ output: (c, m) => { chunks.push(c); if (m && m.decoderConfig) dc = m.decoderConfig; }, error: e => log('prime enc err', String(e)) });
  enc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 128000 });
  const N = SR / 2, ON = 12000;
  const data = new Float32Array(N * 2);
  for (let i = ON; i < ON + 960; i++) { const v = 0.8 * Math.sin(2 * Math.PI * 1000 * (i - ON) / SR); data[i] = v; data[N + i] = v; }
  enc.encode(new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: N, numberOfChannels: 2, timestamp: 0, data }));
  await enc.flush(); enc.close();
  const rawDesc = copyBytes(dc && dc.description);
  let desc = rawDesc;
  const bad = !desc || desc.byteLength < 2 || (desc[0] >> 3) === 0;
  if (bad) desc = ascFor(SR, 2);
  const out = [];
  const dec = new AudioDecoder({ output: ad => { const n = ad.numberOfFrames; const b = new Float32Array(n); ad.copyTo(b, { planeIndex: 0, format: 'f32-planar' }); out.push({ ts: ad.timestamp, b }); ad.close(); }, error: e => log('prime dec err', String(e)) });
  dec.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, description: desc });
  for (const c of chunks) dec.decode(c);
  await dec.flush(); dec.close();
  let pos = 0, onset = -1;
  const firstTs = out.length ? out[0].ts : 0;
  for (const o of out) { for (let i = 0; i < o.b.length; i++) { if (Math.abs(o.b[i]) > 0.1) { onset = pos + i; break; } } if (onset >= 0) break; pos += o.b.length; }
  return { ok: onset >= 0, primingSamples: onset - ON, firstDecodedTs: firstTs, chunkCount: chunks.length, firstChunkTs: chunks[0] && chunks[0].timestamp, descBad: bad, rawDescHex: hex(rawDesc) };
}

// ---- clip assembly ----
function epochDecoderConfig(ep) {
  return { codec: ep.codec, codedWidth: ep.codedWidth, codedHeight: ep.codedHeight, description: ep.description, colorSpace: ep.colorSpace };
}

async function assemble({ seconds, endUs, title }) {
  const tA = performance.now();
  const startTarget = endUs - seconds * 1e6;
  let gi = -1;
  for (let i = 0; i < gops.length; i++) if (gops[i].start <= startTarget) gi = i;
  if (gi < 0) gi = 0;
  const sel = gops.slice(gi);
  const epochIds = [...new Set(sel.map(g => g.epoch))];
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vs = new EncodedVideoPacketSource('avc');
  out.addVideoTrack(vs, { frameRate: 30 });
  const as = new EncodedAudioPacketSource('aac');
  out.addAudioTrack(as);
  await out.start();

  // Title card handling: title packets occupy [0, titleDur); gameplay starts at its keyframe after that.
  let vShift, clipZero;
  const titlePkts = title ? title.packets : [];
  const titleDurUs = title ? title.durUs : 0;
  if (title) {
    clipZero = sel[0].start; // gameplay must start on a keyframe mid-track
    vShift = (ts) => (ts - clipZero + titleDurUs) / 1e6;
  } else {
    clipZero = startTarget; // exact trim via negative pre-roll + edit list
    vShift = (ts) => (ts - clipZero) / 1e6;
  }
  const vpk = [];
  for (const p of titlePkts) vpk.push({ ...p, outTs: p.ts / 1e6, cfg: title.decoderConfig });
  for (const g of sel) for (const p of g.packets) if (p.ts < endUs) vpk.push({ ...p, outTs: vShift(p.ts) });

  const aStart = clipZero - (title ? 0 : 0);
  const apk = [];
  if (title) for (const p of title.audioPackets) apk.push({ p, outTs: p.timestamp });
  for (const p of audioPackets) {
    const tUs = p.timestamp * 1e6;
    // one extra packet of pre-roll before clipZero for MDCT overlap; it lands at a negative ts -> trimmed by elst
    if (tUs + p.duration * 1e6 < aStart - 22000 || tUs >= endUs) continue;
    const outTs = (tUs - clipZero) / 1e6 + (title ? titleDurUs / 1e6 : 0) - primingSec;
    if (title && outTs < titleDurUs / 1e6 - 0.0001) continue;
    apk.push({ p, outTs });
  }
  let i = 0, j = 0, firstV = true, firstA = true;
  while (i < vpk.length || j < apk.length) {
    const vt = i < vpk.length ? vpk[i].outTs : Infinity;
    const at = j < apk.length ? apk[j].outTs : Infinity;
    if (vt <= at) {
      const p = vpk[i++];
      await vs.add(new EncodedPacket(p.data, p.type, p.outTs, p.dur / 1e6), firstV ? { decoderConfig: p.cfg || epochDecoderConfig(epochs[p.epoch]) } : undefined);
      firstV = false;
    } else {
      const { p, outTs } = apk[j++];
      await as.add(p.clone({ timestamp: outTs }), firstA ? { decoderConfig: fixedAudioConfig() } : undefined);
      firstA = false;
    }
  }
  vs.close(); as.close();
  await out.finalize();
  const ms = performance.now() - tA;
  return { buffer: out.target.buffer, ms, gopCount: sel.length, epochIds, firstGopStart: sel[0].start, startTarget, videoPackets: vpk.length, audioPackets: apk.length };
}

function fixedAudioConfig() {
  const c = { ...audioConfig };
  const d = c.description;
  if (!d || d.byteLength < 2 || (d[0] >> 3) === 0) c.description = ascFor(c.sampleRate, c.numberOfChannels);
  return c;
}

async function assemblePcm({ seconds, endUs }) {
  const tA = performance.now();
  const startTarget = endUs - seconds * 1e6;
  let gi = -1;
  for (let i = 0; i < gops.length; i++) if (gops[i].start <= startTarget) gi = i;
  if (gi < 0) gi = 0;
  const sel = gops.slice(gi);
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vs = new EncodedVideoPacketSource('avc');
  out.addVideoTrack(vs, { frameRate: 30 });
  let audioCfgSeen = null;
  const as = new AudioSampleSource({ codec: 'aac', quality: new Quality(128000), onEncodedPacket: (p, m) => { if (m && m.decoderConfig) audioCfgSeen = hex(copyBytes(m.decoderConfig.description)); } });
  out.addAudioTrack(as);
  await out.start();
  const clipZero = startTarget;
  const vpk = [];
  for (const g of sel) for (const p of g.packets) if (p.ts < endUs) vpk.push({ ...p, outTs: (p.ts - clipZero) / 1e6 });
  // PCM batches covering [clipZero - priming - 1 batch, endUs)
  const firstFrame = Math.floor((clipZero / 1e6 - primingSec) * SR) - 2048;
  const lastFrame = Math.floor(endUs / 1e6 * SR);
  const batches = pcmRing.filter(b => b.startFrame + b.frames > firstFrame && b.startFrame < lastFrame);
  let i = 0, j = 0, firstV = true, audioMs = 0;
  while (i < vpk.length || j < batches.length) {
    const vt = i < vpk.length ? vpk[i].outTs : Infinity;
    const b = batches[j];
    const at = j < batches.length ? b.startFrame / SR - clipZero / 1e6 - primingSec : Infinity;
    if (vt <= at) {
      const p = vpk[i++];
      await vs.add(new EncodedPacket(p.data, p.type, p.outTs, p.dur / 1e6), firstV ? { decoderConfig: epochDecoderConfig(epochs[p.epoch]) } : undefined);
      firstV = false;
    } else {
      j++;
      const a0 = performance.now();
      const smp = new AudioSample({ data: b.pcm, format: 's16', numberOfChannels: 2, sampleRate: SR, timestamp: at });
      await as.add(smp); smp.close();
      audioMs += performance.now() - a0;
    }
  }
  vs.close(); as.close();
  await out.finalize();
  return { buffer: out.target.buffer, ms: performance.now() - tA, audioMs, audioCfgSeen };
}

// Title card: second encoder instance with the identical config; compare avcC bytes.
async function makeTitle(frames) {
  const pkts = []; let dcfg = null;
  const e = new VideoEncoder({ output: (c, m) => { if (m && m.decoderConfig) dcfg = { ...m.decoderConfig, description: copyBytes(m.decoderConfig.description) }; const d = new Uint8Array(c.byteLength); c.copyTo(d); pkts.push({ type: c.type, ts: c.timestamp, dur: c.duration || 33333, data: d }); }, error: err => log('title enc err', String(err)) });
  e.configure(vcfg);
  for (let k = 0; k < frames.length; k++) { e.encode(frames[k], { keyFrame: k === 0 }); frames[k].close(); }
  await e.flush(); e.close();
  // Title audio: silence encoded by an independent AudioEncoder-backed source
  const titleAudio = [];
  const o2 = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new NullTarget() });
  const s2 = new AudioSampleSource({ codec: 'aac', quality: new Quality(128000), onEncodedPacket: (p) => titleAudio.push(p) });
  o2.addAudioTrack(s2); await o2.start();
  const n = Math.round(frames.length / 30 * SR);
  const sil = new AudioSample({ data: new Float32Array(n * 2), format: 'f32-planar', numberOfChannels: 2, sampleRate: SR, timestamp: 0 });
  await s2.add(sil); sil.close(); s2.close(); await o2.finalize();
  const live = epochs[epochs.length - 1];
  return { packets: pkts, decoderConfig: dcfg, durUs: frames.length * 33333, audioPackets: titleAudio.filter(p => p.timestamp < frames.length / 30 - 1e-6), identicalAvcC: hex(dcfg.description) === hex(live.description), titleAvcC: hex(dcfg.description), liveAvcC: hex(live.description), titleCodec: dcfg.codec, liveCodec: live.codec };
}

let lastFrameTs = 0;
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const { cfg, tried } = await pickVideoConfig(m.width, m.height);
      vcfg = cfg;
      venc = makeEncoder(cfg, onLiveChunk);
      const nativeAac = await initAudio();
      const priming = await measurePriming();
      if (priming.ok) primingSec = priming.primingSamples / SR;
      post({ type: 'inited', cfg, tried, nativeAac, priming });
    } else if (m.type === 'frame') {
      const f = m.frame;
      stats.framesIn++;
      stats.maxQueue = Math.max(stats.maxQueue, venc.encodeQueueSize);
      // prototype: apply backpressure instead of dropping, so the test measures correctness not load
      while (venc.encodeQueueSize > 2) await new Promise(r => venc.addEventListener('dequeue', r, { once: true }));
      {
        const key = f.timestamp - lastKeyReq >= 1e6 - 1000;
        if (key) lastKeyReq = f.timestamp;
        venc.encode(f, { keyFrame: key });
        lastFrameTs = f.timestamp;
        f.close();
      }
      await feedAudioUntil(lastFrameTs);
      post({ type: 'ack', q: venc.encodeQueueSize });
    } else if (m.type === 'clip') {
      await venc.flush();
      const endUs = lastFrameTs + 33333;
      const r = await assemble({ seconds: m.seconds, endUs, title: null });
      post({ type: 'clip', name: m.name, stats, ...r, buffer: undefined, bytes: r.buffer.byteLength, primingSec }, []);
      post({ type: 'file', name: m.name, buffer: r.buffer }, [r.buffer]);
    } else if (m.type === 'clippcm') {
      await venc.flush();
      const endUs = lastFrameTs + 33333;
      const r = await assemblePcm({ seconds: m.seconds, endUs });
      post({ type: 'clippcm', ms: r.ms, audioMs: r.audioMs, audioCfgSeen: r.audioCfgSeen, bytes: r.buffer.byteLength });
      post({ type: 'file', name: m.name, buffer: r.buffer }, [r.buffer]);
    } else if (m.type === 'title') {
      await venc.flush();
      const t = await makeTitle(m.frames);
      const endUs = lastFrameTs + 33333;
      post({ type: 'titleinfo', identicalAvcC: t.identicalAvcC, titleAvcC: t.titleAvcC, liveAvcC: t.liveAvcC, titleCodec: t.titleCodec, liveCodec: t.liveCodec, titleAudioPackets: t.audioPackets.length });
      if (t.identicalAvcC) {
        const r = await assemble({ seconds: m.seconds, endUs, title: t });
        post({ type: 'file', name: m.name, buffer: r.buffer, ms: r.ms }, [r.buffer]);
      }
    }
  } catch (err) {
    post({ type: 'error', msg: String(err && err.stack || err) });
  }
};
