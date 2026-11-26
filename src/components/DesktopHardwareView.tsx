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
  const [gpuInfo, setGpuInfo] = useState<string>('Checking device graphics...');
  const [osLabel, setOsLabel] = useState<string>('Detecting...');

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Mac/i.test(ua)) {
      setOsLabel('macOS');
    } else if (/Win/i.test(ua)) {
      setOsLabel('Windows');
    } else {
      setOsLabel('Linux / Web');
    }

    const probeGpu = async () => {
      if (!('gpu' in navigator)) {
        setGpuInfo('Standard CPU mode (works everywhere)');
        return;
      }
      try {
        const navGpu = navigator as unknown as {
          gpu: {
            requestAdapter: () => Promise<{
              info?: { description?: string; vendor?: string; architecture?: string };
            } | null>;
          };
        };
        const adapter = await navGpu.gpu.requestAdapter();
        if (!adapter) {
          setGpuInfo('Standard CPU mode (works everywhere)');
          return;
        }
        const desc =
          adapter.info?.description ||
          [adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' ') ||
          'Fast WebGPU hardware ready';
        setGpuInfo(desc);
      } catch {
        setGpuInfo('Standard CPU mode (works everywhere)');
      }
    };
    void probeGpu();
  }, []);

  const isElectron = Boolean(window.quietbriefDesktop);

  return (
    <div class="stack">
      <div class="card">
        <div class="card-header">
          <div>
            <h1 style="margin:0;font-size:20px;">Settings &amp; device setup</h1>
            <p style="margin:4px 0 0;font-size:13px;color:var(--text-muted);">
              QuietBrief runs locally in your browser for free. Optional local AI (Ollama) and desktop app build steps are below.
            </p>
          </div>
          {canInstallPwa && (
            <button class="btn btn-primary" onClick={onInstallPwa}>
              Install app on this device
            </button>
          )}
        </div>

        <div class="hardware-grid">
          <div class="card" style="background:var(--bg);padding:14px;">
            <div class="field-label">Your device</div>
            <div style="font-weight:700;">{osLabel}</div>
            <div style="font-size:12px;color:var(--text-muted);">
              {isElectron ? 'Desktop app' : 'Private browser storage'} ({navigator.hardwareConcurrency || 4} CPU threads)
            </div>
          </div>

          <div class="card" style="background:var(--bg);padding:14px;">
            <div class="field-label">Transcription engine</div>
            <div style="font-weight:700;">{gpuInfo}</div>
            <div style="font-size:12px;color:var(--text-muted);">
              Audio and transcripts stay inside your browser storage.
            </div>
          </div>

          <div class="card" style="background:var(--bg);padding:14px;">
            <div class="card-header" style="align-items:center;">
              <span class="field-label" style="margin:0;">Optional local Ollama AI</span>
              <button class="btn btn-sm" onClick={onRefreshOllama}>
                Check connection
              </button>
            </div>
            <div style="font-weight:700;">
              {ollamaStatus.available
                ? `Connected (${ollamaStatus.models.length} model${ollamaStatus.models.length === 1 ? '' : 's'})`
                : 'Not connected'}
            </div>
            <div style="font-size:12px;color:var(--text-muted);">
              {ollamaStatus.available
                ? ollamaStatus.models.join(', ') || 'Run: ollama pull qwen2.5:3b'
                : 'Completely optional — built-in offline summaries already work with zero setup.'}
            </div>
          </div>
        </div>
      </div>

      <details class="card">
        <summary style="cursor:pointer;font-weight:700;font-size:14px;">
          Advanced: Windows &amp; macOS desktop app + Ollama commands
        </summary>
        <div class="hardware-grid" style="margin-top:14px;">
          <div>
            <h2 class="card-title" style="margin-bottom:6px;">Windows</h2>
            <pre class="code-block">{`set OLLAMA_ORIGINS=*
ollama pull qwen2.5:3b
ollama serve

cd desktop && npm install && npm run dist:win`}</pre>
          </div>
          <div>
            <h2 class="card-title" style="margin-bottom:6px;">macOS</h2>
            <pre class="code-block">{`OLLAMA_ORIGINS="*" ollama serve &
ollama pull qwen2.5:3b

cd desktop && npm install && npm run dist:mac`}</pre>
          </div>
        </div>
      </details>
    </div>
  );
}
