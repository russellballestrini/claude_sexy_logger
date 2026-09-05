import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDb } from '@unturf/unfirehose/test/db-helper';

/**
 * vLLM prefix-cache hit rates, as the page reads them.
 *
 * The sampling moved into core so the worker can take a sample without a web
 * server in the way; this route is the on-demand form and the reader. What
 * these pin: POST hands the discovered hosts to the shared sampler, and GET
 * reports the window's hit rate — first sample to last — beside the lifetime
 * figure, because "is caching working now" and "has it ever" are different
 * questions.
 */

const db = createTestDb();
vi.mock('@unturf/unfirehose/db/schema', () => ({ getDb: () => db }));
vi.mock('@unturf/unfirehose/mesh', () => ({ discoverNodes: () => ['localhost', 'gpu-box'] }));
const sampleVllmCache = vi.fn(async (_db: unknown, hosts: string[]) => hosts.map((host) => ({ host, port: 18888, sampled: 1 })));
vi.mock('@unturf/unfirehose/vllm-sample', () => ({ sampleVllmCache: (...a: [unknown, string[]]) => sampleVllmCache(...a) }));

const { GET, POST } = await import('./route');
const get = (q = '') => GET(new NextRequest(new URL(`/api/inference/cache${q}`, 'http://localhost:3000')));
const insert = db.prepare(`INSERT INTO vllm_cache_samples (hostname, model, queries, hits, kv_usage, kv_size_tokens, prefix_caching, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const stamp = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString().replace('T', ' ').slice(0, 19);

beforeEach(() => { vi.clearAllMocks(); db.prepare('DELETE FROM vllm_cache_samples').run(); });

describe('POST', () => {
  it('samples every discovered node through the shared sampler', async () => {
    const body = await (await POST()).json();
    expect(sampleVllmCache).toHaveBeenCalledWith(db, ['localhost', 'gpu-box']);
    expect(body.nodes.map((n: { host: string }) => n.host)).toEqual(['localhost', 'gpu-box']);
  });
});

describe('GET', () => {
  it('reports the window hit rate from the first sample to the last', async () => {
    insert.run('gpu-box', 'qwen', 1000, 400, 0.5, 8192, 1, stamp(50));
    insert.run('gpu-box', 'qwen', 1600, 880, 0.6, 8192, 1, stamp(5));
    const { models } = await (await get('?hours=1')).json();
    expect(models).toHaveLength(1);
    // 480 hits over 600 queries in the window; 880 over 1600 lifetime.
    expect(models[0]).toMatchObject({ hostname: 'gpu-box', model: 'qwen', windowQueries: 600, windowHits: 480, lifetimeQueries: 1600, samples: 2, prefixCachingEnabled: true });
    expect(models[0].windowHitRate).toBeCloseTo(0.8, 5);
    expect(models[0].lifetimeHitRate).toBeCloseTo(0.55, 5);
  });

  it('leaves out samples older than the window', async () => {
    insert.run('gpu-box', 'qwen', 10, 5, null, null, null, stamp(60 * 30));
    const { models } = await (await get('?hours=1')).json();
    expect(models).toEqual([]);
  });

  it('caps the window at ninety days and floors it at one hour', async () => {
    expect((await (await get('?hours=99999')).json()).hours).toBe(24 * 90);
    expect((await (await get('?hours=0')).json()).hours).toBe(1);
  });

  it('says prefix caching is unknown, not off, when the engine did not report it', async () => {
    insert.run('gpu-box', 'qwen', 10, 5, null, null, null, stamp(5));
    const { models } = await (await get()).json();
    expect(models[0].prefixCachingEnabled).toBeNull();
  });
});
