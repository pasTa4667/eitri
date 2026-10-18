import Foundation
import Vision

let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count >= 2,
      arguments.dropFirst().allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
    FileHandle.standardError.write(Data("Usage: swift prototypes/native-visual/verify.swift <owned-window.png> <required label>...\n".utf8))
    exit(2)
}
let image = URL(fileURLWithPath: arguments[0])
let required = Array(arguments.dropFirst())
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
try VNImageRequestHandler(url: image, options: [:]).perform([request])
let recognized = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
let text = recognized.joined(separator: " ").split(whereSeparator: \.isWhitespace).joined(separator: " ")
let missing = required.filter {
    !text.localizedCaseInsensitiveContains($0.split(whereSeparator: \.isWhitespace).joined(separator: " "))
}
let result: [String: Any] = ["image": image.path, "recognized": recognized, "required": required, "missing": missing, "passed": missing.isEmpty]
let output = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
print(String(data: output, encoding: .utf8)!)
exit(missing.isEmpty ? 0 : 1)
