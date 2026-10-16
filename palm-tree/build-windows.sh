#!/bin/bash
# Build a Windows version of Palm Tree Pet — run on your Mac:   bash build-windows.sh
# Output: dist/Palm Tree Pet-Windows.zip   (friends unzip it and run "Palm Tree Pet.exe")
# Note: AirDrop doesn't work with Windows PCs — send the zip via Google Drive, WeTransfer, or a USB stick.
set -e
cd "$(dirname "$0")"

APP="Palm Tree Pet"
VERSION=$(node -p "require('./package.json').version")
EV=$(node -p "require('./node_modules/electron/package.json').version")   # same Electron version as the Mac app
ZIP_NAME="electron-v$EV-win32-x64.zip"
CACHE="${ELECTRON_WIN_ZIP_DIR:-$HOME/Library/Caches/palm-tree-pet}"
OUT="dist/win"
W="$OUT/$APP"

echo "1/7  Getting Electron $EV for Windows (x64)…"
mkdir -p "$CACHE"
if [ ! -f "$CACHE/$ZIP_NAME" ]; then
  curl -fL --progress-bar -o "$CACHE/$ZIP_NAME.part" "https://github.com/electron/electron/releases/download/v$EV/$ZIP_NAME"
  mv "$CACHE/$ZIP_NAME.part" "$CACHE/$ZIP_NAME"
fi
EXPECTED=$(node -p "require('./node_modules/electron/checksums.json')['$ZIP_NAME']")
GOT=$(shasum -a 256 "$CACHE/$ZIP_NAME" | cut -d' ' -f1)
if [ "$EXPECTED" != "$GOT" ]; then echo "❌ Download is damaged (checksum mismatch). Delete $CACHE/$ZIP_NAME and run again."; exit 1; fi
echo "     checksum OK"

echo "2/7  Unpacking…"
rm -rf "$OUT" "dist/$APP-Windows.zip"; mkdir -p "$W"
unzip -q "$CACHE/$ZIP_NAME" -d "$W"
rm -f "$W/resources/default_app.asar"
mv "$W/electron.exe" "$W/$APP.exe"

echo "3/7  Adding the game (only the files it needs)…"
mkdir -p "$W/resources/app"
cp package.json main.js preload.js analytics.js analytics-config.json "$W/resources/app/"
cp -R src assets "$W/resources/app/"
rm -f "$W/resources/app/assets/app-icon-1024.png" "$W/resources/app/assets/tray-source.png"
find "$W" -name ".DS_Store" -delete

echo "4/7  Removing unused languages (keeps English + Chinese)…"
find "$W/locales" -name "*.pak" ! -name "en-US.pak" ! -name "en-GB.pak" ! -name "zh-CN.pak" ! -name "zh-TW.pak" -delete

echo "5/7  Icon + name on the .exe…"
if [ ! -d .build-tools/node_modules/resedit ]; then
  mkdir -p .build-tools && echo '{"name":"build-tools","private":true}' > .build-tools/package.json
  (cd .build-tools && npm i resedit@2 pe-library@1 --silent >/dev/null)
fi
NODE_PATH="$PWD/.build-tools/node_modules" node tools/windows-exe.js "$W/$APP.exe" assets/app-icon.ico "$VERSION" "$APP"

echo "6/7  Adding instructions…"
cp HOW-TO-OPEN-WINDOWS.txt "$W/HOW TO OPEN.txt"

echo "7/7  Zipping…"
(cd "$OUT" && zip -qr -X "../$APP-Windows.zip" "$APP")

echo ""
echo "✅ Done!"
echo "   Zip: $(du -sh "dist/$APP-Windows.zip" | cut -f1)   dist/$APP-Windows.zip"
echo "   Send it via Google Drive / WeTransfer / USB (AirDrop can't send to Windows)."
[ "$(uname)" = "Darwin" ] && open dist || true
