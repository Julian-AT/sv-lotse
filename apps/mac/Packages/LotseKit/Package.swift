// swift-tools-version: 6.0
import PackageDescription

let modules = [
    "LotseCore", "LotseBridge", "LotseOverlay", "LotseVoice", "LotseCapture",
    "LotseResolver", "LotseImport", "LotseGuidedWindow", "LotseRelatives"
]
let package = Package(
    name: "LotseKit",
    platforms: [.macOS("14.2")],
    products: modules.map { .library(name: $0, targets: [$0]) },
    dependencies: [
        .package(path: "../../../../packages/protocol/swift"),
        .package(url: "https://github.com/PostHog/posthog-ios.git", exact: "3.93.6"),
        .package(url: "https://github.com/livekit/client-sdk-swift.git", exact: "2.19.0")
    ],
    targets: modules.flatMap { name -> [Target] in
        var dependencies: [Target.Dependency] = [.product(name: "LotseProtocol", package: "swift")]
        if name == "LotseCore" {
            dependencies.append(.product(name: "PostHog", package: "posthog-ios"))
            dependencies += [
                .target(name: "LotseBridge"), .target(name: "LotseOverlay"),
                .target(name: "LotseVoice"), .target(name: "LotseResolver"), .target(name: "LotseCapture"),
                .target(name: "LotseGuidedWindow"), .target(name: "LotseImport"), .target(name: "LotseRelatives")
            ]
        }
        if name == "LotseRelatives" {
            dependencies += [
                .product(name: "LiveKit", package: "client-sdk-swift"),
                .target(name: "LotseBridge"), .target(name: "LotseOverlay")
            ]
        }
        if name == "LotseGuidedWindow" || name == "LotseBridge" {
            dependencies.append(.target(name: "LotseImport"))
        }
        let resources: [Resource]
        if ["LotseCapture", "LotseGuidedWindow"].contains(name) {
            resources = [.copy("Resources")]
        } else if name == "LotseVoice" {
            resources = [.copy("Resources/voice-vocabulary.json")]
        } else if name == "LotseImport" {
            resources = [.copy("Resources/mac-capture-exclusions.json")]
        } else if name == "LotseCore" {
            resources = [.copy("Resources/capture-exclusions.json"), .copy("Resources/sv-logo.png")]
        } else {
            resources = []
        }
        return [
            .target(
                name: name, dependencies: dependencies,
                resources: resources
            ),
            .testTarget(
                name: "\(name)Tests",
                dependencies: [.target(name: name)],
                resources: name == "LotseBridge" ? [.copy("Resources")] : []
            )
        ]
    },
    swiftLanguageModes: [.v6]
)
