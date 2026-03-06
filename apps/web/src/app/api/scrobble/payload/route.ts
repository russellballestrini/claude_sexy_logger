import { NextResponse } from 'next/server';
import { getDb } from '@unfirehose/core/db/schema';
import { getSetting } from '@unfirehose/core/db/ingest';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Anthropic API pricing per million tokens (2026 rates)
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-6':            { input: 5,  output: 25, cacheRead: 0.50, cacheWrite: 6.25 },
  'claude-opus-4-5-20251101':   { input: 5,  output: 25, cacheRead: 0.50, cacheWrite: 6.25 },
  'claude-sonnet-4-5-20250929': { input: 3,  output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-sonnet-4-6':          { input: 3,  output: 15, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-haiku-4-5-20251001':  { input: 1,   output: 5,  cacheRead: 0.10, cacheWrite: 1.25 },
};

function calcCost(model: string, input: number, output: number, cacheRead: number, cacheWrite: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (
    (input / 1_000_000) * p.input +
    (output / 1_000_000) * p.output +
    (cacheRead / 1_000_000) * p.cacheRead +
    (cacheWrite / 1_000_000) * p.cacheWrite
  );
}

/**
 * GET /api/scrobble/payload
 *
 * Generates the scrobble payload — metrics-only, NO content/PII/training data.
 * This is what gets sent to the unfirehose.org endpoint when scrobble is enabled.
 *
 * The last.fm model: share what you listened to (usage patterns), not the music itself (content).
 */
