import { useRef, useState } from 'preact/hooks';
import type { AudioSourceMode, MeetingPlatform, WhisperModelId } from '../types/meeting';
import type { AudioMeterSnapshot, LiveDraftCaption } from '../services/audio-capture';
import { formatTimestamp } from '../core/brief-extractor';
import { SAMPLE_MEETING_PRESETS, type SamplePreset } from '../core/audio-utils';

interface RecorderPanelProps {
  isRecording: boolean;
  isPaused: boolean;
  isProcessing: boolean;
  processingLabel: string;
  meter: AudioMeterSnapshot;
  liveCaptions: LiveDraftCaption[];
  activeMode: AudioSourceMode;
  onStartRecording: (opts: {
    title: string;
    platform: MeetingPlatform;
    mode: AudioSourceMode;
    whisperModel: WhisperModelId;
    liveDraft: boolean;
  }) => void;
  onTogglePause: () => void;
  onStopRecording: () => void;
  onToggleMicMute: (muted: boolean) => void;
  onToggleSystemMute: (muted: boolean) => void;
  onImportFile: (file: File, title: string, whisperModel: WhisperModelId) => void;
  onLoadSample: (preset: SamplePreset) => void;
}

export function RecorderPanel(props: RecorderPanelProps) {
  const {
    isRecording,
    isPaused,
    isProcessing,
    processingLabel,
    meter,
    liveCaptions,
    activeMode,
    onStartRecording,
    onTogglePause,
    onStopRecording,
    onToggleMicMute,
    onToggleSystemMute,
    onImportFile,
    onLoadSample,
  } = props;

  const [title, setTitle] = useState('');
  const [platform, setPlatform] = useState<MeetingPlatform>('Zoom');
  const [mode, setMode] = useState<AudioSourceMode>('system+mic');
  const [whisperModel, setWhisperModel] = useState<WhisperModelId>('Xenova/whisper-tiny.en');
  const [liveDraft, setLiveDraft] = useState(true);
  const [micMuted, setMicMuted] = useState(false);
  const [sysMuted, setSysMuted] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file?: File | null) => {
    if (!file) return;
    const cleanTitle = title.trim() || file.name.replace(/\.[^.]+$/, '');
    onImportFile(file, cleanTitle, whisperModel);
  };

  return (
    <section class="recorder-panel" aria-label="Bot-free meeting recorder">
      <div class="recorder-grid">
        <div>
          <label class="field-label" for="qb-meeting-title">
            Meeting Title
          </label>
          <input
            id="qb-meeting-title"
            class="input"
            type="text"
            placeholder="e.g. Weekly Architecture Sync"
            value={title}
            disabled={isRecording || isProcessing}
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          />
        </div>

        <div>
          <label class="field-label" for="qb-platform">
            Call Source (No Bot)
          </label>
          <select
            id="qb-platform"
            class="select"
            value={platform}
            disabled={isRecording || isProcessing}
            onChange={(e) => setPlatform((e.target as HTMLSelectElement).value as MeetingPlatform)}
          >
            <option value="Zoom">Zoom (Silent Capture)</option>
            <option value="Google Meet">Google Meet (Silent Capture)</option>
            <option value="Microsoft Teams">Microsoft Teams (Silent Capture)</option>
            <option value="System Audio">Any App / System Audio</option>
          </select>
        </div>

        <div>
          <label class="field-label" for="qb-audio-mode">
            Audio Channels
          </label>
          <select
            id="qb-audio-mode"
            class="select"
            value={mode}
            disabled={isRecording || isProcessing}
            onChange={(e) => setMode((e.target as HTMLSelectElement).value as AudioSourceMode)}
          >
            <option value="system+mic">System + Mic (Recommended)</option>
            <option value="system">System / Call Audio Only</option>
            <option value="mic">Microphone Only</option>
          </select>
        </div>

        <div>
          {!isRecording ? (
            <button
              class="btn btn-primary"
              disabled={isProcessing}
              onClick={() => {
                setMicMuted(false);
                setSysMuted(false);
                onStartRecording({
                  title: title.trim() || `${platform} Meeting ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                  platform,
                  mode,
                  whisperModel,
                  liveDraft,
                });
              }}
            >
              <span>●</span> Start Bot-Free Recording
            </button>
          ) : (
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn" onClick={onTogglePause}>
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button class="btn btn-danger" onClick={onStopRecording}>
                ■ Stop &amp; Distill ({formatTimestamp(meter.elapsedSec)})
              </button>
            </div>
          )}
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--text-muted);">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <label style="display:inline-flex;align-items:center;gap:6px;">
            <span>Whisper Model:</span>
            <select
              class="select"
              style="width:auto;padding:4px 8px;font-size:12px;"
              value={whisperModel}
              disabled={isRecording || isProcessing}
              onChange={(e) => setWhisperModel((e.target as HTMLSelectElement).value as WhisperModelId)}
            >
              <option value="Xenova/whisper-tiny.en">Whisper Tiny EN (~40MB, fastest)</option>
              <option value="Xenova/whisper-base.en">Whisper Base EN (~75MB, balanced)</option>
              <option value="Xenova/whisper-small.en">Whisper Small EN (~240MB, high accuracy)</option>
            </select>
          </label>

          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
            <input
              type="checkbox"
              checked={liveDraft}
              disabled={isRecording}
              onChange={(e) => setLiveDraft((e.target as HTMLInputElement).checked)}
            />
            Live draft captions during recording
          </label>
        </div>

        <span>
          Zero bots join your call — pick your Zoom/Meet/Teams tab or screen and toggle{' '}
          <strong>Share audio</strong>.
        </span>
      </div>

      {isRecording && (
        <div class="meter-row">
          {(activeMode === 'system+mic' || activeMode === 'system') && (
            <div class="meter-box">
              <div class="meter-head">
                <span style="display:inline-flex;align-items:center;gap:6px;">
                  <span class="dot dot-pulse" />
                  <strong>Remote Call Audio</strong>
                </span>
                <button
                  class="btn btn-sm"
                  onClick={() => {
                    const next = !sysMuted;
                    setSysMuted(next);
                    onToggleSystemMute(next);
                  }}
                >
                  {sysMuted ? 'Unmute Call' : 'Mute Call'}
                </button>
              </div>
              <div class="meter-track">
                <div
                  class="meter-fill meter-fill-indigo"
                  style={{ width: `${sysMuted ? 0 : Math.round(meter.systemLevel * 100)}%` }}
                />
              </div>
            </div>
          )}

          {(activeMode === 'system+mic' || activeMode === 'mic') && (
            <div class="meter-box">
              <div class="meter-head">
                <span style="display:inline-flex;align-items:center;gap:6px;">
                  <span class="dot" />
                  <strong>Your Microphone</strong>
                </span>
                <button
                  class="btn btn-sm"
                  onClick={() => {
                    const next = !micMuted;
                    setMicMuted(next);
                    onToggleMicMute(next);
                  }}
                >
                  {micMuted ? 'Unmute Mic' : 'Mute Mic'}
                </button>
              </div>
              <div class="meter-track">
                <div
                  class="meter-fill"
                  style={{ width: `${micMuted ? 0 : Math.round(meter.micLevel * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {isRecording && liveCaptions.length > 0 && (
        <div class="banner" style="font-size:12px;">
          <div>
            <strong>Live Draft:</strong>{' '}
            {liveCaptions
              .slice(-3)
              .map((c) => c.text)
              .join(' ')}
          </div>
          <span class="pill pill-indigo">Full Whisper runs on Stop</span>
        </div>
      )}

      {isProcessing && (
        <div class="banner banner-ok">
          <span>{processingLabel || 'Running local on-device transcription & brief synthesis...'}</span>
          <span class="pill pill-green">On-Device Processing</span>
        </div>
      )}

      {!isRecording && !isProcessing && (
        <div
          class="dropzone"
          style={dragActive ? 'border-color: var(--accent); background: var(--accent-soft);' : ''}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            handleFile(e.dataTransfer?.files?.[0]);
          }}
        >
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/webm,video/mp4"
              style="display:none;"
              onChange={(e) => handleFile((e.target as HTMLInputElement).files?.[0])}
            />
            <button class="btn btn-sm" onClick={() => fileInputRef.current?.click()}>
              Import Recording (.wav / .mp3 / .m4a / .webm)
            </button>
            <span style="font-size:12px;color:var(--text-muted);">
              or drop an audio file here to transcribe 100% locally via Whisper
            </span>
          </div>

          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-size:11px;color:var(--text-dim);">Try instant sample:</span>
            {SAMPLE_MEETING_PRESETS.map((preset) => (
              <button
                key={preset.id}
                class="btn btn-sm"
                onClick={() => onLoadSample(preset)}
              >
                {preset.platform} Demo
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
