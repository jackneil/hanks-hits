// A/V sync as Apple's media stack decodes it (AVAssetReader = the decoder iOS Photos/Messages use).
// Test-pattern contract: full-white video frame and a 1 kHz beep at every whole second.
import AVFoundation
import Foundation
let path = CommandLine.arguments[1]
let asset = AVURLAsset(url: URL(fileURLWithPath: path))
let sema = DispatchSemaphore(value: 0)
Task {
  do {
    let reader = try AVAssetReader(asset: asset)
    let vtrack = try await asset.loadTracks(withMediaType: .video).first!
    let atrack = try await asset.loadTracks(withMediaType: .audio).first!
    let vout = AVAssetReaderTrackOutput(track: vtrack, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    let aout = AVAssetReaderTrackOutput(track: atrack, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false, AVNumberOfChannelsKey: 1, AVSampleRateKey: 48000])
    reader.add(vout); reader.add(aout); reader.startReading()
    var flashes: [Double] = []
    while let sb = vout.copyNextSampleBuffer() {
      let t = CMSampleBufferGetPresentationTimeStamp(sb).seconds
      guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
      CVPixelBufferLockBaseAddress(pb, .readOnly)
      let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb), bpr = CVPixelBufferGetBytesPerRow(pb)
      let base = CVPixelBufferGetBaseAddress(pb)!.assumingMemoryBound(to: UInt8.self)
      var sum = 0; var n = 0
      for y in stride(from: 0, to: h, by: 16) { for x in stride(from: 0, to: w, by: 16) { let p = base + y * bpr + x * 4; sum += Int(p[0]) + Int(p[1]) + Int(p[2]); n += 3 } }
      CVPixelBufferUnlockBaseAddress(pb, .readOnly)
      if Double(sum) / Double(n) > 200 { flashes.append(t) }
    }
    var onsets: [Double] = []; var inBeep = false; var quietRun = 0
    while let sb = aout.copyNextSampleBuffer() {
      let t0 = CMSampleBufferGetPresentationTimeStamp(sb).seconds
      guard let bb = CMSampleBufferGetDataBuffer(sb) else { continue }
      var len = 0; var ptr: UnsafeMutablePointer<Int8>? = nil
      CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &len, dataPointerOut: &ptr)
      let count = len / 4
      ptr!.withMemoryRebound(to: Float.self, capacity: count) { f in
        for i in 0..<count {
          let loud = abs(f[i]) > 0.05
          if loud { if !inBeep { onsets.append(t0 + Double(i) / 48000.0); inBeep = true }; quietRun = 0 }
          else if inBeep { quietRun += 1; if quietRun > 2400 { inBeep = false } }
        }
      }
    }
    var pairs: [Double] = []
    for f in flashes { if let b = onsets.min(by: { abs($0 - f) < abs($1 - f) }) { pairs.append(((b - f) * 10000).rounded() / 10) } }
    let out: [String: Any] = ["file": path, "flashes": flashes, "beepOnsets": onsets.map { ($0 * 10000).rounded() / 10000 }, "audioMinusVideoMs": pairs]
    print(String(data: try JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
  } catch { print("error \(error)") }
  sema.signal()
}
sema.wait()
