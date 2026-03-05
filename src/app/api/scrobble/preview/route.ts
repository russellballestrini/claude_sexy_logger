import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  try {
    const db = getDb();

    // Get all projects with their visibility
    const projects = db.prepare(`
      SELECT p.id, p.name, p.display_name, p.path,
             COALESCE(pv.visibility, 'private') as visibility,
             pv.auto_detected,
             COUNT(DISTINCT s.id) as session_count,
             COUNT(m.id) as message_count,
             SUM(m.input_tokens) as total_input,
             SUM(m.output_tokens) as total_output,
             MIN(m.timestamp) as first_activity,
             MAX(m.timestamp) as last_activity
      FROM projects p
      LEFT JOIN project_visibility pv ON pv.project_id = p.id
      LEFT JOIN sessions s ON s.project_id = p.id
      LEFT JOIN messages m ON m.session_id = s.id
      GROUP BY p.id
      ORDER BY p.display_name
    `).all() as any[];

    // Model usage summary (no per-message detail)
    const modelSummary = db.prepare(`
      SELECT model, COUNT(*) as messages,
             SUM(input_tokens) as input, SUM(output_tokens) as output
      FROM messages WHERE model IS NOT NULL
      GROUP BY model ORDER BY messages DESC
    `).all() as any[];

    // Tool usage summary (names and counts only)
    const toolSummary = db.prepare(`
      SELECT tool_name, COUNT(*) as count
      FROM content_blocks
      WHERE block_type = 'tool_use' AND tool_name IS NOT NULL
      GROUP BY tool_name ORDER BY count DESC LIMIT 20
    `).all() as any[];

    // What's included vs excluded
    const included = [
      'Project names and display names',
      'Session counts and date ranges',
      'Model usage (which models, message counts)',
      'Token totals per project (input, output)',
      'Tool call frequencies (tool names + counts)',
      'Project visibility status',
    ];

    const excluded = [
      'Prompt text and user messages',
      'Assistant response content',
      'Thinking blocks',
      'Tool call arguments and results',
      'File paths and file contents',
      'Git commit messages and diffs',
      'CLAUDE.md contents',
      'Any PII (already sanitized at ingest)',
    ];

    return NextResponse.json({
      projects: projects.map((p: any) => ({
        name: p.name,
        displayName: p.display_name,
        visibility: p.visibility,
        autoDetected: p.auto_detected,
        sessionCount: p.session_count ?? 0,
        messageCount: p.message_count ?? 0,
        totalInput: p.total_input ?? 0,
        totalOutput: p.total_output ?? 0,
        firstActivity: p.first_activity,
        lastActivity: p.last_activity,
      })),
      modelSummary,
      toolSummary,
      included,
      excluded,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
