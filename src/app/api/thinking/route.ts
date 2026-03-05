import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const projectFilter = url.searchParams.get('project');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200'), 5000);
  const offset = parseInt(url.searchParams.get('offset') ?? '0');
  const search = url.searchParams.get('search')?.trim();
  const dateFrom = url.searchParams.get('from');
  const dateTo = url.searchParams.get('to');

  try {
    const db = getDb();
    const params: any[] = [];

    let where = "cb.block_type = 'thinking' AND cb.text_content IS NOT NULL AND cb.text_content != ''";

    if (projectFilter) {
      where += ' AND p.name = ?';
      params.push(projectFilter);
    }
    if (dateFrom) {
      where += ' AND m.timestamp >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ' AND m.timestamp <= ?';
      params.push(dateTo + 'T23:59:59');
    }
    if (search) {
      where += ' AND cb.text_content LIKE ?';
      params.push(`%${search}%`);
    }

    const query = `
      SELECT cb.text_content as thinking, cb.message_id,
             m.timestamp, m.model,
             s.session_uuid, s.display_name as session_display,
             p.name as project_name, p.display_name as project_display
      FROM content_blocks cb
      JOIN messages m ON cb.message_id = m.id
      JOIN sessions s ON m.session_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE ${where}
      ORDER BY m.timestamp DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params) as any[];

    // For each thinking block, get the preceding user prompt
    const promptStmt = db.prepare(`
      SELECT cb.text_content
      FROM messages m2
      JOIN content_blocks cb ON cb.message_id = m2.id AND cb.block_type = 'text'
      WHERE m2.session_id = (SELECT session_id FROM messages WHERE id = ?)
        AND m2.type = 'user'
        AND m2.timestamp <= (SELECT timestamp FROM messages WHERE id = ?)
      ORDER BY m2.timestamp DESC
      LIMIT 1
    `);

    const entries = rows.map(row => {
      let precedingPrompt = '';
      try {
        const prompt = promptStmt.get(row.message_id, row.message_id) as any;
        if (prompt?.text_content) {
          precedingPrompt = prompt.text_content.slice(0, 300);
        }
      } catch { /* skip */ }

      return {
        sessionId: row.session_uuid,
        sessionDisplay: row.session_display,
        project: row.project_name,
        projectDisplay: row.project_display,
        timestamp: row.timestamp,
        thinking: row.thinking,
        precedingPrompt,
        model: row.model,
        charCount: row.thinking?.length ?? 0,
      };
    });

    // Total count
    const countParams: any[] = [];
    let countWhere = "cb.block_type = 'thinking' AND cb.text_content IS NOT NULL AND cb.text_content != ''";
    if (projectFilter) { countWhere += ' AND p.name = ?'; countParams.push(projectFilter); }
    if (dateFrom) { countWhere += ' AND m.timestamp >= ?'; countParams.push(dateFrom); }
    if (dateTo) { countWhere += ' AND m.timestamp <= ?'; countParams.push(dateTo + 'T23:59:59'); }
    if (search) { countWhere += ' AND cb.text_content LIKE ?'; countParams.push(`%${search}%`); }

    const countQuery = `
      SELECT COUNT(*) as total
      FROM content_blocks cb
      JOIN messages m ON cb.message_id = m.id
      JOIN sessions s ON m.session_id = s.id
      JOIN projects p ON s.project_id = p.id
      WHERE ${countWhere}
    `;
    const { total } = db.prepare(countQuery).get(...countParams) as { total: number };

    return NextResponse.json({ entries, total, limit, offset });
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to query thinking', detail: err.message },
      { status: 500 }
    );
  }
}
