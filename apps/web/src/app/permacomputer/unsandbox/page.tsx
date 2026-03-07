'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import Link from 'next/link';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fetcher = (url: string) => fetch(url).then(r => r.json());

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--color-muted)] uppercase tracking-wide">{title}</h2>
        {actions}
      </div>
      {children}
    </div>
  );
}

export default function UnsandboxNodePage() {
  const { data: status, mutate: mutateStatus } = useSWR('/api/unsandbox', fetcher, { refreshInterval: 30000 });
  const { data: sessions, mutate: mutateSessions } = useSWR('/api/unsandbox?action=sessions', fetcher, { refreshInterval: 10000 });
  const { data: services, mutate: mutateServices } = useSWR('/api/unsandbox?action=services', fetcher, { refreshInterval: 10000 });

  // Execute code
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('bash');
  const [execResult, setExecResult] = useState<any>(null);
  const [executing, setExecuting] = useState(false);

  // Boot harness
  const [bootPrompt, setBootPrompt] = useState('');
  const [booting, setBooting] = useState(false);
  const [bootResult, setBootResult] = useState<any>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  // Session management
  const [killingSession, setKillingSession] = useState<string | null>(null);

  // Service creation
  const [serviceName, setServiceName] = useState('');
  const [servicePorts, setServicePorts] = useState('80');
  const [serviceBootstrap, setServiceBootstrap] = useState('');
  const [creatingService, setCreatingService] = useState(false);
  const [serviceResult, setServiceResult] = useState<any>(null);

  const executeCode = useCallback(async () => {
    if (!code.trim()) return;
    setExecuting(true);
    setExecResult(null);
    try {
      const res = await fetch('/api/unsandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'execute', language, code }),
      });
      setExecResult(await res.json());
    } catch (err) {
      setExecResult({ error: String(err) });
    } finally {
      setExecuting(false);
    }
  }, [code, language]);

  const bootHarness = useCallback(async () => {
    setBooting(true);
    setBootResult(null);
    setBootError(null);
    try {
      const res = await fetch('/api/unsandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'boot-harness',
          harness: 'claude',
          prompt: bootPrompt.trim() || undefined,
          network: 'semitrusted',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBootResult(data);
        mutateSessions();
      } else {
        setBootError(data.error || 'Boot failed');
      }
    } catch (err) {
      setBootError(String(err));
    } finally {
      setBooting(false);
    }
  }, [bootPrompt, mutateSessions]);

  const killSession = useCallback(async (sessionId: string) => {
    setKillingSession(sessionId);
    try {
      await fetch('/api/unsandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'kill-session', sessionId }),
      });
      mutateSessions();
    } catch {
      // ignore
    } finally {
      setKillingSession(null);
    }
  }, [mutateSessions]);

  const createService = useCallback(async () => {
    if (!serviceName.trim()) return;
    setCreatingService(true);
    setServiceResult(null);
    try {
      const res = await fetch('/api/unsandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-service',
          name: serviceName.trim(),
          ports: servicePorts.trim(),
          bootstrap: serviceBootstrap.trim() || undefined,
          network: 'semitrusted',
        }),
      });
      const data = await res.json();
      setServiceResult(data);
      if (!data.error) {
        mutateServices();
        setServiceName('');
        setServiceBootstrap('');
      }
    } catch (err) {
      setServiceResult({ error: String(err) });
    } finally {
      setCreatingService(false);
    }
  }, [serviceName, servicePorts, serviceBootstrap, mutateServices]);

  const destroyService = useCallback(async (serviceId: string) => {
    if (!confirm(`Destroy service ${serviceId}?`)) return;
    try {
      await fetch('/api/unsandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'destroy-service', serviceId }),
      });
      mutateServices();
    } catch {
      // ignore
    }
  }, [mutateServices]);

  if (!status) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] p-6">
        <div className="text-sm text-[var(--color-muted)]">Loading...</div>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] p-6">
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">unsandbox.com</h1>
          <div className="text-red-400">Not connected. Configure your API keys on the <Link href="/permacomputer" className="text-[var(--color-accent)] hover:underline">Permacomputer</Link> page.</div>
        </div>
      </div>
    );
  }

  const sessionList: any[] = sessions?.sessions ?? [];
  const serviceList: any[] = services?.services ?? [];

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/permacomputer" className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors">&larr;</Link>
          <div>
            <h1 className="text-2xl font-bold">unsandbox.com</h1>
            <p className="text-sm text-[var(--color-muted)]">Virtual compute node &middot; cloud sandbox</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-green-400">● connected</span>
          <span className="font-mono font-bold text-[var(--color-accent)]">tier {status.tier}</span>
          <span className="text-[var(--color-muted)]">{status.rateLimit} rpm</span>
          <span className="text-[var(--color-muted)]">{status.maxSessions} max sessions</span>
        </div>
      </div>

      {/* Tier banner */}
      <div className="bg-gradient-to-r from-[var(--color-accent)]/10 to-transparent rounded border border-[var(--color-accent)]/30 p-4">
        <div className="flex items-center gap-4">
          <div className="text-3xl font-bold text-[var(--color-accent)]">T{status.tier}</div>
          <div className="space-y-0.5">
            <div className="text-sm font-bold">Tier {status.tier} &middot; {status.rateLimit} requests/min &middot; {status.maxSessions} concurrent sessions</div>
            <div className="text-xs text-[var(--color-muted)]">
              42 languages &middot; semitrusted network &middot; persistent services &middot; snapshots &middot; custom domains
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Boot Harness */}
        <Section title="Boot Agent Harness">
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-muted)]">
              Spin up Claude Code in a cloud sandbox with semitrusted network access.
            </p>
            <input
              type="text"
              value={bootPrompt}
              onChange={e => setBootPrompt(e.target.value)}
              placeholder="Initial prompt (optional)"
              className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-2 text-sm"
              onKeyDown={e => { if (e.key === 'Enter') bootHarness(); }}
            />
            <button
              onClick={bootHarness}
              disabled={booting}
              className="w-full px-4 py-2 text-sm font-bold rounded bg-[var(--color-accent)] text-[var(--color-background)] hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
            >
              {booting ? 'Booting...' : 'Boot Claude on unsandbox'}
            </button>
            {bootResult && (
              <div className="text-sm text-green-400 font-mono bg-[var(--color-background)] rounded p-2 border border-[var(--color-border)]">
                Session: {bootResult.sessionId}
                {bootResult.domain && <span className="ml-2 text-[var(--color-muted)]">{bootResult.domain}</span>}
              </div>
            )}
            {bootError && <div className="text-sm text-red-400">{bootError}</div>}
          </div>
        </Section>

        {/* Execute Code */}
        <Section title="Execute Code">
          <div className="space-y-3">
            <div className="flex gap-2">
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                className="bg-[var(--color-background)] border border-[var(--color-border)] rounded px-2 py-1 text-sm cursor-pointer"
              >
                {['bash', 'python', 'javascript', 'typescript', 'ruby', 'go', 'rust', 'c', 'cpp'].map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              <button
                onClick={executeCode}
                disabled={executing || !code.trim()}
                className="px-4 py-1 text-sm font-bold rounded bg-[var(--color-accent)] text-[var(--color-background)] hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
              >
                {executing ? 'Running...' : 'Run'}
              </button>
            </div>
            <textarea
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={language === 'bash' ? 'echo "hello from unsandbox"' : `# ${language} code here`}
              className="w-full h-28 bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono resize-y"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) executeCode(); }}
            />
            {execResult && (
              <pre className="bg-[#0d0d0d] rounded border border-[var(--color-border)] p-3 text-xs font-mono overflow-auto max-h-60 whitespace-pre-wrap">
                {execResult.error ? (
                  <span className="text-red-400">{execResult.error}</span>
                ) : (
                  <>
                    {execResult.stdout && <span className="text-[#d4d4d4]">{execResult.stdout}</span>}
                    {execResult.stderr && <span className="text-yellow-400">{execResult.stderr}</span>}
                    {execResult.exit_code !== undefined && execResult.exit_code !== 0 && (
                      <span className="text-red-400 block mt-1">exit code: {execResult.exit_code}</span>
                    )}
                  </>
                )}
              </pre>
            )}
          </div>
        </Section>
      </div>

      {/* Active Sessions */}
      <Section
        title={`Sessions (${sessionList.length})`}
        actions={
          <button onClick={() => mutateSessions()} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer">refresh</button>
        }
      >
        {sessionList.length === 0 ? (
          <div className="text-sm text-[var(--color-muted)] text-center py-6">
            No active sessions. Boot a harness or create a session to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sessionList.map((s: any) => (
              <div key={s.session_id || s.id} className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="font-mono text-sm font-bold">{s.session_id || s.id}</span>
                  </div>
                  <button
                    onClick={() => killSession(s.session_id || s.id)}
                    disabled={killingSession === (s.session_id || s.id)}
                    className="text-xs text-red-400 hover:text-red-300 cursor-pointer disabled:opacity-50"
                  >
                    {killingSession === (s.session_id || s.id) ? 'killing...' : 'kill'}
                  </button>
                </div>
                {s.domain && <div className="text-xs text-[var(--color-muted)] mt-1 font-mono">{s.domain}</div>}
                {s.shell && <div className="text-xs text-[var(--color-muted)] mt-1">shell: {s.shell}</div>}
                {s.created_at && <div className="text-xs text-[var(--color-muted)] mt-1">created: {new Date(s.created_at).toLocaleString()}</div>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Services */}
      <Section
        title={`Services (${serviceList.length})`}
        actions={
          <button onClick={() => mutateServices()} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer">refresh</button>
        }
      >
        <div className="space-y-3">
          {serviceList.length > 0 && (
            <div className="grid grid-cols-1 gap-3">
              {serviceList.map((svc: any) => (
                <div key={svc.service_id || svc.id} className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${svc.state === 'running' ? 'bg-green-400' : svc.state === 'frozen' ? 'bg-blue-400' : 'bg-yellow-400'}`} />
                      <span className="font-mono text-sm font-bold">{svc.name || svc.service_id || svc.id}</span>
                      {svc.state && <span className="text-xs text-[var(--color-muted)]">{svc.state}</span>}
                    </div>
                    <button
                      onClick={() => destroyService(svc.service_id || svc.id)}
                      className="text-xs text-red-400 hover:text-red-300 cursor-pointer"
                    >
                      destroy
                    </button>
                  </div>
                  {svc.domain && (
                    <div className="text-xs mt-1">
                      <a href={`https://${svc.domain}`} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] hover:underline font-mono">{svc.domain}</a>
                    </div>
                  )}
                  {svc.ports && <div className="text-xs text-[var(--color-muted)] mt-1">ports: {svc.ports}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Create new service */}
          <div className="border-t border-[var(--color-border)] pt-3 space-y-2">
            <div className="text-xs font-bold text-[var(--color-muted)]">Deploy New Service</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={serviceName}
                onChange={e => setServiceName(e.target.value)}
                placeholder="service name"
                className="bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-sm font-mono"
              />
              <input
                type="text"
                value={servicePorts}
                onChange={e => setServicePorts(e.target.value)}
                placeholder="ports (e.g. 80,443)"
                className="bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <textarea
              value={serviceBootstrap}
              onChange={e => setServiceBootstrap(e.target.value)}
              placeholder="bootstrap command (e.g. python -m http.server 80)"
              className="w-full h-16 bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono resize-y"
            />
            <button
              onClick={createService}
              disabled={creatingService || !serviceName.trim()}
              className="px-4 py-1.5 text-sm font-bold rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {creatingService ? 'Deploying...' : 'Deploy Service'}
            </button>
            {serviceResult?.error && <div className="text-sm text-red-400">{serviceResult.error}</div>}
            {serviceResult && !serviceResult.error && (
              <div className="text-sm text-green-400 font-mono">
                Deployed: {serviceResult.service_id || serviceResult.name}
                {serviceResult.domain && <span className="ml-2 text-[var(--color-muted)]">{serviceResult.domain}</span>}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* Quick reference */}
      <div className="text-xs text-[var(--color-muted)] space-y-1">
        <div>CLI: <code className="font-mono text-[var(--color-foreground)]">curl -o un https://unsandbox.com/downloads/un && chmod +x un</code></div>
        <div>Sessions: <code className="font-mono text-[var(--color-foreground)]">un session --tmux</code> &middot; Services: <code className="font-mono text-[var(--color-foreground)]">un service --name myapp --ports 80 --bootstrap &quot;...&quot;</code></div>
      </div>
    </div>
  );
}
