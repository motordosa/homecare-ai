// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "HomeCareCore", platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "HomeCareCore", targets: ["HomeCareCore"])],
    targets: [.target(name: "HomeCareCore", path: "Core"),
              .testTarget(name: "HomeCareCoreTests", dependencies: ["HomeCareCore"], path: "Tests/HomeCareCoreTests")],
    swiftLanguageVersions: [.v5]
)
