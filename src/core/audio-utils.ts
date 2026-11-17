import type { TranscriptSegment } from '../types/meeting';

/**
 * Encodes mono Float32 PCM audio [-1, 1] into a standard 16-bit RIFF WAV buffer.
 */
export function encodeWavBytes(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

export function encodeWavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  const bytes = encodeWavBytes(samples, sampleRate);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
}

/**
 * Decodes any browser-supported audio/video file or Blob into 16 kHz mono Float32Array
 * suitable for local Whisper inference.
 */
export async function decodeAudioTo16kMono(blob: Blob): Promise<{
  samples: Float32Array;
  durationSec: number;
}> {
  const arrayBuf = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const targetRate = 16000;
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContext(1, frameCount, targetRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return {
      samples: rendered.getChannelData(0).slice(),
      durationSec: decoded.duration,
    };
  } finally {
    await ctx.close();
  }
}

export function createSampleToneWav(durationSec = 6): Blob {
  const sampleRate = 16000;
  const totalSamples = sampleRate * durationSec;
  const samples = new Float32Array(totalSamples);
  const notes = [261.63, 329.63, 392.0, 523.25];
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const note = notes[Math.floor(t * 2) % notes.length];
    const env = Math.sin(Math.PI * ((t * 2) % 1));
    samples[i] = Math.sin(2 * Math.PI * note * t) * 0.12 * env;
  }
  return encodeWavBlob(samples, sampleRate);
}

export interface SamplePreset {
  id: string;
  title: string;
  platform: 'Zoom' | 'Microsoft Teams' | 'Google Meet';
  durationSec: number;
  segments: TranscriptSegment[];
}

export const SAMPLE_MEETING_PRESETS: SamplePreset[] = [
  {
    id: 'sample-security-sync',
    title: 'Enterprise Zero-Bot Compliance & Q4 Launch Sync',
    platform: 'Microsoft Teams',
    durationSec: 214,
    segments: [
      {
        id: 's1',
        startSec: 4,
        endSec: 22,
        speaker: 'Elena (CISO)',
        channel: 'remote',
        text: 'Legal officially banned Otter and third-party recording bots from client calls starting Monday. Every meeting tool must record locally with zero cloud uploads.',
      },
      {
        id: 's2',
        startSec: 24,
        endSec: 46,
        speaker: 'You',
        channel: 'local',
        text: 'Understood. We agreed to ship QuietBrief using direct WASAPI loopback on Windows and ScreenCaptureKit on Mac so nothing joins the participant list.',
      },
      {
        id: 's3',
        startSec: 48,
        endSec: 73,
        speaker: 'Marcus (Eng Lead)',
        channel: 'remote',
        text: 'Marcus will benchmark Whisper base and Qwen2.5 1.5B on both RTX 4060 CUDA and M3 Pro Apple Silicon by Friday. Also we decided to store all audio blobs inside local IndexedDB only.',
      },
      {
        id: 's4',
        startSec: 75,
        endSec: 99,
        speaker: 'Priya (Product)',
        channel: 'remote',
        text: 'Can enterprise admins disable all external model downloads on air-gapped laptops before deployment?',
      },
      {
        id: 's5',
        startSec: 102,
        endSec: 126,
        speaker: 'You',
        channel: 'local',
        text: "I'll prepare the offline model bundle guide and publish the Windows installer notes by Nov 18. Let's ship the public beta on Wednesday.",
      },
      {
        id: 's6',
        startSec: 129,
        endSec: 158,
        speaker: 'Elena (CISO)',
        channel: 'remote',
        text: 'Wait, do we need SOC2 attestation on the desktop updater endpoint before rolling out to the finance division?',
      },
      {
        id: 's7',
        startSec: 162,
        endSec: 194,
        speaker: 'Priya (Product)',
        channel: 'remote',
        text: 'Priya will send the executive launch checklist to Legal before EOD tomorrow. Everything else is approved for beta.',
      },
    ],
  },
  {
    id: 'sample-architecture-review',
    title: 'Q4 Audio Pipeline & Local LLM Quantization Review',
    platform: 'Zoom',
    durationSec: 185,
    segments: [
      {
        id: 'a1',
        startSec: 5,
        endSec: 28,
        speaker: 'You',
        channel: 'local',
        text: "Let's go with sequential execution: run local Whisper right after Stop, unload audio buffer, then run the 4-bit quantized brief extractor so 8GB GPUs never OOM.",
      },
      {
        id: 'a2',
        startSec: 30,
        endSec: 58,
        speaker: 'Devon (Audio Systems)',
        channel: 'remote',
        text: 'Devon will implement dual-channel mixing between microphone and Zoom system audio by Thursday so speaker attribution stays accurate.',
      },
      {
        id: 'a3',
        startSec: 60,
        endSec: 88,
        speaker: 'Hannah (Design)',
        channel: 'remote',
        text: 'We confirmed the executive brief card must appear above the fold with checkable tasks, owners, and deadlines instead of a raw transcript wall.',
      },
      {
        id: 'a4',
        startSec: 92,
        endSec: 120,
        speaker: 'Devon (Audio Systems)',
        channel: 'remote',
        text: 'What should happen on older corporate MacBooks running macOS 13 without ScreenCaptureKit audio taps?',
      },
    ],
  },
];
