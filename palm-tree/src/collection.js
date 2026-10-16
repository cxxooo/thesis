// Collection screen: the ASCII palm tree poster, grey at first.
// Every time the user finishes trimming the palm tree (all old leaves cut), one more palm in the poster gets its color.
// assets/collection-ids.png marks every colored pixel of the poster with the palm it belongs to (red channel = 1..23,
// in the order they unlock). Palms unlocked since the last visit fade from grey to color while you watch.
// The palm tree pet stays on top and playable while this is open; finishing a tree here colors the next palm live.

const bridge = window.pet || {
  collection: async () => ({ unlocked: 3, seen: 1, layout: { width: Math.round(innerWidth * 0.436), bottom: 70 } }),
  asset: async (n) => `../assets/${n}.png`, closeCollection() {}, collectionSeen() {}, track() {}, onCollectionUpdate() {},
};
const NEW_DELAY = 450, NEW_FADE = 1400; // ms: wait, then fade newly unlocked palms to color

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function pixels(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

let closing = false;
function close(via) {
  if (closing) return; closing = true;
  document.body.classList.remove('shown');
  setTimeout(() => bridge.closeCollection(via), 230);
}
window.addEventListener('mousedown', () => close('click'));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') close('key'); });

(async () => {
  const data = await bridge.collection();
  const [art, ids] = await Promise.all([loadImg(await bridge.asset('ascii-palm-tree')), loadImg(await bridge.asset('collection-ids'))]);
  const W = art.width, H = art.height;
  const box = document.getElementById('art');
  box.style.width = data.layout.width + 'px';
  box.style.bottom = data.layout.bottom + 'px';
  const canvas = document.getElementById('c');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const src = pixels(art), idp = pixels(ids).data;
  const out = ctx.createImageData(W, H);
  const o = out.data, s = src.data;
  const byPalm = []; // palm id -> list of pixel offsets
  let total = 0;
  for (let p = 0, n = W * H; p < n; p++) {
    const k = p * 4, id = idp[k];
    o[k + 3] = s[k + 3];
    if (id) { (byPalm[id] = byPalm[id] || []).push(k); if (id > total) total = id; }
    if (id && id <= data.seen) { o[k] = s[k]; o[k + 1] = s[k + 1]; o[k + 2] = s[k + 2]; continue; }
    o[k] = o[k + 1] = o[k + 2] = Math.round(0.299 * s[k] + 0.587 * s[k + 1] + 0.114 * s[k + 2]);
  }
  ctx.putImageData(out, 0, 0);
  let shownUpTo = Math.min(data.seen, total);
  bridge.track('collection_open', { unlocked: Math.min(data.unlocked, total), total, newPalms: Math.max(0, Math.min(data.unlocked, total) - shownUpTo) });
  requestAnimationFrame(() => document.body.classList.add('shown'));

  // fade palms (shownUpTo, upTo] from grey to color
  function reveal(upTo, delay) {
    upTo = Math.min(upTo, total);
    if (upTo <= shownUpTo) return;
    const fresh = [];
    for (let id = shownUpTo + 1; id <= upTo; id++) if (byPalm[id]) fresh.push(...byPalm[id]);
    shownUpTo = upTo;
    const grey = fresh.map((k) => o[k]);
    const t0 = performance.now() + delay;
    function step(t) {
      const a = Math.max(0, Math.min(1, (t - t0) / NEW_FADE)), e = a * a * (3 - 2 * a);
      fresh.forEach((k, j) => { const g = grey[j]; o[k] = g + (s[k] - g) * e; o[k + 1] = g + (s[k + 1] - g) * e; o[k + 2] = g + (s[k + 2] - g) * e; });
      ctx.putImageData(out, 0, 0);
      if (a < 1) requestAnimationFrame(step); else bridge.collectionSeen(upTo);
    }
    requestAnimationFrame(step);
  }
  reveal(data.unlocked, NEW_DELAY);
  bridge.onCollectionUpdate((n) => reveal(n, 900)); // a tree was finished while this is open (wait for the celebration)
})();
