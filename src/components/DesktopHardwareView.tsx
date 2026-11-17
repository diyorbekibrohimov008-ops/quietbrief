import { useEffect, useState } from 'preact/hooks';
import type { OllamaStatus } from '../services/local-llm';

interface DesktopHardwareViewProps {
  ollamaStatus: OllamaStatus;
  onRefreshOllama: () => void;
  canInstallPwa: boolean;
  onInstallPwa: () => void;
}

export function DesktopHardwareView(props: DesktopHardwareViewProps) {
  const { ollamaStatus, onRefreshOllama, canInstallPwa, onInstallPwa } = props;
  const [gpuInfo, setGpuInfo] = useState<string>('Probing WebGPU adapter...');
  const [osLabel, setOsLabel] = useState<string>('Detecting...');

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Mac/i.test(ua)) {
      setOsLabel('macOS (Apple Silicon / Metal ready)');
    } else if (/Win/i.test(ua)) {
      setOsLabel('Windows (WASAPI Loopback + CUDA ready)');
    } else {
      setOsLabel('Linux / Cross-Platform');
    }

    const probeGpu = async () => {
      if (!('gpu' in navigator)) {
        setGpuInfo('WebGPU disabled — Whisper runs on local multi-platform WASM');
        return;
      }
      try {
        const navGpu = navigator as unknown as {
          gpu: { requestAdapter: () => Promise<{ info?: { description?: string; vendor?: string; architecture?: string } } | null> };
        };
        const adapter = await navGpu.gpu.requestAdapter();
        if (!adapter) {
          setGpuInfo('No WebGPU hardware adapter found — WASM active');
          return;
        }
        const desc =
          adapter.info?.description ||
          [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' · ') ||
          'WebGPU Hardware Acceleration Active';
        setGpuInfo(desc);
      } catch {
        setGpuInfo('WebGPU adapter probe restricted — WASM active');
      }
    };
    void probeGpu();
  }, []);

  const isElectron = Boolean(window.quietbriefDesktop);

  return (
    <div class="page-pad">
      <div class="card">
        <div class="card-header">
          <div>
            <h1 style="margin:0;font-size:19px;">Desktop Package &amp; On-Device Hardware</h1>
            <p style="margin:4px 0 0;font-size:13px;color:var(--text-muted);">
              Run QuietBrief natively on Windows (CUDA + WASAPI) or macOS (Apple Silicon Metal + ScreenCaptureKit), or install directly as an offline Desktop PWA.
            </p>
          </div>
          {canInstallPwa && (
            <button class="btn btn-primary" onClick={onInstallPwa}>
              Install Desktop App (PWA)
            </button>
          )}
        </div>

        <div class="hardware-grid">
          <div class="card" style="background:var(--bg);">
            <div class="field-label">Host Environment</div>
            <div style="font-weight:700;">{osLabel}</div>
            <div style="font-size:12px;color:var(--text-muted);">
              Runtime: {isElectron ? 'Native Electron Desktop Wrapper' : 'Browser Sandbox (Zero Cloud Upload)'} ·{' '}
              {navigator.hardwareConcurrency || 4} CPU threads
            </div>
          </div>

          <div class="card" style="background:var(--bg);">
            <div class="field-label">On-Device Whisper Accelerator</div>
            <div style="font-weight:700;">{gpuInfo}</div>
            <div style="font-size:12px;color:var(--text-muted);">
              Audio stays in RAM &amp; IndexedDB — Whisper weights cached persistently in browser storage.
            </div>
          </div>

          <div class="card" style="background:var(--bg);">
            <div class="card-header">
              <span class="field-label" style="margin:0;">Local Quantized LLM (Ollama)</span>
              <button class="btn btn-sm" onClick={onRefreshOllama}>
                Refresh
              </button>
            </div>
            <div style="font-weight:700;">
              {ollamaStatus.available
                ? `Connected (${ollamaStatus.models.length} local model${ollamaStatus.models.length === 1 ? '' : 's'})`
                : 'Not detected on localhost:11434'}
            </div>
            <div style="font-size:12px;color:var(--text-muted);">
              {ollamaStatus.available
                ? ollamaStatus.models.join(', ') || 'Run: ollama pull qwen2.5:3b'
                : 'Start Ollama locally with OLLAMA_ORIGINS=* or use the built-in WebGPU / Instant Local engines.'}
            </div>
          </div>
        </div>
      </div>

      <div class="hardware-grid">
        <div class="card">
          <h2 class="card-title">Windows (WASAPI + NVIDIA CUDA)</h2>
          <p style="margin:0;font-size:13px;color:var(--text-muted);">
            Silent system audio capture via Windows WASAPI loopback — no VB-Cable or third-party virtual driver needed.
          </p>
          <pre class="code-block">{`# Enable local Ollama GPU access from web/PWA:
set OLLAMA_ORIGINS=*
ollama pull qwen2.5:3b
ollama serve

# Or build standalone Windows Electron (.exe):
cd desktop
npm install && npm run dist:win`}</pre>
        </div>

        <div class="card">
          <h2 class="card-title">macOS (Apple Silicon Metal + ScreenCaptureKit)</h2>
          <p style="margin:0;font-size:13px;color:var(--text-muted);">
            Silent call audio loopback on macOS 13+/14.2+ via Electron ScreenCaptureKit — zero meeting bots, ~4x lighter than heavy native wrappers.
          </p>
          <pre class="code-block">{`# Enable local Ollama Metal GPU access:
OLLAMA_ORIGINS="*" ollama serve &
ollama pull qwen2.5:3b

# Build Universal Apple Silicon + Intel (.dmg):
cd desktop
npm install && npm run dist:mac`}</pre>
        </div>
      </div>
    </div>
  );
}
