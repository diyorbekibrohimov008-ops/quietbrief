const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quietbriefDesktop', {
  platform: process.platform,
  arch: process.arch,
  getGpuLabel: () => ipcRenderer.invoke('qb:gpu-info'),
  ollamaProbe: () => ipcRenderer.invoke('qb:ollama-probe'),
  ollamaChat: (payload) => ipcRenderer.invoke('qb:ollama-chat', payload),
});
