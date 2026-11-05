# SV KI-Lotse for macOS

Clicky-derived menu-bar companion for the web workspace. Requires macOS 14.2 or later,
Xcode with Swift 6, XcodeGen and SwiftLint. Upstream provenance and license are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

From the repository root:

```sh
cd apps/mac
xcodegen generate
open SVKILotse.xcodeproj
```

Select the `SVKILotse` scheme and run. Start the web workspace separately at
`http://localhost:3000`. The app shows a menu-bar item, the blue companion cursor,
and the workspace window. The workspace's close button hides it; use the menu to
show it again. Quit from the menu when finished.

Override `LOTSE_WORKSPACE_URL` in the launch environment or as an Xcode build
setting (written to Info.plist). The environment takes precedence. Only the exact
configured origin may use the native bridge. Authentication cookies persist in
the workspace's dedicated WebKit data store.

The menu's “Sprechtaste aktivieren” explains and requests input-monitoring access.
Hold Control–Option for on-device German Apple Speech input; release to finish.
Microphone and Speech permissions are requested on first use. Install German
on-device speech recognition if it is unavailable. No screen capture permission
is requested until a future explicit capture action uses that capability.

Analytics is off by default. To use it, configure `POSTHOG_HOST` (HTTPS) and
`POSTHOG_PROJECT_TOKEN` in the app's environment, then enable “Nutzungsstatistik
erlauben” in the menu. There is no built-in analytics host or token. Disabling
consent stops the SDK. Events carry no transcript, document or form content.

Sparkle is linked through SPM. Release builds supply `SUFeedURL` and `SUPublicEDKey`
through `project.yml`, and sign updates with the release key outside the app.
Automatic update checks are disabled in this development configuration.

Unsigned build and tests, from the repository root:

```sh
swift test --package-path apps/mac/Packages/LotseKit
xcodebuild -project apps/mac/SVKILotse.xcodeproj -scheme SVKILotse -destination 'platform=macOS' -derivedDataPath .build/dd CODE_SIGNING_ALLOWED=NO build test
swiftlint lint --strict --config apps/mac/.swiftlint.yml apps/mac/Packages
bash apps/mac/Scripts/check-source-boundaries.sh
```

The package tests include real WebKit/HTTP integration tests; run them in a logged-in
macOS GUI session. `SVKILotseTests` in the app scheme checks its bundled launch and
permission configuration. Module responsibilities and extension rules are in [AGENTS.md](AGENTS.md).
