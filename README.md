# QuietBrief

[![Live Demo](https://img.shields.io/badge/Live%20Demo-quietbrief.vercel.app-10b981?style=flat&logo=vercel)](https://quietbrief.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20Windows%20(CUDA)%20%7C%20macOS%20(Apple%20Silicon)-indigo.svg)](#)

> **100% free, bot-free local meeting transcription and executive action brief workspace for Windows (WASAPI + CUDA) and macOS (ScreenCaptureKit + Apple Silicon).**

Live Production Deployment: **[https://quietbrief.vercel.app](https://quietbrief.vercel.app)**  
Secondary Alias: **[https://quietbrief-ibroximov.vercel.app](https://quietbrief-ibroximov.vercel.app)**

---

## Why QuietBrief?

| Problem with Incumbents | QuietBrief Solution |
| :--- | :--- |
| **Intrusive Meeting Bots (Otter.ai):** Cloud bots join calls as visible participants, raising compliance, security, and corporate policy alarms. | **Zero Bots Joining:** Silent local loopback recording captures call and microphone audio directly without external bots. |
| **Unformatted Transcript Dumps (MacWhisper):** Huge, raw walls of text requiring tedious manual reading. | **Instant Executive Briefs:** Automatic extraction of Decisions Made, Action Items with owners & deadlines, and Unanswered Questions. |
| **Mac Exclusivity & High Price:** Mac-only (€64) tools leave Windows enterprise users behind. | **Cross-Platform:** Available as a web app, installable PWA, and Electron desktop wrapper supporting Windows (CUDA) and macOS (Apple Silicon). |
| **Cloud Audio Risk:** Corporate data sent to third-party cloud servers. | **100% Local Privacy:** Transcripts and audio stay in your local browser IndexedDB vault or local disk; zero cloud audio uploads. |

---

## Features

- **Bot-Free Dual-Channel Audio Capture:** Record system/tab audio directly from Zoom, Google Meet, or Microsoft Teams (`getDisplayMedia` + Web Audio API gain mixer, or native Electron OS loopback) mixed with your local microphone.
- **On-Device Whisper Transcription:** Quantized Whisper in a Web Worker (`@huggingface/transformers` with ONNX WebGPU and WASM fallback) for on-device speech recognition without uploading audio.
- **Local Executive Action Brief Engine:** Distills meetings into:
  - **Executive TL;DR:** 2–4 high-impact outcome bullets.
  - **Decisions Made:** Logged with timestamp, deciding speaker, and rationale.
  - **Assigned Action Items:** Owners, deadlines, checkable completion states, and priorities.
  - **Unanswered Questions:** Filters out questions already answered by other participants.
  - **Topic Chapters:** Timeline index of agenda progression.
- **Three LLM Modes:**
  1. **Instant Local Brief Engine:** Zero download, deterministic on-device NLP parser.
  2. **Local Ollama GPU:** Connects to `http://localhost:11434` (e.g. `qwen2.5:3b`, `llama3.2`) leveraging NVIDIA CUDA or Apple Silicon Metal.
  3. **In-Browser WebGPU LLM:** Direct in-browser quantized model execution via `@mlc-ai/web-llm`.
- **Local Storage & Multi-Format Exporters:**
  - IndexedDB local vault (`quietbrief-local-vault`) stores transcripts and audio blobs.
  - Export to Markdown (`.md`), SubRip Subtitles (`.srt`), structured JSON (`.json`), or plain text.

---

## Project Structure

```
quietbrief/
├── api/
│   └── health.js              # Serverless health endpoint (Vercel)
├── desktop/                   # Electron desktop wrapper (Windows WASAPI & macOS ScreenCaptureKit)
│   ├── main.cjs
│   ├── preload.cjs
│   ├── package.json
│   └── README.md
├── public/
│   ├── icon.svg
│   ├── manifest.webmanifest   # PWA manifest
│   └── sw.js                  # Service Worker shell caching
├── src/
│   ├── components/            # UI components (Recorder, Brief Workspace, Action Tracker, Hardware View)
│   ├── core/                  # Pure logic (brief extractor, exporters, audio utilities)
│   ├── services/              # Audio capture, local Whisper transcriber, local LLM, IndexedDB vault
│   ├── types/                 # Shared TypeScript interfaces
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── tests/                     # Unit test suites (brief extractor, exporters, WAV encoder)
├── package.json
├── tsconfig.json
├── vercel.json
└── vite.config.ts
```

---

## Getting Started

### Prerequisites

- Node.js `20.x` or later (tested on Node `24.x`)
- npm `10.x` or later

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

### Run Tests

```bash
npm test
```

### Production Build

```bash
npm run build
```

The build outputs an optimized single-file bundle into `dist/`.

---

## Desktop Packaging (Windows & macOS)

For native OS loopback capture (WASAPI on Windows, ScreenCaptureKit on macOS) and desktop Ollama bridge:

```bash
cd desktop
npm install
npm run dist:win   # Windows installer (.exe)
npm run dist:mac   # macOS DMG / zip
```

See [desktop/README.md](./desktop/README.md) for full details.

---

## License

MIT License. See [LICENSE](./LICENSE) for details.
