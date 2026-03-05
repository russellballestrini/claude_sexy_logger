import path from 'path';

/**
 * Path helpers for Fetch JSONL session data.
 *
 * Fetch writes JSONL to {DATA_DIR}/jsonl/{project-slug}/{session-id}.jsonl.
 * Set FETCH_JSONL_DIR env var to point at the Fetch JSONL output directory.
 */

const FETCH_JSONL_DIR = process.env.FETCH_JSONL_DIR || '';

export const fetchPaths = {
  root: FETCH_JSONL_DIR,

  projectDir(slug: string) {
    return path.join(FETCH_JSONL_DIR, slug);
  },

  sessionFile(slug: string, sessionId: string) {
    return path.join(FETCH_JSONL_DIR, slug, `${sessionId}.jsonl`);
  },
};

export function decodeFetchProjectName(slug: string): string {
  // Fetch project slugs are typically just the project directory name
  return slug.replace(/-/g, ' ').trim() || slug;
}
