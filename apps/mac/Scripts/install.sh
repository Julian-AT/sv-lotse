#!/usr/bin/env bash
# Builds the Release app and installs it as "/Applications/SV KI-Lotse.app".
# Signs with the local "Apple Development" identity when one exists (override: LOTSE_SIGN_IDENTITY=<SHA-1>).
# A stable signature keeps the privacy grants (screen recording, accessibility, input monitoring) across
# rebuilds; macOS binds them to the code signature, so an ad-hoc build loses them on every reinstall.
# Ad-hoc signing remains the fallback. Hardened runtime stays off for this local build: its library
# validation rejects the vendor-signed LiveKitWebRTC framework. Notarized releases keep it on.
set -euo pipefail

MAC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="SV KI-Lotse"
DESTINATION="${LOTSE_INSTALL_DIR:-/Applications}/$APP_NAME.app"
BUILD_DIR="$MAC_DIR/build/install"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

cd "$MAC_DIR"
xcodegen generate --quiet
IDENTITY="${LOTSE_SIGN_IDENTITY:-}"
IDENTITY_NAME=""
if [[ -z "$IDENTITY" ]]; then
  read -r IDENTITY IDENTITY_NAME < <(security find-identity -v -p codesigning 2>/dev/null \
    | awk '/"Apple Development/ { sha = $2; $1 = ""; $2 = ""; gsub(/^ +|"/, ""); print sha, $0; exit }') || true
fi
TEAM=""
if [[ -n "$IDENTITY" ]]; then
  TEAM="$(security find-certificate -c "${IDENTITY_NAME:-Apple Development}" -p 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]*\).*/\1/p')"
fi
if [[ -n "$IDENTITY" && -n "$TEAM" ]]; then
  echo "Signing with ${IDENTITY_NAME:-$IDENTITY} (team $TEAM)"
  SIGNING=(CODE_SIGN_IDENTITY="$IDENTITY" DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER=)
else
  echo "No Apple Development identity found; signing ad hoc (privacy grants reset on every reinstall)."
  IDENTITY="-"
  SIGNING=(CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=)
fi

xcodebuild -project SVKILotse.xcodeproj -scheme SVKILotse -configuration Release \
  -derivedDataPath "$BUILD_DIR" -destination "platform=macOS,arch=$(uname -m)" \
  "${SIGNING[@]}" ENABLE_HARDENED_RUNTIME=NO -quiet build

BUILT="$BUILD_DIR/Build/Products/Release/SVKILotse.app"
[[ -d "$BUILT" ]] || { echo "Build product missing: $BUILT" >&2; exit 1; }

# Re-sign nested code inside-out with the same identity (no --deep), then the app with its entitlements.
if [[ "$IDENTITY" != "-" ]] && ! codesign --verify --deep --strict "$BUILT" 2>/dev/null; then
  while IFS= read -r -d '' nested; do
    codesign --force --sign "$IDENTITY" --preserve-metadata=identifier,entitlements "$nested"
  done < <(find "$BUILT/Contents/Frameworks" -depth \( -name '*.xpc' -o -name '*.app' -o -name '*.framework' \
    -o -name '*.dylib' -o -name Autoupdate \) -print0 2>/dev/null)
  codesign --force --sign "$IDENTITY" --preserve-metadata=identifier,entitlements "$BUILT"
fi
codesign --verify --strict "$BUILT"

# Quit only the installed copy; a Debug run from Xcode with the same bundle ID stays untouched.
RUNNING="$DESTINATION/Contents/MacOS/SVKILotse"
if pgrep -qf "$RUNNING"; then
  pkill -TERM -f "$RUNNING" || true
  for _ in {1..20}; do pgrep -qf "$RUNNING" || break; sleep 0.5; done
  pkill -KILL -f "$RUNNING" || true
fi

rm -rf "$DESTINATION"
ditto "$BUILT" "$DESTINATION"
"$LSREGISTER" -f "$DESTINATION"
touch "$DESTINATION"
echo "Installed $DESTINATION"
