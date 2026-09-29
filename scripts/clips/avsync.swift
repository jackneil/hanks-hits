// AVFoundation reader for the clips lab analyzer (plan 15: "every file is
// judged by ffmpeg/ffprobe and a Swift AVFoundation checker, which is what
// iPhone Photos and Messages use").
//
// Usage: avsync <file.mp4>
//
// It decodes the file with AVAssetReader, the decoder of Apple's media
// stack, and prints one JSON object on stdout:
//   {"file": ..., "video": {"frames": [[time s, luma], ...]},
//    "audio": {"sampleRate": 48000, "binMs": 1,
//              "segments": [{"start": time s, "samples": n, "peaks": [...]}]}}
// "audio" is null when the file has no sound track. The times are
// presentation times, so the edit list and the roll groups apply the way an
// iPhone applies them. scripts/clips/lib/sync.mjs finds the flashes and the
// beeps in these series, the same way for every decoder.
//
// On an error it writes the reason to stderr and exits with status 1.
//
// Ported from design/clips/prototype/avcheck/avsync.swift (Phase 0). Changes:
// full frame and envelope series instead of fixed thresholds, an error exit
// instead of "error" on stdout, no crash on a file without a sound track,
// and segments that show gaps in the sound track.
import AVFoundation
import Foundation

let sampleRate = 48000.0
let binSamples = 48  // 1 ms at 48 kHz
let gapTolerance = 0.00025  // s: a buffer that does not follow on starts a new segment

func fail(_ message: String) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(1)
}

func number(_ value: Double, _ digits: Int) -> String {
  if !value.isFinite { return "null" }
  return String(format: "%.\(digits)f", value)
}

func jsonString(_ text: String) -> String {
  var out = "\""
  for scalar in text.unicodeScalars {
    switch scalar {
    case "\"": out += "\\\""
    case "\\": out += "\\\\"
    case "\n": out += "\\n"
    case "\r": out += "\\r"
    case "\t": out += "\\t"
    default:
      if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
    }
  }
  return out + "\""
}

struct Segment {
  var start: Double
  var samples: Int
  var peaks: [Float]
}

guard CommandLine.arguments.count == 2 else { fail("usage: avsync <file.mp4>") }
let path = CommandLine.arguments[1]
guard FileManager.default.fileExists(atPath: path) else { fail("avsync: no such file: \(path)") }

Task {
  do {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else { fail("avsync: the file has no video track") }
    let audioTrack = try await asset.loadTracks(withMediaType: .audio).first

    // Video and audio are read in two passes, one reader each, so a long
    // track cannot stall the other track's output.
    let videoReader = try AVAssetReader(asset: asset)
    let videoOutput = AVAssetReaderTrackOutput(
      track: videoTrack,
      outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    videoOutput.alwaysCopiesSampleData = false
    videoReader.add(videoOutput)
    guard videoReader.startReading() else { fail("avsync: the video reader did not start: \(String(describing: videoReader.error))") }
    var frames: [(Double, Double)] = []
    while let buffer = videoOutput.copyNextSampleBuffer() {
      let time = CMSampleBufferGetPresentationTimeStamp(buffer).seconds
      guard let pixels = CMSampleBufferGetImageBuffer(buffer) else { continue }
      CVPixelBufferLockBaseAddress(pixels, .readOnly)
      let width = CVPixelBufferGetWidth(pixels)
      let height = CVPixelBufferGetHeight(pixels)
      let rowBytes = CVPixelBufferGetBytesPerRow(pixels)
      guard let base = CVPixelBufferGetBaseAddress(pixels)?.assumingMemoryBound(to: UInt8.self) else {
        CVPixelBufferUnlockBaseAddress(pixels, .readOnly)
        continue
      }
      // Rec. 709 luma of every 8th pixel in both directions (BGRA bytes).
      var sum = 0.0
      var count = 0.0
      for y in stride(from: 0, to: height, by: 8) {
        for x in stride(from: 0, to: width, by: 8) {
          let p = base + y * rowBytes + x * 4
          sum += 0.0722 * Double(p[0]) + 0.7152 * Double(p[1]) + 0.2126 * Double(p[2])
          count += 1
        }
      }
      CVPixelBufferUnlockBaseAddress(pixels, .readOnly)
      if count > 0 { frames.append((time, sum / count)) }
    }
    if videoReader.status == .failed { fail("avsync: the video reader failed: \(String(describing: videoReader.error))") }

    var segments: [Segment] = []
    if let audioTrack = audioTrack {
      let audioReader = try AVAssetReader(asset: asset)
      let audioOutput = AVAssetReaderTrackOutput(
        track: audioTrack,
        outputSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM,
          AVLinearPCMBitDepthKey: 32,
          AVLinearPCMIsFloatKey: true,
          AVLinearPCMIsNonInterleaved: false,
          AVLinearPCMIsBigEndianKey: false,
          AVNumberOfChannelsKey: 1,
          AVSampleRateKey: sampleRate,
        ])
      audioReader.add(audioOutput)
      guard audioReader.startReading() else { fail("avsync: the audio reader did not start: \(String(describing: audioReader.error))") }
      while let buffer = audioOutput.copyNextSampleBuffer() {
        let start = CMSampleBufferGetPresentationTimeStamp(buffer).seconds
        guard let block = CMSampleBufferGetDataBuffer(buffer) else { continue }
        let count = CMBlockBufferGetDataLength(block) / 4
        if count == 0 { continue }
        // A block buffer can keep its bytes in more than one memory block. A
        // pointer to offset 0 is then good for the first memory block only,
        // not for the whole length. So copy the bytes out:
        // CMBlockBufferCopyDataBytes reads across all the memory blocks.
        var samples = [Float](repeating: 0, count: count)
        let copied = samples.withUnsafeMutableBytes { bytes in
          CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: count * 4, destination: bytes.baseAddress!)
        }
        if copied != kCMBlockBufferNoErr { fail("avsync: could not read an audio buffer (status \(copied))") }
        if segments.isEmpty
          || abs(start - (segments[segments.count - 1].start + Double(segments[segments.count - 1].samples) / sampleRate)) > gapTolerance
        {
          segments.append(Segment(start: start, samples: 0, peaks: []))
        }
        let index = segments.count - 1
        for i in 0..<count {
          let bin = segments[index].samples / binSamples
          let value = abs(samples[i])
          if bin >= segments[index].peaks.count {
            segments[index].peaks.append(value)
          } else if value > segments[index].peaks[bin] {
            segments[index].peaks[bin] = value
          }
          segments[index].samples += 1
        }
      }
      if audioReader.status == .failed { fail("avsync: the audio reader failed: \(String(describing: audioReader.error))") }
    }

    var out = "{\"file\":\(jsonString(path)),\"video\":{\"frames\":["
    out += frames.map { "[\(number($0.0, 6)),\(number($0.1, 2))]" }.joined(separator: ",")
    out += "]},\"audio\":"
    if audioTrack == nil {
      out += "null"
    } else {
      out += "{\"sampleRate\":\(Int(sampleRate)),\"binMs\":1,\"segments\":["
      out += segments.map { segment in
        "{\"start\":\(number(segment.start, 6)),\"samples\":\(segment.samples),\"peaks\":["
          + segment.peaks.map { number(Double($0), 5) }.joined(separator: ",") + "]}"
      }.joined(separator: ",")
      out += "]}"
    }
    out += "}\n"
    FileHandle.standardOutput.write(out.data(using: .utf8)!)
    exit(0)
  } catch {
    fail("avsync: \(error)")
  }
}

dispatchMain()
