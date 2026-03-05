import { NextRequest, NextResponse } from 'next/server';
import { userInfo } from 'os';
import {
  getAllSettings,
  setSetting,
  deleteSetting,
} from '@unfirehose/core/db/ingest';

export async function GET() {
  const settings = getAllSettings();
  const username = userInfo().username;

  // Auto-set display name and handle from system user on first access
  if (!settings.unfirehose_display_name) {
    setSetting('unfirehose_display_name', username);
    settings.unfirehose_display_name = username;
  }
  if (!settings.unfirehose_handle) {
    setSetting('unfirehose_handle', username);
    settings.unfirehose_handle = username;
  }

  return NextResponse.json({ ...settings, _system_username: username });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, key, value } = body;

  if (action === 'set' && key && value !== undefined) {
    setSetting(key, String(value));
    return NextResponse.json({ ok: true, key, value });
  }

  if (action === 'delete' && key) {
    deleteSetting(key);
    return NextResponse.json({ ok: true, deleted: key });
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
