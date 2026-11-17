import type {
  ActionItem,
  DecisionItem,
  ExecutiveBrief,
  OpenQuestion,
  TopicChapter,
  TranscriptSegment,
} from '../types/meeting';

const DECISION_PATTERNS = [
  /\b(?:we|team|everyone)\s+(?:decided|agreed|confirmed|aligned|approved|chose|settled)\b/i,
  /\b(?:decision|consensus|verdict)\s*(?:is|:)\b/i,
  /\b(?:let's|we'll|we will|going to|moving forward)\s+(?:go with|use|ship|adopt|deploy|freeze|lock in|standardize on|drop|cancel)\b/i,
  /\b(?:approved|signed off|greenlit|locked in|finalized)\b/i,
];

const ACTION_TRIGGER_PATTERNS = [
  /\b(?:action item|todo|to-do|follow[\s-]?up|assigned to)\b/i,
  /\b(?:i'll|i will|we'll|we need to|someone needs to|make sure to|please)\s+(?:send|share|prepare|draft|review|deploy|create|update|schedule|fix|check|test|ship|write|follow up|reach out|set up|open|publish)\b/i,
  /\b([A-Z][a-z]{1,18})\s+(?:will|to|needs to|should|can you|is going to)\s+(?:send|share|prepare|draft|review|deploy|create|update|schedule|fix|check|test|ship|write|follow up|reach out|set up|open|publish|own|handle|lead|investigate|benchmark|audit)\b/,
  /\b(?:can you|could you|need you to)\s+[a-z]/i,
];

const DEADLINE_PATTERNS: RegExp[] = [
  /\b(?:by|before|until|on|due)\s+(?:EOD|end of day|COB|end of week|EOW|tomorrow|tonight|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this friday|this monday|next sprint|q[1-4](?:\s+\d{4})?)\b/i,
  /\b(?:by|before|on|due)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/i,
  /\b(?:within|in)\s+\d+\s+(?:hours?|days?|weeks?)\b/i,
  /\b(?:today|tomorrow|asap|eod|eow)\b/i,
];

const URGENT_PATTERN = /\b(?:asap|urgent|critical|blocker|immediately|today|tomorrow|eod|p0|security|compliance)\b/i;

const QUESTION_BLOCKER_PATTERN =
  /\b(?:blocked|blocking|unclear|unknown|pending|waiting on|need confirmation|legal|compliance|budget|approval|depends on)\b/i;

const ANSWER_SIGNALS =
  /^(?:yes|yeah|yep|no|nope|correct|right|actually|we confirmed|it is|it's|that's|good question[, ]+we|the answer is|roughly|around|about)\b/i;

function makeId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

function cleanSentence(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function splitSentences(text: string): string[] {
  const normalized = cleanSentence(text);
  if (!normalized) return [];
  const parts = normalized.match(/[^.!?]+(?:[.!?]+|$)/g);
  return parts ? parts.map((p) => cleanSentence(p)).filter(Boolean) : [normalized];
}

function extractDeadline(text: string): string {
  for (const pattern of DEADLINE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0].replace(/^(?:by|before|until|on|due)\s+/i, '').trim();
    }
  }
  return 'Unscheduled';
}

