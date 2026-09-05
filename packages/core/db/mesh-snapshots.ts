/**
 * Append mesh samples.
 *
 * This was the body of POST /api/mesh/history, which existed so the worker
 * could hand the web server a row to write into a database the worker
 * already had open. It lives here now; the route and the worker both call
 * it, and the worker writes directly.
 *
 * Append-only. The worker's rollup tick folds 15s rows past the 28-day
 * boundary into mesh_snapshots_15m and deletes the source rows in the same
 * transaction; nothing here prunes.
 */
import type Database from 'better-sqlite3';
import type { MeshNode } from '../mesh-probe';

/** Insert one row per reachable node. Returns how many were written. */
export function insertMeshSnapshots(db: Database.Database, nodes: MeshNode[]): number {
  const insert = db.prepare(`
    INSERT INTO mesh_snapshots (hostname, cpu_cores, load_avg_1, load_avg_5, load_avg_15,
      mem_total_gb, mem_used_gb, power_watts, gpu_power_watts, gpu_util, gpu_mem_used_mb, gpu_mem_total_mb, power_source, claude_processes,
      agent_processes, harness_counts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let written = 0;
  const tx = db.transaction(() => {
    for (const n of nodes as Array<MeshNode & Record<string, any>>) {
      if (!n.reachable) continue;
      // Total across harnesses, and the breakdown. A node with five
      // uncloseai-cli agents and no claude used to persist a zero here.
      const counts = n.harnessCounts as Record<string, number> | undefined;
      const agents = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
      insert.run(
        n.hostname,
        n.cpuCores ?? 0,
        n.loadAvg?.[0] ?? 0,
        n.loadAvg?.[1] ?? 0,
        n.loadAvg?.[2] ?? 0,
        n.memTotalGB ?? 0,
        n.memUsedGB ?? 0,
        n.powerWatts ?? 0,
        n.gpuPowerWatts ?? 0,
        n.gpuUtil ?? null,
        n.gpuMemUsedMB ?? null,
        n.gpuMemTotalMB ?? null,
        n.powerSource ?? 'estimate',
        n.claudeProcesses ?? 0,
        agents || (n.claudeProcesses ?? 0),
        counts ? JSON.stringify(counts) : null,
      );
      written++;
    }
  });
  tx();
  return written;
}
