// Prototype of the server-side hosted-clip validator (moov-only, no decode).
// Reads the object through a range-read callback so the byte cost is measurable;
// in production `readRange` is a Range GET against a presigned URL (bucket egress is free).
import { Input, CustomSource, ALL_FORMATS, MP4, EncodedPacketSink } from 'mediabunny';
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';

const LIMITS = {
  maxBytes: 50 * 1024 * 1024,       // Chromium navigator.share hard cap (kMaxSharedFileBytes)
  maxMoovBytes: 4 * 1024 * 1024,    // 5 min x 60 fps sample tables are ~100-200 KB; 4 MB is a bomb guard
  maxDurationS: 300.5,
  maxFps: 61,
  maxLongSide: 1280, maxShortSide: 720, minShortSide: 180,
  maxKeyframeGapS: 2.5,
  allowedTopLevel: new Set(['ftyp', 'moov', 'mdat', 'free', 'skip']),
  allowedBrands: new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1']),
};

function fileReader(path) {
  const fd = openSync(path, 'r');
  const size = fstatSync(fd).size;
  const stats = { reads: 0, bytes: 0 };
  return {
    size, stats,
    read(start, end) { // [start, end)
      const len = end - start;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, start);
      stats.reads++; stats.bytes += len;
      return new Uint8Array(buf.buffer, buf.byteOffset, len);
    },
    close() { closeSync(fd); },
  };
}