function extractOwner(sentence: string, speaker: string): string {
  const assignedMatch = sentence.match(/\bassigned\s+to\s+([A-Z][a-z]{1,18})\b/);
  if (assignedMatch) return assignedMatch[1];

  const namedAction = sentence.match(
    /\b([A-Z][a-z]{1,18})\s+(?:will|to|needs to|should|is going to)\s+/
  );
  if (
    namedAction &&
    !['We', 'They', 'This', 'That', 'There', 'Here', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(
      namedAction[1]
    )
  ) {
    return namedAction[1];
  }

  if (/\b(?:i'll|i will|i'm going to|i can take)\b/i.test(sentence)) {
    return speaker || 'You';
  }
  if (/\b(?:can you|could you|please)\b/i.test(sentence)) {
    const addressed = sentence.match(/^([A-Z][a-z]{1,18}),/);
    if (addressed) return addressed[1];
  }
  return speaker || 'Team';
}

function inferPriority(text: string, deadline: string): 'high' | 'medium' | 'low' {
  if (URGENT_PATTERN.test(text)) return 'high';
  if (deadline !== 'Unscheduled') return 'medium';
  return 'low';
}

function scoreSummarySentence(sentence: string): number {
  let score = Math.min(sentence.length, 140) / 40;
  if (DECISION_PATTERNS.some((p) => p.test(sentence))) score += 4;
  if (ACTION_TRIGGER_PATTERNS.some((p) => p.test(sentence))) score += 3;
  if (/\d+%|\$\d+|\d+\s+(?:ms|gb|users|days|weeks)/i.test(sentence)) score += 2;
  if (sentence.endsWith('?')) score -= 1;
  return score;
}

function isQuestionAnswered(
  segments: TranscriptSegment[],
  questionIndex: number,
  askerSpeaker: string
): boolean {
  const limit = Math.min(segments.length, questionIndex + 4);
  for (let j = questionIndex + 1; j < limit; j++) {
    const next = segments[j];
    const nextText = cleanSentence(next.text);
    if (!nextText) continue;

    if (next.speaker !== askerSpeaker && ANSWER_SIGNALS.test(nextText)) {
      return true;
    }

    // Stop attributing later replies if another participant raises a new question.
    if (nextText.endsWith('?')) {
      break;
    }
  }
  return false;
}

/**
 * Extracts a structured Executive Brief purely on-device using deterministic
 * linguistic rules. Serves as an instant zero-download baseline and reliable
 * fallback when Ollama or WebGPU LLM is not loaded.
 */
export function extractExecutiveBrief(
  segments: TranscriptSegment[],
  meetingTitle = 'Meeting'
): ExecutiveBrief {
  const decisions: DecisionItem[] = [];
  const actionItems: ActionItem[] = [];
  const unansweredQuestions: OpenQuestion[] = [];
  const candidateSummaries: { text: string; score: number; startSec: number }[] = [];

  const seenDecisions = new Set<string>();
  const seenTasks = new Set<string>();
  const seenQuestions = new Set<string>();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const sentences = splitSentences(seg.text);

    for (const sentence of sentences) {
      if (sentence.length < 12) continue;

      const lower = sentence.toLowerCase();
      candidateSummaries.push({
        text: `${seg.speaker}: ${sentence}`,
        score: scoreSummarySentence(sentence),
        startSec: seg.startSec,
      });

      if (
        DECISION_PATTERNS.some((p) => p.test(sentence)) &&
        !sentence.endsWith('?') &&
        !seenDecisions.has(lower)
      ) {
        seenDecisions.add(lower);
        decisions.push({
          id: makeId('dec', decisions.length),
          summary: sentence,
          decidedBy: seg.speaker,
          timestampSec: seg.startSec,
          rationale: `Captured from ${seg.speaker} at ${formatTimestamp(seg.startSec)}`,
        });
      }

      if (
        ACTION_TRIGGER_PATTERNS.some((p) => p.test(sentence)) &&
        (!sentence.endsWith('?') ||
          /\b(?:send|share|prepare|draft|update|fix|deploy|schedule|deliver)\b/i.test(sentence)) &&
        !seenTasks.has(lower)
      ) {
        seenTasks.add(lower);
        const deadline = extractDeadline(sentence);
        const owner = extractOwner(sentence, seg.speaker);
        actionItems.push({
          id: makeId('act', actionItems.length),
          owner,
          task: sentence.replace(/^(?:action item|todo|to-do)\s*:\s*/i, ''),
          deadline,
          priority: inferPriority(sentence, deadline),
          completed: false,
          sourceTimestampSec: seg.startSec,
        });
      }

      const isQuestion =
        sentence.endsWith('?') ||
        /\b(?:open question|still unclear|need to know|anyone know)\b/i.test(sentence);

      if (isQuestion && !seenQuestions.has(lower)) {
        if (!isQuestionAnswered(segments, i, seg.speaker)) {
          seenQuestions.add(lower);
          unansweredQuestions.push({
            id: makeId('q', unansweredQuestions.length),
            question: sentence,
            raisedBy: seg.speaker,
            timestampSec: seg.startSec,
            blocker: QUESTION_BLOCKER_PATTERN.test(sentence),
          });
        }
      }
    }
  }

  const tldr = candidateSummaries
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.startSec - b.startSec)
    .map((item) => item.text);

  if (tldr.length === 0 && segments.length > 0) {
    tldr.push(
      `${meetingTitle}: ${segments.length} transcript segments recorded (${formatTimestamp(
        segments[segments.length - 1].endSec
      )} total).`
    );
  }

  const topics = buildTopics(segments);

  return {
    tldr,
    decisions,
    actionItems,
    unansweredQuestions,
    topics,
    generatedBy: 'Instant Local Brief Engine (On-Device)',
    generatedAt: new Date().toISOString(),
  };
}