export async function GET() {
  try {
    const db = getDb();
    const handle = getSetting('unfirehose_handle') ?? 'anonymous';
    const displayName = getSetting('unfirehose_display_name') ?? handle;

    // --- Lifetime stats ---
    const lifetime = db.prepare(`
      SELECT
        COUNT(DISTINCT s.id) as total_sessions,
        COUNT(DISTINCT m.id) as total_messages,
        COUNT(DISTINCT DATE(m.timestamp)) as active_days,
        MIN(m.timestamp) as first_activity,
        MAX(m.timestamp) as last_activity,
        SUM(m.input_tokens) as total_input_tokens,
        SUM(m.output_tokens) as total_output_tokens,
        SUM(m.cache_read_tokens) as total_cache_read,
        SUM(m.cache_creation_tokens) as total_cache_write
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
    `).get() as any;

    // --- Streak calculation ---
    const activeDates = db.prepare(`
      SELECT DISTINCT DATE(timestamp) as d FROM messages
      WHERE timestamp IS NOT NULL ORDER BY d DESC
    `).all() as { d: string }[];

    const { currentStreak, longestStreak } = calcStreaks(activeDates.map(r => r.d));

    // --- Daily cost for last 90 days ---
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const dailyCosts = db.prepare(`
      SELECT DATE(timestamp) as date, model,
             SUM(input_tokens) as inp, SUM(output_tokens) as out,
             SUM(cache_read_tokens) as cr, SUM(cache_creation_tokens) as cw
      FROM messages
      WHERE timestamp >= ? AND model IS NOT NULL AND model != '<synthetic>'
      GROUP BY date, model
      ORDER BY date
    `).all(ninetyDaysAgo) as any[];

    const costByDay: Record<string, number> = {};
    for (const r of dailyCosts) {
      costByDay[r.date] = (costByDay[r.date] ?? 0) + calcCost(r.model, r.inp, r.out, r.cr, r.cw);
    }
    const dailyCostSeries = Object.entries(costByDay)
      .map(([date, cost]) => ({ date, costUSD: Math.round(cost * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalCostAllTime = (() => {
      const allModels = db.prepare(`
        SELECT model, SUM(input_tokens) as inp, SUM(output_tokens) as out,
               SUM(cache_read_tokens) as cr, SUM(cache_creation_tokens) as cw
        FROM messages WHERE model IS NOT NULL AND model != '<synthetic>'
        GROUP BY model
      `).all() as any[];
      return allModels.reduce((s, m) => s + calcCost(m.model, m.inp, m.out, m.cr, m.cw), 0);
    })();

    // --- Model breakdown (names + token counts only) ---
    const models = db.prepare(`
      SELECT model, COUNT(*) as messages,
             SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
      FROM messages WHERE model IS NOT NULL AND model != '<synthetic>'
      GROUP BY model ORDER BY messages DESC
    `).all() as any[];

    // --- Harness breakdown ---
    const harnesses = db.prepare(`
      SELECT COALESCE(s.harness, 'claude-code') as harness,
             COUNT(DISTINCT s.id) as sessions, COUNT(m.id) as messages
      FROM sessions s
      JOIN messages m ON m.session_id = s.id
      GROUP BY harness ORDER BY sessions DESC
    `).all() as any[];

    // --- Hour-of-day heatmap (sleep schedule proxy) ---
    const hourActivity = db.prepare(`
      SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour, COUNT(*) as count
      FROM messages WHERE timestamp IS NOT NULL
      GROUP BY hour ORDER BY hour
    `).all() as any[];

    // --- Day-of-week activity ---
    const dowActivity = db.prepare(`
      SELECT CAST(strftime('%w', timestamp) AS INTEGER) as dow, COUNT(*) as count
      FROM messages WHERE timestamp IS NOT NULL
      GROUP BY dow ORDER BY dow
    `).all() as any[];

    // --- DOW x Hour heatmap ---
    const dowHourHeatmap = db.prepare(`
      SELECT CAST(strftime('%w', timestamp) AS INTEGER) as dow,
             CAST(strftime('%H', timestamp) AS INTEGER) as hour,
             COUNT(*) as count
      FROM messages WHERE timestamp IS NOT NULL
      GROUP BY dow, hour ORDER BY dow, hour
    `).all() as any[];

    // --- Daily message counts (activity chart, 90 days) ---
    const dailyMessages = db.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM messages WHERE timestamp >= ?
      GROUP BY date ORDER BY date
    `).all(ninetyDaysAgo) as any[];

    // --- Tool usage (names + counts, no arguments) ---
    const tools = db.prepare(`
      SELECT tool_name, COUNT(*) as count
      FROM content_blocks
      WHERE block_type = 'tool_use' AND tool_name IS NOT NULL
      GROUP BY tool_name ORDER BY count DESC LIMIT 30
    `).all() as any[];

    // --- Per-project stats (public/unlisted only) ---
    const projectStats = db.prepare(`
      SELECT p.name, p.display_name,
             COALESCE(pv.visibility, 'private') as visibility,
             COUNT(DISTINCT s.id) as sessions,
             COUNT(DISTINCT m.id) as messages,
             COUNT(DISTINCT DATE(m.timestamp)) as active_days,
             SUM(m.input_tokens) as input_tokens,
             SUM(m.output_tokens) as output_tokens,
             MIN(m.timestamp) as first_activity,
             MAX(m.timestamp) as last_activity
      FROM projects p
      LEFT JOIN project_visibility pv ON pv.project_id = p.id
      LEFT JOIN sessions s ON s.project_id = p.id
      LEFT JOIN messages m ON m.session_id = s.id
      WHERE COALESCE(pv.visibility, 'private') IN ('public', 'unlisted')
      GROUP BY p.id
      ORDER BY messages DESC
    `).all() as any[];

    // --- Weekly velocity (sessions per week, last 12 weeks) ---
    const twelveWeeksAgo = new Date(Date.now() - 84 * 86400000).toISOString();
    const weeklyVelocity = db.prepare(`
      SELECT strftime('%Y-W%W', m.timestamp) as week,
             COUNT(DISTINCT s.id) as sessions,
             COUNT(m.id) as messages
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
      WHERE m.timestamp >= ?
      GROUP BY week ORDER BY week
    `).all(twelveWeeksAgo) as any[];

    // --- Average session duration (from turn_duration messages) ---
    const avgSessionLen = db.prepare(`
      SELECT AVG(duration_ms) as avg_ms
      FROM (
        SELECT s.id, (julianday(MAX(m.timestamp)) - julianday(MIN(m.timestamp))) * 86400000 as duration_ms
        FROM sessions s
        JOIN messages m ON m.session_id = s.id
        GROUP BY s.id
        HAVING COUNT(m.id) > 1
      )
    `).get() as any;

    // --- Gamification: badges/achievements ---
    const badges = computeBadges({
      totalSessions: lifetime.total_sessions ?? 0,
      totalMessages: lifetime.total_messages ?? 0,
      activeDays: lifetime.active_days ?? 0,
      currentStreak,
      longestStreak,
      totalCost: totalCostAllTime,
      projectCount: projectStats.length,
      toolCount: tools.length,
      harnessCount: harnesses.length,
    });

    return NextResponse.json({
      $schema: 'unfirehose-scrobble/1.0',
      generatedAt: new Date().toISOString(),
      handle,
      displayName,

      // Lifetime summary
      lifetime: {
        totalSessions: lifetime.total_sessions ?? 0,
        totalMessages: lifetime.total_messages ?? 0,
        activeDays: lifetime.active_days ?? 0,
        firstActivity: lifetime.first_activity,
        lastActivity: lifetime.last_activity,
        totalInputTokens: lifetime.total_input_tokens ?? 0,
        totalOutputTokens: lifetime.total_output_tokens ?? 0,
        totalCacheRead: lifetime.total_cache_read ?? 0,
        totalCacheWrite: lifetime.total_cache_write ?? 0,
        totalCostUSD: Math.round(totalCostAllTime * 100) / 100,
      },

      // Streaks
      streaks: {
        current: currentStreak,
        longest: longestStreak,
      },

      // Gamification
      badges,

      // Activity patterns (sleep schedule proxy)
      activity: {
        hourOfDay: hourActivity.map((h: any) => ({ hour: h.hour, count: h.count })),
        dayOfWeek: dowActivity.map((d: any) => ({
          day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.dow],
          count: d.count,
        })),
        heatmap: dowHourHeatmap.map((d: any) => ({
          dow: d.dow,
          hour: d.hour,
          count: d.count,
        })),
      },

      // Time series (90 days)
      timeSeries: {
        dailyMessages,
        dailyCost: dailyCostSeries,
        weeklyVelocity,
      },

      // Breakdowns (no content, just counts)
      models: models.map((m: any) => ({
        model: m.model,
        messages: m.messages,
        inputTokens: m.input_tokens,
        outputTokens: m.output_tokens,
      })),
      harnesses: harnesses.map((h: any) => ({
        harness: h.harness,
        sessions: h.sessions,
        messages: h.messages,
      })),
      tools: tools.map((t: any) => ({
        name: t.tool_name,
        count: t.count,
      })),

      // Per-project (public/unlisted only — no private project names)
      projects: projectStats.map((p: any) => ({
        name: p.display_name || p.name,
        visibility: p.visibility,
        sessions: p.sessions,
        messages: p.messages,
        activeDays: p.active_days,
        inputTokens: p.input_tokens ?? 0,
        outputTokens: p.output_tokens ?? 0,
        firstActivity: p.first_activity,
        lastActivity: p.last_activity,
      })),

      // Session stats
      sessionStats: {
        avgDurationMs: Math.round(avgSessionLen?.avg_ms ?? 0),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// --- Streak calculation ---
function calcStreaks(sortedDatesDesc: string[]): { currentStreak: number; longestStreak: number } {
  if (sortedDatesDesc.length === 0) return { currentStreak: 0, longestStreak: 0 };

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Current streak: must include today or yesterday
  let currentStreak = 0;
  if (sortedDatesDesc[0] === today || sortedDatesDesc[0] === yesterday) {
    currentStreak = 1;
    for (let i = 1; i < sortedDatesDesc.length; i++) {
      const prev = new Date(sortedDatesDesc[i - 1]);
      const curr = new Date(sortedDatesDesc[i]);
      const diff = (prev.getTime() - curr.getTime()) / 86400000;
      if (diff === 1) currentStreak++;
      else break;
    }
  }

  // Longest streak: scan all dates ascending
  const asc = [...sortedDatesDesc].reverse();
  let longestStreak = 1;
  let run = 1;
  for (let i = 1; i < asc.length; i++) {
    const prev = new Date(asc[i - 1]);
    const curr = new Date(asc[i]);
    const diff = (curr.getTime() - prev.getTime()) / 86400000;
    if (diff === 1) {
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 1;
    }
  }

  return { currentStreak, longestStreak };
}

// --- Badge/achievement system ---
interface BadgeInput {
  totalSessions: number;
  totalMessages: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  totalCost: number;
  projectCount: number;
  toolCount: number;
  harnessCount: number;
}

interface Badge {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  tier?: 'bronze' | 'silver' | 'gold' | 'diamond';
  progress?: number; // 0-1
}

function computeBadges(input: BadgeInput): Badge[] {
  const badges: Badge[] = [];

  // Session milestones
  const sessionTiers = [
    { n: 10, tier: 'bronze' as const, name: 'First Steps', desc: '10 sessions' },
    { n: 100, tier: 'silver' as const, name: 'Regular', desc: '100 sessions' },
    { n: 500, tier: 'gold' as const, name: 'Power User', desc: '500 sessions' },
    { n: 1000, tier: 'diamond' as const, name: 'Machine Whisperer', desc: '1000 sessions' },
  ];
  for (const t of sessionTiers) {
    badges.push({
      id: `sessions-${t.n}`,
      name: t.name,
      description: t.desc,
      earned: input.totalSessions >= t.n,
      tier: t.tier,
      progress: Math.min(1, input.totalSessions / t.n),
    });
  }

  // Message milestones
  const msgTiers = [
    { n: 1000, tier: 'bronze' as const, name: 'Chatty', desc: '1K messages' },
    { n: 10000, tier: 'silver' as const, name: 'Prolific', desc: '10K messages' },
    { n: 100000, tier: 'gold' as const, name: 'Torrent', desc: '100K messages' },
    { n: 500000, tier: 'diamond' as const, name: 'Firehose', desc: '500K messages' },
  ];
  for (const t of msgTiers) {
    badges.push({
      id: `messages-${t.n}`,
      name: t.name,
      description: t.desc,
      earned: input.totalMessages >= t.n,
      tier: t.tier,
      progress: Math.min(1, input.totalMessages / t.n),
    });
  }

  // Streak badges
  const streakTiers = [
    { n: 3, tier: 'bronze' as const, name: 'Consistent', desc: '3-day streak' },
    { n: 7, tier: 'silver' as const, name: 'Weekly Warrior', desc: '7-day streak' },
    { n: 30, tier: 'gold' as const, name: 'Monthly Machine', desc: '30-day streak' },
    { n: 100, tier: 'diamond' as const, name: 'Unstoppable', desc: '100-day streak' },
  ];
  for (const t of streakTiers) {
    badges.push({
      id: `streak-${t.n}`,
      name: t.name,
      description: t.desc,
      earned: input.longestStreak >= t.n,
      tier: t.tier,
      progress: Math.min(1, input.longestStreak / t.n),
    });
  }

  // Cost milestones
  const costTiers = [
    { n: 10, tier: 'bronze' as const, name: 'Penny Pincher', desc: '$10 spent' },
    { n: 100, tier: 'silver' as const, name: 'Investor', desc: '$100 spent' },
    { n: 1000, tier: 'gold' as const, name: 'Whale', desc: '$1K spent' },
    { n: 10000, tier: 'diamond' as const, name: 'Deep Pocket', desc: '$10K spent' },
  ];
  for (const t of costTiers) {
    badges.push({
      id: `cost-${t.n}`,
      name: t.name,
      description: t.desc,
      earned: input.totalCost >= t.n,
      tier: t.tier,
      progress: Math.min(1, input.totalCost / t.n),
    });
  }

  // Active days
  const dayTiers = [
    { n: 7, tier: 'bronze' as const, name: 'Week One', desc: '7 active days' },
    { n: 30, tier: 'silver' as const, name: 'Monthly', desc: '30 active days' },
    { n: 100, tier: 'gold' as const, name: 'Centurion', desc: '100 active days' },
    { n: 365, tier: 'diamond' as const, name: 'Year Round', desc: '365 active days' },
  ];
  for (const t of dayTiers) {
    badges.push({
      id: `days-${t.n}`,
      name: t.name,
      description: t.desc,
      earned: input.activeDays >= t.n,
      tier: t.tier,
      progress: Math.min(1, input.activeDays / t.n),
    });
  }

  // Multi-project
  if (input.projectCount >= 5) {
    badges.push({ id: 'polyglot', name: 'Polyglot', description: '5+ public projects', earned: true, tier: 'silver' });
  }
  if (input.projectCount >= 20) {
    badges.push({ id: 'architect', name: 'Architect', description: '20+ public projects', earned: true, tier: 'gold' });
  }

  // Multi-harness
  if (input.harnessCount >= 2) {
    badges.push({ id: 'multi-harness', name: 'Multi-Harness', description: '2+ harness types', earned: true, tier: 'silver' });
  }
  if (input.harnessCount >= 4) {
    badges.push({ id: 'harness-collector', name: 'Harness Collector', description: '4+ harness types', earned: true, tier: 'gold' });
  }

  // Tool diversity
  if (input.toolCount >= 10) {
    badges.push({ id: 'toolsmith', name: 'Toolsmith', description: '10+ distinct tools used', earned: true, tier: 'silver' });
  }
  if (input.toolCount >= 25) {
    badges.push({ id: 'swiss-army', name: 'Swiss Army', description: '25+ distinct tools used', earned: true, tier: 'gold' });
  }

  return badges;
}
