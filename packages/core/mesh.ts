import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

// Discover mesh nodes from SSH config
export function discoverNodes(): string[] {
  const nodes = new Set<string>();
  nodes.add('localhost');

  try {
    const sshConfig = readFileSync(path.join(homedir(), '.ssh', 'config'), 'utf-8');
    const hostRegex = /^Host\s+(.+)/gm;
    let match;
    while ((match = hostRegex.exec(sshConfig)) !== null) {
      const hosts = match[1].split(/\s+/);
      for (const h of hosts) {
        if (h.includes('*') || h.includes('git.') || h.includes('github')) continue;
        if (h.includes('.foxhop.net') || (!h.includes('.') && h !== 'localhost')) {
          nodes.add(h);
        }
      }
    }
  } catch {
    // SSH config not readable
  }

  return [...nodes];
}
