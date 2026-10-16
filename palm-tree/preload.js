const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  setClickThrough: (on) => ipcRenderer.send('click-through', on),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  track: (type, data) => ipcRenderer.send('track', type, data),
  loadState: () => ipcRenderer.invoke('load-state'),
  saveState: (s) => ipcRenderer.send('save-state', s),
  font: () => ipcRenderer.invoke('font'),
  asset: (name) => ipcRenderer.invoke('asset', name),
  onCommand: (fn) => ipcRenderer.on('command', (_e, cmd, arg) => fn(cmd, arg)),
  // collection screen
  collection: () => ipcRenderer.invoke('collection-data'),
  collectionSeen: (n) => ipcRenderer.send('collection-seen', n),
  closeCollection: (via) => ipcRenderer.send('collection-close', via),
  onCollectionUpdate: (fn) => ipcRenderer.on('collection-update', (_e, n) => fn(n)),
});
