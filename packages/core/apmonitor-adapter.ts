/**
 * APMonitor adapter — reads APMonitor statefile as an external tool.
 *
 * APMonitor (https://github.com/russellballestrini/APMonitor) is a separate
 * GPL v3 + Commons Clause licensed tool. We do NOT embed or port any of its
 * code. This adapter only reads its JSON statefile output, the same way we
 * read SSH output or /proc files.
 *
 * Default statefile: /var/tmp/apmonitor-statefile.json
 */

import { readFileSync, existsSync, statSync } from 'fs';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface APMonitorResource {
  name: string;
  isUp: boolean;
  lastChecked: string | null;
  lastResponseTimeMs: number | null;
  errorReason: string | null;
  downCount: number;
  notifiedCount: number;
  lastNotified: string | null;
  lastAlarmStarted: string | null;
  lastSuccessfulHeartbeat: string | null;
  portsState: Record<string, any> | null;
}

export interface APMonitorState {
  resources: APMonitorResource[];
  statefilePath: string;
  lastModified: string | null;
  error: string | null;
}

const DEFAULT_STATEFILE = '/var/tmp/apmonitor-statefile.json';

/**
 * Read APMonitor statefile from disk. Returns parsed resource states.
 * Pass a custom path or falls back to the default location.
 */
export function readAPMonitorState(statefilePath?: string): APMonitorState {
  const filepath = statefilePath || DEFAULT_STATEFILE;

  if (!existsSync(filepath)) {
    return {
      resources: [],
      statefilePath: filepath,
      lastModified: null,
      error: 'Statefile not found',
    };
  }

  try {
    const raw = readFileSync(filepath, 'utf-8');
    const state = JSON.parse(raw);
    const stat = statSync(filepath);

    const resources: APMonitorResource[] = [];

    for (const [name, data] of Object.entries(state)) {
      const d = data as any;
      resources.push({
        name,
        isUp: !!d.is_up,
        lastChecked: d.last_checked ?? null,
        lastResponseTimeMs: d.last_response_time_ms ?? null,
        errorReason: d.error_reason ?? null,
        downCount: d.down_count ?? 0,
        notifiedCount: d.notified_count ?? 0,
        lastNotified: d.last_notified ?? null,
        lastAlarmStarted: d.last_alarm_started ?? null,
        lastSuccessfulHeartbeat: d.last_successful_heartbeat ?? null,
        portsState: d.ports_state ?? null,
      });
    }

    return {
      resources,
      statefilePath: filepath,
      lastModified: stat.mtime.toISOString(),
      error: null,
    };
  } catch (err: any) {
    return {
      resources: [],
      statefilePath: filepath,
      lastModified: null,
      error: err.message,
    };
  }
}

/**
 * Read APMonitor statefile from a remote host via SSH.
 */
export function readRemoteAPMonitorState(
  host: string,
  statefilePath?: string,
): APMonitorState {
  const filepath = statefilePath || DEFAULT_STATEFILE;

  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    const raw = execSync(
      `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${host} 'cat ${filepath} 2>/dev/null && echo "---STAT---" && stat -c %Y ${filepath} 2>/dev/null'`,
      { encoding: 'utf-8', timeout: 10000 },
    );

    const parts = raw.split('---STAT---');
    const jsonStr = parts[0].trim();
    const mtime = parts[1]?.trim();

    const state = JSON.parse(jsonStr);
    const resources: APMonitorResource[] = [];

    for (const [name, data] of Object.entries(state)) {
      const d = data as any;
      resources.push({
        name,
        isUp: !!d.is_up,
        lastChecked: d.last_checked ?? null,
        lastResponseTimeMs: d.last_response_time_ms ?? null,
        errorReason: d.error_reason ?? null,
        downCount: d.down_count ?? 0,
        notifiedCount: d.notified_count ?? 0,
        lastNotified: d.last_notified ?? null,
        lastAlarmStarted: d.last_alarm_started ?? null,
        lastSuccessfulHeartbeat: d.last_successful_heartbeat ?? null,
        portsState: d.ports_state ?? null,
      });
    }

    return {
      resources,
      statefilePath: `${host}:${filepath}`,
      lastModified: mtime ? new Date(parseInt(mtime) * 1000).toISOString() : null,
      error: null,
    };
  } catch (err: any) {
    return {
      resources: [],
      statefilePath: `${host}:${filepath}`,
      lastModified: null,
      error: err.message?.includes('ETIMEDOUT') ? 'Connection timed out' : err.message,
    };
  }
}
