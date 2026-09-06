import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, seedProject, seedSession, seedMessage } from './test/db-helper';
import { weeklyVelocityRows } from './scrobble';

/**
 * Messages per week, and the sessions active in each.
 *
 * The old fold credited every message of a session to the week the session
 * last ran in, so one still-open session showed the current week as
 * "1 session, 11,884 msgs". A message belongs to the week it happened; a
 * session counts in every week it was active.
 */

const db = createTestDb();
let pid: number;
beforeEach(() => {
  db.prepare('DELETE FROM messages').run(); db.prepare('DELETE FROM sessions').run(); db.prepare('DELETE FROM projects').run();
  pid = seedProject(db, 'p', 'p');
});
// Two Mondays in different %W weeks of 2026: W24 starts Sun Jun 14, W25 Sun Jun 21.
const W24 = '2026-06-15T10:00:00Z', W25 = '2026-06-22T10:00:00Z';

describe('weeklyVelocityRows', () => {
  it('counts a message in the week it happened, not the week its session ended', () => {
    const sid = seedSession(db, pid, 's1');
    seedMessage(db, sid, { timestamp: W24 }); seedMessage(db, sid, { timestamp: W24 });
    seedMessage(db, sid, { timestamp: W25 });
    const rows = weeklyVelocityRows(db, '2026-06-01');
    expect(rows.map((r) => [r.week, r.messages])).toEqual([['2026-W24', 2], ['2026-W25', 1]]);
  });

  it('counts a session in every week it was active', () => {
    // The same session in both weeks is one session in each — not one in
    // the last and zero before.
    const sid = seedSession(db, pid, 's1');
    seedMessage(db, sid, { timestamp: W24 }); seedMessage(db, sid, { timestamp: W25 });
    const other = seedSession(db, pid, 's2');
    seedMessage(db, other, { timestamp: W25 });
    const rows = weeklyVelocityRows(db, '2026-06-01');
    expect(rows.map((r) => [r.week, r.sessions])).toEqual([['2026-W24', 1], ['2026-W25', 2]]);
  });

  it('leaves out weeks before the window', () => {
    const sid = seedSession(db, pid, 's1');
    seedMessage(db, sid, { timestamp: '2026-01-05T10:00:00Z' }); seedMessage(db, sid, { timestamp: W25 });
    expect(weeklyVelocityRows(db, '2026-06-01').map((r) => r.week)).toEqual(['2026-W25']);
  });

  it('marks the week we are in as partial, since its numbers are still growing', () => {
    const sid = seedSession(db, pid, 's1');
    seedMessage(db, sid, { timestamp: new Date().toISOString() });
    const [row] = weeklyVelocityRows(db, '2000-01-01');
    expect(row.partial).toBe(true);
  });

  it('does not mark a finished week', () => {
    const sid = seedSession(db, pid, 's1');
    seedMessage(db, sid, { timestamp: W24 });
    expect(weeklyVelocityRows(db, '2026-06-01')[0].partial).toBeUndefined();
  });
});
