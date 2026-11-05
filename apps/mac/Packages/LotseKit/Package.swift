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
        .package(url: "https://github.com/PostHog/posthog-ios.git", exact: "3.93.6")
    ],
    targets: modules.flatMap { name -> [Target] in
        var dependencies: [Target.Dependency] = [.product(name: "LotseProtocol", package: "swift")]
        if name == "LotseCore" {
            dependencies.append(.product(name: "PostHog", package: "posthog-ios"))
            dependencies += [.target(name: "LotseBridge"), .target(name: "LotseOverlay"), .target(name: "LotseVoice")]
        }
        return [
            .target(name: name, dependencies: dependencies),
            .testTarget(
                name: "\(name)Tests",
                dependencies: [.target(name: name)],
                resources: name == "LotseBridge" ? [.copy("Resources")] : []
            )
        ]
    },
    swiftLanguageModes: [.v6]
)
