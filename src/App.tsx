import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  ActionItem,
  AudioSourceMode,
  MeetingPlatform,
  MeetingRecord,
  SummaryEngineMode,
  TranscriptSegment,
  WhisperModelId,
} from './types/meeting';
import {
  createSampleToneWav,
  decodeAudioTo16kMono,
  type SamplePreset,
} from './core/audio-utils';
import { extractExecutiveBrief, formatTimestamp } from './core/brief-extractor';
import {
  deleteMeeting,
  ensureInitialSampleMeetings,
  getAudioBlob,
  saveMeeting,
} from './services/storage';
import {
  startAudioCapture,
  type AudioMeterSnapshot,
  type CaptureSession,
  type LiveDraftCaption,
} from './services/audio-capture';
import { transcribeAudioLocally } from './services/whisper-transcriber';
import {
  generateExecutiveBrief,
  probeOllama,
  type OllamaStatus,
} from './services/local-llm';
import { RecorderPanel } from './components/RecorderPanel';
import { BriefWorkspace } from './components/BriefWorkspace';
import { ActionsTrackerView } from './components/ActionsTrackerView';
import { DesktopHardwareView } from './components/DesktopHardwareView';

type ActiveTab = 'workspace' | 'actions' | 'desktop';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function App() {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('workspace');
  const [searchQuery, setSearchQuery] = useState('');
  const [bannerError, setBannerError] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('');
  const [meter, setMeter] = useState<AudioMeterSnapshot>({
    systemLevel: 0,
    micLevel: 0,
    elapsedSec: 0,
  });
  const [liveCaptions, setLiveCaptions] = useState<LiveDraftCaption[]>([]);
  const [activeMode, setActiveMode] = useState<AudioSourceMode>('system+mic');
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({
    available: false,
    models: [],
  });
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  const captureRef = useRef<CaptureSession | null>(null);
  const pendingMetaRef = useRef<{
    title: string;
    platform: MeetingPlatform;
    mode: AudioSourceMode;
    whisperModel: WhisperModelId;
  } | null>(null);
  const liveCaptionsRef = useRef<LiveDraftCaption[]>([]);

  const refreshOllama = () => {
    void probeOllama().then(setOllamaStatus);
  };

  useEffect(() => {
    void ensureInitialSampleMeetings().then((loaded) => {
      setMeetings(loaded);
      if (loaded.length > 0) setSelectedId(loaded[0].id);
    });
    refreshOllama();

    const onBeforeInstall = (ev: Event) => {
      ev.preventDefault();
      setInstallEvent(ev as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const persistMeetingUpdate = async (updated: MeetingRecord, audioBlob?: Blob) => {
    await saveMeeting(updated, audioBlob);
    setMeetings((prev) => {
      const exists = prev.some((m) => m.id === updated.id);
      const next = exists
        ? prev.map((m) => (m.id === updated.id ? updated : m))
        : [updated, ...prev];
      return next.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
    setSelectedId(updated.id);
  };

  const transcribeAndDistill = async (opts: {
    id: string;
    title: string;
    platform: MeetingPlatform;
    mode: AudioSourceMode;
    blob: Blob;
    durationHintSec: number;
    whisperModel: WhisperModelId;
    fallbackCaptions?: LiveDraftCaption[];
  }) => {
    setIsProcessing(true);
    setBannerError('');
    setProcessingLabel('Decoding audio locally to 16 kHz mono PCM...');

    let decodedSamples: Float32Array | null = null;
    let durationSec = opts.durationHintSec;

    try {
      const decoded = await decodeAudioTo16kMono(opts.blob);
      decodedSamples = decoded.samples;
      if (decoded.durationSec > 0) durationSec = Math.round(decoded.durationSec);
    } catch (err) {
      setBannerError(
        `Audio decode notice: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    let segments: TranscriptSegment[] = [];
    let whisperLabel = `${opts.whisperModel} (Local)`;

    if (decodedSamples) {
      try {
        const speakerLabel =
          opts.mode === 'mic'
            ? 'You'
            : opts.mode === 'system'
            ? 'Call Audio'
            : 'Speaker';
        const channel =
          opts.mode === 'mic' ? 'local' : opts.mode === 'system' ? 'remote' : 'mixed';

        const res = await transcribeAudioLocally({
          samples16kMono: decodedSamples,
          durationSec,
          modelId: opts.whisperModel,
          defaultSpeaker: speakerLabel,
          channel,
          onProgress: (ev) => setProcessingLabel(ev.message),
        });
        segments = res.segments;
        whisperLabel = `${opts.whisperModel.replace('Xenova/', '')} · ${res.device.toUpperCase()}`;
      } catch (err) {
        setBannerError(
          `Whisper worker notice: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Fall back to live draft captions if Whisper returned nothing or offline CDN failed
    if (segments.length === 0 && opts.fallbackCaptions && opts.fallbackCaptions.length > 0) {
      const finalDrafts = opts.fallbackCaptions.filter((c) => c.isFinal);
      const sourceDrafts = finalDrafts.length > 0 ? finalDrafts : opts.fallbackCaptions;
      segments = sourceDrafts.map((c, idx) => ({
        id: `draft-${idx + 1}`,
        startSec: c.timestampSec,
        endSec: c.timestampSec + 4,
        speaker: 'You (Draft)',
        channel: 'local',
        text: c.text,
      }));
      whisperLabel = 'Browser Speech Draft';
    }

    setProcessingLabel('Synthesizing local Executive Brief...');
    let brief = extractExecutiveBrief(segments, opts.title);
    if (ollamaStatus.available && ollamaStatus.models.length > 0 && segments.length > 0) {
      try {
        brief = await generateExecutiveBrief({
          mode: 'ollama',
          segments,
          meetingTitle: opts.title,
          ollamaModel: ollamaStatus.models[0],
          onStatus: setProcessingLabel,
        });
      } catch {
        // Already have instant-local brief ready
      }
    }

    const record: MeetingRecord = {
      id: opts.id,
      title: opts.title,
      createdAt: new Date().toISOString(),
      durationSec: Math.max(1, durationSec),
      platform: opts.platform,
      audioSourceMode: opts.mode,
      audioMimeType: opts.blob.type,
      hasAudioBlob: true,
      whisperModel: whisperLabel,
      segments,
      brief,
      status: 'ready',
    };

    await persistMeetingUpdate(record, opts.blob);
    setActiveTab('workspace');
    setIsProcessing(false);
    setProcessingLabel('');
  };

  const handleStartRecording = async (opts: {
    title: string;
    platform: MeetingPlatform;
    mode: AudioSourceMode;
    whisperModel: WhisperModelId;
    liveDraft: boolean;
  }) => {
    setBannerError('');
    setLiveCaptions([]);
    liveCaptionsRef.current = [];

    try {
      const session = await startAudioCapture({
        mode: opts.mode,
        enableLiveDraftCaptions: opts.liveDraft,
        onMeter: setMeter,
        onLiveCaption: (cap) => {
          const next = [...liveCaptionsRef.current.slice(-24), cap];
          liveCaptionsRef.current = next;
          setLiveCaptions(next);
        },
      });
      captureRef.current = session;
      pendingMetaRef.current = {
        title: opts.title,
        platform: opts.platform,
        mode: opts.mode,
        whisperModel: opts.whisperModel,
      };
      setActiveMode(opts.mode);
      setIsPaused(false);
      setIsRecording(true);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Unable to start audio capture.');
    }
  };

  const handleStopRecording = async () => {
    const session = captureRef.current;
    const meta = pendingMetaRef.current;
    if (!session || !meta) return;

    captureRef.current = null;
    setIsRecording(false);
    setIsPaused(false);

    const { blob, durationSec } = await session.stop();
    await transcribeAndDistill({
      id: `meeting-${Date.now()}`,
      title: meta.title,
      platform: meta.platform,
      mode: meta.mode,
      blob,
      durationHintSec: durationSec,
      whisperModel: meta.whisperModel,
      fallbackCaptions: liveCaptionsRef.current,
    });
  };

  const handleImportFile = async (file: File, title: string, whisperModel: WhisperModelId) => {
    await transcribeAndDistill({
      id: `meeting-${Date.now()}`,
      title,
      platform: 'Audio Import',
      mode: 'file',
      blob: file,
      durationHintSec: 10,
      whisperModel,
    });
  };

  const handleLoadSample = async (preset: SamplePreset) => {
    setBannerError('');
    const sampleAudio = createSampleToneWav(6);
    const brief = extractExecutiveBrief(preset.segments, preset.title);
    const record: MeetingRecord = {
      id: `meeting-${preset.id}-${Date.now()}`,
      title: preset.title,
      createdAt: new Date().toISOString(),
      durationSec: preset.durationSec,
      platform: preset.platform,
      audioSourceMode: 'system+mic',
      audioMimeType: sampleAudio.type,
      hasAudioBlob: true,
      whisperModel: 'Sample Preset (Zero-Bot Demo)',
      segments: preset.segments,
      brief,
      status: 'ready',
    };
    await persistMeetingUpdate(record, sampleAudio);
    setActiveTab('workspace');
  };

  const selectedMeeting =
    meetings.find((m) => m.id === selectedId) || meetings[0] || null;

  const toggleTask = async (meetingId: string, taskId: string) => {
    const target = meetings.find((m) => m.id === meetingId);
    if (!target) return;
    const updated: MeetingRecord = {
      ...target,
      brief: {
        ...target.brief,
        actionItems: target.brief.actionItems.map((item) =>
          item.id === taskId ? { ...item, completed: !item.completed } : item
        ),
      },
    };
    await persistMeetingUpdate(updated);
  };

  const addTask = async (meetingId: string, newItem: Omit<ActionItem, 'id'>) => {
    const target = meetings.find((m) => m.id === meetingId);
    if (!target) return;
    const updated: MeetingRecord = {
      ...target,
      brief: {
        ...target.brief,
        actionItems: [
          ...target.brief.actionItems,
          { ...newItem, id: `act-${Date.now()}` },
        ],
      },
    };
    await persistMeetingUpdate(updated);
  };

  const renameSpeaker = async (meetingId: string, oldName: string, newName: string) => {
    const target = meetings.find((m) => m.id === meetingId);
    if (!target) return;
    const updated: MeetingRecord = {
      ...target,
      segments: target.segments.map((s) =>
        s.speaker === oldName ? { ...s, speaker: newName } : s
      ),
      brief: {
        ...target.brief,
        decisions: target.brief.decisions.map((d) =>
          d.decidedBy === oldName ? { ...d, decidedBy: newName } : d
        ),
        actionItems: target.brief.actionItems.map((a) =>
          a.owner === oldName ? { ...a, owner: newName } : a
        ),
        unansweredQuestions: target.brief.unansweredQuestions.map((q) =>
          q.raisedBy === oldName ? { ...q, raisedBy: newName } : q
        ),
      },
    };
    await persistMeetingUpdate(updated);
  };

  const regenerateBrief = async (
    meetingId: string,
    mode: SummaryEngineMode,
    modelName?: string
  ) => {
    const target = meetings.find((m) => m.id === meetingId);
    if (!target) return;
    setBannerError('');
    setIsProcessing(true);
    setProcessingLabel('Running local Executive Brief engine...');
    try {
      const brief = await generateExecutiveBrief({
        mode,
        segments: target.segments,
        meetingTitle: target.title,
        ollamaModel: mode === 'ollama' ? modelName : undefined,
        webGpuModelPreference: mode === 'webgpu-llm' ? modelName : undefined,
        onStatus: setProcessingLabel,
      });
      await persistMeetingUpdate({ ...target, brief });
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Failed to regenerate brief.');
    } finally {
      setIsProcessing(false);
      setProcessingLabel('');
    }
  };

  const retranscribeAudio = async (meetingId: string, modelId: WhisperModelId) => {
    const target = meetings.find((m) => m.id === meetingId);
    if (!target) return;
    const blob = await getAudioBlob(meetingId);
    if (!blob) {
      setBannerError('No stored audio found for this meeting.');
      return;
    }
    setBannerError('');
    setIsProcessing(true);
    setProcessingLabel('Decoding stored local audio...');
    try {
      const decoded = await decodeAudioTo16kMono(blob);
      const res = await transcribeAudioLocally({
        samples16kMono: decoded.samples,
        durationSec: decoded.durationSec || target.durationSec,
        modelId,
        onProgress: (ev) => setProcessingLabel(ev.message),
      });
      const brief = extractExecutiveBrief(res.segments, target.title);
      await persistMeetingUpdate({
        ...target,
        whisperModel: `${modelId.replace('Xenova/', '')} · ${res.device.toUpperCase()}`,
        segments: res.segments,
        brief,
      });
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Local Whisper transcription failed.');
    } finally {
      setIsProcessing(false);
      setProcessingLabel('');
    }
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    await deleteMeeting(meetingId);
    const remaining = meetings.filter((m) => m.id !== meetingId);
    setMeetings(remaining);
    if (selectedId === meetingId) {
      setSelectedId(remaining[0]?.id || '');
    }
  };

  const filteredMeetings = searchQuery.trim()
    ? meetings.filter((m) => {
        const q = searchQuery.toLowerCase();
        return (
          m.title.toLowerCase().includes(q) ||
          m.segments.some((s) => s.text.toLowerCase().includes(q)) ||
          m.brief.actionItems.some(
            (a) => a.task.toLowerCase().includes(q) || a.owner.toLowerCase().includes(q)
          )
        );
      })
    : meetings;

  const openActionCount = meetings.reduce(
    (sum, m) => sum + m.brief.actionItems.filter((a) => !a.completed).length,
    0
  );

  return (
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-left">
            <div class="brand-mark">Q</div>
            <div>
              <div class="brand-title">QuietBrief</div>
              <div class="brand-sub">Bot-Free · Local AI Briefs</div>
            </div>
          </div>
          <span class="pill pill-green">v1.0</span>
        </div>

        <div class="nav-pills">
          <button
            class={`nav-pill ${activeTab === 'workspace' ? 'active' : ''}`}
            onClick={() => setActiveTab('workspace')}
          >
            Meetings
          </button>
          <button
            class={`nav-pill ${activeTab === 'actions' ? 'active' : ''}`}
            onClick={() => setActiveTab('actions')}
          >
            Tasks ({openActionCount})
          </button>
          <button
            class={`nav-pill ${activeTab === 'desktop' ? 'active' : ''}`}
            onClick={() => setActiveTab('desktop')}
          >
            Desktop
          </button>
        </div>

        <input
          class="input"
          type="search"
          placeholder="Search meetings, tasks, quotes..."
          value={searchQuery}
          onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
        />

        <div class="meeting-list">
          {filteredMeetings.length === 0 ? (
            <div style="font-size:12px;color:var(--text-dim);padding:10px;">
              No meetings yet. Start a bot-free recording or drop an audio file.
            </div>
          ) : (
            filteredMeetings.map((m) => {
              const open = m.brief.actionItems.filter((a) => !a.completed).length;
              return (
                <button
                  key={m.id}
                  class={`meeting-item ${selectedMeeting?.id === m.id && activeTab === 'workspace' ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedId(m.id);
                    setActiveTab('workspace');
                  }}
                >
                  <div class="meeting-item-title">{m.title}</div>
                  <div class="meeting-item-meta">
                    <span>
                      {m.platform} · {formatTimestamp(m.durationSec)}
                    </span>
                    <span>{open > 0 ? `${open} tasks` : 'All clear'}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div class="privacy-footer">
          <div class="privacy-badge">
            <span class="dot" />
            <span>0 bytes uploaded · Local Vault</span>
          </div>
          <div>
            {'gpu' in navigator ? 'WebGPU acceleration detected' : 'WASM local runtime ready'} ·{' '}
            {ollamaStatus.available
              ? `Ollama (${ollamaStatus.models.length} models)`
              : 'Instant Brief active'}
          </div>
        </div>
      </aside>

      <main class="main-area">
        <header class="topbar">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span class="pill pill-green">No Meeting Bots</span>
            <span class="pill">Zoom · Meet · Teams</span>
            <span class="pill pill-indigo">
              {ollamaStatus.available ? 'Local GPU Ollama Ready' : 'On-Device Whisper + Brief'}
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            {installEvent && (
              <button
                class="btn btn-sm btn-primary"
                onClick={() => {
                  void installEvent.prompt();
                }}
              >
                Install Desktop App
              </button>
            )}
            <button class="btn btn-sm" onClick={() => setActiveTab('desktop')}>
              Windows &amp; Mac Setup
            </button>
          </div>
        </header>

        {bannerError && (
          <div style="margin:14px 24px 0;">
            <div class="banner banner-warn">
              <span>{bannerError}</span>
              <button class="btn btn-sm" onClick={() => setBannerError('')}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {activeTab === 'workspace' && (
          <>
            <RecorderPanel
              isRecording={isRecording}
              isPaused={isPaused}
              isProcessing={isProcessing}
              processingLabel={processingLabel}
              meter={meter}
              liveCaptions={liveCaptions}
              activeMode={activeMode}
              onStartRecording={handleStartRecording}
              onTogglePause={() => {
                if (!captureRef.current) return;
                if (isPaused) {
                  captureRef.current.resume();
                  setIsPaused(false);
                } else {
                  captureRef.current.pause();
                  setIsPaused(true);
                }
              }}
              onStopRecording={handleStopRecording}
              onToggleMicMute={(muted) => captureRef.current?.setMicMuted(muted)}
              onToggleSystemMute={(muted) => captureRef.current?.setSystemMuted(muted)}
              onImportFile={handleImportFile}
              onLoadSample={handleLoadSample}
            />

            {selectedMeeting ? (
              <BriefWorkspace
                meeting={selectedMeeting}
                ollamaStatus={ollamaStatus}
                isBusy={isProcessing || isRecording}
                onToggleTask={(taskId) => void toggleTask(selectedMeeting.id, taskId)}
                onAddTask={(task) => void addTask(selectedMeeting.id, task)}
                onRenameSpeaker={(oldName, newName) =>
                  void renameSpeaker(selectedMeeting.id, oldName, newName)
                }
                onRegenerateBrief={(mode, model) =>
                  void regenerateBrief(selectedMeeting.id, mode, model)
                }
                onRetranscribeAudio={(modelId) =>
                  void retranscribeAudio(selectedMeeting.id, modelId)
                }
                onDeleteMeeting={(id) => void handleDeleteMeeting(id)}
              />
            ) : (
              <div class="page-pad">
                <div class="card">
                  <h2 style="margin:0;">Ready for your first bot-free meeting</h2>
                  <p style="margin:0;color:var(--text-muted);">
                    Click <strong>Start Bot-Free Recording</strong> above, drop a recording file, or load a sample meeting to inspect the structured Executive Brief.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'actions' && (
          <ActionsTrackerView
            meetings={meetings}
            onToggleTask={(mId, tId) => void toggleTask(mId, tId)}
            onOpenMeeting={(mId) => {
              setSelectedId(mId);
              setActiveTab('workspace');
            }}
          />
        )}

        {activeTab === 'desktop' && (
          <DesktopHardwareView
            ollamaStatus={ollamaStatus}
            onRefreshOllama={refreshOllama}
            canInstallPwa={Boolean(installEvent)}
            onInstallPwa={() => {
              if (installEvent) void installEvent.prompt();
            }}
          />
        )}
      </main>
    </div>
  );
}
