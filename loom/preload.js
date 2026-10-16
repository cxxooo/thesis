const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('loom', {
  init: () => ipcRenderer.invoke('init'),
  glyphs: () => ipcRenderer.invoke('glyphs'),
  key: (k) => ipcRenderer.send('key', k),
  savePNG: (dataUrl) => ipcRenderer.send('save-png', dataUrl),
  savePDF: (svg, w, h) => ipcRenderer.send('save-pdf', svg, w, h),
  tieKnot: () => ipcRenderer.send('tie-knot'),
  setExpanded: (on) => ipcRenderer.send('set-expanded', on),
  setHeight: (h) => ipcRenderer.send('set-height', h),
  setClickThrough: (on) => ipcRenderer.send('click-through', on),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  onWeave: (fn) => ipcRenderer.on('weave', (_e, add) => fn(add)),
  onGrey: (fn) => ipcRenderer.on('grey', (_e, idx) => fn(idx)),
  onCommand: (fn) => ipcRenderer.on('command', (_e, cmd, arg) => fn(cmd, arg)),
});
