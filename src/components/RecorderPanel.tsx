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
    <section
      class="recorder-panel"
      aria-label="Meeting recorder"
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
      <div class="card-header">
        <div>
          <h2 class="card-title">Record a meeting or upload audio</h2>
          <p style="margin:3px 0 0;font-size:13px;color:var(--text-muted);">
            Listens privately on your computer — no bot joins your call, and nothing is sent to the cloud.
          </p>
        </div>
        {!isRecording && !isProcessing && (
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            {SAMPLE_MEETING_PRESETS.slice(0, 1).map((preset) => (
              <button
                key={preset.id}
                class="btn btn-sm"
                onClick={() => onLoadSample(preset)}
              >
                Try sample meeting
              </button>
            ))}
          </div>
        )}
      </div>

      <div class="recorder-row">
        <input
          id="qb-meeting-title"
          class="input"
          type="text"
          aria-label="Meeting name"
          placeholder="Meeting name (e.g. Weekly Team Check-in)"
          value={title}
          disabled={isRecording || isProcessing}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,video/webm,video/mp4"
          style="display:none;"
          onChange={(e) => handleFile((e.target as HTMLInputElement).files?.[0])}
        />

        {!isRecording ? (
          <>
            <button
              class="btn btn-primary"
              disabled={isProcessing}
              onClick={() => {
                setMicMuted(false);
                setSysMuted(false);
                onStartRecording({
                  title:
                    title.trim() ||
                    `${platform} Meeting ${new Date().toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`,
                  platform,
                  mode,
                  whisperModel,
                  liveDraft,
                });
              }}
            >
              Start recording
            </button>
            <button
              class="btn"
              disabled={isProcessing}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload audio
            </button>
          </>
        ) : (
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn" onClick={onTogglePause}>
              {isPaused ? 'Resume' : 'Pause'}
            </button>
            <button class="btn btn-danger" onClick={onStopRecording}>
              Stop &amp; summarize ({formatTimestamp(meter.elapsedSec)})
            </button>
          </div>
        )}
      </div>

      {isRecording && (
        <div class="meter-row">
          {(activeMode === 'system+mic' || activeMode === 'system') && (
            <div class="meter-box">
              <div class="meter-head">
                <span style="display:inline-flex;align-items:center;gap:6px;">
                  <span class="dot dot-pulse" />
                  <strong>Call audio</strong>
                </span>
                <button
                  class="btn btn-sm"
                  onClick={() => {
                    const next = !sysMuted;
                    setSysMuted(next);
                    onToggleSystemMute(next);
                  }}
                >
                  {sysMuted ? 'Unmute' : 'Mute'}
                </button>
              </div>
              <div class="meter-track">
                <div
                  class="meter-fill"
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
                  <strong>Your microphone</strong>
                </span>
                <button
                  class="btn btn-sm"
                  onClick={() => {
                    const next = !micMuted;
                    setMicMuted(next);
                    onToggleMicMute(next);
                  }}
                >
                  {micMuted ? 'Unmute' : 'Mute'}
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
            <strong>Live notes:</strong>{' '}
            {liveCaptions
              .slice(-3)
              .map((c) => c.text)
              .join(' ')}
          </div>
          <span class="pill">Full transcript builds when you stop</span>
        </div>
      )}

      {isProcessing && (
        <div class="banner banner-ok">
          <span>{processingLabel || 'Creating your private meeting notes...'}</span>
          <span class="pill pill-green">On-device</span>
        </div>
      )}

      {!isRecording && !isProcessing && (
        <details class="options-disclosure">
          <summary>Recording options (app, microphone, speech accuracy)</summary>
          <div class="options-grid">
            <div>
              <label class="field-label" for="qb-platform">
                Meeting app
              </label>
              <select
                id="qb-platform"
                class="select"
                value={platform}
                onChange={(e) =>
                  setPlatform((e.target as HTMLSelectElement).value as MeetingPlatform)
                }
              >
                <option value="Zoom">Zoom</option>
                <option value="Google Meet">Google Meet</option>
                <option value="Microsoft Teams">Microsoft Teams</option>
                <option value="System Audio">Any other app</option>
              </select>
            </div>

            <div>
              <label class="field-label" for="qb-audio-mode">
                What to record
              </label>
              <select
                id="qb-audio-mode"
                class="select"
                value={mode}
                onChange={(e) =>
                  setMode((e.target as HTMLSelectElement).value as AudioSourceMode)
                }
              >
                <option value="system+mic">Call audio + your mic</option>
                <option value="system">Call audio only</option>
                <option value="mic">Microphone only</option>
              </select>
            </div>

            <div>
              <label class="field-label" for="qb-whisper-model">
                Transcription speed / accuracy
              </label>
              <select
                id="qb-whisper-model"
                class="select"
                value={whisperModel}
                onChange={(e) =>
                  setWhisperModel((e.target as HTMLSelectElement).value as WhisperModelId)
                }
              >
                <option value="Xenova/whisper-tiny.en">Fast (~40 MB)</option>
                <option value="Xenova/whisper-base.en">Balanced (~75 MB)</option>
                <option value="Xenova/whisper-small.en">Most accurate (~240 MB)</option>
              </select>
            </div>
          </div>

          <div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input
                type="checkbox"
                checked={liveDraft}
                onChange={(e) => setLiveDraft((e.target as HTMLInputElement).checked)}
              />
              Show live draft captions while recording
            </label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              {SAMPLE_MEETING_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  class="btn btn-sm"
                  onClick={() => onLoadSample(preset)}
                >
                  Load {preset.platform} sample
                </button>
              ))}
            </div>
          </div>
        </details>
      )}
    </section>
  );
}
