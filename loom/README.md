# Keystroke Loom

A loom that sits on your desktop and weaves whatever you type, in any app.
Built the same way as Palm Tree Pet: Electron, a transparent always-on-top window, and a menu bar icon.

## Run it (first time)

Open Terminal and run:

```
cd "/Users/xinxincui/Desktop/thesis yr/thesis/loom/app"
npm install
npm start
```

After the first time, `npm start` is enough.

If `npm start` says "Electron failed to install correctly": newer npm skips install scripts,
so Electron itself was never downloaded. Run this once, then `npm start` again:

```
node node_modules/electron/install.js
```

## Permission to read typing

To weave from every app, macOS has to allow it. The first time you start the loom:

1. macOS asks to give "Electron" Accessibility access. Click **Open System Settings**.
2. In **Privacy & Security → Accessibility**, turn on **Electron**.
3. If macOS also asks about **Input Monitoring**, turn Electron on there too.
4. The loom starts weaving within a few seconds. If it doesn't, quit (menu bar icon → Quit) and run `npm start` again.

Until permission is given, the loom still weaves while it is the focused window.
The menu bar icon shows which mode it is in.

macOS hides typing in password fields from every app, so passwords are never woven.

## Weaving rules (from the Figma file)

- Colour = the key's column, shape = the key's row:
  number row = bar, Q row = square, A row = circle, Z row = "\".
- The Z row is shifted one column (⌘ sits in column 0), so Z is column 1 and "." is column 9.
- ⌘ / Ctrl / Shift + a key weaves two cells: a square in the key's colour with the white glyph, then the key's own cell.
- Space weaves one yellow cell with the white bracket.
- A modifier key pressed on its own weaves nothing. Keys not on the chart (Enter, arrows, - = [ ] ' /) weave nothing.
- Backspace weaves nothing new: it turns the colour of the last keystroke light grey (white glyphs stay).
  A modifier + key pair turns grey together. Each press greys one more keystroke going back.
- Holding a key down weaves it once. Holding Backspace keeps greying, like a real deletion.
- The loom starts as an empty square. Click it once to tie the knot (bottom right); weaving starts then.
  Nothing is woven before the knot is tied.
- Rows start above the knot: first row right → left, next row left → right, and so on upwards.
- The square shows 7 rows. When the cloth is taller, the oldest rows roll down out of view.
- Double-click the loom to see the whole cloth (it grows upwards). The menu bar then shows **Download PDF**.
  Double-click again to go back to the square.

## Menu bar

- **Weaving**: untick to pause.
- **Download PDF** (only while the whole cloth is shown): saves the whole cloth as a PDF on the Desktop.
- **Save image to Desktop**: PNG of the whole cloth at 2×.
- **Clear loom…**: removes the cloth and unties the knot.
- **Size**: Small / Medium / Large (Medium is the default, half the Figma size).
- **Testing → Save backup to Desktop**: a tiny text file (`.loom`) with every cell, about 3 bytes per keystroke.
- **Testing → Open backup…**: puts a saved cloth back on the loom.

The cloth is saved between launches (in `~/Library/Application Support/keystroke-loom/state.json`).

## Glyphs from Figma

See `assets/glyphs/README.txt`.

## Build an app to share

```
bash build-mac.sh
```

Makes `dist/Keystroke Loom.app` and a zip. People who open the built app give Accessibility
permission to "Keystroke Loom" instead of "Electron".
