import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  ActionItem,
  MeetingRecord,
  SummaryEngineMode,
  WhisperModelId,
} from '../types/meeting';
import { formatTimestamp } from '../core/brief-extractor';
import { toJsonExport, toMarkdownBrief, toSrt } from '../core/exporters';
import { getAudioBlob } from '../services/storage';
import type { OllamaStatus } from '../services/local-llm';

interface BriefWorkspaceProps {
  meeting: MeetingRecord;
  ollamaStatus: OllamaStatus;
  isBusy: boolean;
  onToggleTask: (taskId: string) => void;
  onAddTask: (task: Omit<ActionItem, 'id'>) => void;
  onRenameSpeaker: (oldName: string, newName: string) => void;
  onRegenerateBrief: (mode: SummaryEngineMode, modelName?: string) => void;
  onRetranscribeAudio: (modelId: WhisperModelId) => void;
  onDeleteMeeting: (meetingId: string) => void;
}

type MeetingSectionTab = 'summary' | 'tasks' | 'transcript';

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BriefWorkspace(props: BriefWorkspaceProps) {
  const {
    meeting,
    ollamaStatus,
    isBusy,
    onToggleTask,
    onAddTask,
    onRenameSpeaker,
    onRegenerateBrief,
    onRetranscribeAudio,
    onDeleteMeeting,
  } = props;

  const [sectionTab, setSectionTab] = useState<MeetingSectionTab>('summary');
  const [engineMode, setEngineMode] = useState<SummaryEngineMode>(
    ollamaStatus.available ? 'ollama' : 'instant-local'
  );
  const [ollamaModel, setOllamaModel] = useState<string>(ollamaStatus.models[0] || 'qwen2.5:3b');
  const [webGpuModel, setWebGpuModel] = useState<string>('Qwen2.5-1.5B-Instruct');
  const [transcriptQuery, setTranscriptQuery] = useState('');
  const [copiedNotice, setCopiedNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskOwner, setNewTaskOwner] = useState('You');
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskDeadline, setNewTaskDeadline] = useState('Friday');
  const [retranscribeModel, setRetranscribeModel] = useState<WhisperModelId>('Xenova/whisper-tiny.en');
  const [renamingSpeaker, setRenamingSpeaker] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const audioRef = useRef<HTMLAudioElement>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setConfirmDelete(false);
    setRenamingSpeaker(null);
  }, [meeting.id]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setAudioUrl(null);

    if (meeting.hasAudioBlob) {
      getAudioBlob(meeting.id).then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setAudioUrl(objectUrl);
      });
    }

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meeting.id, meeting.hasAudioBlob]);

  useEffect(() => {
    if (ollamaStatus.available && ollamaStatus.models.length > 0 && !ollamaStatus.models.includes(ollamaModel)) {
      setOllamaModel(ollamaStatus.models[0]);
    }
  }, [ollamaStatus]);

  const jumpToSec = (sec: number) => {
    setSectionTab('transcript');
    window.setTimeout(() => {
      const el = audioRef.current;
      if (!el) return;
      el.currentTime = Math.max(0, sec);
      void el.play().catch(() => {
        // User gesture or short sample audio duration
      });
    }, 30);
  };

  const slug =
    meeting.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'meeting-notes';

  const { brief } = meeting;
  const filteredSegments = transcriptQuery.trim()
    ? meeting.segments.filter(
        (s) =>
          s.text.toLowerCase().includes(transcriptQuery.toLowerCase()) ||
          s.speaker.toLowerCase().includes(transcriptQuery.toLowerCase())
      )
    : meeting.segments;

  const openTasks = brief.actionItems.filter((a) => !a.completed).length;

  return (
    <div class="stack">
      {/* Meeting Document Header */}
      <div class="card">
        <div class="card-header">
          <div>
            <h1 style="margin:0;font-size:21px;letter-spacing:-0.02em;">{meeting.title}</h1>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
              <span class="pill pill-green">{meeting.platform}</span>
              <span class="pill tabular-nums">{formatTimestamp(meeting.durationSec)}</span>
              <span class="pill">{brief.actionItems.length} action items</span>
              <span class="pill">{brief.decisions.length} decisions</span>
            </div>
          </div>

          <div class="no-print" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <button
              class="btn btn-sm"
              onClick={() => {
                void navigator.clipboard?.writeText(toMarkdownBrief(meeting));
                setCopiedNotice('Copied');
                if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
                copyTimerRef.current = window.setTimeout(() => setCopiedNotice(''), 2000);
              }}
            >
              {copiedNotice || 'Copy notes'}
            </button>
            <button
              class="btn btn-sm"
              onClick={() => downloadText(`${slug}.md`, toMarkdownBrief(meeting), 'text/markdown')}
            >
              Download .md
            </button>
            <button class="btn btn-sm" onClick={() => window.print()}>
              Print
            </button>
            {confirmDelete ? (
              <>
                <button
                  class="btn btn-sm btn-danger"
                  onClick={() => {
                    setConfirmDelete(false);
                    onDeleteMeeting(meeting.id);
                  }}
                >
                  Confirm delete
                </button>
                <button class="btn btn-sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                class="btn btn-sm"
                onClick={() => setConfirmDelete(true)}
                title="Delete this meeting from your device"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Focused Document Tabs */}
        <div class="doc-tabs no-print" role="tablist">
          <button
            class={`doc-tab ${sectionTab === 'summary' ? 'active' : ''}`}
            onClick={() => setSectionTab('summary')}
          >
            Summary
          </button>
          <button
            class={`doc-tab ${sectionTab === 'tasks' ? 'active' : ''}`}
            onClick={() => setSectionTab('tasks')}
          >
            Action items ({openTasks} open)
          </button>
          <button
            class={`doc-tab ${sectionTab === 'transcript' ? 'active' : ''}`}
            onClick={() => setSectionTab('transcript')}
          >
            Full transcript ({meeting.segments.length})
          </button>
        </div>

        {/* TAB 1: SUMMARY */}
        {sectionTab === 'summary' && (
          <div class="stack" style="gap:18px;">
            <div>
              <h2 class="card-title" style="margin-bottom:10px;">
                Key takeaways
              </h2>
              <ul class="list-clean">
                {brief.tldr.map((bullet, idx) => (
                  <li
                    key={idx}
                    style="padding:10px 12px;border-radius:9px;background:var(--bg);border:1px solid var(--border);"
                  >
                    {bullet}
                  </li>
                ))}
              </ul>
              {brief.topics.length > 0 && (
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
                  {brief.topics.map((topic, idx) => (
                    <button
                      key={idx}
                      class="timestamp-btn"
                      onClick={() => jumpToSec(topic.startSec)}
                      title="Jump to this moment in the transcript"
                    >
                      {formatTimestamp(topic.startSec)} {topic.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div class="card-header" style="margin-bottom:10px;">
                <h2 class="card-title">Decisions made</h2>
                <span class="pill pill-green">{brief.decisions.length}</span>
              </div>
              {brief.decisions.length === 0 ? (
                <div style="color:var(--text-muted);font-size:13px;">
                  No clear decisions were detected in this recording.
                </div>
              ) : (
                <ul class="list-clean">
                  {brief.decisions.map((dec) => (
                    <li
                      key={dec.id}
                      style="padding:10px 12px;border-radius:9px;background:var(--bg);border:1px solid var(--border);display:flex;justify-content:space-between;gap:10px;align-items:start;"
                    >
                      <div>
                        <div style="font-weight:600;">{dec.summary}</div>
                        <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">
                          By {dec.decidedBy}
                          {dec.rationale ? ` — ${dec.rationale}` : ''}
                        </div>
                      </div>
                      <button class="timestamp-btn" onClick={() => jumpToSec(dec.timestampSec)}>
                        {formatTimestamp(dec.timestampSec)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div class="card-header" style="margin-bottom:10px;">
                <h2 class="card-title">Open questions to follow up on</h2>
                <span class="pill pill-amber">{brief.unansweredQuestions.length}</span>
              </div>
              {brief.unansweredQuestions.length === 0 ? (
                <div style="color:var(--text-muted);font-size:13px;">
                  Every question asked during this call appears to have been answered.
                </div>
              ) : (
                <ul class="list-clean">
                  {brief.unansweredQuestions.map((q) => (
                    <li
                      key={q.id}
                      style="padding:10px 12px;border-radius:9px;background:#fffbeb;border:1px solid #fde68a;display:flex;justify-content:space-between;gap:10px;align-items:start;"
                    >
                      <div>
                        <div style="font-weight:600;">{q.question}</div>
                        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;">
                          <span class="pill">Asked by {q.raisedBy}</span>
                          {q.blocker && <span class="pill pill-rose">Needs answer soon</span>}
                        </div>
                      </div>
                      <button class="timestamp-btn" onClick={() => jumpToSec(q.timestampSec)}>
                        {formatTimestamp(q.timestampSec)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: ACTION ITEMS */}
        {sectionTab === 'tasks' && (
          <div class="stack" style="gap:12px;">
            <div class="card-header">
              <div>
                <h2 class="card-title">Action items &amp; deadlines</h2>
                <p style="margin:2px 0 0;font-size:12px;color:var(--text-muted);">
                  Check off tasks as they are finished or add a new follow-up item.
                </p>
              </div>
              <button class="btn btn-sm btn-primary no-print" onClick={() => setShowAddTask(!showAddTask)}>
                + Add task
              </button>
            </div>

            {showAddTask && (
              <div class="add-task-grid no-print">
                <input
                  class="input"
                  placeholder="Owner"
                  value={newTaskOwner}
                  onInput={(e) => setNewTaskOwner((e.target as HTMLInputElement).value)}
                />
                <input
                  class="input"
                  placeholder="What needs to be done?"
                  value={newTaskText}
                  onInput={(e) => setNewTaskText((e.target as HTMLInputElement).value)}
                />
                <input
                  class="input"
                  placeholder="Due date"
                  value={newTaskDeadline}
                  onInput={(e) => setNewTaskDeadline((e.target as HTMLInputElement).value)}
                />
                <button
                  class="btn btn-sm btn-primary"
                  onClick={() => {
                    if (!newTaskText.trim()) return;
                    onAddTask({
                      owner: newTaskOwner.trim() || 'You',
                      task: newTaskText.trim(),
                      deadline: newTaskDeadline.trim() || 'Unscheduled',
                      priority: 'medium',
                      completed: false,
                      sourceTimestampSec: 0,
                    });
                    setNewTaskText('');
                    setShowAddTask(false);
                  }}
                >
                  Save
                </button>
              </div>
            )}

            {brief.actionItems.length === 0 ? (
              <div style="color:var(--text-muted);font-size:13px;">
                No action items were detected in this meeting yet.
              </div>
            ) : (
              <ul class="list-clean">
                {brief.actionItems.map((item) => (
                  <li key={item.id} class={`task-row ${item.completed ? 'done' : ''}`}>
                    <input
                      type="checkbox"
                      checked={item.completed}
                      style="margin-top:4px;accent-color:var(--accent);width:16px;height:16px;"
                      onChange={() => onToggleTask(item.id)}
                    />
                    <div>
                      <div class="task-text" style="font-weight:500;">
                        {item.task}
                      </div>
                      <div class="task-meta">
                        <span class="pill pill-green">{item.owner}</span>
                        <span class="pill pill-amber">Due {item.deadline}</span>
                        <span
                          class={`pill ${
                            item.priority === 'high' ? 'pill-rose' : ''
                          }`}
                        >
                          {item.priority}
                        </span>
                      </div>
                    </div>
                    <button
                      class="timestamp-btn"
                      onClick={() => jumpToSec(item.sourceTimestampSec)}
                    >
                      {formatTimestamp(item.sourceTimestampSec)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* TAB 3: TRANSCRIPT & AUDIO */}
        {sectionTab === 'transcript' && (
          <div class="stack" style="gap:14px;">
            {audioUrl && (
              <div
                class="no-print"
                style="padding:12px;border-radius:10px;background:var(--bg);border:1px solid var(--border);display:flex;flex-direction:column;gap:10px;"
              >
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                  <span style="font-size:12px;font-weight:600;color:var(--text-muted);">
                    Audio playback
                  </span>
                  <div style="display:flex;gap:4px;">
                    {[1, 1.25, 1.5, 2].map((rate) => (
                      <button
                        key={rate}
                        class={`btn btn-sm ${playbackRate === rate ? 'btn-primary' : ''}`}
                        onClick={() => {
                          setPlaybackRate(rate);
                          if (audioRef.current) audioRef.current.playbackRate = rate;
                        }}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>
                <audio ref={audioRef} controls src={audioUrl} style="width:100%;" />
              </div>
            )}

            <input
              class="input no-print"
              type="search"
              placeholder="Search transcript by keyword or speaker name..."
              value={transcriptQuery}
              onInput={(e) => setTranscriptQuery((e.target as HTMLInputElement).value)}
            />

            {renamingSpeaker && (
              <div
                class="no-print"
                style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px;border-radius:9px;background:var(--accent-soft);border:1px solid #bfe0d2;"
              >
                <span style="font-size:12px;font-weight:600;">
                  Rename &ldquo;{renamingSpeaker}&rdquo; everywhere:
                </span>
                <input
                  class="input"
                  style="width:180px;padding:5px 8px;"
                  value={renameDraft}
                  onInput={(e) => setRenameDraft((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setRenamingSpeaker(null);
                    if (e.key === 'Enter' && renameDraft.trim()) {
                      onRenameSpeaker(renamingSpeaker, renameDraft.trim());
                      setRenamingSpeaker(null);
                    }
                  }}
                />
                <button
                  class="btn btn-sm btn-primary"
                  onClick={() => {
                    if (renameDraft.trim() && renameDraft.trim() !== renamingSpeaker) {
                      onRenameSpeaker(renamingSpeaker, renameDraft.trim());
                    }
                    setRenamingSpeaker(null);
                  }}
                >
                  Save name
                </button>
                <button class="btn btn-sm" onClick={() => setRenamingSpeaker(null)}>
                  Cancel
                </button>
              </div>
            )}

            <div class="stack" style="gap:8px;max-height:60vh;overflow-y:auto;">
              {filteredSegments.length === 0 ? (
                <div style="color:var(--text-muted);font-size:13px;">
                  {meeting.segments.length === 0
                    ? 'No spoken words were captured in this recording.'
                    : 'No transcript lines match your search.'}
                </div>
              ) : (
                filteredSegments.map((seg) => (
                  <div key={seg.id} class="segment-row">
                    <div class="segment-head">
                      <button
                        class={`speaker-name ${seg.channel === 'local' ? 'speaker-local' : ''}`}
                        title="Click to rename this speaker"
                        onClick={() => {
                          setRenamingSpeaker(seg.speaker);
                          setRenameDraft(seg.speaker);
                        }}
                      >
                        {seg.speaker}
                      </button>
                      <button
                        class="timestamp-btn"
                        onClick={() => jumpToSec(seg.startSec)}
                        title="Play audio from this timestamp"
                      >
                        {formatTimestamp(seg.startSec)}
                      </button>
                    </div>
                    <div style="font-size:13px;color:var(--text);">{seg.text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Advanced Options Tucked Quietly at Bottom */}
        <details class="options-disclosure no-print">
          <summary>Advanced AI summary, re-transcribe &amp; export formats</summary>
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:12px;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-weight:600;">Summary engine:</span>
              <select
                class="select"
                style="width:auto;padding:5px 9px;font-size:12px;"
                value={engineMode}
                onChange={(e) =>
                  setEngineMode((e.target as HTMLSelectElement).value as SummaryEngineMode)
                }
              >
                <option value="instant-local">Built-in instant summary (offline)</option>
                <option value="ollama">
                  Local Ollama {ollamaStatus.available ? `(${ollamaStatus.models.length} models)` : '(not connected)'}
                </option>
                <option value="webgpu-llm">In-browser WebGPU model</option>
              </select>

              {engineMode === 'ollama' && (
                <input
                  class="input"
                  style="width:165px;padding:5px 8px;font-size:12px;"
                  value={ollamaModel}
                  list="qb-ollama-models"
                  onInput={(e) => setOllamaModel((e.target as HTMLInputElement).value)}
                  placeholder="qwen2.5:3b"
                />
              )}
              <datalist id="qb-ollama-models">
                {ollamaStatus.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>

              {engineMode === 'webgpu-llm' && (
                <select
                  class="select"
                  style="width:auto;padding:5px 8px;font-size:12px;"
                  value={webGpuModel}
                  onChange={(e) => setWebGpuModel((e.target as HTMLSelectElement).value)}
                >
                  <option value="Qwen2.5-1.5B-Instruct">Qwen2.5 1.5B</option>
                  <option value="Llama-3.2-1B-Instruct">Llama 3.2 1B</option>
                  <option value="SmolLM2-360M-Instruct">SmolLM2 360M (Fastest)</option>
                </select>
              )}

              <button
                class="btn btn-sm btn-primary"
                disabled={isBusy || meeting.segments.length === 0}
                onClick={() =>
                  onRegenerateBrief(
                    engineMode,
                    engineMode === 'ollama'
                      ? ollamaModel
                      : engineMode === 'webgpu-llm'
                      ? webGpuModel
                      : undefined
                  )
                }
              >
                Refresh summary
              </button>
            </div>

            {audioUrl && (
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span style="font-weight:600;">Re-transcribe audio:</span>
                <select
                  class="select"
                  style="width:auto;padding:5px 8px;font-size:12px;"
                  value={retranscribeModel}
                  onChange={(e) =>
                    setRetranscribeModel((e.target as HTMLSelectElement).value as WhisperModelId)
                  }
                >
                  <option value="Xenova/whisper-tiny.en">Whisper Tiny (fast)</option>
                  <option value="Xenova/whisper-base.en">Whisper Base (balanced)</option>
                  <option value="Xenova/whisper-small.en">Whisper Small (accurate)</option>
                </select>
                <button
                  class="btn btn-sm"
                  disabled={isBusy}
                  onClick={() => onRetranscribeAudio(retranscribeModel)}
                >
                  Run again locally
                </button>
              </div>
            )}

            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-weight:600;">Extra exports:</span>
              <button
                class="btn btn-sm"
                onClick={() => downloadText(`${slug}.srt`, toSrt(meeting.segments), 'text/plain')}
              >
                Subtitles (.srt)
              </button>
              <button
                class="btn btn-sm"
                onClick={() => downloadText(`${slug}.json`, toJsonExport(meeting), 'application/json')}
              >
                Raw data (.json)
              </button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
