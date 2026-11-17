export type AudioSourceMode = 'system+mic' | 'system' | 'mic' | 'file';

export type MeetingPlatform =
  | 'Zoom'
  | 'Google Meet'
  | 'Microsoft Teams'
  | 'System Audio'
  | 'Audio Import'
  | 'Sample';

export type SummaryEngineMode = 'instant-local' | 'ollama' | 'webgpu-llm';

export type WhisperModelId =
  | 'Xenova/whisper-tiny.en'
  | 'Xenova/whisper-base.en'
  | 'Xenova/whisper-small.en';

export interface TranscriptSegment {
  id: string;
  startSec: number;
  endSec: number;
  speaker: string;
  channel: 'local' | 'remote' | 'mixed';
  text: string;
}

export interface ActionItem {
  id: string;
  owner: string;
  task: string;
  deadline: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  sourceTimestampSec: number;
}

export interface DecisionItem {
  id: string;
  summary: string;
  decidedBy: string;
  timestampSec: number;
  rationale: string;
}

export interface OpenQuestion {
  id: string;
  question: string;
  raisedBy: string;
  timestampSec: number;
  blocker: boolean;
}

export interface TopicChapter {
  title: string;
  startSec: number;
}

export interface ExecutiveBrief {
  tldr: string[];
  decisions: DecisionItem[];
  actionItems: ActionItem[];
  unansweredQuestions: OpenQuestion[];
  topics: TopicChapter[];
  generatedBy: string;
  generatedAt: string;
}

export type MeetingStatus =
  | 'recorded'
  | 'transcribing'
  | 'summarizing'
  | 'ready'
  | 'error';

export interface MeetingRecord {
  id: string;
  title: string;
  createdAt: string;
  durationSec: number;
  platform: MeetingPlatform;
  audioSourceMode: AudioSourceMode;
  audioMimeType?: string;
  hasAudioBlob?: boolean;
  whisperModel?: string;
  segments: TranscriptSegment[];
  brief: ExecutiveBrief;
  status: MeetingStatus;
  errorMessage?: string;
}
