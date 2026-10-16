#!/bin/bash
# Build "Keystroke Loom.app" + a .zip to AirDrop to testers (same steps as Palm Tree Pet).
# Run from Terminal inside the app folder:   bash build-mac.sh
set -e
cd "$(dirname "$0")"

APP="Keystroke Loom"
BUNDLE_ID="edu.artcenter.keystrokeloom"
VERSION=$(node -p "require('./package.json').version")
SRC_APP="node_modules/electron/dist/Electron.app"
OUT="dist"
A="$OUT/$APP.app"

if [ ! -d "$SRC_APP" ]; then
  echo "❌ Can't find $SRC_APP — run 'npm install' first."; exit 1
fi

echo "1/6  Copying Electron…"
rm -rf "$OUT"; mkdir -p "$OUT"
ditto "$SRC_APP" "$A"
R="$A/Contents/Resources"
rm -f "$R/default_app.asar"

echo "2/6  Adding the loom…"
mkdir -p "$R/app/node_modules"
cp package.json main.js preload.js "$R/app/"
ditto src "$R/app/src"
ditto assets "$R/app/assets"
# the keyboard listener is a native module, so it has to travel with the app
for m in uiohook-napi node-gyp-build; do
  [ -d "node_modules/$m" ] && ditto "node_modules/$m" "$R/app/node_modules/$m"
done

echo "3/6  Removing unused languages…"
LP="$A/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources"
find "$LP" -maxdepth 1 -name "*.lproj" ! -name "en.lproj" ! -name "en_GB.lproj" ! -name "zh_CN.lproj" ! -name "zh_TW.lproj" -exec rm -rf {} +

echo "4/6  App name, version, no Dock icon…"
PL="$A/Contents/Info.plist"
plutil -replace CFBundleName -string "$APP" "$PL"
plutil -replace CFBundleDisplayName -string "$APP" "$PL"
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$PL"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PL"
plutil -replace CFBundleVersion -string "$VERSION" "$PL"
plutil -replace LSUIElement -bool true "$PL"

if [ -f assets/app-icon-1024.png ]; then
  echo "     App icon…"
  ICONSET="$OUT/icon.iconset"; mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s assets/app-icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    d=$((s*2)); sips -z $d $d assets/app-icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$R/electron.icns"; rm -rf "$ICONSET"
fi

echo "5/6  Signing (ad-hoc, so it runs on Apple Silicon)…"
xattr -cr "$A"
codesign --force --deep --sign - "$A" 2>/dev/null
codesign --verify --deep "$A" && echo "     signature OK"

echo "6/6  Zipping…"
ditto -c -k --sequesterRsrc --keepParent "$A" "$OUT/$APP.zip"

echo ""
echo "✅ Done:  $A   and   $OUT/$APP.zip"
open "$OUT"
