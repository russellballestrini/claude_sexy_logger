'use client';

import { useState, useCallback, useMemo } from 'react';
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

// ============================================================
// Main Page
// ============================================================

export default function PermacomputerPage() {
  const { data: mesh, mutate: mutateMesh } = useSWR('/api/mesh', fetcher, { refreshInterval: 30000 });
  const { data: sshData, mutate: mutateSsh } = useSWR<{ hosts: SshHost[]; keys: string[] }>('/api/ssh-config', fetcher);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const hosts = sshData?.hosts ?? [];
  const meshNodes: any[] = mesh?.nodes ?? [];
  const reachable = meshNodes.filter((n: any) => n.reachable);

  // Build combined node list: mesh nodes enriched with SSH config
  const allNodes = useMemo(() => {
    const nodes: { meshNode: any; sshHost?: SshHost; key: string }[] = [];
    const seen = new Set<string>();

    for (const mn of meshNodes) {
      const host = hosts.find(h => h.name === mn.hostname || h.hostname === mn.hostname);
      const key = mn.hostname;
      seen.add(key);
      if (host) { seen.add(host.name); if (host.hostname) seen.add(host.hostname); }
      nodes.push({ meshNode: mn, sshHost: host, key });
    }

    // SSH hosts not in mesh
    for (const h of hosts) {
      if (!seen.has(h.name) && !seen.has(h.hostname ?? '')) {
        nodes.push({ meshNode: null, sshHost: h, key: h.name });
      }
    }

    return nodes;
  }, [meshNodes, hosts]);

  return (
    <div className="space-y-6">
      <PageContext
        pageType="permacomputer"
        summary={`Permacomputer. ${allNodes.length} nodes, ${reachable.length} reachable, ${mesh?.summary?.totalClaudes ?? 0} claudes.`}
        metrics={{ nodes: allNodes.length, reachable: reachable.length, claudes: mesh?.summary?.totalClaudes ?? 0 }}
      />

      <div>
        <h2 className="text-lg font-bold">Permacomputer</h2>
        <p className="text-base text-[var(--color-muted)]">
          Your personal compute mesh. Click a node for deep diagnostics.
        </p>
      </div>

      {/* Mesh Summary Bar */}
      {mesh?.summary && <MeshSummaryBar summary={mesh.summary} />}

      {/* Node Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {allNodes.map(({ meshNode, sshHost, key }) => (
          <NodeCard
            key={key}
            node={meshNode}
            sshHost={sshHost}
            isSelected={selectedNode === key}
            onSelect={() => setSelectedNode(selectedNode === key ? null : key)}
          />
        ))}
        <AddNodeButton hosts={hosts} keys={sshData?.keys ?? []} mutate={() => { mutateSsh(); mutateMesh(); }} />
      </div>

      {/* Node Detail Panel */}
      {selectedNode && (
        <NodeDetailPanel
          hostname={selectedNode}
          sshHost={hosts.find(h => h.name === selectedNode || h.hostname === selectedNode)}
          meshNode={meshNodes.find((n: any) => n.hostname === selectedNode)}
          onClose={() => setSelectedNode(null)}
          keys={sshData?.keys ?? []}
          mutateSsh={mutateSsh}
          mutateMesh={mutateMesh}
        />
      )}

      {/* Unsandbox */}
      <UnsandboxPanel />

      {/* Bootstrap Harness */}
      <BootstrapPanel />
    </div>
  );
}

// ============================================================
// Mesh Summary Bar
// ============================================================

