# Palm Tree Pet

A desktop pet palm tree. Click an old (brown) leaf. The little gardener climbs up, cuts it, and it falls. Old leaves grow back over time.

## Run it (first time)

1. Install Node.js (LTS) from https://nodejs.org if you don't have it.
2. In Terminal:
   ```
   cd "~/Desktop/thesis yr/thesis/palm tree/game"
   npm install
   npm start
   ```
After that, only `npm start` is needed.

## Controls

- **Click an old leaf** to queue it for cutting (you can click several)
- **Drag the trunk or green leaves** to move the tree
- **Click the gardener** to make them hop
- **Palm icon in the menu bar** → regrow now, regrow speed, size (1x/2x/3x), sound, quit

## Swapping in your art

- Tree art lives in `assets/`. Re-export from Aseprite with the same names (full 128×400 canvas, untrimmed) and restart.
- The gardener is a placeholder drawn in code (`FR` in `src/game.js`). Replace it with your own sprite sheet later.
- Leaf attach points are in `PIVOTS` in `src/game.js`.
