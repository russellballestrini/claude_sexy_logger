import { NextRequest, NextResponse } from 'next/server';
import {
  getAllSettings,
  getSetting,
  setSetting,
  deleteSetting,
  applyPlanThresholds,
} from '@/lib/db/ingest';

export async function GET() {
  const settings = getAllSettings();
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, key, value } = body;

  if (action === 'set' && key && value !== undefined) {
    setSetting(key, String(value));

    // Auto-apply thresholds when plan changes
    if (key === 'anthropic_plan') {
      applyPlanThresholds(value);
    }

    return NextResponse.json({ ok: true, key, value });
  }

  if (action === 'delete' && key) {
    deleteSetting(key);
    return NextResponse.json({ ok: true, deleted: key });
  }

  if (action === 'apply_plan' && body.plan) {
    applyPlanThresholds(body.plan);
    return NextResponse.json({ ok: true, plan: body.plan });
  }

  // Bulk set
  if (action === 'bulk_set' && body.settings) {
    for (const [k, v] of Object.entries(body.settings)) {
      setSetting(k, String(v));
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const { key } = await req.json();
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
  deleteSetting(key);
  return NextResponse.json({ ok: true });
}
