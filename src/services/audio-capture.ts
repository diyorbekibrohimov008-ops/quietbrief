import type { AudioSourceMode } from '../types/meeting';

export interface AudioMeterSnapshot {
  systemLevel: number;
  micLevel: number;
  elapsedSec: number;
}

export interface LiveDraftCaption {
  text: string;
  isFinal: boolean;
  timestampSec: number;
}

export interface CaptureSession {
  pause: () => void;
  resume: () => void;
  setMicMuted: (muted: boolean) => void;
  setSystemMuted: (muted: boolean) => void;
  stop: () => Promise<{ blob: Blob; durationSec: number; mimeType: string }>;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function pickSupportedMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

function computeRmsLevel(analyser: AnalyserNode | null, buffer: Uint8Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buffer);
  let sumSq = 0;
  for (let i = 0; i < buffer.length; i++) {
    const normalized = (buffer[i] - 128) / 128;
    sumSq += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(sumSq / buffer.length) * 3.2);
}

/**
 * Starts bot-free local audio capture using browser Screen/Tab Audio (getDisplayMedia)
 * and/or Microphone (getUserMedia), mixed via Web Audio API with live VU levels.
 */
export async function startAudioCapture(options: {
  mode: AudioSourceMode;
  enableLiveDraftCaptions?: boolean;
  onMeter?: (snap: AudioMeterSnapshot) => void;
  onLiveCaption?: (caption: LiveDraftCaption) => void;
}): Promise<CaptureSession> {
  const { mode, enableLiveDraftCaptions = false, onMeter, onLiveCaption } = options;

  let systemStream: MediaStream | null = null;
  let micStream: MediaStream | null = null;

  try {
    if (mode === 'system+mic' || mode === 'system') {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error(
          'System/tab audio capture is unavailable in this browser. Use Chrome, Edge, or the QuietBrief Desktop app.'
        );
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      // Immediately release video frames — we only record audio locally.
      for (const track of displayStream.getVideoTracks()) {
        track.stop();
        displayStream.removeTrack(track);
      }

      if (displayStream.getAudioTracks().length === 0) {
        throw new Error(
          'No system audio track was shared. Re-click Record and check "Share tab audio" or "Share system audio" in the picker.'
        );
      }
      systemStream = displayStream;
    }

    if (mode === 'system+mic' || mode === 'mic') {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is unavailable in this browser.');
      }
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    }
  } catch (err) {
    systemStream?.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
    throw err;
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const destination = audioCtx.createMediaStreamDestination();

  let systemGain: GainNode | null = null;
  let micGain: GainNode | null = null;
  let systemAnalyser: AnalyserNode | null = null;
  let micAnalyser: AnalyserNode | null = null;

  if (systemStream) {
    const src = audioCtx.createMediaStreamSource(systemStream);
    systemGain = audioCtx.createGain();
    systemAnalyser = audioCtx.createAnalyser();
    systemAnalyser.fftSize = 256;
    src.connect(systemGain);
    systemGain.connect(systemAnalyser);
    systemAnalyser.connect(destination);
  }

  if (micStream) {
    const src = audioCtx.createMediaStreamSource(micStream);
    micGain = audioCtx.createGain();
    micAnalyser = audioCtx.createAnalyser();
    micAnalyser.fftSize = 256;
    src.connect(micGain);
    micGain.connect(micAnalyser);
    micAnalyser.connect(destination);
  }

  const mimeType = pickSupportedMimeType();
  const recorder = mimeType
    ? new MediaRecorder(destination.stream, { mimeType })
    : new MediaRecorder(destination.stream);

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  let startedAt = Date.now();
  let accumulatedMs = 0;
  let paused = false;

  const sysBuf = new Uint8Array(new ArrayBuffer(256));
  const micBuf = new Uint8Array(new ArrayBuffer(256));

  const meterTimer = window.setInterval(() => {
    const elapsedMs = paused ? accumulatedMs : accumulatedMs + (Date.now() - startedAt);
    onMeter?.({
      systemLevel: computeRmsLevel(systemAnalyser, sysBuf),
      micLevel: computeRmsLevel(micAnalyser, micBuf),
      elapsedSec: Math.floor(elapsedMs / 1000),
    });
  }, 90);

  // Optional browser Web Speech API live draft captions for mic feed
  let recognition: SpeechRecognitionLike | null = null;
  if (enableLiveDraftCaptions && onLiveCaption) {
    const WinSpeech = (
      window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      }
    ).SpeechRecognition ||
      (
        window as unknown as {
          webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        }
      ).webkitSpeechRecognition;

    if (WinSpeech) {
      try {
        recognition = new WinSpeech();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.onresult = (ev) => {
          const elapsedSec = Math.floor(
            (accumulatedMs + (Date.now() - startedAt)) / 1000
          );
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const res = ev.results[i];
            const txt = res[0]?.transcript?.trim();
            if (txt) {
              onLiveCaption({
                text: txt,
                isFinal: res.isFinal,
                timestampSec: elapsedSec,
              });
            }
          }
        };
        recognition.onerror = () => {
          // Non-fatal: full Whisper runs locally on stop.
        };
        recognition.start();
      } catch {
        recognition = null;
      }
    }
  }

  recorder.start(500);

  return {
    pause() {
      if (paused || recorder.state !== 'recording') return;
      accumulatedMs += Date.now() - startedAt;
      paused = true;
      recorder.pause();
    },
    resume() {
      if (!paused || recorder.state !== 'paused') return;
      startedAt = Date.now();
      paused = false;
      recorder.resume();
    },
    setMicMuted(muted: boolean) {
      if (micGain) micGain.gain.value = muted ? 0 : 1;
    },
    setSystemMuted(muted: boolean) {
      if (systemGain) systemGain.gain.value = muted ? 0 : 1;
    },
    stop() {
      return new Promise((resolve) => {
        window.clearInterval(meterTimer);
        try {
          recognition?.stop();
        } catch {
          // ignore
        }

        const totalSec = Math.max(
          1,
          Math.round((paused ? accumulatedMs : accumulatedMs + (Date.now() - startedAt)) / 1000)
        );

        const finish = () => {
          systemStream?.getTracks().forEach((t) => t.stop());
          micStream?.getTracks().forEach((t) => t.stop());
          void audioCtx.close();
          const finalMime = recorder.mimeType || mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: finalMime });
          resolve({ blob, durationSec: totalSec, mimeType: finalMime });
        };

        if (recorder.state === 'inactive') {
          finish();
          return;
        }
        recorder.onstop = finish;
        recorder.stop();
      });
    },
  };
}