function MeshSummaryBar({ summary }: { summary: any }) {
  const memPct = summary.totalMemGB > 0 ? Math.round((summary.totalMemUsedGB / summary.totalMemGB) * 100) : 0;
  const allGreen = summary.reachableNodes === summary.totalNodes;

  return (
    <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-4">
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`text-lg ${allGreen ? 'text-green-400' : 'text-yellow-400'}`}>
            {allGreen ? '●' : '◐'}
          </span>
          <span className="text-base font-bold">
            {summary.reachableNodes}/{summary.totalNodes} nodes
          </span>
        </div>
        <MiniStat label="claudes" value={summary.totalClaudes} accent />
        <MiniStat label="cores" value={summary.totalCores} />
        <div className="flex items-center gap-2">
          <span className="text-base text-[var(--color-muted)]">mem</span>
          <div className="w-24 h-2 bg-[var(--color-background)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${memPct}%`,
                backgroundColor: memPct > 85 ? '#ef4444' : memPct > 60 ? '#eab308' : 'var(--color-accent)',
              }}
            />
          </div>
          <span className="text-base font-mono">{summary.totalMemUsedGB}/{summary.totalMemGB}G</span>
        </div>
        <span className={`text-base font-bold ${allGreen ? 'text-green-400' : 'text-yellow-400'}`}>
          {allGreen ? 'all green' : 'degraded'}
        </span>
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-base text-[var(--color-muted)]">{label}</span>
      <span className={`text-base font-bold font-mono ${accent ? 'text-[var(--color-accent)]' : ''}`}>{value}</span>
    </div>
  );
}

// ============================================================
// Node Card (compact, clickable)
// ============================================================

