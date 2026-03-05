import { readFile, readdir } from 'fs/promises';
import { claudePaths } from '@/lib/claude-paths';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/schema';
import type { SessionsIndex } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  const { project } = await params;

  try {
    let index: SessionsIndex;
    try {
      const raw = await readFile(claudePaths.sessionsIndex(project), 'utf-8');
      index = JSON.parse(raw);
    } catch {
      // No index — build from JSONL filenames
      const files = await readdir(claudePaths.projectDir(project));
      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
      index = {
        entries: jsonlFiles.map((f) => ({
          sessionId: f.replace('.jsonl', ''),
          messageCount: 0,
        })),
      };
    }

    const url = new URL(request.url);
    const sort = url.searchParams.get('sort') ?? 'modified';
    const order = url.searchParams.get('order') ?? 'desc';

    const sorted = [...index.entries].sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aVal = String((a as any)[sort] ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bVal = String((b as any)[sort] ?? '');
      return order === 'desc' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
    });

    // Augment with display names from DB
    const db = getDb();
    const uuids = sorted.map(s => s.sessionId);
    const displayNames: Record<string, string> = {};
    if (uuids.length > 0) {
      const rows = db.prepare(
        `SELECT session_uuid, display_name FROM sessions WHERE session_uuid IN (${uuids.map(() => '?').join(',')})`
      ).all(...uuids) as Array<{ session_uuid: string; display_name: string | null }>;
      for (const row of rows) {
        if (row.display_name) displayNames[row.session_uuid] = row.display_name;
      }
    }

    return NextResponse.json({
      project,
      originalPath: index.originalPath,
      sessions: sorted.map(s => ({
        ...s,
        displayName: displayNames[s.sessionId] ?? null,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to list sessions', detail: String(err) },
      { status: 500 }
    );
  }
}
