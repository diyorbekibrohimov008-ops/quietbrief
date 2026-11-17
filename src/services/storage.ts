import type { MeetingRecord } from '../types/meeting';
import { SAMPLE_MEETING_PRESETS, createSampleToneWav } from '../core/audio-utils';
import { extractExecutiveBrief } from '../core/brief-extractor';

const DB_NAME = 'quietbrief-local-vault';
const DB_VERSION = 1;
const STORE_MEETINGS = 'meetings';
const STORE_AUDIO = 'audioBlobs';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MEETINGS)) {
        db.createObjectStore(STORE_MEETINGS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open local IndexedDB vault.'));
  });
}

export async function listMeetings(): Promise<MeetingRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEETINGS, 'readonly');
    const store = tx.objectStore(STORE_MEETINGS);
    const req = store.getAll();
    req.onsuccess = () => {
      const records = (req.result as MeetingRecord[]).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      resolve(records);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to read meetings.'));
  });
}

export async function saveMeeting(record: MeetingRecord, audioBlob?: Blob): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MEETINGS, STORE_AUDIO], 'readwrite');
    const meetingsStore = tx.objectStore(STORE_MEETINGS);
    const audioStore = tx.objectStore(STORE_AUDIO);

    meetingsStore.put({
      ...record,
      hasAudioBlob: Boolean(audioBlob) || Boolean(record.hasAudioBlob),
      audioMimeType: audioBlob?.type || record.audioMimeType,
    });

    if (audioBlob) {
      audioStore.put(audioBlob, record.id);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save meeting locally.'));
  });
}

export async function getAudioBlob(meetingId: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_AUDIO, 'readonly');
    const req = tx.objectStore(STORE_AUDIO).get(meetingId);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('Failed to load audio blob.'));
  });
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MEETINGS, STORE_AUDIO], 'readwrite');
    tx.objectStore(STORE_MEETINGS).delete(meetingId);
    tx.objectStore(STORE_AUDIO).delete(meetingId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete meeting.'));
  });
}

const SEED_FLAG_KEY = 'quietbrief_seeded_v1';

export async function ensureInitialSampleMeetings(): Promise<MeetingRecord[]> {
  const existing = await listMeetings();
  if (existing.length > 0 || localStorage.getItem(SEED_FLAG_KEY) === '1') {
    return existing;
  }

  const preset = SAMPLE_MEETING_PRESETS[0];
  const sampleAudio = createSampleToneWav(6);
  const seeded: MeetingRecord = {
    id: `meeting-${preset.id}`,
    title: preset.title,
    createdAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
    durationSec: preset.durationSec,
    platform: 'Sample',
    audioSourceMode: 'system+mic',
    audioMimeType: sampleAudio.type,
    hasAudioBlob: true,
    whisperModel: 'Sample Preset (Zero-Bot Demo)',
    segments: preset.segments,
    brief: extractExecutiveBrief(preset.segments, preset.title),
    status: 'ready',
  };

  await saveMeeting(seeded, sampleAudio);
  localStorage.setItem(SEED_FLAG_KEY, '1');
  return [seeded];
}