function NodeCard({ node, sshHost, isSelected, onSelect }: {
  node: any; sshHost?: SshHost; isSelected: boolean; onSelect: () => void;
}) {
  const reachable = node?.reachable;
  const name = sshHost?.name ?? node?.hostname ?? '?';
  const hostname = sshHost?.hostname ?? node?.hostname;
  const cpuCores = node?.cpuCores ?? 0;
  const memTotal = node?.memTotalGB ?? 0;
  const memUsed = node?.memUsedGB ?? 0;
  const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
  const load1 = node?.loadAvg?.[0] ?? 0;
  const loadPct = cpuCores > 0 ? Math.min(100, Math.round((load1 / cpuCores) * 100)) : 0;
  const claudes = node?.claudeProcesses ?? 0;
  const swap = node?.swapUsedGB ?? 0;

  return (
    <button
      onClick={onSelect}
      className={`text-left bg-[var(--color-surface)] rounded border p-4 transition-all cursor-pointer hover:border-[var(--color-accent)]/50 ${
        isSelected
          ? 'border-[var(--color-accent)] shadow-[0_0_12px_rgba(var(--accent-rgb,212,0,0),0.3)]'
          : 'border-[var(--color-border)]'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-sm ${reachable ? 'text-green-400' : node ? 'text-red-400' : 'text-[var(--color-muted)]'}`}>
          {reachable ? '●' : '○'}
        </span>
        <span className="text-base font-bold font-mono truncate">{name}</span>
        {hostname && hostname !== name && (
          <span className="text-xs text-[var(--color-muted)] font-mono truncate">{hostname}</span>
        )}
        {claudes > 0 && (
          <span className="ml-auto text-xs font-bold text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-1.5 py-0.5 rounded">
            {claudes} claude{claudes !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {reachable ? (
        <>
          {/* Mini gauges */}
          <div className="space-y-2 mb-3">
            <MiniGauge label="CPU" value={`${load1}/${cpuCores}`} pct={loadPct} />
            <MiniGauge label="MEM" value={`${memUsed}/${memTotal}G`} pct={memPct} />
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
            <span>{cpuCores} cores</span>
            {swap > 0 && <span className="text-yellow-400">swap {swap}G</span>}
            {node.uptime && <span>up {node.uptime}</span>}
          </div>
        </>
      ) : (
        <div className="text-xs text-[var(--color-muted)]">
          {node?.error ?? (node ? 'unreachable' : 'not probed')}
          {sshHost && (
            <div className="mt-1">
              {sshHost.user && <span>user: {sshHost.user} </span>}
              {sshHost.port && sshHost.port !== '22' && <span>port: {sshHost.port}</span>}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

function MiniGauge({ label, value, pct }: { label: string; value: string; pct: number }) {
  const color = pct > 85 ? '#ef4444' : pct > 60 ? '#eab308' : 'var(--color-accent)';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--color-muted)] w-6">{label}</span>
      <div className="flex-1 h-1.5 bg-[var(--color-background)] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono w-16 text-right">{value}</span>
    </div>
  );
}

// ============================================================
// Add Node Button (inline card)
// ============================================================

function AddNodeButton({ hosts, keys, mutate }: { hosts: SshHost[]; keys: string[]; mutate: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<SshHost>({ name: '', hostname: '', port: '22', user: '', identityFile: '', forwardAgent: 'yes' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const res = await fetch('/api/ssh-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (res.ok) { mutate(); setAdding(false); setForm({ name: '', hostname: '', port: '22', user: '', identityFile: '', forwardAgent: 'yes' }); }
    } finally { setSaving(false); }
  };

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="border border-dashed border-[var(--color-border)] rounded p-4 flex items-center justify-center gap-2 text-base text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-accent)]/50 transition-colors cursor-pointer min-h-[120px]"
      >
        <span className="text-lg">+</span> Add Node
      </button>
    );
  }

  return (
    <div className="border border-[var(--color-accent)]/30 rounded p-4 space-y-3 col-span-1 md:col-span-2 xl:col-span-3">
      <HostForm form={form} setForm={setForm} keys={keys} onSave={save} onCancel={() => setAdding(false)} saving={saving} isNew />
    </div>
  );
}

// ============================================================
// Node Detail Panel (expanded view with deep probe data)
// ============================================================

function NodeDetailPanel({ hostname, sshHost, meshNode, onClose, keys, mutateSsh, mutateMesh }: {
  hostname: string;
  sshHost?: SshHost;
  meshNode?: any;
  onClose: () => void;
  keys: string[];
  mutateSsh: () => void;
  mutateMesh: () => void;
}) {
  const probeHost = sshHost?.hostname ?? sshHost?.name ?? hostname;
  const { data: detail, isLoading, mutate: mutateDetail } = useSWR(
    `/api/mesh/node?host=${encodeURIComponent(probeHost)}`,
    fetcher,
    { refreshInterval: 0 }
  );
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<SshHost>(sshHost ?? { name: hostname });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'processes' | 'gpu' | 'disk' | 'network' | 'sessions'>('overview');

  const refresh = () => mutateDetail();

  const saveHost = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      const res = await fetch('/api/ssh-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (res.ok) { mutateSsh(); mutateMesh(); setEditing(false); }
    } finally { setSaving(false); }
  };

  const TABS = [
    { id: 'overview' as const, label: 'Overview', icon: '◇' },
    { id: 'processes' as const, label: 'Processes', icon: '▸' },
    { id: 'gpu' as const, label: 'GPU', icon: '◈', hide: !detail?.gpu?.hasGpu },
    { id: 'disk' as const, label: 'Disk', icon: '■' },
    { id: 'network' as const, label: 'Network', icon: '◎' },
    { id: 'sessions' as const, label: 'Sessions', icon: '≡' },
  ].filter(t => !t.hide);

  return (
    <div className="bg-[var(--color-surface)] rounded border border-[var(--color-accent)]/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-background)]">
        <div className="flex items-center gap-3">
          <span className={`text-sm ${detail?.reachable ? 'text-green-400' : 'text-red-400'}`}>
            {detail?.reachable ? '●' : '○'}
          </span>
          <span className="text-base font-bold font-mono">{hostname}</span>
          {detail?.system && (
            <span className="text-xs text-[var(--color-muted)]">
              {detail.system.os} / {detail.system.arch} / {detail.system.kernel}
            </span>
          )}
          {isLoading && <span className="text-xs text-[var(--color-muted)] animate-pulse">probing...</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer">refresh</button>
          {sshHost && (
            <button onClick={() => setEditing(!editing)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer">
              {editing ? 'cancel edit' : 'edit host'}
            </button>
          )}
          <button onClick={onClose} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer ml-2">close</button>
        </div>
      </div>

      {/* Edit form */}
      {editing && sshHost && (
        <div className="px-5 py-3 border-b border-[var(--color-border)]">
          <HostForm form={form} setForm={setForm} keys={keys} onSave={saveHost} onCancel={() => setEditing(false)} saving={saving} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-0.5 px-5 pt-2 border-b border-[var(--color-border)]">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs rounded-t border-b-2 transition-colors cursor-pointer ${
              activeTab === tab.id
                ? 'border-[var(--color-accent)] text-[var(--color-foreground)] font-bold'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
            }`}
          >
            <span className={activeTab === tab.id ? 'text-[var(--color-accent)]' : ''}>{tab.icon}</span>
            <span className="ml-1.5">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">
        {!detail?.reachable && !isLoading && (
          <div className="text-base text-red-400">{detail?.error ?? 'Node unreachable'}</div>
        )}
        {detail?.reachable && activeTab === 'overview' && <OverviewTab detail={detail} />}
        {detail?.reachable && activeTab === 'processes' && <ProcessesTab detail={detail} />}
        {detail?.reachable && activeTab === 'gpu' && <GpuTab detail={detail} />}
        {detail?.reachable && activeTab === 'disk' && <DiskTab detail={detail} />}
        {detail?.reachable && activeTab === 'network' && <NetworkTab detail={detail} />}
        {detail?.reachable && activeTab === 'sessions' && <SessionsTab detail={detail} />}
      </div>
    </div>
  );
}

// ============================================================
// Overview Tab
// ============================================================

function OverviewTab({ detail }: { detail: any }) {
  const sys = detail.system;
  const mem = detail.memory;
  const load = detail.loadAvg;
  const cores = sys?.cpuCores ?? 1;
  const uptimeHours = Math.round((detail.uptimeSeconds ?? 0) / 3600);

  // Build load sparkline from 1/5/15 min averages
  const loadPoints = load ? [load[0], load[1], load[2]] : [0, 0, 0];
  const maxLoad = Math.max(...loadPoints, cores) || 1;

  const memPct = mem ? Math.round((mem.usedGB / mem.totalGB) * 100) : 0;
  const swapPct = mem && mem.swapTotalGB > 0 ? Math.round((mem.swapUsedGB / mem.swapTotalGB) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* System info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="CPU" value={sys?.cpuModel?.replace(/\(R\)|\(TM\)/g, '').replace(/CPU\s+/i, '').trim() ?? 'n/a'} sub={`${cores} cores${sys?.cpuMhz ? ` @ ${Math.round(sys.cpuMhz)}MHz` : ''}`} />
        <StatCard label="Architecture" value={sys?.arch ?? 'n/a'} sub={sys?.kernel ?? ''} />
        <StatCard label="OS" value={sys?.os ?? 'Linux'} sub={`up ${formatDuration(detail.uptimeSeconds)}`} />
        <StatCard label="Claudes" value={detail.claudeProcesses?.length ?? 0} sub={detail.claudeProcesses?.length > 0 ? detail.claudeProcesses.map((p: any) => `PID ${p.pid}`).join(', ') : 'none running'} accent />
      </div>

      {/* Load & Memory gauges */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Load */}
        <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4">
          <div className="text-xs text-[var(--color-muted)] mb-2">Load Average</div>
          <div className="flex items-end gap-1 h-16 mb-2">
            {['1m', '5m', '15m'].map((label, i) => {
              const val = loadPoints[i];
              const pct = Math.min(100, (val / maxLoad) * 100);
              const color = val > cores ? '#ef4444' : val > cores * 0.7 ? '#eab308' : 'var(--color-accent)';
              return (
                <div key={label} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-mono font-bold" style={{ color }}>{val.toFixed(2)}</span>
                  <div className="w-full bg-[var(--color-surface)] rounded-sm overflow-hidden" style={{ height: '100%' }}>
                    <div className="w-full rounded-sm transition-all" style={{ height: `${pct}%`, backgroundColor: color, marginTop: `${100 - pct}%` }} />
                  </div>
                  <span className="text-[10px] text-[var(--color-muted)]">{label}</span>
                </div>
              );
            })}
          </div>
          <div className="text-xs text-[var(--color-muted)]">
            runnable: {detail.runnable} / threshold: {cores} cores
          </div>
        </div>

        {/* Memory */}
        <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4">
          <div className="text-xs text-[var(--color-muted)] mb-2">Memory</div>
          {mem && (
            <>
              <GaugeBar label="RAM" pct={memPct} value={`${mem.usedGB}/${mem.totalGB}G`} sub={`${mem.availableGB}G available`} />
              <div className="flex gap-3 text-xs text-[var(--color-muted)] mt-2 mb-3">
                <span>buffers: {mem.buffersGB}G</span>
                <span>cached: {mem.cachedGB}G</span>
                <span>shmem: {mem.shmemGB}G</span>
                {mem.dirtyMB > 0 && <span className="text-yellow-400">dirty: {mem.dirtyMB}MB</span>}
              </div>
              {mem.swapTotalGB > 0 && (
                <GaugeBar label="Swap" pct={swapPct} value={`${mem.swapUsedGB}/${mem.swapTotalGB}G`} sub={mem.swapCachedGB > 0 ? `${mem.swapCachedGB}G cached` : ''} warn={swapPct > 50} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Temperatures */}
      {detail.temperatures?.length > 0 && (
        <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4">
          <div className="text-xs text-[var(--color-muted)] mb-2">Thermal Zones</div>
          <div className="flex gap-4 flex-wrap">
            {detail.temperatures.map((t: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-muted)]">{t.zone}</span>
                <span className={`text-sm font-mono font-bold ${t.tempC > 80 ? 'text-red-400' : t.tempC > 60 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {t.tempC}°C
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Processes Tab
// ============================================================

function ProcessesTab({ detail }: { detail: any }) {
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);

  const allProcesses: any[] = detail.processes ?? [];
  const claudePs: any[] = detail.claudeProcesses ?? [];

  const filtered = useMemo(() => {
    let list = allProcesses;
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter((p: any) => p.command?.toLowerCase().includes(q) || p.user?.toLowerCase().includes(q));
    }
    return showAll ? list : list.slice(0, 30);
  }, [allProcesses, filter, showAll]);

  return (
    <div className="space-y-4">
      {/* Claude processes hero section */}
      {claudePs.length > 0 && (
        <div className="bg-[var(--color-accent)]/5 border border-[var(--color-accent)]/20 rounded p-4 space-y-2">
          <div className="text-xs font-bold text-[var(--color-accent)]">
            {claudePs.length} Claude process{claudePs.length !== 1 ? 'es' : ''} running
          </div>
          <div className="space-y-1">
            {claudePs.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs font-mono">
                <span className="text-[var(--color-accent)] w-12">PID {p.pid}</span>
                <span className="text-[var(--color-muted)] w-12">{p.user}</span>
                <GaugePill label="cpu" value={p.cpu} max={100} />
                <GaugePill label="mem" value={p.mem} max={100} />
                <span className="text-[var(--color-muted)] w-16">RSS {formatBytes(p.rss * 1024)}</span>
                <span className="text-[var(--color-muted)] w-16">{p.time}</span>
                <span className="text-[var(--color-foreground)] truncate flex-1">{p.command}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Process filter */}
      <div className="flex items-center gap-3">
        <input
          type="text" value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="filter processes..."
          className="flex-1 bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-xs font-mono"
        />
        <span className="text-xs text-[var(--color-muted)]">{filtered.length} of {allProcesses.length}</span>
      </div>

      {/* Process table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <th className="text-left py-1 pr-2">USER</th>
              <th className="text-right py-1 pr-2">PID</th>
              <th className="text-right py-1 pr-2">%CPU</th>
              <th className="text-right py-1 pr-2">%MEM</th>
              <th className="text-right py-1 pr-2">RSS</th>
              <th className="text-left py-1 pr-2">STAT</th>
              <th className="text-left py-1 pr-2">TIME</th>
              <th className="text-left py-1">COMMAND</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p: any, i: number) => {
              const isClaude = p.command?.toLowerCase().includes('claude');
              return (
                <tr key={i} className={`border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface-hover)] ${isClaude ? 'bg-[var(--color-accent)]/5' : ''}`}>
                  <td className="py-0.5 pr-2 text-[var(--color-muted)]">{p.user}</td>
                  <td className="py-0.5 pr-2 text-right">{p.pid}</td>
                  <td className={`py-0.5 pr-2 text-right ${p.cpu > 50 ? 'text-red-400 font-bold' : p.cpu > 10 ? 'text-yellow-400' : ''}`}>{p.cpu}</td>
                  <td className={`py-0.5 pr-2 text-right ${p.mem > 20 ? 'text-red-400 font-bold' : p.mem > 5 ? 'text-yellow-400' : ''}`}>{p.mem}</td>
                  <td className="py-0.5 pr-2 text-right text-[var(--color-muted)]">{formatBytes(p.rss * 1024)}</td>
                  <td className="py-0.5 pr-2 text-[var(--color-muted)]">{p.stat}</td>
                  <td className="py-0.5 pr-2 text-[var(--color-muted)]">{p.time}</td>
                  <td className={`py-0.5 truncate max-w-md ${isClaude ? 'text-[var(--color-accent)]' : ''}`}>{p.command}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!showAll && allProcesses.length > 30 && (
        <button onClick={() => setShowAll(true)} className="text-xs text-[var(--color-accent)] hover:underline cursor-pointer">
          Show all {allProcesses.length} processes
        </button>
      )}
    </div>
  );
}

// ============================================================
// GPU Tab
// ============================================================

function GpuTab({ detail }: { detail: any }) {
  const nvidia: any[] = detail.gpu?.nvidia ?? [];
  const nvidiaPs: any[] = detail.gpu?.nvidiaProcesses ?? [];
  const amd: any[] = detail.gpu?.amd ?? [];

  return (
    <div className="space-y-4">
      {nvidia.map((gpu: any, i: number) => (
        <div key={i} className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-base font-bold">{gpu.name}</span>
              <span className="text-xs text-[var(--color-muted)] ml-2">GPU {gpu.index}</span>
            </div>
            <span className="text-xs font-mono text-[var(--color-muted)]">{gpu.pstate}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <GaugeCard label="GPU Utilization" pct={gpu.gpuUtil} value={`${gpu.gpuUtil}%`} />
            <GaugeCard label="Memory" pct={gpu.memTotalMB > 0 ? Math.round((gpu.memUsedMB / gpu.memTotalMB) * 100) : 0} value={`${gpu.memUsedMB}/${gpu.memTotalMB}MB`} />
            <GaugeCard label="Power" pct={gpu.powerLimitW > 0 ? Math.round((gpu.powerDrawW / gpu.powerLimitW) * 100) : 0} value={`${gpu.powerDrawW}/${gpu.powerLimitW}W`} />
            <div className="bg-[var(--color-surface)] rounded p-3">
              <div className="text-xs text-[var(--color-muted)] mb-1">Thermal</div>
              <div className={`text-lg font-mono font-bold ${gpu.tempC > 80 ? 'text-red-400' : gpu.tempC > 65 ? 'text-yellow-400' : 'text-green-400'}`}>
                {gpu.tempC}°C
              </div>
              <div className="text-xs text-[var(--color-muted)]">fan {gpu.fanPct}%</div>
            </div>
          </div>
        </div>
      ))}

      {nvidiaPs.length > 0 && (
        <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4">
          <div className="text-xs text-[var(--color-muted)] mb-2">GPU Processes</div>
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)]">
                <th className="text-right py-1 pr-3">PID</th>
                <th className="text-left py-1 pr-3">Process</th>
                <th className="text-right py-1">GPU Mem</th>
              </tr>
            </thead>
            <tbody>
              {nvidiaPs.map((p: any, i: number) => (
                <tr key={i} className="border-b border-[var(--color-border)]/30">
                  <td className="py-0.5 pr-3 text-right">{p.pid}</td>
                  <td className="py-0.5 pr-3">{p.name}</td>
                  <td className="py-0.5 text-right">{p.memMB}MB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {amd.length > 0 && (
        <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4">
          <div className="text-xs text-[var(--color-muted)] mb-2">AMD GPU</div>
          <pre className="text-xs font-mono overflow-x-auto">{JSON.stringify(amd, null, 2)}</pre>
        </div>
      )}

      {!nvidia.length && !amd.length && (
        <div className="text-base text-[var(--color-muted)]">No GPU detected on this node.</div>
      )}
    </div>
  );
}

// ============================================================
// Disk Tab
// ============================================================

function DiskTab({ detail }: { detail: any }) {
  const disks: any[] = detail.disk ?? [];

  return (
    <div className="space-y-3">
      {disks.map((d: any, i: number) => (
        <div key={i} className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-mono font-bold">{d.mount}</span>
              <span className="text-xs text-[var(--color-muted)] ml-2">{d.device}</span>
            </div>
            <span className="text-xs font-mono">{d.used} / {d.size}</span>
          </div>
          <div className="h-2 bg-[var(--color-surface)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${d.usePct}%`,
                backgroundColor: d.usePct > 90 ? '#ef4444' : d.usePct > 75 ? '#eab308' : 'var(--color-accent)',
              }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-[var(--color-muted)]">
            <span>{d.usePct}% used</span>
            <span>{d.avail} free</span>
          </div>
        </div>
      ))}
      {disks.length === 0 && <div className="text-base text-[var(--color-muted)]">No disk data available.</div>}
    </div>
  );
}

// ============================================================
// Network Tab
// ============================================================

function NetworkTab({ detail }: { detail: any }) {
  const ifaces: any[] = detail.network?.interfaces ?? [];
  const throughput: any[] = detail.network?.throughput ?? [];

  return (
    <div className="space-y-4">
      {/* Interfaces */}
      <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4">
        <div className="text-xs text-[var(--color-muted)] mb-2">Interfaces</div>
        <div className="space-y-1">
          {ifaces.map((iface: any, i: number) => (
            <div key={i} className="flex items-center gap-3 text-xs font-mono">
              <span className={`w-16 font-bold ${iface.state === 'UP' ? 'text-green-400' : 'text-[var(--color-muted)]'}`}>{iface.name}</span>
              <span className={`w-10 ${iface.state === 'UP' ? 'text-green-400' : 'text-red-400'}`}>{iface.state}</span>
              <span className="text-[var(--color-muted)] flex-1 truncate">{iface.addrs}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Throughput */}
      {throughput.length > 0 && (
        <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4">
          <div className="text-xs text-[var(--color-muted)] mb-2">Cumulative Throughput (since boot)</div>
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Interface</th>
                <th className="text-right py-1">RX</th>
                <th className="text-right py-1">TX</th>
                <th className="text-right py-1">RX pkts</th>
                <th className="text-right py-1">TX pkts</th>
              </tr>
            </thead>
            <tbody>
              {throughput.map((n: any, i: number) => (
                <tr key={i} className="border-b border-[var(--color-border)]/30">
                  <td className="py-0.5 font-bold">{n.iface}</td>
                  <td className="py-0.5 text-right text-green-400">{formatBytes(n.rxBytes)}</td>
                  <td className="py-0.5 text-right text-blue-400">{formatBytes(n.txBytes)}</td>
                  <td className="py-0.5 text-right text-[var(--color-muted)]">{formatNumber(n.rxPackets)}</td>
                  <td className="py-0.5 text-right text-[var(--color-muted)]">{formatNumber(n.txPackets)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sessions Tab
// ============================================================

function SessionsTab({ detail }: { detail: any }) {
  const tmux: any[] = detail.sessions?.tmux ?? [];
  const screen: any[] = detail.sessions?.screen ?? [];
  const docker: any[] = detail.containers ?? [];

  return (
    <div className="space-y-4">
      {/* Tmux */}
      <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4">
        <div className="text-xs text-[var(--color-muted)] mb-2">tmux sessions</div>
        {tmux.length > 0 ? (
          <div className="space-y-1">
            {tmux.map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs font-mono">
                <span className="text-green-400">●</span>
                <span className="font-bold">{s.name}</span>
                <span className="text-[var(--color-muted)]">{s.windows} window{s.windows !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[var(--color-muted)]">No tmux sessions</div>
        )}
      </div>

      {/* Screen */}
      {screen.length > 0 && (
        <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4">
          <div className="text-xs text-[var(--color-muted)] mb-2">screen sessions</div>
          <div className="space-y-1">
            {screen.map((s: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-xs font-mono">
                <span className="text-green-400">●</span>
                <span className="font-bold">{s.name}</span>
                <span className="text-[var(--color-muted)]">PID {s.pid}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Docker */}
      {docker.length > 0 && (
        <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-4">
          <div className="text-xs text-[var(--color-muted)] mb-2">Docker Containers</div>
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-[var(--color-muted)] border-b border-[var(--color-border)]">
                <th className="text-left py-1">Name</th>
                <th className="text-left py-1">Image</th>
                <th className="text-left py-1">Status</th>
                <th className="text-left py-1">Ports</th>
              </tr>
            </thead>
            <tbody>
              {docker.map((c: any, i: number) => (
                <tr key={i} className="border-b border-[var(--color-border)]/30">
                  <td className="py-0.5 font-bold">{c.name}</td>
                  <td className="py-0.5 text-[var(--color-muted)]">{c.image}</td>
                  <td className={`py-0.5 ${c.status?.includes('Up') ? 'text-green-400' : 'text-yellow-400'}`}>{c.status}</td>
                  <td className="py-0.5 text-[var(--color-muted)]">{c.ports}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tmux.length === 0 && screen.length === 0 && docker.length === 0 && (
        <div className="text-base text-[var(--color-muted)]">No active sessions or containers.</div>
      )}
    </div>
  );
}

// ============================================================
// Shared UI Components
// ============================================================

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-[var(--color-background)] rounded border border-[var(--color-border)] p-3">
      <div className="text-xs text-[var(--color-muted)] mb-1">{label}</div>
      <div className={`text-sm font-bold truncate ${accent ? 'text-[var(--color-accent)]' : ''}`}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--color-muted)] truncate mt-0.5">{sub}</div>}
    </div>
  );
}

function GaugeBar({ label, pct, value, sub, warn }: { label: string; pct: number; value: string; sub?: string; warn?: boolean }) {
  const color = warn || pct > 85 ? '#ef4444' : pct > 60 ? '#eab308' : 'var(--color-accent)';
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold">{label}</span>
        <span className="text-xs font-mono">{value}</span>
      </div>
      <div className="h-2.5 bg-[var(--color-surface)] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      {sub && <div className="text-[10px] text-[var(--color-muted)] mt-0.5">{sub}</div>}
    </div>
  );
}

function GaugeCard({ label, pct, value }: { label: string; pct: number; value: string }) {
  const color = pct > 85 ? '#ef4444' : pct > 60 ? '#eab308' : 'var(--color-accent)';
  return (
    <div className="bg-[var(--color-surface)] rounded p-3">
      <div className="text-xs text-[var(--color-muted)] mb-1">{label}</div>
      <div className="text-lg font-mono font-bold mb-1" style={{ color }}>{pct}%</div>
      <div className="h-1.5 bg-[var(--color-background)] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="text-[10px] text-[var(--color-muted)] mt-1">{value}</div>
    </div>
  );
}

function GaugePill({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = pct > 50 ? '#ef4444' : pct > 20 ? '#eab308' : 'var(--color-accent)';
  return (
    <div className="flex items-center gap-1 w-20">
      <span className="text-[10px] text-[var(--color-muted)]">{label}</span>
      <div className="flex-1 h-1 bg-[var(--color-background)] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] font-mono" style={{ color }}>{value.toFixed(1)}</span>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)}${units[i]}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(seconds: number): string {
  if (!seconds) return 'n/a';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ============================================================
// Unsandbox Panel
// ============================================================

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

// ============================================================
// Bootstrap Harness Panel
// ============================================================

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

// ============================================================
// Host Form
// ============================================================

function HostForm({ form, setForm, keys, onSave, onCancel, saving, isNew }: {
  form: SshHost; setForm: (f: SshHost) => void; keys: string[];
  onSave: () => void; onCancel: () => void; saving: boolean; isNew?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Host Alias</label>
          <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. cammy" disabled={!isNew}
            className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono disabled:opacity-50" />
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">HostName</label>
          <input type="text" value={form.hostname ?? ''} onChange={e => setForm({ ...form, hostname: e.target.value })}
            placeholder="e.g. cammy.foxhop.net"
            className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono" />
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Port</label>
          <input type="text" value={form.port ?? ''} onChange={e => setForm({ ...form, port: e.target.value })}
            placeholder="22"
            className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono" />
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">User</label>
          <input type="text" value={form.user ?? ''} onChange={e => setForm({ ...form, user: e.target.value })}
            placeholder="e.g. fox"
            className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono" />
        </div>
        <div>
          <label className="text-base text-[var(--color-muted)] block mb-1">Identity File</label>
          <select value={form.identityFile ?? ''} onChange={e => setForm({ ...form, identityFile: e.target.value })}
            className="w-full bg-[var(--color-background)] border border-[var(--color-border)] rounded px-3 py-1.5 text-base font-mono">
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
