'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { PageContext } from '@unfirehose/ui/PageContext';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const SETTINGS_KEYS = {
  unsandboxPublicKey: 'unsandbox_public_key',
  unsandboxSecretKey: 'unsandbox_secret_key',
  unsandboxEnabled: 'unsandbox_enabled',
};

const HARNESSES = [
  { value: 'claude', label: 'Claude Code', cmd: 'claude' },
  { value: 'custom', label: 'Custom Command', cmd: '' },
];

interface SshHost {
  name: string;
  hostname?: string;
  port?: string;
  user?: string;
  identityFile?: string;
  forwardAgent?: string;
}

export default function PermacomputerPage() {
  const { data: mesh } = useSWR('/api/mesh', fetcher, { refreshInterval: 30000 });
  const { data: sshData, mutate: mutateSsh } = useSWR<{ hosts: SshHost[]; keys: string[] }>('/api/ssh-config', fetcher);
  const { data: settings } = useSWR('/api/settings', fetcher);

  const hosts = sshData?.hosts ?? [];
  const meshNodes: any[] = mesh?.nodes ?? [];
  const reachable = meshNodes.filter((n: any) => n.reachable);

  return (
    <div className="space-y-6">
      <PageContext
        pageType="permacomputer"
        summary={`Permacomputer. ${hosts.length} SSH nodes, ${reachable.length} reachable, ${mesh?.summary?.totalClaudes ?? 0} claudes.`}
        metrics={{ nodes: hosts.length, reachable: reachable.length, claudes: mesh?.summary?.totalClaudes ?? 0 }}
      />

      <div>
        <h2 className="text-lg font-bold">Permacomputer</h2>
        <p className="text-base text-[var(--color-muted)]">
          Configure your personal compute mesh. SSH nodes, cloud compute, agent harnesses.
        </p>
      </div>

      {/* Mesh Summary */}
      {mesh?.summary && (
        <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-4 space-y-3">
          <h3 className="text-base font-bold text-[var(--color-muted)]">Mesh</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat label="Nodes" value={`${mesh.summary.reachableNodes}/${mesh.summary.totalNodes}`} />
            <Stat label="Claudes" value={mesh.summary.totalClaudes} />
            <Stat label="Cores" value={mesh.summary.totalCores} />
            <Stat label="Memory" value={`${mesh.summary.totalMemUsedGB}/${mesh.summary.totalMemGB} GB`} />
            <Stat label="Status" value={mesh.summary.reachableNodes === mesh.summary.totalNodes ? 'all green' : 'degraded'} accent={mesh.summary.reachableNodes === mesh.summary.totalNodes} />
          </div>
        </div>
      )}

      {/* SSH Nodes */}
      <SshNodesPanel hosts={hosts} keys={sshData?.keys ?? []} meshNodes={meshNodes} mutate={mutateSsh} mutateMesh={() => {}} />

      {/* SSH Keys */}
      <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-4 space-y-3">
        <h3 className="text-base font-bold text-[var(--color-muted)]">SSH Keys</h3>
        {(sshData?.keys ?? []).length === 0 ? (
          <p className="text-base text-[var(--color-muted)]">No SSH keys found in ~/.ssh/</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(sshData?.keys ?? []).map(k => (
              <span key={k} className="px-3 py-1 text-base font-mono rounded border border-[var(--color-border)] bg-[var(--color-background)]">
                {k}
              </span>
            ))}
          </div>
        )}
        <p className="text-base text-[var(--color-muted)]">
          To add a key to a remote node: <code className="font-mono text-[var(--color-foreground)]">ssh-copy-id -i ~/.ssh/KEY user@host</code>
        </p>
      </div>

      {/* Unsandbox */}
      <UnsandboxPanel />

      {/* Bootstrap Harness */}
      <BootstrapPanel />
    </div>
  );
}

// --- SSH Nodes ---

