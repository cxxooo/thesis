#!/bin/bash
# Build "Palm Tree Pet.app" + a .zip to AirDrop to testers.
# Run from Terminal inside the game folder:   bash build-mac.sh
# Output: dist/Palm Tree Pet.app  and  dist/Palm Tree Pet.zip
set -e
cd "$(dirname "$0")"

APP="Palm Tree Pet"
BUNDLE_ID="edu.artcenter.palmtreepet"
VERSION=$(node -p "require('./package.json').version")
SRC_APP="node_modules/electron/dist/Electron.app"
OUT="dist"
A="$OUT/$APP.app"

if [ ! -d "$SRC_APP" ]; then
  echo "❌ Can't find $SRC_APP — run 'npm start' once first to make sure Electron is installed."; exit 1
fi

echo "1/7  Copying Electron…"
rm -rf "$OUT"; mkdir -p "$OUT"
ditto "$SRC_APP" "$A"
R="$A/Contents/Resources"
rm -f "$R/default_app.asar"

echo "2/7  Adding the game (only the files it needs)…"
mkdir -p "$R/app"
cp package.json main.js preload.js analytics.js analytics-config.json "$R/app/"
ditto src "$R/app/src"
ditto assets "$R/app/assets"
rm -f "$R/app/assets/app-icon-1024.png" "$R/app/assets/tray-source.png"

echo "3/7  Removing unused languages (keeps English + Chinese)…"
LP="$A/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources"
find "$LP" -maxdepth 1 -name "*.lproj" ! -name "en.lproj" ! -name "en_GB.lproj" ! -name "zh_CN.lproj" ! -name "zh_TW.lproj" -exec rm -rf {} +

echo "4/7  App name, version, no Dock icon…"
PL="$A/Contents/Info.plist"
plutil -replace CFBundleName -string "$APP" "$PL"
plutil -replace CFBundleDisplayName -string "$APP" "$PL"
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$PL"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$PL"
plutil -replace CFBundleVersion -string "$VERSION" "$PL"
plutil -replace LSUIElement -bool true "$PL"          # menu bar app: no Dock icon

echo "5/7  App icon…"
ICONSET="$OUT/icon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s assets/app-icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s*2)); sips -z $d $d assets/app-icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$R/electron.icns"
rm -rf "$ICONSET"

echo "6/7  Signing (ad-hoc, so it runs on Apple Silicon)…"
xattr -cr "$A"
codesign --force --deep --sign - "$A" 2>/dev/null
codesign --verify --deep "$A" && echo "     signature OK"

echo "7/7  Zipping for AirDrop…"
ditto -c -k --sequesterRsrc --keepParent "$A" "$OUT/$APP.zip"

echo ""
echo "✅ Done!"
echo "   App:  $(du -sh "$A" | cut -f1)   $A"
echo "   Zip:  $(du -sh "$OUT/$APP.zip" | cut -f1)   $OUT/$APP.zip   ← AirDrop this"
echo "   Chip: $(lipo -archs "$A/Contents/MacOS/Electron")  (arm64 = Apple Silicon Macs: M1/M2/M3/M4)"
open "$OUT"
