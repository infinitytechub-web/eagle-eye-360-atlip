// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.6.2"),
        .package(name: "CapacitorCommunityKeepAwake", path: "../../../node_modules/.pnpm/@capacitor-community+keep-awake@8.0.1_@capacitor+core@8.6.2/node_modules/@capacitor-community/keep-awake"),
        .package(name: "CapacitorCommunityTextToSpeech", path: "../../../node_modules/.pnpm/@capacitor-community+text-to-speech@8.0.2_@capacitor+core@8.6.2/node_modules/@capacitor-community/text-to-speech"),
        .package(name: "CapacitorApp", path: "../../../node_modules/.pnpm/@capacitor+app@8.1.2_@capacitor+core@8.6.2/node_modules/@capacitor/app"),
        .package(name: "CapacitorBrowser", path: "../../../node_modules/.pnpm/@capacitor+browser@8.0.5_@capacitor+core@8.6.2/node_modules/@capacitor/browser"),
        .package(name: "CapacitorGeolocation", path: "../../../node_modules/.pnpm/@capacitor+geolocation@8.2.5_@capacitor+core@8.6.2/node_modules/@capacitor/geolocation"),
        .package(name: "CapacitorSplashScreen", path: "../../../node_modules/.pnpm/@capacitor+splash-screen@8.0.2_@capacitor+core@8.6.2/node_modules/@capacitor/splash-screen"),
        .package(name: "CapacitorStatusBar", path: "../../../node_modules/.pnpm/@capacitor+status-bar@8.0.4_@capacitor+core@8.6.2/node_modules/@capacitor/status-bar")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCommunityKeepAwake", package: "CapacitorCommunityKeepAwake"),
                .product(name: "CapacitorCommunityTextToSpeech", package: "CapacitorCommunityTextToSpeech"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorGeolocation", package: "CapacitorGeolocation"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar")
            ]
        )
    ]
)
