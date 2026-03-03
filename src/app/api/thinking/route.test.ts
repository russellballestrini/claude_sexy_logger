import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'stream';

vi.mock('@/lib/claude-paths', () => ({
  claudePaths: {
    projects: '/mock/.claude/projects',
    projectDir: (p: string) => `/mock/.claude/projects/${p}`,
    sessionsIndex: (p: string) => `/mock/.claude/projects/${p}/sessions-index.json`,
    sessionFile: (p: string, s: string) => `/mock/.claude/projects/${p}/${s}.jsonl`,
  },
}));

const assistantEntry = JSON.stringify({
  type: 'assistant',
  sessionId: 'sess-1',
  timestamp: '2026-03-03T14:00:00Z',
  message: {
    role: 'assistant',
    model: 'claude-opus-4-6',
    content: [{ type: 'thinking', thinking: 'Let me consider this problem...' }],
  },
});

const userEntry = JSON.stringify({
  type: 'user',
  sessionId: 'sess-1',
  timestamp: '2026-03-03T13:59:00Z',
  message: { role: 'user', content: 'What should we build?' },
});

vi.mock('fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue(['test-project']),
  readFile: vi.fn().mockResolvedValue(JSON.stringify({
    entries: [{ sessionId: 'sess-1', modified: '2026-03-03T14:00:00Z' }],
  })),
}));

vi.mock('fs', () => ({
  createReadStream: vi.fn().mockImplementation(() =>
    Readable.from([`${userEntry}\n${assistantEntry}\n`])
  ),
}));

const { GET } = await import('./route');

function req(url: string) {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('GET /api/thinking', () => {
  it('returns thinking excerpts across projects', async () => {
    const res = await GET(req('/api/thinking?limit=10'));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0].thinking).toContain('Let me consider');
    expect(data[0].precedingPrompt).toContain('What should we build');
  });

  it('filters by search text', async () => {
    const res = await GET(req('/api/thinking?search=nonexistent&limit=10'));
    const data = await res.json();
    expect(data).toHaveLength(0);
  });
});
