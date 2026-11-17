import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractExecutiveBrief,
  formatTimestamp,
  parseLlmBriefJson,
} from '../src/core/brief-extractor.ts';
import { toJsonExport, toMarkdownBrief, toSrt } from '../src/core/exporters.ts';
import { encodeWavBytes } from '../src/core/audio-utils.ts';
import type { MeetingRecord, TranscriptSegment } from '../src/types/meeting.ts';

const sampleSegments: TranscriptSegment[] = [
  {
    id: '1',
    startSec: 5,
    endSec: 20,
    speaker: 'Elena',
    channel: 'remote',
    text: 'We agreed to ban external meeting bots across client calls starting Monday.',
  },
  {
    id: '2',
    startSec: 22,
    endSec: 40,
    speaker: 'Marcus',
    channel: 'remote',
    text: 'Marcus will benchmark Whisper on RTX 4060 CUDA by Friday.',
  },
  {
    id: '3',
    startSec: 42,
    endSec: 58,
    speaker: 'Priya',
    channel: 'remote',
    text: 'Do enterprise IT admins need an offline air-gapped installer before rollout?',
  },
  {
    id: '4',
    startSec: 60,
    endSec: 75,
    speaker: 'You',
    channel: 'local',
    text: 'Can you confirm if legal signed the privacy addendum?',
  },
  {
    id: '5',
    startSec: 77,
    endSec: 90,
    speaker: 'Elena',
    channel: 'remote',
    text: 'Yes, Legal signed it yesterday afternoon.',
  },
];

test('extractExecutiveBrief extracts decisions, assigned tasks with deadlines, and unanswered questions', () => {
  const brief = extractExecutiveBrief(sampleSegments, 'Security Sync');

  assert.ok(brief.tldr.length >= 1, 'Expected non-empty executive TL;DR');
  assert.ok(
    brief.decisions.some((d) => /ban external meeting bots/i.test(d.summary)),
    'Expected decision extraction'
  );

  const marcusTask = brief.actionItems.find((a) => a.owner === 'Marcus');
  assert.ok(marcusTask, 'Expected task assigned to Marcus');
  assert.match(marcusTask!.deadline, /Friday/i);

  assert.ok(
    brief.unansweredQuestions.some((q) => /air-gapped installer/i.test(q.question)),
    'Expected unanswered question to remain flagged'
  );
  assert.ok(
    !brief.unansweredQuestions.some((q) => /legal signed the privacy addendum/i.test(q.question)),
    'Expected answered question to be filtered out'
  );
});

test('parseLlmBriefJson parses fenced JSON and falls back cleanly on malformed JSON', () => {
  const fenced = [
    '```json',
    JSON.stringify({
      tldr: ['Shipped zero-bot capture.'],
      decisions: [{ summary: 'Use WASAPI loopback', decidedBy: 'You', timestampSec: 12, rationale: 'No driver needed' }],
      actionItems: [{ owner: 'Dev', task: 'Package Windows build', deadline: 'Nov 18', priority: 'high', sourceTimestampSec: 25 }],
      unansweredQuestions: [{ question: 'Mac signing cert ready?', raisedBy: 'QA', timestampSec: 40, blocker: true }],
      topics: [{ title: 'Audio Architecture', startSec: 0 }],
    }),
    '```',
  ].join('\n');

  const parsed = parseLlmBriefJson(fenced, sampleSegments, 'Local Ollama');
  assert.equal(parsed.generatedBy, 'Local Ollama');
  assert.equal(parsed.decisions[0].summary, 'Use WASAPI loopback');
  assert.equal(parsed.actionItems[0].deadline, 'Nov 18');
  assert.equal(parsed.unansweredQuestions[0].blocker, true);

  const malformed = parseLlmBriefJson('not json at all', sampleSegments, 'Local Ollama');
  assert.match(malformed.generatedBy, /structured fallback/);
  assert.ok(malformed.decisions.length >= 1);
});

test('exporters format Markdown brief, SRT subtitles, and JSON cleanly', () => {
  const brief = extractExecutiveBrief(sampleSegments, 'Security Sync');
  const meeting: MeetingRecord = {
    id: 'm1',
    title: 'Security Sync',
    createdAt: '2026-11-11T12:00:00.000Z',
    durationSec: 90,
    platform: 'Zoom',
    audioSourceMode: 'system+mic',
    segments: sampleSegments,
    brief,
    status: 'ready',
  };

  const md = toMarkdownBrief(meeting);
  assert.match(md, /^# Security Sync/m);
  assert.match(md, /## Assigned Tasks & Deadlines/);
  assert.match(md, /- \[ \] \*\*Marcus\*\*:/);

  const srt = toSrt(sampleSegments);
  assert.match(srt, /00:00:05,000 --> 00:00:20,000/);

  const parsedJson = JSON.parse(toJsonExport(meeting)) as MeetingRecord;
  assert.equal(parsedJson.title, 'Security Sync');
  assert.equal(formatTimestamp(90), '01:30');
});

test('encodeWavBytes writes a valid RIFF WAVE header', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 0.25]);
  const bytes = encodeWavBytes(samples, 16000);
  const ascii = String.fromCharCode(...bytes.slice(0, 4), ...bytes.slice(8, 12));
  assert.equal(ascii, 'RIFFWAVE');
  assert.equal(bytes.length, 44 + samples.length * 2);
});
