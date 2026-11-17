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

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

  const [engineMode, setEngineMode] = useState<SummaryEngineMode>(
    ollamaStatus.available ? 'ollama' : 'instant-local'
  );
  const [ollamaModel, setOllamaModel] = useState<string>(ollamaStatus.models[0] || 'qwen2.5:3b');
  const [webGpuModel, setWebGpuModel] = useState<string>('Qwen2.5-1.5B-Instruct');
  const [transcriptQuery, setTranscriptQuery] = useState('');
  const [copiedNotice, setCopiedNotice] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskOwner, setNewTaskOwner] = useState('You');
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskDeadline, setNewTaskDeadline] = useState('Friday');
  const [retranscribeModel, setRetranscribeModel] = useState<WhisperModelId>('Xenova/whisper-tiny.en');

  const audioRef = useRef<HTMLAudioElement>(null);

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
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, sec);
    void el.play().catch(() => {
      // User gesture or unsupported sample audio duration
    });
  };

  const slug = meeting.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'meeting-brief';

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
    <div class="workspace-split">
      {/* LEFT COLUMN: EXECUTIVE ACTION BRIEF */}
      <div class="stack">
        <div class="card">
          <div class="card-header">
            <div>
              <h1 style="margin:0;font-size:19px;letter-spacing:-0.02em;">{meeting.title}</h1>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
                <span class="pill pill-green">{meeting.platform}</span>
                <span class="pill">{formatTimestamp(meeting.durationSec)}</span>
                <span class="pill pill-indigo">{brief.generatedBy}</span>
                {meeting.whisperModel && <span class="pill">{meeting.whisperModel}</span>}
              </div>
            </div>
            <div class="no-print" style="display:flex;gap:6px;flex-wrap:wrap;">
              <button
                class="btn btn-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(toMarkdownBrief(meeting));
                  setCopiedNotice('Markdown copied');
                  window.setTimeout(() => setCopiedNotice(''), 2000);
                }}
              >
                {copiedNotice || 'Copy Brief'}
              </button>
              <button
                class="btn btn-sm"
                onClick={() => downloadText(`${slug}.md`, toMarkdownBrief(meeting), 'text/markdown')}
              >
                .md
              </button>
              <button
                class="btn btn-sm"
                onClick={() => downloadText(`${slug}.srt`, toSrt(meeting.segments), 'text/plain')}
              >
                .srt
              </button>
              <button
                class="btn btn-sm"
                onClick={() => downloadText(`${slug}.json`, toJsonExport(meeting), 'application/json')}
              >
                .json
              </button>
              <button class="btn btn-sm" onClick={() => window.print()}>
                Print/PDF
              </button>
              <button
                class="btn btn-sm btn-danger"
                onClick={() => onDeleteMeeting(meeting.id)}
                title="Delete meeting from local IndexedDB"
              >
                Delete
              </button>
            </div>
          </div>

          <div
            class="no-print"
            style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--border);"
          >
            <span style="font-size:12px;color:var(--text-muted);font-weight:600;">Local LLM Engine:</span>
            <select
              class="select"
              style="width:auto;padding:5px 9px;font-size:12px;"
              value={engineMode}
              onChange={(e) => setEngineMode((e.target as HTMLSelectElement).value as SummaryEngineMode)}
            >
              <option value="instant-local">Instant Local Brief (Zero Download)</option>
              <option value="ollama">
                Local Ollama GPU {ollamaStatus.available ? `(${ollamaStatus.models.length} models ready)` : '(Offline)'}
              </option>
              <option value="webgpu-llm">In-Browser WebGPU Quantized LLM</option>
            </select>

            {engineMode === 'ollama' && (
              <input
                class="input"
                style="width:170px;padding:5px 8px;font-size:12px;"
                value={ollamaModel}
                list="qb-ollama-models"
                onInput={(e) => setOllamaModel((e.target as HTMLInputElement).value)}
                placeholder="Model e.g. qwen2.5:3b"
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
                <option value="Qwen2.5-1.5B-Instruct">Qwen2.5 1.5B (4-bit WebGPU)</option>
                <option value="Llama-3.2-1B-Instruct">Llama 3.2 1B (4-bit WebGPU)</option>
                <option value="SmolLM2-360M-Instruct">SmolLM2 360M (Fastest)</option>
              </select>
            )}

            <button
              class="btn btn-sm btn-primary"
              disabled={isBusy || meeting.segments.length === 0}
              onClick={() =>
                onRegenerateBrief(
                  engineMode,
                  engineMode === 'ollama' ? ollamaModel : engineMode === 'webgpu-llm' ? webGpuModel : undefined
                )
              }
            >
              Re-distill Executive Brief
            </button>
          </div>
        </div>

        {/* EXECUTIVE TL;DR */}
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Executive Summary</h2>
            <span class="pill pill-green">{brief.tldr.length} key points</span>
          </div>
          <ul class="list-clean">
            {brief.tldr.map((bullet, idx) => (
              <li
                key={idx}
                style="padding:8px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--border);"
              >
                {bullet}
              </li>
            ))}
          </ul>
          {brief.topics.length > 0 && (
            <div style="display:flex;gap:6px;flex-wrap:wrap;padding-top:4px;">
              {brief.topics.map((topic, idx) => (
                <button
                  key={idx}
                  class="timestamp-btn"
                  onClick={() => jumpToSec(topic.startSec)}
                  title="Jump to chapter"
                >
                  {formatTimestamp(topic.startSec)} · {topic.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ASSIGNED TASKS & DEADLINES */}
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Assigned Tasks &amp; Deadlines</h2>
            <div style="display:flex;gap:8px;align-items:center;">
              <span class="pill pill-indigo">{openTasks} open</span>
              <button class="btn btn-sm no-print" onClick={() => setShowAddTask(!showAddTask)}>
                + Add Task
              </button>
            </div>
          </div>

          {showAddTask && (
            <div
              class="no-print"
              style="display:grid;grid-template-columns:110px 1fr 110px auto;gap:8px;padding:10px;background:var(--bg);border-radius:8px;border:1px solid var(--border);"
            >
              <input
                class="input"
                placeholder="Owner"
                value={newTaskOwner}
                onInput={(e) => setNewTaskOwner((e.target as HTMLInputElement).value)}
              />
              <input
                class="input"
                placeholder="Action item description..."
                value={newTaskText}
                onInput={(e) => setNewTaskText((e.target as HTMLInputElement).value)}
              />
              <input
                class="input"
                placeholder="Deadline"
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
              No explicit action items detected in this transcript.
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
                      <span class="pill pill-indigo">Owner: {item.owner}</span>
                      <span class="pill pill-amber">Due: {item.deadline}</span>
                      <span
                        class={`pill ${
                          item.priority === 'high'
                            ? 'pill-rose'
                            : item.priority === 'medium'
                            ? 'pill-green'
                            : ''
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

        {/* DECISIONS & UNANSWERED QUESTIONS */}
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Decisions Made</h2>
            <span class="pill pill-green">{brief.decisions.length} locked</span>
          </div>
          {brief.decisions.length === 0 ? (
            <div style="color:var(--text-muted);font-size:13px;">No explicit decisions detected yet.</div>
          ) : (
            <ul class="list-clean">
              {brief.decisions.map((dec) => (
                <li
                  key={dec.id}
                  style="padding:10px;border-radius:8px;background:var(--bg);border:1px solid var(--border);display:flex;justify-content:space-between;gap:10px;align-items:start;"
                >
                  <div>
                    <div style="font-weight:600;">{dec.summary}</div>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">
                      By {dec.decidedBy} {dec.rationale ? `· ${dec.rationale}` : ''}
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

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Unanswered Questions &amp; Open Risks</h2>
            <span class="pill pill-amber">{brief.unansweredQuestions.length} open</span>
          </div>
          {brief.unansweredQuestions.length === 0 ? (
            <div style="color:var(--text-muted);font-size:13px;">
              All raised questions appear answered during the meeting.
            </div>
          ) : (
            <ul class="list-clean">
              {brief.unansweredQuestions.map((q) => (
                <li
                  key={q.id}
                  style="padding:10px;border-radius:8px;background:var(--bg);border:1px solid rgba(245,158,11,0.35);display:flex;justify-content:space-between;gap:10px;align-items:start;"
                >
                  <div>
                    <div style="font-weight:600;">{q.question}</div>
                    <div style="display:flex;gap:6px;margin-top:5px;">
                      <span class="pill">Raised by {q.raisedBy}</span>
                      {q.blocker && <span class="pill pill-rose">Potential Blocker</span>}
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

      {/* RIGHT COLUMN: AUDIO PLAYER & SYNCHRONIZED TRANSCRIPT */}
      <div class="stack">
        {audioUrl && (
          <div class="card no-print">
            <div class="card-header">
              <h2 class="card-title">Local Audio Playback</h2>
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
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <select
                class="select"
                style="width:auto;padding:5px 8px;font-size:12px;"
                value={retranscribeModel}
                onChange={(e) =>
                  setRetranscribeModel((e.target as HTMLSelectElement).value as WhisperModelId)
                }
              >
                <option value="Xenova/whisper-tiny.en">Whisper Tiny EN</option>
                <option value="Xenova/whisper-base.en">Whisper Base EN</option>
                <option value="Xenova/whisper-small.en">Whisper Small EN</option>
              </select>
              <button
                class="btn btn-sm"
                disabled={isBusy}
                onClick={() => onRetranscribeAudio(retranscribeModel)}
              >
                Re-transcribe Locally (Whisper)
              </button>
            </div>
          </div>
        )}

        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Timestamped Transcript</h2>
            <span class="pill">{meeting.segments.length} segments</span>
          </div>

          <input
            class="input no-print"
            type="search"
            placeholder="Filter transcript by keyword or speaker..."
            value={transcriptQuery}
            onInput={(e) => setTranscriptQuery((e.target as HTMLInputElement).value)}
          />

          <div class="stack" style="gap:8px;max-height:70vh;overflow-y:auto;">
            {filteredSegments.length === 0 ? (
              <div style="color:var(--text-muted);font-size:13px;">
                {meeting.segments.length === 0
                  ? 'No transcript text captured (silent audio or Whisper pending).'
                  : 'No matching transcript segments.'}
              </div>
            ) : (
              filteredSegments.map((seg) => (
                <div key={seg.id} class="segment-row">
                  <div class="segment-head">
                    <button
                      class={`speaker-name ${seg.channel === 'local' ? 'speaker-local' : ''}`}
                      style="background:none;border:none;padding:0;text-align:left;"
                      title="Click to rename speaker across this meeting"
                      onClick={() => {
                        const renamed = window.prompt('Rename speaker:', seg.speaker);
                        if (renamed && renamed.trim() && renamed.trim() !== seg.speaker) {
                          onRenameSpeaker(seg.speaker, renamed.trim());
                        }
                      }}
                    >
                      {seg.speaker}
                    </button>
                    <button
                      class="timestamp-btn"
                      onClick={() => jumpToSec(seg.startSec)}
                      title="Jump audio to timestamp"
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
      </div>
    </div>
  );
}
