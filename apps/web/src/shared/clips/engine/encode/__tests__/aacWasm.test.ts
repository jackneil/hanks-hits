/**
 * Integration test of the real WASM AAC fallback (tier W+).
 *
 * @mediabunny/aac-encoder starts its FFmpeg WASM encoder in a nested worker.
 * jsdom has no Worker, so the package uses Node worker_threads, which runs the
 * same WASM. No fake is involved here.
 */
import { describe, expect, it } from "vitest";
import { AAC_FRAME, AacPacketRing, AacSession, PRE_PAD_FRAMES, PRIMING_CONSTANTS, PcmRing, type AacSink } from "../audio/aac";
import { createWasmBackend } from "../audio/aacBackends";

const SR = 48000;

function tone(frames: number, from = 0): [Float32Array, Float32Array] {
  const l = new Float32Array(frames);
  for (let i = 0; i < frames; i++) l[i] = 0.3 * Math.sin((2 * Math.PI * 440 * (from + i)) / SR);
  return [l, l.slice()];
}

describe("WASM AAC backend (real @mediabunny/aac-encoder)", () => {
  it(
    "streams raw AAC packets as it goes, one per 1024 frames, and flushes the rest",
    async () => {
      const packets: ArrayBuffer[] = [];
      const errors: unknown[] = [];
      const sink: AacSink = { packet: (d) => packets.push(d), error: (e) => errors.push(e) };
      const backend = await createWasmBackend(sink);
      expect(backend.kind).toBe("wasm");
      const frames = 5 * SR;
      for (let at = 0; at < frames; at += 8192) {
        const n = Math.min(8192, frames - at);
        backend.encode(...tone(n, at));
      }
      // Wait for the encode chain without a flush: packets must already be flowing.
      const deadline = Date.now() + 20_000;
      while (packets.length < 100 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      expect(packets.length).toBeGreaterThanOrEqual(100);
      await backend.flush();
      backend.close();
      expect(errors).toEqual([]);
      // Every frame plus FFmpeg's 1024-sample priming, padded to whole packets.
      expect(packets.length).toBe(Math.ceil((frames + PRIMING_CONSTANTS.wasm) / AAC_FRAME));
      for (const p of packets) {
        const b = new Uint8Array(p);
        expect(b.byteLength).toBeGreaterThan(0);
        // Raw AAC, never ADTS (an ADTS frame starts with the 0xFFF sync word).
        expect(b.byteLength >= 2 && b[0] === 0xff && (b[1] & 0xf0) === 0xf0).toBe(false);
      }
      // 128 kbps: about 683 bytes per 1024-frame packet on average.
      const avg = packets.reduce((n, p) => n + p.byteLength, 0) / packets.length;
      expect(avg).toBeGreaterThan(300);
      expect(avg).toBeLessThan(1100);
    },
    60_000,
  );

  it(
    "feeds an AacSession with contiguous packets on the WASM grid",
    async () => {
      const pcm = new PcmRing(62);
      const ring = new AacPacketRing(62);
      const errors: string[] = [];
      const s = new AacSession({
        kinds: ["wasm"],
        primingSamples: {},
        createBackend: (_k, sink) => createWasmBackend(sink),
        pcm,
        ring,
        onError: (code, detail) => errors.push(`${code}: ${detail}`),
      });
      for (let b = 0; b < 200; b++) {
        const [l] = tone(1024, b * 1024);
        const data = new Float32Array(2048);
        for (let f = 0; f < 1024; f++) data[f * 2] = data[f * 2 + 1] = l[f];
        pcm.write(b * 1024, data);
      }
      s.pump();
      const deadline = Date.now() + 20_000;
      while (ring.size < 150 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      await s.closeStream();
      expect(errors).toEqual([]);
      const packets = ring.packets;
      expect(packets[0].tsFrames).toBe(-(PRIMING_CONSTANTS.wasm + PRE_PAD_FRAMES));
      for (let i = 1; i < packets.length; i++) expect(packets[i].tsFrames - packets[i - 1].tsFrames).toBe(AAC_FRAME);
      // The flush brings the stream up to the last whole packet at or before the fed audio.
      expect(ring.endFrame).toBeLessThanOrEqual(200 * 1024);
      expect(ring.endFrame).toBeGreaterThan(200 * 1024 - AAC_FRAME);
    },
    60_000,
  );
});
