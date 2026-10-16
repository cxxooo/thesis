// Keystroke Loom — drawing the cloth
// Geometry comes from the Figma file "thesis" (page "weaving"):
//   The loom is a 360×360 square: 10 warp threads, 40px apart, colour #f0e1d8 ("loom" frame).
//   The first click ties the knot at the bottom right and weaving starts ("first knot" frame).
//   Each cell is 40×40, centred on a warp thread.
//   Weaving starts in the row just above the knot, goes right→left,
//   the next row left→right, and so on upwards.
//   Double-click shows the whole cloth (the tall "loom" frame); double-click again returns to the square.
//
// Cell codes (stored in state.json):
//   b<col> bar (number row)   s<col> square (Q row)   c<col> circle (A row)   d<col> "\" (Z row)
//   M<col> ⌘ cell   C<col> Ctrl cell   S<col> Shift cell   _ space
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#c1d980', '#377f40', '#0aaac1', '#aecce6', '#d7cec7', '#d2b2f5', '#ff7daf', '#ea2f16', '#ff6920', '#fbbb01'];
  const SPACE_COLOR = '#fbbb01';
  const GREY = '#e6e2df';   // colour of deleted keystrokes (Backspace); not in Figma yet, placeholder
  const WARP = '#f0e1d8';
  const GROUND = '#f4f4f4'; // Figma canvas colour, used as the background of saved images
  const CELL = 40, COLS = 10;
  const SQUARE = 360;              // the loom is a square until double-clicked
  const KNOT_FROM_BOTTOM = 59;     // knot frame top is at 301 in the 360px frame
  const TOP_MARGIN = 20;           // space above the top row when the whole cloth is shown

  const svg = document.getElementById('loom');
  let cells = [];
  let glyphFiles = {};
  let started = false;             // the knot is tied on the first click
  let expanded = false;            // double-click: show the whole cloth

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  // ---------- glyphs: Figma SVG files when present, built-in drawings otherwise ----------
  // ⌘ is rebuilt from the exact Figma numbers (5 boxes, 11.852px, 4.444px stroke, 5.926px corners).
  // ctrl / shift / space / knot are close stand-ins until the exported SVGs are added to assets/glyphs/.
  function rr(x, y, w, h, r, [tl, tr, br, bl]) {
    const a = (on) => (on ? r : 0);
    const [TL, TR, BR, BL] = [a(tl), a(tr), a(br), a(bl)];
    return `M${x + TL},${y}H${x + w - TR}${TR ? `A${TR},${TR} 0 0 1 ${x + w},${y + TR}` : ''}V${y + h - BR}`
      + `${BR ? `A${BR},${BR} 0 0 1 ${x + w - BR},${y + h}` : ''}H${x + BL}${BL ? `A${BL},${BL} 0 0 1 ${x},${y + h - BL}` : ''}`
      + `V${y + TL}${TL ? `A${TL},${TL} 0 0 1 ${x + TL},${y}` : ''}Z`;
  }
  const BUILT_IN = {
    cmd(g) {
      const s = 4.444, box = 11.852, inner = box - s, r = 5.926 - s / 2;
      const b = (x, y, c) => el('path', { d: rr(x + s / 2, y + s / 2, inner, inner, r, c), fill: 'none', stroke: '#fff', 'stroke-width': s }, g);
      b(2.22, 2.22, [1, 1, 0, 1]); b(25.93, 2.22, [1, 1, 1, 0]);
      b(2.22, 25.93, [1, 0, 1, 1]); b(25.93, 25.93, [0, 1, 1, 1]);
      b(14.07, 14.07, [0, 0, 0, 0]);
    },
    ctrl(g) {
      el('path', { d: 'M0 26 C8 26 12 13 20 13 S32 26 40 26', fill: 'none', stroke: '#fff', 'stroke-width': 4.444, 'stroke-linecap': 'round' }, g);
    },
    shift(g) {
      el('path', { d: 'M20 6.5 L33.5 20 H26.5 V33.5 H13.5 V20 H6.5 Z', fill: 'none', stroke: '#fff', 'stroke-width': 4, 'stroke-linejoin': 'round' }, g);
    },
    space(g) {
      el('path', { d: 'M4.44 14.22 V21 Q4.44 24.07 7.5 24.07 H32.5 Q35.56 24.07 35.56 21 V14.22', fill: 'none', stroke: '#fff', 'stroke-width': 4.444, 'stroke-linecap': 'round' }, g);
    },
    knot(g) {
      el('ellipse', { cx: 17, cy: 26, rx: 10, ry: 6.5, fill: '#ff9356' }, g);
      el('path', { d: 'M22 24 C27 20 26 12 34 11', fill: 'none', stroke: '#ff9356', 'stroke-width': 5, 'stroke-linecap': 'round' }, g);
    },
  };
  function buildDefs(root) {
    const defs = el('defs', {}, root);
    for (const name of Object.keys(BUILT_IN)) {
      const sym = el('symbol', { id: 'g-' + name, viewBox: '0 0 40 40', overflow: 'visible' }, defs);
      if (glyphFiles[name]) el('image', { href: glyphFiles[name], x: 0, y: 0, width: 40, height: 40 }, sym);
      else BUILT_IN[name](sym);
    }
    return defs;
  }

  // ---------- one cell, drawn in a 40×40 box at (0,0) ----------
  function drawCell(g, code) {
    const deleted = code[0] === '~';
    if (deleted) code = code.slice(1);
    const t = code[0], col = Number(code.slice(1));
    const color = deleted ? GREY : COLORS[col];
    const SPACE = deleted ? GREY : SPACE_COLOR;
    const glyph = (name) => el('use', { href: '#g-' + name, x: 0, y: 0, width: 40, height: 40 }, g);
    switch (t) {
      case 'b': el('rect', { x: 15, y: 0, width: 10, height: 40, fill: color }, g); break;
      case 's': el('rect', { x: 0, y: 0, width: 40, height: 40, fill: color }, g); break;
      case 'c': el('circle', { cx: 20, cy: 20, r: 20, fill: color }, g); break;
      case 'd': el('rect', { x: 15, y: 0, width: 10, height: 40, fill: color, transform: 'rotate(-45 20 20)' }, g); break;
      case '_': el('rect', { x: 0, y: 0, width: 40, height: 40, fill: SPACE }, g); glyph('space'); break;
      case 'M': case 'C': case 'S':
        el('rect', { x: 0, y: 0, width: 40, height: 40, fill: color }, g);
        glyph({ M: 'cmd', C: 'ctrl', S: 'shift' }[t]);
        break;
    }
  }

  // position of the n-th cell: boustrophedon from bottom right
  const place = (i) => {
    const row = Math.floor(i / COLS), pos = i % COLS;
    return { row, col: row % 2 === 0 ? COLS - 1 - pos : pos, dir: row % 2 === 0 ? -1 : 1 };
  };

  // ---------- the whole loom ----------
  // square: the 360×360 loom; when the cloth is taller, older rows roll down out of view.
  // all:    every row (double-click view and saved PDFs); the loom grows upwards to fit.
  function layout(all) {
    const rows = Math.ceil(cells.length / COLS);
    const H = all ? Math.max(SQUARE, KNOT_FROM_BOTTOM + CELL * rows + TOP_MARGIN) : SQUARE;
    const knotTop = H - KNOT_FROM_BOTTOM, row0 = knotTop - CELL;
    const fits = Math.floor(row0 / CELL) + 1;              // 7 rows in the square
    const first = all ? 0 : Math.max(0, rows - fits);
    return { H, knotTop, row0, first };
  }

  function build(root, { all = false, animate = 0, ground = false } = {}) {
    root.innerHTML = '';
    const { H, knotTop, row0, first } = layout(all);
    root.setAttribute('viewBox', `-40 -10 440 ${H + 20}`);
    buildDefs(root);
    if (ground) el('rect', { x: -40, y: -10, width: 440, height: H + 20, fill: GROUND }, root);
    // invisible area so the whole square can be clicked and dragged, not just the thin warp lines
    if (!ground) el('rect', { x: -20, y: 0, width: 400, height: H, fill: '#000', 'fill-opacity': 0 }, root);

    for (let c = 0; c < COLS; c++) {
      el('line', { x1: c * CELL, y1: 0, x2: c * CELL, y2: H, stroke: WARP, 'stroke-width': 8, 'stroke-linecap': 'round' }, root);
    }
    const cloth = el('g', {}, root);
    for (let i = first * COLS; i < cells.length; i++) {
      const p = place(i);
      const pos = el('g', { transform: `translate(${p.col * CELL - CELL / 2} ${row0 - CELL * (p.row - first)})` }, cloth);
      const g = el('g', {}, pos);
      if (i >= cells.length - animate) { g.classList.add('new'); g.style.setProperty('--from', `${-p.dir * 24}px`); }
      drawCell(g, cells[i]);
    }
    if (started && first === 0) {
      const k = el('g', {}, el('g', { transform: `translate(${(COLS - 1) * CELL - CELL / 2} ${knotTop})` }, root));
      if (animate === -1) k.classList.add('tie');
      el('use', { href: '#g-knot', x: 0, y: 0, width: 40, height: 40 }, k);
    }
    return H + 20;
  }
  let lastHeight = 0;
  const render = (animate = 0) => {
    const h = build(svg, { all: expanded, animate });
    if (h !== lastHeight) { lastHeight = h; window.loom.setHeight(h); }
  };

  // ---------- download PDF (whole cloth) ----------
  function exportPDF() {
    const out = document.createElementNS(NS, 'svg');
    out.setAttribute('xmlns', NS);
    const h = build(out, { all: true, ground: true });
    out.setAttribute('width', 440); out.setAttribute('height', h);
    window.loom.savePDF(new XMLSerializer().serializeToString(out), 440, h);
  }

  // ---------- save image (whole cloth, PNG at 2×) ----------
  function exportPNG() {
    const out = document.createElementNS(NS, 'svg');
    out.setAttribute('xmlns', NS);
    const h = build(out, { all: true, ground: true });
    const W = 440 * 2, H = h * 2;
    out.setAttribute('width', W); out.setAttribute('height', H);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(out)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      cv.getContext('2d').drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      window.loom.savePNG(cv.toDataURL('image/png'));
    };
    img.src = url;
  }

  // ---------- mouse ----------
  // Clicks pass through to the desktop except on the loom. Drag to move.
  // First click ties the knot. Double-click shows the whole cloth / goes back to the square.
  let overLoom = false, dragging = false, downAt = null;
  const isLoom = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && t !== svg && t !== document.body && t !== document.documentElement; };
  window.addEventListener('mousemove', (e) => {
    if (dragging) { window.loom.dragMove(); return; }
    const on = isLoom(e.clientX, e.clientY);
    if (on !== overLoom) { overLoom = on; window.loom.setClickThrough(!on); document.body.style.cursor = on ? 'grab' : ''; }
  });
  window.addEventListener('mousedown', (e) => {
    if (!overLoom || e.button !== 0) return;
    dragging = true; downAt = [e.screenX, e.screenY];
    document.body.style.cursor = 'grabbing'; window.loom.dragStart();
  });
  window.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false; document.body.style.cursor = overLoom ? 'grab' : ''; window.loom.dragEnd();
    const moved = downAt && Math.hypot(e.screenX - downAt[0], e.screenY - downAt[1]) > 4;
    if (!moved && !started) window.loom.tieKnot();
  });
  window.addEventListener('dblclick', () => {
    if (!started || !overLoom) return;
    expanded = !expanded;
    window.loom.setExpanded(expanded);
    render();
  });

  // ---------- keys typed while the loom is focused (only used when the global listener is off) ----------
  let mode = 'local';
  window.addEventListener('keydown', (e) => {
    if (mode !== 'local' || e.repeat) return;
    window.loom.key({ code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey });
  });

  // ---------- wiring ----------
  window.loom.onWeave((add) => { cells.push(...add); render(add.length); });
  window.loom.onGrey((idx) => { for (const i of idx) if (cells[i] && cells[i][0] !== '~') cells[i] = '~' + cells[i]; render(); });
  window.loom.onCommand(async (cmd, arg) => {
    if (cmd === 'started') { started = true; render(-1); }
    if (cmd === 'clear') { cells = []; started = false; expanded = false; window.loom.setExpanded(false); render(); }
    if (cmd === 'export') exportPDF();
    if (cmd === 'export-png') exportPNG();
    if (cmd === 'load') { cells = arg.slice(); started = true; render(); }
    if (cmd === 'collapse' && expanded) { expanded = false; window.loom.setExpanded(false); render(); }
    if (cmd === 'mode') mode = arg;
    if (cmd === 'glyphs-changed') { glyphFiles = await window.loom.glyphs(); render(); }
  });
  (async () => {
    glyphFiles = await window.loom.glyphs();
    const s = await window.loom.init();
    cells = s.cells || []; mode = s.mode; started = !!s.started;
    render();
  })();
})();
