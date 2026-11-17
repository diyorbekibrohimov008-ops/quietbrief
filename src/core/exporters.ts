import type { MeetingRecord, TranscriptSegment } from '../types/meeting';
import { formatTimestamp } from './brief-extractor.ts';

function formatSrtTime(totalSec: number): string {
  const safeMs = Math.max(0, Math.round(totalSec * 1000));
  const hours = Math.floor(safeMs / 3600000);
  const mins = Math.floor((safeMs % 3600000) / 60000);
  const secs = Math.floor((safeMs % 60000) / 1000);
  const ms = safeMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(
    2,
    '0'
  )},${String(ms).padStart(3, '0')}`;
}

export function toPlainTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((seg) => `[${formatTimestamp(seg.startSec)}] ${seg.speaker}: ${seg.text}`)
    .join('\n');
}

export function toSrt(segments: TranscriptSegment[]): string {
  return segments
    .map((seg, idx) => {
      const end = seg.endSec > seg.startSec ? seg.endSec : seg.startSec + 4;
      return `${idx + 1}\n${formatSrtTime(seg.startSec)} --> ${formatSrtTime(end)}\n${seg.speaker}: ${
        seg.text
      }`;
    })
    .join('\n\n');
}

export function toMarkdownBrief(meeting: MeetingRecord): string {
  const { brief } = meeting;
  const lines: string[] = [
    `# ${meeting.title}`,
    `- **Date:** ${new Date(meeting.createdAt).toLocaleString()}`,
    `- **Platform:** ${meeting.platform} (Bot-Free Local Capture)`,
    `- **Duration:** ${formatTimestamp(meeting.durationSec)}`,
    `- **Brief Engine:** ${brief.generatedBy}`,
    '',
    '## Executive Summary',
    ...(brief.tldr.length > 0
      ? brief.tldr.map((b) => `- ${b}`)
      : ['- No executive summary bullets generated yet.']),
    '',
    '## Decisions Made',
    ...(brief.decisions.length > 0
      ? brief.decisions.map(
          (d) =>
            `- **${d.summary}** (${d.decidedBy} @ ${formatTimestamp(d.timestampSec)})${
              d.rationale ? ` — ${d.rationale}` : ''
            }`
        )
      : ['- No explicit decisions recorded.']),
    '',
    '## Assigned Tasks & Deadlines',
    ...(brief.actionItems.length > 0
      ? brief.actionItems.map(
          (a) =>
            `- [${a.completed ? 'x' : ' '}] **${a.owner}**: ${a.task} *(Due: ${a.deadline} · Priority: ${
              a.priority
            } · @ ${formatTimestamp(a.sourceTimestampSec)})*`
        )
      : ['- No action items assigned.']),
    '',
    '## Unanswered Questions & Blockers',
    ...(brief.unansweredQuestions.length > 0
      ? brief.unansweredQuestions.map(
          (q) =>
            `- ${q.blocker ? '[BLOCKER] ' : ''}**${q.raisedBy}** (@ ${formatTimestamp(
              q.timestampSec
            )}): ${q.question}`
        )
      : ['- No open questions flagged.']),
    '',
    '## Timestamped Transcript',
    toPlainTranscript(meeting.segments) || '_No transcript segments._',
  ];

  return lines.join('\n');
}

export function toJsonExport(meeting: MeetingRecord): string {
  return JSON.stringify(meeting, null, 2);
}
