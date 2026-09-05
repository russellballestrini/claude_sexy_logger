import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb, seedAlert } from '../test/db-helper';

/**
 * Being rid of alerts.
 *
 * Acknowledging one dims it and leaves it in the recent list and the breach
 * history for good. 2,741 had piled up on fox's box, every one acknowledged,
 * with no way to remove any. These are the two statements that fix that,
 * against a real database.
 */

const db = createTestDb();
vi.mock('./schema', async (orig) => ({ ...(await orig() as object), getDb: () => db }));
const { clearAlerts, acknowledgeAllAlerts } = await import('./ingest');

const count = (where = '1=1') => (db.prepare(`SELECT COUNT(*) c FROM alerts WHERE ${where}`).get() as { c: number }).c;
beforeEach(() => { db.prepare('DELETE FROM alerts').run(); });

describe('acknowledgeAllAlerts', () => {
  it('acknowledges every open alert in one statement and reports how many', () => {
    seedAlert(db, { acknowledged: 0 }); seedAlert(db, { acknowledged: 0 }); seedAlert(db, { acknowledged: 1 });
    expect(acknowledgeAllAlerts()).toBe(2);
    expect(count('acknowledged = 0')).toBe(0);
  });

  it('reports zero, and changes nothing, when nothing is open', () => {
    seedAlert(db, { acknowledged: 1 });
    expect(acknowledgeAllAlerts()).toBe(0);
    expect(count()).toBe(1);
  });
});

describe('clearAlerts', () => {
  it('removes acknowledged alerts by default and leaves open ones to be dealt with', () => {
    seedAlert(db, { acknowledged: 1 }); seedAlert(db, { acknowledged: 1 }); seedAlert(db, { acknowledged: 0 });
    expect(clearAlerts()).toBe(2);
    expect(count()).toBe(1);
    expect(count('acknowledged = 0')).toBe(1);
  });

  it('removes everything, open included, when asked for all', () => {
    seedAlert(db, { acknowledged: 1 }); seedAlert(db, { acknowledged: 0 });
    expect(clearAlerts('all')).toBe(2);
    expect(count()).toBe(0);
  });

  it('is safe to run on an empty table', () => {
    expect(clearAlerts()).toBe(0);
    expect(clearAlerts('all')).toBe(0);
  });
});
