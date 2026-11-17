const { app, BrowserWindow, desktopCapturer, ipcMain, session } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const OLLAMA_URL = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

function detectGpuSummary() {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      execFile('sysctl', ['-n', 'machdep.cpu.brand_string'], (err, stdout) => {
        const cpu = err ? process.arch : stdout.trim();
        resolve(`${cpu} (Apple Metal)`);
      });
      return;
    }

    if (process.platform === 'win32') {
      execFile(
        'nvidia-smi',
        ['--query-gpu=name,memory.total', '--format=csv,noheader'],
        (err, stdout) => {
          if (!err && stdout.trim()) {
            resolve(`${stdout.trim()} (CUDA)`);
          } else {
            resolve(`Windows ${process.arch} (WASAPI + DirectML/WASM)`);
          }
        }
      );
      return;
    }

    resolve(`${process.platform} ${process.arch}`);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b0d12',
    title: 'QuietBrief — Local Meeting Transcription & Executive Briefs',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Enable silent OS system audio loopback (Windows WASAPI / macOS ScreenCaptureKit)
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch {
      callback({});
    }
  });

  const localBundle = path.join(__dirname, '..', 'dist', 'index.html');
  const targetUrl = process.env.QUIETBRIEF_URL;

  if (targetUrl) {
    void win.loadURL(targetUrl);
  } else if (fs.existsSync(localBundle)) {
    void win.loadFile(localBundle);
  } else {
    void win.loadURL('http://localhost:5173');
  }
}

ipcMain.handle('qb:gpu-info', async () => detectGpuSummary());

ipcMain.handle('qb:ollama-probe', async () => {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return { available: false, models: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    return {
      available: true,
      models: (data.models || []).map((m) => m.name).filter(Boolean),
    };
  } catch (err) {
    return {
      available: false,
      models: [],
      error: err instanceof Error ? err.message : 'Ollama offline',
    };
  }
});

ipcMain.handle('qb:ollama-chat', async (_event, { model, prompt }) => {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      format: 'json',
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama returned HTTP ${res.status}`);
  }
  const data = await res.json();
  return data?.message?.content || '';
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