function SshNodesPanel({
  hosts, keys, meshNodes, mutate, mutateMesh,
}: {
  hosts: SshHost[];
  keys: string[];
  meshNodes: any[];
  mutate: () => void;
  mutateMesh: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<SshHost>({ name: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, 'ok' | 'fail' | 'testing'>>({});

  const getMeshNode = (hostName: string) =>
    meshNodes.find((n: any) => n.hostname === hostName || n.hostname === hosts.find(h => h.name === hostName)?.hostname);

  const startEdit = (host: SshHost) => { setEditing(host.name); setForm({ ...host }); };
  const startNew = () => { setEditing('__new__'); setForm({ name: '', hostname: '', port: '22', user: '', identityFile: '', forwardAgent: 'yes' }); };
  const cancel = () => { setEditing(null); setForm({ name: '' }); };

  const saveHost = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const res = await fetch('/api/ssh-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (res.ok) { mutate(); mutateMesh(); setEditing(null); setForm({ name: '' }); }
    } finally { setSaving(false); }
  };

  const deleteHost = async (name: string) => {
    const res = await fetch('/api/ssh-config', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (res.ok) { mutate(); mutateMesh(); setDeleting(null); }
  };

  const testHost = async (name: string) => {
    setTesting(name);
    setTestResults(prev => ({ ...prev, [name]: 'testing' }));
    try {
      const res = await fetch('/api/mesh');
      const meshData = await res.json();
      const host = hosts.find(h => h.name === name);
      const node = meshData.nodes?.find((n: any) => n.hostname === name || n.hostname === host?.hostname);
      setTestResults(prev => ({ ...prev, [name]: node?.reachable ? 'ok' : 'fail' }));
    } catch { setTestResults(prev => ({ ...prev, [name]: 'fail' })); }
    finally { setTesting(null); }
  };

  return (
    <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-[var(--color-muted)]">SSH Nodes</h3>
        <div className="flex items-center gap-3">
          <span className="text-base text-[var(--color-muted)]">
            {hosts.length} host{hosts.length !== 1 ? 's' : ''} in ~/.ssh/config
          </span>
          <button onClick={startNew} disabled={editing !== null}
            className="px-3 py-1.5 text-base font-bold rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50 cursor-pointer">
            + Add Node
          </button>
        </div>
      </div>

      {editing === '__new__' && (
        <HostForm form={form} setForm={setForm} keys={keys} onSave={saveHost} onCancel={cancel} saving={saving} isNew />
      )}

      {hosts.length === 0 && editing !== '__new__' && (
        <p className="text-base text-[var(--color-muted)]">No SSH hosts configured. Add a node to get started.</p>
      )}

      <div className="space-y-2">
        {hosts.map(host => {
          const node = getMeshNode(host.name);
          const isEditing = editing === host.name;
          const isDeleting = deleting === host.name;
          const testStatus = testResults[host.name];

          if (isEditing) {
            return <HostForm key={host.name} form={form} setForm={setForm} keys={keys} onSave={saveHost} onCancel={cancel} saving={saving} />;
          }

          return (
            <div key={host.name} className="bg-[var(--color-background)] rounded border border-[var(--color-border)] px-4 py-3 flex items-center gap-4">
              <span className={`text-base ${node?.reachable ? 'text-green-400' : 'text-[var(--color-muted)]'}`}>
                {node?.reachable ? '●' : '○'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold font-mono">{host.name}</span>
                  {host.hostname && host.hostname !== host.name && (
                    <span className="text-base text-[var(--color-muted)] font-mono">{host.hostname}</span>
                  )}
                  {host.port && host.port !== '22' && (
                    <span className="text-base text-[var(--color-muted)]">:{host.port}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-base text-[var(--color-muted)]">
                  {host.user && <span>user: {host.user}</span>}
                  {host.identityFile && <span>key: {host.identityFile.replace(/.*\//, '')}</span>}
                  {host.forwardAgent === 'yes' && <span>agent fwd</span>}
                </div>
              </div>
              {node?.reachable && (
                <div className="text-base text-[var(--color-muted)] text-right shrink-0">
                  {node.claudeProcesses !== undefined && <div>{node.claudeProcesses} claude{node.claudeProcesses !== 1 ? 's' : ''}</div>}
                  {node.loadAvg && <div>load {node.loadAvg[0]}</div>}
                </div>
              )}
              {testStatus && testStatus !== 'testing' && (
                <span className={`text-base font-bold ${testStatus === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                  {testStatus === 'ok' ? 'reachable' : 'unreachable'}
                </span>
              )}
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => testHost(host.name)} disabled={testing === host.name}
                  className="text-base text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer disabled:opacity-50">
                  {testing === host.name ? 'testing...' : 'test'}
                </button>
                <button onClick={() => startEdit(host)} disabled={editing !== null}
                  className="text-base text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer disabled:opacity-50">
                  edit
                </button>
                {isDeleting ? (
                  <div className="flex gap-1">
                    <button onClick={() => deleteHost(host.name)} className="text-base text-red-400 hover:text-red-300 cursor-pointer">confirm</button>
                    <button onClick={() => setDeleting(null)} className="text-base text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer">cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setDeleting(host.name)} disabled={editing !== null}
                    className="text-base text-[var(--color-muted)] hover:text-red-400 transition-colors cursor-pointer disabled:opacity-50">
                    remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Unsandbox ---

function UnsandboxPanel() {
  const { data: settings, mutate: mutateSettings } = useSWR('/api/settings', fetcher);
  const { data: status, mutate: mutateStatus } = useSWR('/api/unsandbox', fetcher, { refreshInterval: 60000 });
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; tier?: number; error?: string } | null>(null);
  const [booting, setBooting] = useState(false);
  const [bootResult, setBootResult] = useState<any>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootPrompt, setBootPrompt] = useState('');

  const publicKey = settings?.[SETTINGS_KEYS.unsandboxPublicKey] ?? '';
  const secretKey = settings?.[SETTINGS_KEYS.unsandboxSecretKey] ?? '';
  const enabled = settings?.[SETTINGS_KEYS.unsandboxEnabled] === 'true';

  const saveSetting = async (key: string, value: string) => {
    mutateSettings((prev: Record<string, string> | undefined) => ({ ...prev, [key]: value }), { revalidate: false });
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set', key, value }) });
    mutateStatus();
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch('/api/unsandbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) });
      setTestResult(await res.json());
    } catch (err) { setTestResult({ ok: false, error: String(err) }); }
    finally { setTesting(false); }
  };

  const bootOnUnsandbox = async () => {
    setBooting(true); setBootResult(null); setBootError(null);
    try {
      const res = await fetch('/api/unsandbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'boot-harness', harness: 'claude', prompt: bootPrompt.trim() || undefined, network: 'semitrusted' }),
      });
      const data = await res.json();
      if (data.success) setBootResult(data); else setBootError(data.error || 'Boot failed');
    } catch (err) { setBootError(String(err)); }
    finally { setBooting(false); }
  };

  return (
    <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-[var(--color-muted)]">unsandbox.com</h3>
          <p className="text-base text-[var(--color-muted)] mt-0.5">
            Cloud compute for agent harnesses. Free tier or paid for sessions + semitrust network.
          </p>
        </div>
        <label className="flex items-center gap-2 text-base shrink-0">
          <input type="checkbox" checked={enabled} className="accent-[var(--color-accent)]"
            onChange={(e) => saveSetting(SETTINGS_KEYS.unsandboxEnabled, String(e.target.checked))} />
          <span className={enabled ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}>
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Public Key</label>
          <input type="text" defaultValue={publicKey} placeholder="unsb-pk-xxxx-xxxx-xxxx-xxxx"
            className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono"
            onBlur={(e) => { if (e.target.value !== publicKey) saveSetting(SETTINGS_KEYS.unsandboxPublicKey, e.target.value.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Secret Key</label>
          <div className="flex gap-2">
            <input type={showSecret ? 'text' : 'password'} defaultValue={secretKey} placeholder="unsb-sk-xxxx-xxxx-xxxx-xxxx"
              className="flex-1 bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono"
              onBlur={(e) => { if (e.target.value !== secretKey) saveSetting(SETTINGS_KEYS.unsandboxSecretKey, e.target.value.trim()); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <button onClick={() => setShowSecret(!showSecret)}
              className="px-2 text-base text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer">
              {showSecret ? 'hide' : 'show'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {status?.connected && (
          <div className="flex items-center gap-3 text-base">
            <span className="text-green-400">● connected</span>
            <span className="text-[var(--color-muted)]">tier {status.tier}</span>
            <span className="text-[var(--color-muted)]">{status.rateLimit} rpm</span>
            <span className="text-[var(--color-muted)]">{status.maxSessions} session{status.maxSessions !== 1 ? 's' : ''}</span>
            {status.network && <span className="text-[var(--color-muted)]">{status.network}</span>}
          </div>
        )}
        {status && !status.connected && publicKey && (
          <span className="text-base text-red-400">○ {status.error || 'disconnected'}</span>
        )}
        <button onClick={testConnection} disabled={testing || !publicKey || !secretKey}
          className="px-3 py-1 text-base rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-muted)] transition-colors disabled:opacity-50 cursor-pointer">
          {testing ? 'testing...' : 'test connection'}
        </button>
        {testResult && (
          <span className={`text-base font-bold ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
            {testResult.ok ? `tier ${testResult.tier}` : testResult.error}
          </span>
        )}
      </div>

      {enabled && publicKey && secretKey && (
        <div className="border-t border-[var(--color-border)] pt-3 space-y-3">
          <h4 className="text-base font-bold text-[var(--color-muted)]">Boot on unsandbox</h4>
          <div className="flex gap-2">
            <input type="text" value={bootPrompt} onChange={e => setBootPrompt(e.target.value)}
              placeholder="initial prompt (optional)"
              className="flex-1 bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base"
              onKeyDown={e => { if (e.key === 'Enter') bootOnUnsandbox(); }} />
            <button onClick={bootOnUnsandbox} disabled={booting}
              className="px-4 py-1.5 text-base font-bold rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap">
              {booting ? 'Booting...' : 'Boot Claude on unsandbox'}
            </button>
          </div>
          {bootResult && (
            <div className="text-base text-green-400 font-mono">
              session: {bootResult.sessionId}
              {bootResult.domain && <span className="ml-2 text-[var(--color-muted)]">{bootResult.domain}</span>}
            </div>
          )}
          {bootError && <div className="text-base text-red-400">{bootError}</div>}
        </div>
      )}

      {!publicKey && (
        <div className="text-base text-[var(--color-muted)] space-y-1">
          <div>
            Free code execution for anyone. Get keys at{' '}
            <a href="https://unsandbox.com" target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent)] hover:underline">unsandbox.com</a>
            {' '}— free tier runs 42 languages, paid tiers add sessions + semitrust network for agent harnesses.
          </div>
          <div>
            Tier formula: <span className="font-mono text-[var(--color-foreground)]">$7*N/mo</span> for <span className="font-mono text-[var(--color-foreground)]">N*7 rpm</span> + sessions.
            CLI: <code className="font-mono text-[var(--color-foreground)]">curl -O unsandbox.com/cli/typescript</code>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Bootstrap Harness ---

function BootstrapPanel() {
  const { data: mesh } = useSWR('/api/mesh', fetcher, { refreshInterval: 30000 });
  const { data: projects } = useSWR('/api/projects', fetcher);
  const { data: settings } = useSWR('/api/settings', fetcher);
  const [host, setHost] = useState('localhost');
  const [harness, setHarness] = useState('claude');
  const [customCmd, setCustomCmd] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [multiplexer, setMultiplexer] = useState<'tmux' | 'screen'>('tmux');
  const [yolo, setYolo] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [booting, setBooting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const meshNodes: any[] = mesh?.nodes ?? [];
  const reachableNodes = meshNodes.filter((n: any) => n.reachable);
  const projectList: any[] = projects ?? [];
  const unsandboxEnabled = settings?.unsandbox_enabled === 'true' && !!settings?.unsandbox_public_key;

  const handleBoot = useCallback(async () => {
    if (host === 'unsandbox' && !projectPath) { /* unsandbox can boot without local path */ }
    else if (!projectPath) return;

    setBooting(true); setResult(null); setError(null);

    try {
      if (host === 'unsandbox') {
        const res = await fetch('/api/unsandbox', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'boot-harness', harness: harness === 'custom' ? customCmd : 'claude', projectRepo: projectPath, prompt: prompt.trim() || undefined, network: 'semitrusted' }),
        });
        const data = await res.json();
        if (data.success) setResult({ ...data, host: 'unsandbox', multiplexer: 'unsandbox' });
        else setError(data.error || 'Boot failed');
      } else {
        const res = await fetch('/api/boot', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath, projectName, host: host === 'localhost' ? undefined : host, yolo: harness === 'claude' ? yolo : false, prompt: prompt.trim() || undefined, harness: harness === 'custom' ? customCmd : 'claude', preferMultiplexer: multiplexer }),
        });
        const data = await res.json();
        if (res.ok) setResult(data); else setError(data.error || 'Boot failed');
      }
    } catch (err) { setError(String(err)); }
    finally { setBooting(false); }
  }, [projectPath, projectName, host, harness, yolo, prompt, customCmd, multiplexer]);

  return (
    <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-4 space-y-4">
      <h3 className="text-base font-bold text-[var(--color-muted)]">Bootstrap Harness</h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Host</label>
          <select value={host} onChange={e => setHost(e.target.value)}
            className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono">
            <option value="localhost">localhost</option>
            {unsandboxEnabled && <option value="unsandbox">unsandbox.com (cloud)</option>}
            {reachableNodes.filter((n: any) => n.hostname !== meshNodes[0]?.hostname).map((n: any) => (
              <option key={n.hostname} value={n.hostname}>{n.hostname} ({n.claudeProcesses ?? 0} claudes)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Harness</label>
          <select value={harness} onChange={e => setHarness(e.target.value)}
            className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base">
            {HARNESSES.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Multiplexer</label>
          <div className="flex gap-2">
            {(['tmux', 'screen'] as const).map(mux => (
              <button key={mux} onClick={() => setMultiplexer(mux)}
                className={`flex-1 px-3 py-1.5 text-base rounded border transition-colors cursor-pointer ${
                  multiplexer === mux ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-bold' : 'border-[var(--color-border)] hover:border-[var(--color-muted)]'
                }`}>
                {mux}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Mode</label>
          <button onClick={() => setYolo(!yolo)} disabled={harness !== 'claude'}
            className={`w-full px-3 py-1.5 text-base rounded border transition-colors cursor-pointer disabled:opacity-30 ${
              yolo && harness === 'claude' ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-bold' : 'border-[var(--color-border)] hover:border-[var(--color-muted)]'
            }`}>
            {yolo ? 'YOLO (skip perms)' : 'Interactive'}
          </button>
        </div>
      </div>

      <div>
        <label className="text-base text-[var(--color-muted)] block mb-1">Project</label>
        <div className="flex gap-2">
          <select value={selectedProject} onChange={e => {
            const name = e.target.value;
            setSelectedProject(name);
            const proj = projectList.find((p: any) => p.name === name);
            setProjectPath(proj?.path ?? '');
            setProjectName(proj?.name ?? '');
          }} className="flex-1 bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono">
            <option value="">select project...</option>
            {projectList.map((p: any) => <option key={p.name} value={p.name}>{p.displayName || p.name}</option>)}
          </select>
          <input type="text" value={projectPath} onChange={e => { setProjectPath(e.target.value); setSelectedProject(''); setProjectName(''); }}
            placeholder="or enter path: /home/fox/git/..."
            className="flex-1 bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono" />
        </div>
      </div>

      <div>
        <label className="text-base text-[var(--color-muted)] block mb-1">Initial Prompt (optional)</label>
        <input type="text" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g. fix the failing tests"
          className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base"
          onKeyDown={e => { if (e.key === 'Enter' && (projectPath || host === 'unsandbox')) handleBoot(); }} />
      </div>

      {harness === 'custom' && (
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Command</label>
          <input type="text" value={customCmd} onChange={e => setCustomCmd(e.target.value)} placeholder="e.g. python train.py"
            className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono" />
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={handleBoot} disabled={booting || (host !== 'unsandbox' && !projectPath)}
          className="px-6 py-2 text-base font-bold rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50 cursor-pointer">
          {booting ? 'Bootstrapping...' : `Boot ${harness === 'claude' ? 'Claude' : 'Harness'} on ${host === 'unsandbox' ? 'unsandbox.com' : host}`}
        </button>
        {result && (
          <div className="text-base text-green-400 font-mono">
            {result.bootstrapped?.length > 0 && (
              <span className="text-yellow-400 mr-2">[bootstrapped: {result.bootstrapped.join(', ')}]</span>
            )}
            {result.sessionId
              ? <>session: {result.sessionId}{result.domain && <span className="text-[var(--color-muted)] ml-2">{result.domain}</span>}</>
              : <>{result.multiplexer} session: {result.tmuxSession}{result.host !== 'localhost' && ` on ${result.host}`}</>
            }
            {result.command && <span className="text-[var(--color-muted)] ml-2">{result.command}</span>}
          </div>
        )}
        {error && <div className="text-base text-red-400">{error}</div>}
      </div>
    </div>
  );
}

// --- Shared ---

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div>
      <div className="text-base text-[var(--color-muted)]">{label}</div>
      <div className={`text-base font-bold ${accent ? 'text-[var(--color-accent)]' : ''}`}>{value}</div>
    </div>
  );
}

function HostForm({ form, setForm, keys, onSave, onCancel, saving, isNew }: {
  form: SshHost; setForm: (f: SshHost) => void; keys: string[];
  onSave: () => void; onCancel: () => void; saving: boolean; isNew?: boolean;
}) {
  return (
    <div className="bg-[var(--color-background)] rounded border border-[var(--color-accent)]/30 p-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Host Alias</label>
          <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. cammy" disabled={!isNew}
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono disabled:opacity-50" />
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">HostName</label>
          <input type="text" value={form.hostname ?? ''} onChange={e => setForm({ ...form, hostname: e.target.value })}
            placeholder="e.g. cammy.foxhop.net"
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono" />
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Port</label>
          <input type="text" value={form.port ?? ''} onChange={e => setForm({ ...form, port: e.target.value })}
            placeholder="22"
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono" />
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">User</label>
          <input type="text" value={form.user ?? ''} onChange={e => setForm({ ...form, user: e.target.value })}
            placeholder="e.g. fox"
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono" />
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Identity File</label>
          <select value={form.identityFile ?? ''} onChange={e => setForm({ ...form, identityFile: e.target.value })}
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono">
            <option value="">default</option>
            {keys.map(k => <option key={k} value={`~/.ssh/${k}`}>~/.ssh/{k}</option>)}
          </select>
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Forward Agent</label>
          <div className="flex gap-2 mt-0.5">
            {['yes', 'no'].map(v => (
              <button key={v} onClick={() => setForm({ ...form, forwardAgent: v })}
                className={`flex-1 px-3 py-1.5 text-base rounded border transition-colors cursor-pointer ${
                  form.forwardAgent === v ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-bold' : 'border-[var(--color-border)] hover:border-[var(--color-muted)]'
                }`}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={onSave} disabled={saving || !form.name}
          className="px-4 py-1.5 text-base font-bold rounded border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-50 cursor-pointer">
          {saving ? 'Saving...' : isNew ? 'Add Host' : 'Save'}
        </button>
        <button onClick={onCancel}
          className="px-4 py-1.5 text-base rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  );
}
