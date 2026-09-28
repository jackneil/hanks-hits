import fs from 'node:fs';
import { Input, BufferSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacketSink } from 'mediabunny';
const file = process.argv[2];
const d = fs.readFileSync(file);
// Parse top-level boxes, keep init (ftyp+moov) + fragments from index K onward (simulating a rolling fragment ring)
const boxes = []; let i = 0;
while (i + 8 <= d.length) { let sz = d.readUInt32BE(i); const typ = d.toString('latin1', i + 4, i + 8); if (sz === 1) sz = Number(d.readBigUInt64BE(i + 8)); if (sz === 0) sz = d.length - i; boxes.push({ typ, off: i, sz }); i += sz; }
const init = boxes.filter(b => b.typ === 'ftyp' || b.typ === 'moov');
const frags = []; for (let k = 0; k < boxes.length; k++) if (boxes[k].typ === 'moof') frags.push([boxes[k], boxes[k + 1]]);
const keepFrom = 5;
const parts = [...init.map(b => d.subarray(b.off, b.off + b.sz)), ...frags.slice(keepFrom).flatMap(([a, b]) => [d.subarray(a.off, a.off + a.sz), d.subarray(b.off, b.off + b.sz)])];
const ring = Buffer.concat(parts);
const t0 = performance.now();
const input = new Input({ source: new BufferSource(ring), formats: ALL_FORMATS });
const vt = await input.getPrimaryVideoTrack(); const at = await input.getPrimaryAudioTrack();
const vcfg = await vt.getDecoderConfig(); const acfg = await at.getDecoderConfig();
const vPk = []; for await (const p of new EncodedPacketSink(vt).packets()) vPk.push(p);
const aPk = []; for await (const p of new EncodedPacketSink(at).packets()) aPk.push(p);
const endT = Math.max(vPk.at(-1).timestamp + vPk.at(-1).duration, aPk.at(-1).timestamp + aPk.at(-1).duration);
const clipLen = 5.5; const zero = endT - clipLen;
const out = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
const vs = new EncodedVideoPacketSource('avc'); const as = new EncodedAudioPacketSource('aac');
out.addVideoTrack(vs); out.addAudioTrack(as); await out.start();
let vi = 0, ai = 0, fv = true, fa = true;
while (vi < vPk.length || ai < aPk.length) {
  const tv = vi < vPk.length ? vPk[vi].timestamp : Infinity, ta = ai < aPk.length ? aPk[ai].timestamp : Infinity;
  if (tv <= ta) { const p = vPk[vi++]; await vs.add(p.clone({ timestamp: p.timestamp - zero }), fv ? { decoderConfig: vcfg } : undefined); fv = false; }
  else { const p = aPk[ai++]; if (p.timestamp + p.duration < zero - 0.03) continue; await as.add(p.clone({ timestamp: p.timestamp - zero }), fa ? { decoderConfig: acfg } : undefined); fa = false; }
}
vs.close(); as.close(); await out.finalize();
fs.writeFileSync(file.replace('.mp4', '-ringremux.mp4'), Buffer.from(out.target.buffer));
console.log(JSON.stringify({ frags: frags.length, keptFrags: frags.length - keepFrom, firstVideoTs: vPk[0].timestamp, firstVideoType: vPk[0].type, endT, zero, vPackets: vPk.length, aPackets: aPk.length, ms: +(performance.now() - t0).toFixed(1), vcodec: vcfg.codec, acodec: acfg.codec }));
