import AVFoundation
import Foundation

// MARK: - Actor that owns the live Process so we can terminate it on cancel

actor ProcessHandle {
    private var process: Process?

    func set(_ p: Process) { process = p }

    func terminate() {
        process?.terminate()
        process = nil
    }
}

// MARK: - Observable synthesizer (main-actor)
// Synthesis is always save-to-disk; no audio streaming.

@MainActor @Observable
final class KokoSynthesizer {
    var isGenerating    = false
    var errorMessage    = ""
    var savedOutputPath = ""

    private var generationTask: Task<Void, Never>?
    private var processHandle  = ProcessHandle()
    private var audioPlayer:    AVAudioPlayer?

    // MARK: Generate

    func generate(
        text: String,
        style: String,
        speed: Float,
        language: String = "en-us",
        outputLabel: String? = nil,
        outputSubdir: String? = nil
    ) {
        guard !isGenerating else { return }

        stopGeneration()
        isGenerating    = true
        errorMessage    = ""
        savedOutputPath = ""
        processHandle   = ProcessHandle()

        guard let paths = KokoPaths.resolve() else {
            errorMessage = "koko binary or model files not found. Make sure the app is packaged correctly."
            isGenerating = false
            return
        }

        let outputURL = Self.makeOutputURL(label: outputLabel, subdir: outputSubdir)
        let handle    = processHandle

        generationTask = Task {
            do {
                try await runKokoText(
                    text: text, style: style, speed: speed, language: language,
                    paths: paths, outputURL: outputURL, handle: handle
                )
                savedOutputPath = outputURL.path
            } catch is CancellationError {
                // cancelled by stopGeneration — no error message
            } catch {
                errorMessage = error.localizedDescription
            }
            isGenerating = false
        }
    }

    func stopGeneration() {
        let handle = processHandle
        Task { await handle.terminate() }
        generationTask?.cancel()
        generationTask = nil
        isGenerating   = false
    }

    // MARK: Playback

    func play() {
        guard !savedOutputPath.isEmpty else { return }
        do {
            let player = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: savedOutputPath))
            audioPlayer = player
            player.play()
        } catch {
            errorMessage = "Playback failed: \(error.localizedDescription)"
        }
    }

    func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
    }

    // MARK: Private

    private func runKokoText(
        text: String,
        style: String,
        speed: Float,
        language: String,
        paths: KokoPaths,
        outputURL: URL,
        handle: ProcessHandle
    ) async throws {
        try FileManager.default.createDirectory(
            at: outputURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let process = Process()
        process.executableURL = paths.koko
        process.arguments = [
            "--model", paths.model.path,
            "--data",  paths.voices.path,
            "--style", style,
            "--speed", String(speed),
            "--lan",   language,
            "text",
            "--output", outputURL.path,
            text,
        ]

        let stderrPipe = Pipe()
        process.standardError = stderrPipe

        try process.run()
        await handle.set(process)

        // Wait for exit on a background thread so we don't block the main actor.
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            Task.detached {
                process.waitUntilExit()
                await handle.terminate()

                if process.terminationStatus == 0 {
                    continuation.resume()
                } else {
                    let stderr = String(
                        data: stderrPipe.fileHandleForReading.readDataToEndOfFile(),
                        encoding: .utf8
                    )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    continuation.resume(throwing: KokoError.processExited(
                        code: process.terminationStatus,
                        stderr: stderr
                    ))
                }
            }
        }
    }

    // MARK: Output path helpers

    static func makeOutputURL(label: String?, subdir: String?) -> URL {
        let base = synthesisDirectory
        let dir  = subdir.map { base.appendingPathComponent(sanitizePath($0)) } ?? base
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let ts   = UInt64(Date().timeIntervalSince1970 * 1_000)
        let stem = label.map { sanitizeStem($0, fallback: "speech") } ?? "speech"
        return dir.appendingPathComponent("\(stem)-\(ts).wav")
    }

    static var synthesisDirectory: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let bundleID   = Bundle.main.bundleIdentifier ?? "me.nkdr.kokoro"
        return appSupport.appendingPathComponent(bundleID).appendingPathComponent("synthesis")
    }

    private static func sanitizePath(_ input: String) -> String {
        input
            .split(whereSeparator: { $0 == "/" || $0 == "\\" })
            .map { sanitizeStem(String($0), fallback: "audio") }
            .filter { !$0.isEmpty }
            .joined(separator: "/")
    }

    private static func sanitizeStem(_ input: String, fallback: String) -> String {
        var out = ""
        for ch in input.prefix(96) {
            let mapped: Character = ch.isLetter || ch.isNumber || ch == "-" || ch == "_" || ch == "." ? ch : "-"
            if mapped == "-" && out.last == "-" { continue }
            out.append(mapped)
        }
        let trimmed = out.trimmingCharacters(in: CharacterSet(charactersIn: "-_."))
        return trimmed.isEmpty ? fallback : trimmed
    }
}

// MARK: - Error type

enum KokoError: LocalizedError {
    case processExited(code: Int32, stderr: String)

    var errorDescription: String? {
        switch self {
        case .processExited(let code, let stderr):
            let base = "koko exited with code \(code)."
            return stderr.isEmpty ? base : "\(base) \(stderr)"
        }
    }
}
