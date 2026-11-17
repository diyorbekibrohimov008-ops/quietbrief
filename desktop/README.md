# QuietBrief Desktop (Windows CUDA & macOS Apple Silicon)

QuietBrief Desktop wraps the local-first web application inside a lightweight Electron shell with native OS loopback audio capture and direct local GPU Ollama integration (no CORS flags required).

## Build from Repo Root

```bash
npm install
npm run build
cd desktop
npm install
npm start
```

## Package Installers

- **Windows (x64 / arm64 NSIS + Portable, WASAPI loopback + NVIDIA CUDA):**
  ```bash
  npm run dist:win
  ```
- **macOS (Apple Silicon arm64 + Intel x64 DMG, ScreenCaptureKit loopback + Metal):**
  ```bash
  npm run dist:mac
  ```
