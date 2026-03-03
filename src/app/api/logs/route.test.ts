import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'stream';

vi.mock('@/lib/claude-paths', () => ({
  claudePaths: {
    projects: '/mock/.claude/projects',
    sessionsIndex: (p: string) => `/mock/${p}/sessions-index.json`,
    sessionFile: (p: string, s: string) => `/mock/${p}/${s}.jsonl`,
  },
}));

const jsonlContent = [
  JSON.stringify({ type: 'user', timestamp: '2026-03-03T14:00:00Z', message: { content: 'hello' } }),
  JSON.stringify({ type: 'assistant', timestamp: '2026-03-03T14:01:00Z', message: { content: [{ type: 'text', text: 'hi' }] } }),
].join('\n');

vi.mock('fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue(['test-project']),
  readFile: vi.fn().mockResolvedValue(JSON.stringify({
    entries: [{ sessionId: 'sess-1', modified: '2026-03-03T14:00:00Z' }],
  })),
}));

vi.mock('fs', () => ({
  createReadStream: vi.fn().mockImplementation(() => Readable.from([jsonlContent])),
}));

const { GET } = await import('./route');

function req(url: string) {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('GET /api/logs', () => {
  it('returns aggregated log entries', async () => {
    const res = await GET(req('/api/logs'));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it('respects limit parameter', async () => {
    const res = await GET(req('/api/logs?limit=1'));
    const data = await res.json();
    expect(data.length).toBeLessThanOrEqual(1);
  });
});
