import { getDb } from '../src/lib/db/schema.js';

const db = getDb();

// Clear any test data
db.prepare('DELETE FROM todos').run();
db.prepare('DELETE FROM todo_events').run();

console.log('[backfill] Starting todo backfill from content_blocks...');

const taskCreates = db.prepare(`
  SELECT cb.tool_input, m.session_id, s.project_id, s.session_uuid, m.timestamp
  FROM content_blocks cb
  JOIN messages m ON cb.message_id = m.id
  JOIN sessions s ON m.session_id = s.id
  WHERE cb.block_type = 'tool_use' AND cb.tool_name = 'TaskCreate'
  ORDER BY m.timestamp ASC
`).all() as any[];

console.log(`TaskCreate rows: ${taskCreates.length}`);

const sessionCounters = new Map<number, number>();
const now = new Date().toISOString();
let created = 0;

const tx = db.transaction(() => {
  for (const row of taskCreates) {
    try {
      const input = JSON.parse(row.tool_input);
      if (!input) continue;

      const counter = (sessionCounters.get(row.session_id) ?? 0) + 1;
      sessionCounters.set(row.session_id, counter);

      db.prepare(`
        INSERT OR IGNORE INTO todos (project_id, session_id, external_id, content, status, active_form, source, source_session_uuid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(row.project_id, row.session_id, String(counter), input.subject ?? input.description ?? '', 'pending', input.activeForm ?? null, 'claude', row.session_uuid, now, now);
      created++;
    } catch { /* skip */ }
  }

  // Process TaskUpdate
  const taskUpdates = db.prepare(`
    SELECT cb.tool_input, m.session_id, s.project_id
    FROM content_blocks cb
    JOIN messages m ON cb.message_id = m.id
    JOIN sessions s ON m.session_id = s.id
    WHERE cb.block_type = 'tool_use' AND cb.tool_name = 'TaskUpdate'
    ORDER BY m.timestamp ASC
  `).all() as any[];

  console.log(`TaskUpdate rows: ${taskUpdates.length}`);
  let updated = 0;

  for (const row of taskUpdates) {
    try {
      const input = JSON.parse(row.tool_input);
      if (!input?.taskId || !input?.status) continue;

      const taskId = String(input.taskId);
      const newStatus = input.status === 'deleted' ? 'completed' : input.status;

      const existing = db.prepare(
        "SELECT id, status FROM todos WHERE project_id = ? AND external_id = ? AND source = 'claude'"
      ).get(row.project_id, taskId) as { id: number; status: string } | undefined;

      if (existing && existing.status !== newStatus) {
        db.prepare(
          `UPDATE todos SET status = ?, updated_at = ?, completed_at = CASE WHEN ? IN ('completed', 'deleted') THEN ? ELSE completed_at END WHERE id = ?`
        ).run(newStatus, now, input.status, now, existing.id);
        db.prepare(
          'INSERT INTO todo_events (todo_id, old_status, new_status, event_at) VALUES (?, ?, ?, ?)'
        ).run(existing.id, existing.status, newStatus, now);
        updated++;
      }
    } catch { /* skip */ }
  }

  console.log(`Updated: ${updated}`);

  // Process TodoWrite
  const todoWrites = db.prepare(`
    SELECT cb.tool_input, m.session_id, s.project_id, s.session_uuid
    FROM content_blocks cb
    JOIN messages m ON cb.message_id = m.id
    JOIN sessions s ON m.session_id = s.id
    WHERE cb.block_type = 'tool_use' AND cb.tool_name = 'TodoWrite'
    ORDER BY m.timestamp ASC
  `).all() as any[];

  console.log(`TodoWrite rows: ${todoWrites.length}`);

  for (const row of todoWrites) {
    try {
      const input = JSON.parse(row.tool_input);
      if (!input?.todos || !Array.isArray(input.todos)) continue;
      for (const todo of input.todos) {
        if (!todo.content) continue;
        db.prepare(`
          INSERT OR IGNORE INTO todos (project_id, session_id, content, status, active_form, source, source_session_uuid, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(row.project_id, row.session_id, todo.content, todo.status ?? 'pending', todo.activeForm ?? null, 'claude', row.session_uuid, now, now);
      }
    } catch { /* skip */ }
  }
});

tx();

const total = (db.prepare('SELECT COUNT(*) as c FROM todos').get() as { c: number }).c;
const byStatus = db.prepare('SELECT status, COUNT(*) as c FROM todos GROUP BY status').all();
console.log(`\nTotal todos: ${total}`);
console.log('By status:', byStatus);
