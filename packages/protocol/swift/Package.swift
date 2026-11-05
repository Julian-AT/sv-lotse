// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LotseProtocol",
    platforms: [.macOS(.v14)],
    products: [.library(name: "LotseProtocol", targets: ["LotseProtocol"])],
    targets: [
        .target(name: "LotseProtocol"),
        .testTarget(name: "LotseProtocolTests", dependencies: ["LotseProtocol"]),
        // Isolate the synthetic generated types from the frozen protocol module.
        .testTarget(name: "SwiftValidationGeneratorTests")
    ],
    swiftLanguageModes: [.v6]
)
