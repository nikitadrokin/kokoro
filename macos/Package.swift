// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Kokoro",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "Kokoro",
            path: "Sources/Kokoro"
        )
    ]
)
