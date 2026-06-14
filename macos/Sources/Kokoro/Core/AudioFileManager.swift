import AppKit
import AVFoundation
import Foundation

struct SavedAudioFile: Identifiable, Sendable {
    var id: String { path }
    let name: String
    let path: String
    let modifiedDate: Date?
    let sizeBytes: Int64
}

@MainActor @Observable
final class AudioFileManager {
    var files:        [SavedAudioFile] = []
    var isLoading     = false
    var errorMessage  = ""
    var playingPath   = ""
    var playerError   = ""

    private var audioPlayer: AVAudioPlayer?

    func load() {
        isLoading    = true
        errorMessage = ""

        let baseDir = KokoSynthesizer.synthesisDirectory
        Task.detached {
            var collected: [SavedAudioFile] = []
            collect(from: baseDir, base: baseDir, into: &collected)
            collected.sort {
                ($0.modifiedDate ?? .distantPast) > ($1.modifiedDate ?? .distantPast)
            }
            await MainActor.run {
                self.files     = collected
                self.isLoading = false
            }
        }
    }

    func delete(_ file: SavedAudioFile) {
        do {
            try FileManager.default.removeItem(atPath: file.path)
            files.removeAll { $0.path == file.path }
            // Also remove companion .tsv if present
            let tsv = (file.path as NSString).deletingPathExtension + ".tsv"
            try? FileManager.default.removeItem(atPath: tsv)
        } catch {
            errorMessage = "Could not delete file: \(error.localizedDescription)"
        }
    }

    func revealInFinder(_ file: SavedAudioFile) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: file.path)])
    }

    func play(_ file: SavedAudioFile) {
        playerError = ""
        stopPlayback()
        do {
            let player = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: file.path))
            player.play()
            audioPlayer = player
            playingPath = file.path
        } catch {
            playerError = error.localizedDescription
        }
    }

    func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
        playingPath = ""
    }
}

private func collect(from dir: URL, base: URL, into files: inout [SavedAudioFile]) {
    guard let entries = try? FileManager.default.contentsOfDirectory(
        at: dir, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey, .isDirectoryKey]
    ) else { return }

    for entry in entries {
        let isDir = (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        if isDir {
            collect(from: entry, base: base, into: &files)
            continue
        }
        guard entry.pathExtension.lowercased() == "wav" else { continue }

        let attrs    = try? entry.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let modified = attrs?.contentModificationDate
        let size     = Int64(attrs?.fileSize ?? 0)
        let name     = entry.path.hasPrefix(base.path)
            ? String(entry.path.dropFirst(base.path.count + 1))
            : entry.lastPathComponent

        files.append(SavedAudioFile(name: name, path: entry.path, modifiedDate: modified, sizeBytes: size))
    }
}
