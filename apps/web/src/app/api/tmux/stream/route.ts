import { NextRequest } from 'next/server';
import { execFile } from 'child_process';

function sshPrefix(host?: string): { cmd: string; args: string[] } {
  if (!host || host === 'localhost') return { cmd: 'tmux', args: [] };
  // Validate hostname to prevent command injection
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) throw new Error('Invalid hostname');
  return { cmd: 'ssh', args: ['-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=no', host, 'tmux'] };
}

function capturePane(session: string, window?: string, host?: string): Promise<string> {
  const target = window ? `${session}:${window}` : session;
  const { cmd, args } = sshPrefix(host);
  return new Promise((resolve, reject) => {
    execFile(cmd, [...args, 'capture-pane', '-p', '-t', target, '-e'], { timeout: host ? 10000 : 3000, maxBuffer: 1024 * 256 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function listSessions(host?: string): Promise<string[]> {
  const { cmd, args } = sshPrefix(host);
  return new Promise((resolve, reject) => {
    execFile(cmd, [...args, 'list-sessions', '-F', '#{session_name}'], { timeout: host ? 10000 : 3000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim().split('\n').filter(Boolean));
    });
  });
}

function listWindows(session: string, host?: string): Promise<{ index: string; name: string; active: boolean }[]> {
  const { cmd, args } = sshPrefix(host);
  return new Promise((resolve, reject) => {
    execFile(cmd, [...args, 'list-windows', '-t', session, '-F', '#{window_index}:#{window_name}:#{window_active}'], { timeout: host ? 10000 : 3000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim().split('\n').filter(Boolean).map(line => {
        const [index, name, active] = line.split(':');
        return { index, name, active: active === '1' };
      }));
    });
  });
}

// GET /api/tmux/stream?session=xxx&window=yyy — SSE stream of pane content
// GET /api/tmux/stream — list sessions
// GET /api/tmux/stream?session=xxx&windows=1 — list windows
export async function GET(request: NextRequest) {
  const session = request.nextUrl.searchParams.get('session');
  const window = request.nextUrl.searchParams.get('window') ?? undefined;
  const wantWindows = request.nextUrl.searchParams.get('windows');
  const host = request.nextUrl.searchParams.get('host') ?? undefined;

  // List sessions
  if (!session) {
    try {
      const sessions = await listSessions(host);
      return Response.json({ sessions });
    } catch {
      return Response.json({ sessions: [], error: 'tmux not running' });
    }
  }

  // List windows
  if (wantWindows) {
    try {
      const windows = await listWindows(session, host);
      return Response.json({ windows });
    } catch {
      return Response.json({ windows: [], error: 'session not found' });
    }
  }

  // SSE stream
  const encoder = new TextEncoder();
  let alive = true;
  let lastContent = '';

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { alive = false; }
      };

      // Initial capture
      try {
        const content = await capturePane(session, window, host);
        lastContent = content;
        send(content);
      } catch (err) {
        send(`Error: ${String(err)}`);
        controller.close();
        return;
      }

      // Poll — remote is slower so use 1s interval
      const pollMs = host && host !== 'localhost' ? 1000 : 500;
      const interval = setInterval(async () => {
        if (!alive) { clearInterval(interval); controller.close(); return; }
        try {
          const content = await capturePane(session, window, host);
          if (content !== lastContent) {
            lastContent = content;
            send(content);
          }
        } catch {
          alive = false;
          clearInterval(interval);
          try { controller.close(); } catch {}
        }
      }, 500);

      // Clean up after 30 minutes max
      setTimeout(() => { alive = false; clearInterval(interval); try { controller.close(); } catch {} }, 30 * 60 * 1000);
    },
    cancel() { alive = false; },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
