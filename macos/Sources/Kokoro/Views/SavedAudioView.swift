import SwiftUI

struct SavedAudioView: View {
    @State private var manager = AudioFileManager()
    @State private var pendingDeletePath = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header bar
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Library").font(.title2).fontWeight(.semibold)
                    Text("Saved WAV files from synthesis.")
                        .foregroundStyle(.secondary).font(.callout)
                }
                Spacer()
                Button {
                    manager.load()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(manager.isLoading)
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)

            Divider()

            if !manager.errorMessage.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                    Text(manager.errorMessage).font(.callout).foregroundStyle(.red)
                }
                .padding(12)
            }

            if !manager.playerError.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    Text(manager.playerError).font(.callout).foregroundStyle(.orange)
                }
                .padding(.horizontal, 12)
            }

            if manager.isLoading {
                HStack {
                    Spacer()
                    ProgressView("Loading…").padding(40)
                    Spacer()
                }
            } else if manager.files.isEmpty {
                HStack {
                    Spacer()
                    VStack(spacing: 8) {
                        Image(systemName: "waveform.slash")
                            .font(.largeTitle).foregroundStyle(.tertiary)
                        Text("No saved audio yet.")
                            .foregroundStyle(.secondary)
                    }
                    .padding(60)
                    Spacer()
                }
            } else {
                List(manager.files) { file in
                    FileRow(
                        file: file,
                        isPlaying: manager.playingPath == file.path,
                        isPendingDelete: pendingDeletePath == file.path,
                        onPlay: {
                            if manager.playingPath == file.path {
                                manager.stopPlayback()
                            } else {
                                manager.play(file)
                            }
                        },
                        onReveal:  { manager.revealInFinder(file) },
                        onDelete:  {
                            if pendingDeletePath == file.path {
                                manager.delete(file)
                                pendingDeletePath = ""
                            } else {
                                pendingDeletePath = file.path
                            }
                        },
                        onCancelDelete: { pendingDeletePath = "" }
                    )
                }
                .listStyle(.plain)
            }
        }
        .onAppear { manager.load() }
    }
}

private struct FileRow: View {
    let file: SavedAudioFile
    let isPlaying: Bool
    let isPendingDelete: Bool
    let onPlay:         () -> Void
    let onReveal:       () -> Void
    let onDelete:       () -> Void
    let onCancelDelete: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            // Play / pause
            Button(action: onPlay) {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.title2)
                    .foregroundStyle(isPlaying ? Color.accentColor : Color.secondary)
            }
            .buttonStyle(.plain)

            // Name + metadata
            VStack(alignment: .leading, spacing: 2) {
                Text(file.name)
                    .font(.callout).lineLimit(1).truncationMode(.middle)
                HStack(spacing: 8) {
                    if let date = file.modifiedDate {
                        Text(date, format: .dateTime.month().day().hour().minute())
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                    Text(formatSize(file.sizeBytes))
                        .font(.caption2).foregroundStyle(.tertiary)
                }
            }

            Spacer()

            // Action buttons
            HStack(spacing: 4) {
                Button(action: onReveal) {
                    Image(systemName: "arrow.up.right.square")
                }
                .buttonStyle(.borderless)
                .help("Show in Finder")

                if isPendingDelete {
                    Button("Confirm?", role: .destructive, action: onDelete)
                        .font(.caption).buttonStyle(.borderedProminent)
                        .tint(.red)
                    Button(action: onCancelDelete) {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.borderless)
                } else {
                    Button(action: onDelete) {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.red.opacity(0.8))
                    .help("Delete")
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func formatSize(_ bytes: Int64) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        let kib = Double(bytes) / 1024
        if kib < 1024 { return String(format: "%.1f KB", kib) }
        return String(format: "%.1f MB", kib / 1024)
    }
}