function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
function fourcc(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

async function walkTopLevel(r) {
  const boxes = [];
  let off = 0;
  while (off < r.size) {
    if (r.size - off < 8) throw new Error(`trailing ${r.size - off} bytes after last box`);
    const h = r.read(off, Math.min(off + 16, r.size));
    let size = u32(h, 0); const type = fourcc(h, 4); let hdr = 8;
    if (size === 1) { if (h.length < 16) throw new Error('truncated largesize'); size = u32(h, 8) * 2 ** 32 + u32(h, 12); hdr = 16; }
    else if (size === 0) size = r.size - off; // box extends to EOF
    if (size < hdr) throw new Error(`bad box size ${size} for ${type}`);
    if (off + size > r.size) throw new Error(`box ${type} overruns file (${off + size} > ${r.size})`);
    boxes.push({ type, off, size, hdr });
    if (boxes.length > 64) throw new Error('too many top-level boxes');
    off += size;
  }
  return boxes;
}

export async function validateClip(r) {
  const t0 = performance.now();
  const reasons = [];
  if (r.size > LIMITS.maxBytes) return { ok: false, reasons: [`size ${r.size} > ${LIMITS.maxBytes}`] };
  let boxes;
  try { boxes = await walkTopLevel(r); } catch (e) { return { ok: false, reasons: [`box walk: ${e.message}`] }; }
  const seq = boxes.map((b) => b.type);
  for (const t of seq) if (!LIMITS.allowedTopLevel.has(t)) reasons.push(`top-level box '${t}' not allowed`);
  const core = seq.filter((t) => t !== 'free' && t !== 'skip').join(',');
  if (core !== 'ftyp,moov,mdat') reasons.push(`layout '${core}' is not progressive fast-start ftyp,moov,mdat`);
  const ftyp = boxes.find((b) => b.type === 'ftyp');
  if (ftyp) {
    const f = r.read(ftyp.off + ftyp.hdr, ftyp.off + Math.min(ftyp.size, 64));
    const major = fourcc(f, 0);
    if (!LIMITS.allowedBrands.has(major)) reasons.push(`ftyp major brand '${major}' not allowed`);
  }
  const moov = boxes.find((b) => b.type === 'moov');
  if (moov && moov.size > LIMITS.maxMoovBytes) reasons.push(`moov ${moov.size} bytes > ${LIMITS.maxMoovBytes}`);
  if (reasons.length) return { ok: false, reasons, ms: performance.now() - t0 };

  const input = new Input({ formats: ALL_FORMATS, source: new CustomSource({ getSize: () => r.size, read: (s, e) => r.read(s, e) }) });
  try {
    const fmt = await input.getFormat();
    if (fmt !== MP4) reasons.push(`format ${fmt?.name} is not MP4`);
    const vids = await input.getVideoTracks();
    const auds = await input.getAudioTracks();
    const all = await input.getTracks();
    if (vids.length !== 1) reasons.push(`${vids.length} video tracks (need exactly 1)`);
    if (auds.length > 1) reasons.push(`${auds.length} audio tracks (max 1)`);
    if (all.length !== vids.length + auds.length) reasons.push('non-audio/video tracks present');
    const v = vids[0];
    let info = {};
    if (v) {
      const codec = await v.getCodec();
      const cps = await v.getCodecParameterString();
      const w = await v.getDisplayWidth(), h = await v.getDisplayHeight();
      const cw = await v.getCodedWidth(), ch = await v.getCodedHeight();
      const rot = await v.getRotation();
      const dur = await input.computeDuration();
      const ps = await v.computePacketStats();
      info = { codec, cps, w, h, cw, ch, rot, dur, fps: ps.averagePacketRate, kbps: Math.round(ps.averageBitrate / 1000), packets: ps.packetCount };
      if (codec !== 'avc') reasons.push(`video codec ${codec} (need avc/H.264)`);
      const prof = cps ? parseInt(cps.slice(5, 7), 16) : -1;
      if (![0x42, 0x4d, 0x64].includes(prof)) reasons.push(`H.264 profile 0x${prof.toString(16)} not Baseline/Main/High`);
      if (rot !== 0) reasons.push(`rotation ${rot} not allowed`);
      const long = Math.max(w, h), short = Math.min(w, h);
      if (long > LIMITS.maxLongSide || short > LIMITS.maxShortSide || short < LIMITS.minShortSide) reasons.push(`dims ${w}x${h} out of range`);
      if (w % 2 || h % 2) reasons.push(`odd dims ${w}x${h}`);
      if (!(dur > 0.5 && dur <= LIMITS.maxDurationS)) reasons.push(`duration ${dur}s out of range`);
      if (ps.averagePacketRate > LIMITS.maxFps) reasons.push(`fps ${ps.averagePacketRate} > ${LIMITS.maxFps}`);
      // metadata-only packet walk: first packet key, keyframe gaps, sample bytes fit inside mdat
      const sink = new EncodedPacketSink(v);
      let first = true, lastKey = 0, maxGap = 0, bytes = 0;
      for await (const p of sink.packets(undefined, undefined, { metadataOnly: true })) {
        if (first && p.type !== 'key') reasons.push('first video packet is not a keyframe');
        if (p.type === 'key') { maxGap = Math.max(maxGap, p.timestamp - lastKey); lastKey = p.timestamp; }
        bytes += p.byteLength; first = false;
      }
      maxGap = Math.max(maxGap, dur - lastKey);
      info.maxKeyGap = +maxGap.toFixed(2); info.videoBytes = bytes;
      if (maxGap > LIMITS.maxKeyframeGapS) reasons.push(`keyframe gap ${maxGap.toFixed(2)}s > ${LIMITS.maxKeyframeGapS}s`);
      const mdat = boxes.find((b) => b.type === 'mdat');
      if (bytes > mdat.size - mdat.hdr) reasons.push('video samples exceed mdat payload');
    }
    const a = auds[0];
    if (a) {
      const ac = await a.getCodec();
      info.audio = { codec: ac, ch: await a.getNumberOfChannels(), sr: await a.getSampleRate() };
      if (ac !== 'aac') reasons.push(`audio codec ${ac} (need AAC for iOS/iMessage playback)`);
      if (info.audio.ch > 2) reasons.push(`${info.audio.ch} audio channels`);
    }
    return { ok: reasons.length === 0, reasons, info, ms: +(performance.now() - t0).toFixed(1) };
  } catch (e) {
    return { ok: false, reasons: [`parse: ${e.message}`], ms: performance.now() - t0 };
  } finally {
    input.dispose();
  }
}

if (process.argv[1].endsWith('validate-clip.mjs')) {
  for (const f of process.argv.slice(2)) {
    const r = fileReader(f);
    const res = await validateClip(r);
    console.log(JSON.stringify({ file: f.split('/').pop(), size: r.size, ok: res.ok, reasons: res.reasons, info: res.info, ms: res.ms, reads: r.stats.reads, bytesRead: r.stats.bytes, pctRead: +(100 * r.stats.bytes / r.size).toFixed(2) }));
    r.close();
  }
}
