import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface RouterConfig {
  api_key: string;
  endpoint: string;
  watch_paths: string[];
  batch_size: number;
  flush_interval_ms: number;
}

const CONFIG_PATH = process.env.UNFIREHOSE_CONFIG ?? join(homedir(), '.unfirehose.json');
const CURSOR_PATH = process.env.UNFIREHOSE_CURSORS ?? join(homedir(), '.unfirehose-cursors.json');

const DEFAULTS: Omit<RouterConfig, 'api_key'> = {
  endpoint: 'https://api.unfirehose.org/api/ingest',
  watch_paths: [join(homedir(), '.claude')],
  batch_size: 100,
  flush_interval_ms: 5000,
};

export function loadConfig(): RouterConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config not found at ${CONFIG_PATH}\n\n` +
      `Create it with:\n` +
      `  echo '{"api_key":"unfh_YOUR_KEY_HERE"}' > ${CONFIG_PATH}\n`
    );
  }

  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

  if (!raw.api_key || !raw.api_key.startsWith('unfh_')) {
    throw new Error(`Invalid api_key in ${CONFIG_PATH} — must start with unfh_`);
  }

  return { ...DEFAULTS, ...raw };
}

export function loadCursors(): Record<string, number> {
  if (!existsSync(CURSOR_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CURSOR_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveCursors(cursors: Record<string, number>): void {
  writeFileSync(CURSOR_PATH, JSON.stringify(cursors, null, 2));
}
