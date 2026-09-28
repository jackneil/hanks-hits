import fs from 'node:fs';
import { Input, BufferSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget, StreamTarget, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacketSink } from 'mediabunny';
const src = fs.readFileSync('/tmp/hh-clips/proto/out/chrome4-clippcm.mp4');
const input = new Input({ source: new BufferSource(src), formats: ALL_FORMATS });
const vt = await input.getPrimaryVideoTrack(), at = await input.getPrimaryAudioTrack();
const vcfg = await vt.getDecoderConfig(), acfg = await at.getDecoderConfig();
const vPk = [], aPk = [];
for await (const p of new EncodedPacketSink(vt).packets()) vPk.push(p);
for await (const p of new EncodedPacketSink(at).packets()) aPk.push(p);
const OFF = -Math.min(vPk[0].timestamp, 0);
// 1) Record mode: fragmented MP4 streamed through a StreamTarget; track committed fragment ends via onMoof positions.
const file = new Uint8Array(64 << 20); let fileLen = 0; const moofs = [];
const writable = new WritableStream({ write(chunk) { file.set(chunk.data, chunk.position); fileLen = Math.max(fileLen, chunk.position + chunk.data.byteLength); } });
const rec = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1, onMoof: (d, pos, ts) => moofs.push({ pos, ts }) }), target: new StreamTarget(writable) });
const vs = new EncodedVideoPacketSource('avc'), as = new EncodedAudioPacketSource('aac');
rec.addVideoTrack(vs, { frameRate: 30 }); rec.addAudioTrack(as); await rec.start();
let i = 0, j = 0, fv = true, fa = true;
while (i < vPk.length || j < aPk.length) {
  const tv = i < vPk.length ? vPk[i].timestamp : Infinity, ta = j < aPk.length ? aPk[j].timestamp : Infinity;
  if (tv <= ta) { const p0 = vPk[i++]; const p = p0.clone({ timestamp: p0.timestamp + OFF }); await vs.add(p, fv ? { decoderConfig: vcfg } : undefined); fv = false; }
  else { const p0 = aPk[j++]; const p = p0.clone({ timestamp: p0.timestamp + OFF }); if (p.timestamp < 0) continue; await as.add(p, fa ? { decoderConfig: acfg } : undefined); fa = false; }
}
vs.close(); as.close(); await rec.finalize();
const full = file.slice(0, fileLen);
fs.writeFileSync('/tmp/hh-clips/proto/out/record-full.fmp4', full);
// 2) Simulated crash: the "committed" watermark is the start of the 20th moof (i.e. end of fragment 19), plus some garbage bytes of a torn write.
const cut = moofs[20].pos; const torn = full.slice(0, cut + 3000);
const t0 = performance.now();
const committed = torn.slice(0, cut); // recovery = truncate to the last committed boundary
const in2 = new Input({ source: new BufferSource(committed), formats: ALL_FORMATS });
const v2 = await in2.getPrimaryVideoTrack(), a2 = await in2.getPrimaryAudioTrack();
const vP2 = [], aP2 = [];
for await (const p of new EncodedPacketSink(v2).packets()) vP2.push(p);
for await (const p of new EncodedPacketSink(a2).packets()) aP2.push(p);
// 3) Finalize to fast-start via 'reserve' (moov reserved at the front, mdat streamed) - no whole-file RAM copy needed.
const fin = new Output({ format: new Mp4OutputFormat({ fastStart: 'reserve' }), target: new BufferTarget() });
const vs2 = new EncodedVideoPacketSource('avc'), as2 = new EncodedAudioPacketSource('aac');
fin.addVideoTrack(vs2, { frameRate: 30, maximumPacketCount: vP2.length }); fin.addAudioTrack(as2, { maximumPacketCount: aP2.length }); await fin.start();
i = 0; j = 0; fv = true; fa = true;
const vc2 = await v2.getDecoderConfig(), ac2 = await a2.getDecoderConfig();
while (i < vP2.length || j < aP2.length) {
  const tv = i < vP2.length ? vP2[i].timestamp : Infinity, ta = j < aP2.length ? aP2[j].timestamp : Infinity;
  if (tv <= ta) { await vs2.add(vP2[i++], fv ? { decoderConfig: vc2 } : undefined); fv = false; }
  else { await as2.add(aP2[j++], fa ? { decoderConfig: ac2 } : undefined); fa = false; }
}
vs2.close(); as2.close(); await fin.finalize();
fs.writeFileSync('/tmp/hh-clips/proto/out/record-recovered.mp4', Buffer.from(fin.target.buffer));
console.log(JSON.stringify({ fragments: moofs.length, fragTimes: moofs.slice(0, 5).map(m => +m.ts.toFixed(3)), fmp4Bytes: fileLen, recoveredVideoPkts: vP2.length, recoveredAudioPkts: aP2.length, lastVideoTs: vP2.at(-1).timestamp, remuxMs: +(performance.now() - t0).toFixed(1) }));
