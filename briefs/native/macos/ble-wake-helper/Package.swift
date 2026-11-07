// swift-tools-version: 6.0
import PackageDescription

// The desktop's Bluetooth wake helper (macOS). The Electron main process launches it and
// talks to it over stdio JSON lines; it only advertises the service UUIDs main gives it.
let package = Package(
    name: "LanaBleWake",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "LanaBleWake",
            path: "Sources/LanaBleWake",
            // Embeds Info.plist (Bluetooth usage string) in the binary, as macOS expects of a bare tool.
            linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "Info.plist"])]
        ),
    ]
)
