'use client';

import useSWR from 'swr';
import Link from 'next/link';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function TmuxListPage() {
  const { data, isLoading } = useSWR('/api/tmux/stream', fetcher, { refreshInterval: 5000 });
  const sessions: string[] = data?.sessions ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">tmux Sessions</h2>
        <p className="text-sm text-[var(--color-muted)]">Live terminal streams from running agents.</p>
      </div>

      {isLoading && <p className="text-sm text-[var(--color-muted)]">Loading...</p>}

      {!isLoading && sessions.length === 0 && (
        <div className="text-sm text-[var(--color-muted)] text-center py-8 bg-[var(--color-surface)] rounded border border-[var(--color-border)]">
          No tmux sessions running.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {sessions.map(s => (
          <Link
            key={s}
            href={`/tmux/${encodeURIComponent(s)}`}
            className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-4 hover:border-[var(--color-accent)]/50 transition-colors block"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-base font-bold font-mono">{s}</span>
            </div>
            <p className="text-xs text-[var(--color-muted)] mt-1">Click to view live terminal</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
