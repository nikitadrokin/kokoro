import Foundation

struct KokoPaths: Sendable {
    let koko: URL
    let model: URL
    let voices: URL

    static func resolve() -> KokoPaths? {
        // --- Packaged .app: koko lives next to the main executable ---
        if let execDir = Bundle.main.executableURL?.deletingLastPathComponent(),
           let resDir = Bundle.main.resourceURL {
            let koko   = execDir.appendingPathComponent("koko")
            let model  = resDir.appendingPathComponent("kokoro-v1.0.onnx")
            let voices = resDir.appendingPathComponent("voices-v1.0.bin")
            if FileManager.default.fileExists(atPath: koko.path),
               FileManager.default.fileExists(atPath: model.path),
               FileManager.default.fileExists(atPath: voices.path) {
                return KokoPaths(koko: koko, model: model, voices: voices)
            }
        }

        // --- Dev mode: resolve from the built executable path ---
        // Path is: macos/.build/<arch>-apple-macosx/release/Kokoro
        // Repo root is 4 levels up.
        let execURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardized
        let repoRoot = execURL
            .deletingLastPathComponent()  // release
            .deletingLastPathComponent()  // arch-apple-macosx
            .deletingLastPathComponent()  // .build
            .deletingLastPathComponent()  // macos

        let kokoArch = machineArch() == "arm64" ? "aarch64" : "x86_64"
        let koko   = repoRoot.appendingPathComponent("app/src-tauri/binaries/koko-\(kokoArch)-apple-darwin")
        let model  = repoRoot.appendingPathComponent("checkpoints/kokoro-v1.0.onnx")
        let voices = repoRoot.appendingPathComponent("data/voices-v1.0.bin")

        guard FileManager.default.fileExists(atPath: koko.path),
              FileManager.default.fileExists(atPath: model.path),
              FileManager.default.fileExists(atPath: voices.path) else {
            return nil
        }
        return KokoPaths(koko: koko, model: model, voices: voices)
    }

    private static func machineArch() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafePointer(to: &info.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
    }
}