function buildTopics(segments: TranscriptSegment[]): TopicChapter[] {
  if (segments.length === 0) return [];
  const totalSec = segments[segments.length - 1].endSec || 60;
  const bucketSize = Math.max(45, Math.ceil(totalSec / 4));
  const chapters: TopicChapter[] = [];
  let nextThreshold = 0;

  for (const seg of segments) {
    if (seg.startSec >= nextThreshold && chapters.length < 5) {
      const firstSentence = splitSentences(seg.text)[0] || seg.text;
      const concise =
        firstSentence.length > 56 ? `${firstSentence.slice(0, 53).trim()}...` : firstSentence;
      chapters.push({
        title: concise,
        startSec: seg.startSec,
      });
      nextThreshold = seg.startSec + bucketSize;
    }
  }
  return chapters;
}

export function formatTimestamp(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function buildLlmBriefPrompt(
  segments: TranscriptSegment[],
  meetingTitle: string
): string {
  const transcriptLines = segments
    .map((s) => `[${formatTimestamp(s.startSec)} | ${Math.floor(s.startSec)}s] ${s.speaker}: ${s.text}`)
    .join('\n');

  return [
    `You are an executive chief of staff. Distill this meeting transcript titled "${meetingTitle}" into strict JSON only (no markdown fences, no commentary).`,
    `Return an object with exact keys:`,
    `{`,
    `  "tldr": ["2 to 4 concise executive outcome bullets"],`,
    `  "decisions": [{"summary": "string", "decidedBy": "string", "timestampSec": number, "rationale": "string"}],`,
    `  "actionItems": [{"owner": "string", "task": "string", "deadline": "string", "priority": "high|medium|low", "sourceTimestampSec": number}],`,
    `  "unansweredQuestions": [{"question": "string", "raisedBy": "string", "timestampSec": number, "blocker": boolean}],`,
    `  "topics": [{"title": "string", "startSec": number}]`,
    `}`,
    `Only include facts grounded in the transcript. If a deadline is unstated, use "Unscheduled".`,
    `Transcript:`,
    transcriptLines,
  ].join('\n');
}

export function parseLlmBriefJson(
  rawText: string,
  segments: TranscriptSegment[],
  engineLabel: string
): ExecutiveBrief {
  const fallback = extractExecutiveBrief(segments);
  const cleaned = rawText.trim();
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return { ...fallback, generatedBy: `${engineLabel} (structured fallback)` };
  }

  try {
    const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as Partial<ExecutiveBrief>;
    const tldr = Array.isArray(parsed.tldr)
      ? parsed.tldr.map((x) => String(x)).filter(Boolean)
      : fallback.tldr;

    const decisions: DecisionItem[] = Array.isArray(parsed.decisions)
      ? parsed.decisions.map((d, idx) => ({
          id: makeId('dec', idx),
          summary: String(d?.summary || '').trim(),
          decidedBy: String(d?.decidedBy || 'Team').trim(),
          timestampSec: Number(d?.timestampSec) || 0,
          rationale: String(d?.rationale || '').trim(),
        })).filter((d) => d.summary.length > 0)
      : fallback.decisions;

    const actionItems: ActionItem[] = Array.isArray(parsed.actionItems)
      ? parsed.actionItems.map((a, idx) => {
          const priority: ActionItem['priority'] =
            a?.priority === 'high' || a?.priority === 'low' ? a.priority : 'medium';
          return {
            id: makeId('act', idx),
            owner: String(a?.owner || 'Unassigned').trim(),
            task: String(a?.task || '').trim(),
            deadline: String(a?.deadline || 'Unscheduled').trim(),
            priority,
            completed: false,
            sourceTimestampSec: Number(a?.sourceTimestampSec) || 0,
          };
        }).filter((a) => a.task.length > 0)
      : fallback.actionItems;

    const unansweredQuestions: OpenQuestion[] = Array.isArray(parsed.unansweredQuestions)
      ? parsed.unansweredQuestions.map((q, idx) => ({
          id: makeId('q', idx),
          question: String(q?.question || '').trim(),
          raisedBy: String(q?.raisedBy || 'Participant').trim(),
          timestampSec: Number(q?.timestampSec) || 0,
          blocker: Boolean(q?.blocker),
        })).filter((q) => q.question.length > 0)
      : fallback.unansweredQuestions;

    const topics: TopicChapter[] = Array.isArray(parsed.topics) && parsed.topics.length > 0
      ? parsed.topics.map((t) => ({
          title: String(t?.title || 'Topic').trim(),
          startSec: Number(t?.startSec) || 0,
        }))
      : fallback.topics;

    return {
      tldr: tldr.length > 0 ? tldr : fallback.tldr,
      decisions,
      actionItems,
      unansweredQuestions,
      topics,
      generatedBy: engineLabel,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return { ...fallback, generatedBy: `${engineLabel} (structured fallback)` };
  }
}
