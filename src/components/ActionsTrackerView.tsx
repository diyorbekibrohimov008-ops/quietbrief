import { useState } from 'preact/hooks';
import type { MeetingRecord } from '../types/meeting';
import { formatTimestamp } from '../core/brief-extractor';

interface ActionsTrackerViewProps {
  meetings: MeetingRecord[];
  onToggleTask: (meetingId: string, taskId: string) => void;
  onOpenMeeting: (meetingId: string) => void;
}

export function ActionsTrackerView(props: ActionsTrackerViewProps) {
  const { meetings, onToggleTask, onOpenMeeting } = props;
  const [filter, setFilter] = useState<'open' | 'completed' | 'all'>('open');
  const [ownerFilter, setOwnerFilter] = useState('');

  const allItems = meetings.flatMap((m) =>
    m.brief.actionItems.map((item) => ({
      meetingId: m.id,
      meetingTitle: m.title,
      platform: m.platform,
      item,
    }))
  );

  const visible = allItems.filter(({ item }) => {
    if (filter === 'open' && item.completed) return false;
    if (filter === 'completed' && !item.completed) return false;
    if (ownerFilter.trim() && !item.owner.toLowerCase().includes(ownerFilter.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div class="page-pad">
      <div class="card">
        <div class="card-header">
          <div>
            <h1 style="margin:0;font-size:19px;">Cross-Meeting Action Items &amp; Deadlines</h1>
            <p style="margin:4px 0 0;font-size:13px;color:var(--text-muted);">
              Aggregated locally from every executive brief stored on this device.
            </p>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            {(['open', 'completed', 'all'] as const).map((tab) => (
              <button
                key={tab}
                class={`btn btn-sm ${filter === tab ? 'btn-primary' : ''}`}
                onClick={() => setFilter(tab)}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <input
          class="input"
          placeholder="Filter by owner (e.g. Marcus, Priya, You)..."
          value={ownerFilter}
          onInput={(e) => setOwnerFilter((e.target as HTMLInputElement).value)}
        />

        {visible.length === 0 ? (
          <div style="color:var(--text-muted);padding:12px 0;">No action items match this filter.</div>
        ) : (
          <ul class="list-clean">
            {visible.map(({ meetingId, meetingTitle, item }) => (
              <li key={`${meetingId}:${item.id}`} class={`task-row ${item.completed ? 'done' : ''}`}>
                <input
                  type="checkbox"
                  checked={item.completed}
                  style="margin-top:4px;accent-color:var(--accent);width:16px;height:16px;"
                  onChange={() => onToggleTask(meetingId, item.id)}
                />
                <div>
                  <div class="task-text" style="font-weight:500;">
                    {item.task}
                  </div>
                  <div class="task-meta">
                    <span class="pill pill-indigo">{item.owner}</span>
                    <span class="pill pill-amber">Due: {item.deadline}</span>
                    <span class="pill">{meetingTitle}</span>
                  </div>
                </div>
                <button class="btn btn-sm" onClick={() => onOpenMeeting(meetingId)}>
                  Open ({formatTimestamp(item.sourceTimestampSec)})
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
