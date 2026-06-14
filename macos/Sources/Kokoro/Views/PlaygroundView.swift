import AppKit
import SwiftUI

struct PlaygroundView: View {
    @State private var synthesizer = KokoSynthesizer()
    @AppStorage("playground.text")  private var text  = ""
    @AppStorage("playground.style") private var style = "af_heart"
    @AppStorage("playground.speed") private var speed = 1.0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    Text("Playground")
                        .font(.title2).fontWeight(.semibold)
                    Text("Enter text and generate speech using a local Kokoro model.")
                        .foregroundStyle(.secondary).font(.callout)
                }

                // Text editor
                GroupBox {
                    TextEditor(text: $text)
                        .font(.body)
                        .frame(minHeight: 160)
                        .scrollContentBackground(.hidden)
                        .background(.clear)
                } label: {
                    Label("Text", systemImage: "text.alignleft")
                        .font(.caption).foregroundStyle(.secondary)
                }

                // Controls row
                HStack(alignment: .top, spacing: 24) {
                    // Voice
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Voice").font(.caption).foregroundStyle(.secondary)
                        Picker("Voice", selection: $style) {
                            ForEach(voiceOptions) { voice in
                                Text(voice.label + (voice.badge.map { " · \($0)" } ?? ""))
                                    .tag(voice.value)
                            }
                        }
                        .labelsHidden()
                        .frame(minWidth: 160)
                    }

                    // Speed
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Speed").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Text(String(format: "%.2gx", speed))
                                .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                        }
                        Slider(value: $speed, in: 0.7...1.4, step: 0.05)
                            .frame(minWidth: 140)
                    }
                }

                // Error banner
                if !synthesizer.errorMessage.isEmpty {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                        Text(synthesizer.errorMessage).font(.callout).foregroundStyle(.red)
                    }
                    .padding(10)
                    .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }

                // Generate / Stop button
                HStack(spacing: 10) {
                    Button {
                        if synthesizer.isGenerating {
                            synthesizer.stopGeneration()
                        } else {
                            synthesizer.generate(text: text, style: style, speed: Float(speed))
                        }
                    } label: {
                        Label(
                            synthesizer.isGenerating ? "Stop" : "Save audio",
                            systemImage: synthesizer.isGenerating ? "stop.fill" : "arrow.down.circle"
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                              && !synthesizer.isGenerating)
                    .keyboardShortcut(.return, modifiers: .command)

                    if synthesizer.isGenerating {
                        ProgressView().scaleEffect(0.7)
                    }
                }

                // Result: saved file
                if !synthesizer.savedOutputPath.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                            Text(URL(fileURLWithPath: synthesizer.savedOutputPath).lastPathComponent)
                                .font(.callout).lineLimit(1).truncationMode(.middle)
                        }

                        HStack(spacing: 8) {
                            Button {
                                synthesizer.play()
                            } label: {
                                Label("Play", systemImage: "play.fill")
                            }
                            .buttonStyle(.bordered)

                            Button {
                                NSWorkspace.shared.activateFileViewerSelecting(
                                    [URL(fileURLWithPath: synthesizer.savedOutputPath)]
                                )
                            } label: {
                                Label("Show in Finder", systemImage: "arrow.up.right.square")
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(12)
                    .background(.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(20)
        }
    }
}
