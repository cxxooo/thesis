Put the white glyphs exported from Figma here. The loom uses them as soon as they appear
(no restart needed). Until a file is here, the loom draws a built-in stand-in.

File names (exactly):
  cmd.svg     ⌘ glyph
  ctrl.svg    Ctrl wave
  shift.svg   Shift arrow
  space.svg   space bracket
  knot.svg    the orange knot

How to export so the position is exact:
  1. In Figma, select the whole 40×40 cell frame, not just the glyph inside it.
     ⌘     e.g. frame 185:8314 (first cell of the ⌘ row in "test2")
     Ctrl  e.g. frame 185:8740
     Shift e.g. frame 185:8882
     space frame 185:8420
     knot  frame 185:7831 (in "loom - example 1")
  2. Hide the coloured fill of that frame (eye icon on the Fill in the right panel),
     so only the white glyph is left on a transparent background.
     The knot keeps its orange colour.
  3. Export → SVG → Export. Rename the file to the name above and drop it in this folder.
  4. Undo the hidden fill in Figma afterwards.

Because every file is the full 40×40 frame, the glyph lands in exactly the same spot as in Figma.
