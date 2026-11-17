import type { TranscriptSegment, WhisperModelId } from '../types/meeting';

export interface WhisperProgressEvent {
  phase: 'loading-runtime' | 'downloading-model' | 'transcribing' | 'done';
  progress?: number;
  message: string;
  device?: 'webgpu' | 'wasm';
}

const TRANSFORMERS_CDNS = [
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.web.js',
  'https://esm.sh/@huggingface/transformers@4.3.2',
  'https://unpkg.com/@huggingface/transformers@4.3.2/dist/transformers.web.js',
];

const WORKER_SCRIPT = `
let transcriberPromise = null;
let loadedModelId = null;
let activeDevice = 'wasm';
const CDNS = ${JSON.stringify(TRANSFORMERS_CDNS)};

async function loadTransformers() {
  let lastErr;
  for (const url of CDNS) {
    try {
      return await import(url);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Unable to load local Whisper runtime from CDN.');
}

self.onmessage = async (event) => {
  const { id, type, audio, modelId, preferWebGpu } = event.data;
  if (type !== 'transcribe') return;

  try {
    self.postMessage({ id, kind: 'progress', phase: 'loading-runtime', message: 'Initializing local ONNX Whisper runtime...' });
    const { pipeline, env } = await loadTransformers();
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    if (!transcriberPromise || loadedModelId !== modelId) {
      loadedModelId = modelId;
      const canWebGpu = Boolean(preferWebGpu && typeof navigator !== 'undefined' && 'gpu' in navigator);

      const loadWithDevice = async (device) => {
        activeDevice = device;
        return pipeline('automatic-speech-recognition', modelId, {
          device,
          dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
          progress_callback: (info) => {
            if (info && typeof info.progress === 'number') {
              self.postMessage({
                id,
                kind: 'progress',
                phase: 'downloading-model',
                progress: Math.round(info.progress),
                device,
                message: 'Caching Whisper weights locally (' + Math.round(info.progress) + '%)...'
              });
            }
          }
        });
      };

      try {
        transcriberPromise = loadWithDevice(canWebGpu ? 'webgpu' : 'wasm');
        await transcriberPromise;
      } catch (gpuErr) {
        if (canWebGpu) {
          self.postMessage({
            id,
            kind: 'progress',
            phase: 'downloading-model',
            device: 'wasm',
            message: 'WebGPU adapter unavailable, switching cleanly to local WASM...'
          });
          transcriberPromise = loadWithDevice('wasm');
          await transcriberPromise;
        } else {
          throw gpuErr;
        }
      }
    }

    const transcriber = await transcriberPromise;
    self.postMessage({
      id,
      kind: 'progress',
      phase: 'transcribing',
      device: activeDevice,
      message: 'Transcribing meeting locally on ' + activeDevice.toUpperCase() + '...'
    });

    const result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true
    });

    self.postMessage({ id, kind: 'result', result, device: activeDevice });
  } catch (err) {
    transcriberPromise = null;
    self.postMessage({
      id,
      kind: 'error',
      error: err && err.message ? err.message : String(err)
    });
  }
};
`;

let sharedWorker: Worker | null = null;
let jobCounter = 0;

function getWorker(): Worker {
  if (!sharedWorker) {
    const blob = new Blob([WORKER_SCRIPT], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    sharedWorker = new Worker(url, { type: 'module' });
  }
  return sharedWorker;
}

interface WhisperChunk {
  timestamp?: [number | null, number | null];
  text?: string;
}

interface WhisperResult {
  text?: string;
  chunks?: WhisperChunk[];
}

export async function transcribeAudioLocally(options: {
  samples16kMono: Float32Array;
  durationSec: number;
  modelId: WhisperModelId;
  defaultSpeaker?: string;
  channel?: 'local' | 'remote' | 'mixed';
  onProgress?: (ev: WhisperProgressEvent) => void;
}): Promise<{ segments: TranscriptSegment[]; device: 'webgpu' | 'wasm' }> {
  const {
    samples16kMono,
    durationSec,
    modelId,
    defaultSpeaker = 'Speaker',
    channel = 'mixed',
    onProgress,
  } = options;

  const worker = getWorker();
  const jobId = ++jobCounter;
  const preferWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  const raw = await new Promise<{ result: WhisperResult; device: 'webgpu' | 'wasm' }>(
    (resolve, reject) => {
      const handleMessage = (ev: MessageEvent) => {
        const msg = ev.data;
        if (!msg || msg.id !== jobId) return;

        if (msg.kind === 'progress') {
          onProgress?.({
            phase: msg.phase,
            progress: msg.progress,
            message: msg.message,
            device: msg.device,
          });
          return;
        }

        if (msg.kind === 'result') {
          worker.removeEventListener('message', handleMessage);
          resolve({ result: msg.result as WhisperResult, device: msg.device || 'wasm' });
          return;
        }

        if (msg.kind === 'error') {
          worker.removeEventListener('message', handleMessage);
          reject(new Error(msg.error || 'Local Whisper worker failed.'));
        }
      };

      worker.addEventListener('message', handleMessage);
      const copy = new Float32Array(samples16kMono);
      worker.postMessage(
        {
          id: jobId,
          type: 'transcribe',
          audio: copy,
          modelId,
          preferWebGpu,
        },
        [copy.buffer]
      );
    }
  );

  onProgress?.({
    phase: 'done',
    progress: 100,
    device: raw.device,
    message: `Transcribed locally via ${raw.device.toUpperCase()}`,
  });

  const chunks = Array.isArray(raw.result?.chunks) ? raw.result.chunks : [];
  const segments: TranscriptSegment[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i];
    const text = (ch.text || '').trim();
    if (!text) continue;
    const startSec = Number(ch.timestamp?.[0] ?? i * 8);
    const endSec = Number(ch.timestamp?.[1] ?? Math.min(durationSec, startSec + 8));
    segments.push({
      id: `seg-${i + 1}`,
      startSec: Math.max(0, startSec),
      endSec: Math.max(startSec + 1, endSec),
      speaker: defaultSpeaker,
      channel,
      text,
    });
  }

  if (segments.length === 0 && raw.result?.text?.trim()) {
    segments.push({
      id: 'seg-1',
      startSec: 0,
      endSec: Math.max(1, Math.round(durationSec)),
      speaker: defaultSpeaker,
      channel,
      text: raw.result.text.trim(),
    });
  }

  return { segments, device: raw.device };
}
