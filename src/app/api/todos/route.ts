import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const url = request.nextUrl;
    const project = url.searchParams.get('project');
    const status = url.searchParams.get('status');
    const source = url.searchParams.get('source');

    let query = `
      SELECT t.*, p.name as project_name, p.display_name as project_display,
             s.session_uuid, s.display_name as session_display
      FROM todos t
      JOIN projects p ON t.project_id = p.id
      LEFT JOIN sessions s ON t.session_id = s.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (project) {
      query += ' AND p.name = ?';
      params.push(project);
    }
    if (status) {
      const statuses = status.split(',');
      query += ` AND t.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
    if (source) {
      query += ' AND t.source = ?';
      params.push(source);
    }

    query += ' ORDER BY t.updated_at DESC LIMIT 500';

    const todos = db.prepare(query).all(...params) as any[];

    // Group by project for overview
    const byProject: Record<string, { project: string; display: string; todos: any[] }> = {};
    for (const todo of todos) {
      if (!byProject[todo.project_name]) {
        byProject[todo.project_name] = {
          project: todo.project_name,
          display: todo.project_display,
          todos: [],
        };
      }
      byProject[todo.project_name].todos.push({
        id: todo.id,
        content: todo.content,
        status: todo.status,
        activeForm: todo.active_form,
        source: todo.source,
        externalId: todo.external_id,
        blockedBy: todo.blocked_by ? JSON.parse(todo.blocked_by) : [],
        sessionUuid: todo.session_uuid,
        sessionDisplay: todo.session_display,
        createdAt: todo.created_at,
        updatedAt: todo.updated_at,
        completedAt: todo.completed_at,
      });
    }

    // Also get summary counts
    const counts = db.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) as total
      FROM todos
    `).get() as any;

    return NextResponse.json({
      todos,
      byProject: Object.values(byProject),
      counts: {
        pending: counts?.pending ?? 0,
        inProgress: counts?.in_progress ?? 0,
        completed: counts?.completed ?? 0,
        total: counts?.total ?? 0,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
