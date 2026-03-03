import { readdir, readFile } from 'fs/promises';
import { claudePaths } from '@/lib/claude-paths';
import { streamJsonl } from '@/lib/jsonl-reader';
import { NextRequest, NextResponse } from 'next/server';
import type { ThinkingExcerpt, SessionsIndex, ContentBlock } from '@/lib/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEntry = any;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const projectFilter = url.searchParams.get('project');
  const limit = parseInt(url.searchParams.get('limit') ?? '1000');
  const search = url.searchParams.get('search')?.toLowerCase();

  try {
    const projectDirs = await readdir(claudePaths.projects);
    const results: ThinkingExcerpt[] = [];

    // Collect from all projects before sorting, so latest-first is accurate
    for (const dir of projectDirs) {
      if (projectFilter && dir !== projectFilter) continue;

      let sessionIds: string[] = [];
      try {
        const indexRaw = await readFile(claudePaths.sessionsIndex(dir), 'utf-8');
        const index: SessionsIndex = JSON.parse(indexRaw);
        // Sort by modified desc, scale session scan with limit
        const sessionCap = limit <= 1000 ? 20 : 50;
        sessionIds = index.entries
          .sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? ''))
          .slice(0, sessionCap)
          .map((e) => e.sessionId);
      } catch {
        continue;
      }

      for (const sid of sessionIds) {
        const filePath = claudePaths.sessionFile(dir, sid);
        let lastUserText = '';

        try {
          for await (const entry of streamJsonl(filePath, {
            types: ['user', 'assistant'],
          })) {
            const e = entry as AnyEntry;
            if (e.type === 'user') {
              const content = e.message.content;
              if (typeof content === 'string') {
                lastUserText = content;
              } else if (Array.isArray(content)) {
                lastUserText = content
                  .filter((b: ContentBlock) => b.type === 'text')
                  .map((b) => ('text' in b ? b.text : ''))
                  .join('\n');
              }
            } else if (e.type === 'assistant' && Array.isArray(e.message.content)) {
              for (const block of e.message.content) {
                if (block.type === 'thinking' && 'thinking' in block) {
                  const thinking = block.thinking;
                  if (search && !thinking.toLowerCase().includes(search)) continue;
                  results.push({
                    sessionId: e.sessionId,
                    project: dir,
                    timestamp: e.timestamp ?? '',
                    thinking,
                    precedingPrompt: lastUserText,
                    model: e.message.model,
                  });
                }
              }
            }
          }
        } catch {
          // skip unreadable sessions
        }
      }
    }

    // Sort all results by timestamp desc (latest first), then slice to limit
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return NextResponse.json(results.slice(0, limit));
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to aggregate thinking', detail: String(err) },
      { status: 500 }
    );
  }
}
