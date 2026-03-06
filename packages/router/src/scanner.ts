import { readdirSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';

/**
 * Recursively find all .jsonl files under the given paths.
 */
export function findJsonlFiles(watchPaths: string[]): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) {
          walk(full);
        } else if (entry.endsWith('.jsonl') && s.size > 0) {
          files.push(full);
        }
      } catch {
        // skip inaccessible
      }
    }
  }

  for (const p of watchPaths) {
    walk(p);
  }

  return files;
}

/**
 * Read new lines from a file starting at the given byte offset.
 * Returns the lines and the new cursor position.
 */
export function readNewLines(
  filePath: string,
  cursor: number
): { lines: string[]; newCursor: number } {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return { lines: [], newCursor: cursor };
  }

  if (size <= cursor) {
    // File hasn't grown (or was truncated — reset cursor)
    return { lines: [], newCursor: size < cursor ? 0 : cursor };
  }

  const buf = Buffer.alloc(size - cursor);
  const fd = openSync(filePath, 'r');
  try {
    readSync(fd, buf, 0, buf.length, cursor);
  } finally {
    closeSync(fd);
  }

  const text = buf.toString('utf-8');
  const rawLines = text.split('\n').filter(l => l.trim().length > 0);

  return { lines: rawLines, newCursor: size };
}
