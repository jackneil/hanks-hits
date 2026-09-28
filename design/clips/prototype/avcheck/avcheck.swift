// Loads an MP4 with Apple's AVFoundation (the media stack iOS Photos/Messages use)
// and reports whether it is playable, plus track formats and durations.
import AVFoundation
import Foundation
let path = CommandLine.arguments[1]
let asset = AVURLAsset(url: URL(fileURLWithPath: path))
let sema = DispatchSemaphore(value: 0)
Task {
  do {
    let (playable, exportable, duration) = try await asset.load(.isPlayable, .isExportable, .duration)
    var tracks: [[String: Any]] = []
    for t in try await asset.load(.tracks) {
      let (fmts, tr, nat) = try await t.load(.formatDescriptions, .timeRange, .naturalSize)
      var codecs: [String] = []
      for f in fmts {
        let c: FourCharCode = CMFormatDescriptionGetMediaSubType(f)
        let bytes: [UInt8] = [UInt8((c >> 24) & 255), UInt8((c >> 16) & 255), UInt8((c >> 8) & 255), UInt8(c & 255)]
        codecs.append(String(bytes: bytes, encoding: .ascii) ?? "?")
      }
      var row: [String: Any] = [:]
      row["type"] = t.mediaType.rawValue
      row["codec"] = codecs.joined(separator: ",")
      row["start"] = tr.start.seconds
      row["dur"] = tr.duration.seconds
      row["size"] = "\(Int(nat.width))x\(Int(nat.height))"
      tracks.append(row)
    }
    let out: [String: Any] = ["file": path, "playable": playable, "exportable": exportable, "duration": duration.seconds, "tracks": tracks]
    print(String(data: try JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
  } catch { print("{\"file\":\"\(path)\",\"error\":\"\(error)\"}") }
  sema.signal()
}
sema.wait()
