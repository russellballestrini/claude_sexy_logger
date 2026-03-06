import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { claudePaths } from '@unfirehose/core/claude-paths';
import type { SessionsIndex } from '@unfirehose/core/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

function gitExec(cwd: string, args: string[], timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 1024 * 1024 * 5 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function resolveRepoPath(projectName: string): Promise<string | null> {
  try {
    const raw = await readFile(claudePaths.sessionsIndex(projectName), 'utf-8');
    const index: SessionsIndex = JSON.parse(raw);
    return index.originalPath ?? null;
  } catch {
    return null;
  }
}

// GET: return git status + diff for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  const { project } = await params;
  const repoPath = await resolveRepoPath(project);
  if (!repoPath) {
    return NextResponse.json({ error: 'Could not resolve repo path' }, { status: 404 });
  }

  try {
    const [statusRaw, diffStaged, diffUnstaged, branch, logRaw] = await Promise.all([
      gitExec(repoPath, ['status', '--porcelain']),
      gitExec(repoPath, ['diff', '--cached', '--stat']),
      gitExec(repoPath, ['diff', '--stat']),
      gitExec(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
      gitExec(repoPath, ['log', '--oneline', '-5']),
    ]);

    // Full unified diff (staged + unstaged)
    const fullDiff = await gitExec(repoPath, ['diff', 'HEAD']);

    // Parse status into structured files
    const files = statusRaw.trim().split('\n').filter(Boolean).map((line) => {
      const status = line.slice(0, 2).trim();
      const file = line.slice(3);
      return { status, file };
    });

    return NextResponse.json({
      repoPath,
      branch: branch.trim(),
      files,
      diffStat: (diffStaged.trim() + '\n' + diffUnstaged.trim()).trim(),
      diff: fullDiff,
      recentCommits: logRaw.trim(),
      isDirty: files.length > 0,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Git operation failed', detail: String(err) }, { status: 500 });
  }
}

// POST: commit changes
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ project: string }> }
) {
  const { project } = await params;
  const repoPath = await resolveRepoPath(project);
  if (!repoPath) {
    return NextResponse.json({ error: 'Could not resolve repo path' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { message, addAll } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Commit message required' }, { status: 400 });
    }

    // Stage files
    if (addAll) {
      await gitExec(repoPath, ['add', '-A']);
    } else {
      // Only stage tracked modified files (safer default)
      await gitExec(repoPath, ['add', '-u']);
    }

    // Check if there's anything staged
    const staged = await gitExec(repoPath, ['diff', '--cached', '--stat']);
    if (!staged.trim()) {
      return NextResponse.json({ error: 'Nothing staged to commit' }, { status: 400 });
    }

    // Commit
    await gitExec(repoPath, ['commit', '-m', message.trim()]);

    // Get the new commit info
    const newCommit = await gitExec(repoPath, ['log', '--oneline', '-1']);

    return NextResponse.json({
      success: true,
      commit: newCommit.trim(),
    });
  } catch (err) {
    return NextResponse.json({ error: 'Commit failed', detail: String(err) }, { status: 500 });
  }
}
