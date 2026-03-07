import { NextRequest, NextResponse } from 'next/server';
import {
  readAPMonitorState,
  readRemoteAPMonitorState,
} from '@unturf/unfirehose/apmonitor-adapter';
import { discoverNodes } from '@unturf/unfirehose/mesh';
import { getDb } from '@unturf/unfirehose/db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET /api/apmonitor
 *
 * Reads APMonitor statefiles from localhost and all mesh nodes.
 * Query params:
 *   ?host=<hostname>   — read from a specific host only
 *   ?path=<filepath>   — override statefile path
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const hostParam = url.searchParams.get('host');
  const pathParam = url.searchParams.get('path') ?? undefined;

  // Check if user has configured a custom statefile path in settings
  let configuredPath = pathParam;
  if (!configuredPath) {
    try {
      const db = getDb();
      const row = db
        .prepare("SELECT value FROM settings WHERE key = 'apmonitor_statefile'")
        .get() as any;
      if (row?.value) configuredPath = row.value;
    } catch {
      // settings table may not exist
    }
  }

  if (hostParam) {
    // Single host mode
    const state =
      hostParam === 'localhost'
        ? readAPMonitorState(configuredPath)
        : readRemoteAPMonitorState(hostParam, configuredPath);
    return NextResponse.json(state);
  }

  // All mesh nodes
  const nodes = discoverNodes();
  const results: any[] = [];

  for (const host of nodes) {
    const state =
      host === 'localhost'
        ? readAPMonitorState(configuredPath)
        : readRemoteAPMonitorState(host, configuredPath);

    results.push({
      host,
      ...state,
    });
  }

  // Summary across all nodes
  const allResources = results.flatMap((r) => r.resources ?? []);
  const up = allResources.filter((r: any) => r.isUp).length;
  const down = allResources.filter((r: any) => !r.isUp).length;
  const nodesWithData = results.filter((r) => !r.error).length;

  return NextResponse.json({
    nodes: results,
    summary: {
      totalResources: allResources.length,
      up,
      down,
      nodesPolled: nodes.length,
      nodesWithData,
    },
  });
}

/**
 * POST /api/apmonitor
 *
 * Webhook receiver for APMonitor outage/recovery notifications.
 * APMonitor can POST alerts here via its outage_webhooks config.
 *
 * Example APMonitor webhook config:
 *   - endpoint_url: "http://localhost:3000/api/apmonitor"
 *     request_method: POST
 *     request_encoding: JSON
 *     request_prefix: ""
 *     request_suffix: ""
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const now = new Date().toISOString();

    // Store the raw webhook payload in settings as a simple event log
    // (lightweight — no new table needed)
    try {
      const db = getDb();

      // Ensure apmonitor_events table exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS apmonitor_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          payload TEXT NOT NULL,
          received_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      db.prepare('INSERT INTO apmonitor_events (payload, received_at) VALUES (?, ?)').run(
        body,
        now,
      );

      // Keep only last 1000 events
      db.prepare(
        'DELETE FROM apmonitor_events WHERE id NOT IN (SELECT id FROM apmonitor_events ORDER BY id DESC LIMIT 1000)',
      ).run();
    } catch {
      // DB not available — still return 200 so APMonitor doesn't retry
    }

    return NextResponse.json({ ok: true, received_at: now });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
