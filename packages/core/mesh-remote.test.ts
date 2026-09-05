import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Probing one node over ssh.
 *
 * This lived in the /api/mesh route; the worker fetched it through the web
 * server every fifteen seconds per node. Now it is a function. What these
 * pin is the contract the worker relies on: a node that does not answer is
 * a MeshNode with reachable:false and a reason, never a thrown error, and a
 * node that answers is parsed by the same parser the page uses.
 */

const execFile = vi.fn();
vi.mock('child_process', () => ({ execFile: (...a: unknown[]) => execFile(...a) }));
const parseRemoteProbe = vi.fn((host: string) => ({ hostname: host, reachable: true, cpuCores: 4 }));
vi.mock('./mesh-probe', () => ({ parseRemoteProbe: (...a: unknown[]) => parseRemoteProbe(...(a as [string, string])) }));

const { probeRemote } = await import('./mesh-remote');
const answer = (err: Error | null, stdout = '') =>
  execFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: (e: unknown, out: string) => void) => cb(err, stdout));

beforeEach(() => vi.clearAllMocks());

describe('probeRemote', () => {
  it('asks the node over ssh with a connect timeout and no host-key prompt', async () => {
    answer(null, 'probe output');
    await probeRemote('cammy');
    const [cmd, args] = execFile.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('ssh');
    expect(args).toContain('cammy');
    expect(args.join(' ')).toContain('ConnectTimeout=5');
    expect(args.join(' ')).toContain('StrictHostKeyChecking=no');
  });

  it('parses an answer with the same parser the page uses', async () => {
    answer(null, 'probe output');
    const node = await probeRemote('cammy');
    expect(parseRemoteProbe).toHaveBeenCalledWith('cammy', 'probe output');
    expect(node).toMatchObject({ hostname: 'cammy', reachable: true });
  });

  it('reports a node that will not answer as unreachable, not as an exception', async () => {
    // The worker calls this on a timer for every node. A throw would take
    // the whole sampler down for one box being off.
    answer(new Error('ssh: connect to host cammy port 22: Connection refused'));
    const node = await probeRemote('cammy');
    expect(node).toMatchObject({ hostname: 'cammy', reachable: false, error: 'Unreachable' });
  });

  it('names a timeout as one', async () => {
    answer(new Error('ETIMEDOUT'));
    expect((await probeRemote('cammy')).error).toBe('Connection timed out');
  });

  it('reports a probe whose output it cannot parse, with the reason', async () => {
    answer(null, 'garbage');
    parseRemoteProbe.mockImplementationOnce(() => { throw new Error('bad section'); });
    expect(await probeRemote('cammy')).toMatchObject({ reachable: false, error: 'bad section' });
  });
});
