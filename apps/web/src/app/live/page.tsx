'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { formatTimestamp } from '@unfirehose/core/format';
import { decodeProjectName } from '@unfirehose/core/claude-paths-client';
import { PageContext } from '@unfirehose/ui/PageContext';
import { SessionPopover } from '@unfirehose/ui/SessionPopover';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface LiveEntry {
  type: 'entry';
  project: string;
  projectName: string;
  sessionId: string;
  entry: any;
}

interface LiveSession {
  project: string;
  projectName: string;
  sessionId: string;
  originalPath?: string;
}

const SESSION_COLORS = [
  '#10b981', '#a78bfa', '#60a5fa', '#f472b6', '#fbbf24',
  '#34d399', '#818cf8', '#38bdf8', '#fb923c', '#a3e635',
  '#e879f9', '#2dd4bf', '#f87171', '#facc15', '#4ade80',
  '#c084fc', '#22d3ee', '#fb7185', '#a8a29e', '#84cc16',
  '#67e8f9',
];

function getSessionColor(index: number): string {
  return SESSION_COLORS[index % SESSION_COLORS.length];
}

function extractText(entry: any): string {
  if (!entry?.message?.content) return '';
  const content = entry.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text ?? '')
    .join('\n');
}

function extractThinking(entry: any): string | null {
  if (entry?.type !== 'assistant' || !Array.isArray(entry?.message?.content)) return null;
  const blocks = entry.message.content.filter((b: any) => b.type === 'thinking');
  if (blocks.length === 0) return null;
  return blocks.map((b: any) => b.thinking ?? '').join('\n');
}

function extractTools(entry: any): { name: string; id?: string; detail?: string; input?: any }[] {
  if (entry?.type !== 'assistant' || !Array.isArray(entry?.message?.content)) return [];
  return entry.message.content
    .filter((b: any) => b.type === 'tool_use')
    .map((b: any) => {
      let detail: string | undefined;
      if (b.name === 'Bash' && b.input?.command) {
        detail = b.input.command;
      } else if ((b.name === 'Read' || b.name === 'Write' || b.name === 'Edit') && b.input?.file_path) {
        detail = b.input.file_path;
      } else if (b.name === 'Glob' && b.input?.pattern) {
        detail = b.input.pattern;
      } else if (b.name === 'Grep' && b.input?.pattern) {
        detail = `/${b.input.pattern}/` + (b.input.path ? ` in ${b.input.path}` : '');
      } else if (b.name === 'Agent' && b.input?.description) {
        detail = b.input.description;
      }
      return { name: b.name, id: b.id, detail, input: b.input };
    });
}

function extractToolResults(entry: any): { toolUseId: string; content: string; isError: boolean }[] {
  if (entry?.type !== 'user' || !Array.isArray(entry?.message?.content)) return [];
  return entry.message.content
    .filter((b: any) => b.type === 'tool_result')
    .map((b: any) => {
      let content = '';
      if (typeof b.content === 'string') {
        content = b.content;
      } else if (Array.isArray(b.content)) {
        content = b.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text ?? '')
          .join('\n');
      }
      return {
        toolUseId: b.tool_use_id ?? '',
        content,
        isError: b.is_error === true,
      };
    });
}

function shortModel(model?: string): string {
  if (!model) return '';
  return model.replace('claude-', '').replace(/-\d{8}$/, '');
}

// Simple markdown-ish rendering: code blocks, inline code, bold, links
function renderMarkdownish(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```') && !inCodeBlock) {
      inCodeBlock = true;
      codeLang = line.slice(3).trim();
      codeLines = [];
      continue;
    }
    if (line.startsWith('```') && inCodeBlock) {
      inCodeBlock = false;
      nodes.push(
        <pre key={`code-${i}`} className="bg-[var(--color-background)] rounded px-3 py-2 my-1 overflow-x-auto text-[var(--color-foreground)] text-sm leading-relaxed">
          {codeLang && <span className="text-[var(--color-muted)] text-xs block mb-1">{codeLang}</span>}
          {codeLines.join('\n')}
        </pre>
      );
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Regular line — process inline formatting
    nodes.push(<span key={`line-${i}`}>{renderInline(line)}{i < lines.length - 1 ? '\n' : ''}</span>);
  }

  // Unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    nodes.push(
      <pre key="code-unclosed" className="bg-[var(--color-background)] rounded px-3 py-2 my-1 overflow-x-auto text-[var(--color-foreground)] text-sm leading-relaxed">
        {codeLines.join('\n')}
      </pre>
    );
  }

  return nodes;
}

function renderInline(text: string): React.ReactNode[] {
  // Split on inline code, bold, and file paths
  const parts: React.ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const m = match[0];
    if (m.startsWith('`') && m.endsWith('`')) {
      parts.push(
        <code key={match.index} className="bg-[var(--color-background)] px-1 py-0.5 rounded text-[var(--color-accent)] text-sm">
          {m.slice(1, -1)}
        </code>
      );
    } else if (m.startsWith('**') && m.endsWith('**')) {
      parts.push(<strong key={match.index} className="font-bold">{m.slice(2, -2)}</strong>);
    }
    lastIndex = match.index + m.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

// Try to pretty-print if it looks like JSON
function formatOutput(text: string): { formatted: string; isJson: boolean } {
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
    } catch { /* not valid JSON */ }
  }
  return { formatted: text, isJson: false };
}

// Expandable content block
function ExpandableContent({ children, maxHeight = 120, label }: { children: React.ReactNode; maxHeight?: number; label?: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [needsExpansion, setNeedsExpansion] = useState(false);

  useEffect(() => {
    if (contentRef.current) {
      setNeedsExpansion(contentRef.current.scrollHeight > maxHeight + 20);
    }
  }, [children, maxHeight]);

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className={`overflow-hidden transition-[max-height] duration-200 ${!expanded && needsExpansion ? '' : ''}`}
        style={{ maxHeight: expanded ? 'none' : `${maxHeight}px` }}
      >
        {children}
      </div>
      {needsExpansion && !expanded && (
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[var(--color-surface)] to-transparent" />
      )}
      {needsExpansion && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-[var(--color-accent)] hover:underline mt-0.5 cursor-pointer"
        >
          {expanded ? 'collapse' : label ?? 'show more'}
        </button>
      )}
    </div>
  );
}

// Render a tool result block with proper formatting
function ToolResultBlock({ content, isError }: { content: string; isError: boolean }) {
  if (!content.trim()) return null;

  const { formatted, isJson } = formatOutput(content);
  const colorClass = isError
    ? 'text-[var(--color-error)]'
    : 'text-[var(--color-foreground)] opacity-80';

  return (
    <ExpandableContent maxHeight={160} label={`show full output (${content.split('\n').length} lines)`}>
      <pre className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${colorClass} ${isJson ? 'bg-[var(--color-background)] rounded px-2 py-1.5' : ''}`}>
        {formatted}
      </pre>
    </ExpandableContent>
  );
}

export default function LivePage() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [connected, setConnected] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedEntries, setExpandedEntries] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionColorMap = useRef<Map<string, number>>(new Map());

  function getColorForSession(sessionId: string): string {
    if (!sessionColorMap.current.has(sessionId)) {
      sessionColorMap.current.set(sessionId, sessionColorMap.current.size);
    }
    return getSessionColor(sessionColorMap.current.get(sessionId)!);
  }

  const toggleEntry = useCallback((index: number) => {
    setExpandedEntries(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      eventSource = new EventSource('/api/live');

      eventSource.onopen = () => setConnected(true);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'sessions') {
            setSessions(data.sessions);
          } else if (data.type === 'entry') {
            setEntries((prev) => {
              const next = [...prev, data];
              return next.length > 500 ? next.slice(-500) : next;
            });
          }
        } catch { /* skip parse errors */ }
      };

      eventSource.onerror = () => {
        setConnected(false);
        eventSource?.close();
        reconnectTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      eventSource?.close();
      clearTimeout(reconnectTimeout);
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [entries, autoScroll]);

  // Detect manual scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      setAutoScroll(atBottom);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const activeSessionIds = new Set(
    entries.slice(-100).map((e) => e.sessionId)
  );

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <PageContext
        pageType="live"
        summary={`Live stream. ${connected ? 'Connected' : 'Disconnected'}. ${sessions.length} hot sessions, ${activeSessionIds.size} active, ${entries.length} entries buffered.`}
        metrics={{
          connected: connected ? 'yes' : 'no',
          hot_sessions: sessions.length,
          active_sessions: activeSessionIds.size,
          buffered_entries: entries.length,
        }}
        details={sessions.map((s) => `${s.projectName} (${s.sessionId.slice(0, 8)})`).join('\n')}
      />

      {/* Header */}
      <div className="shrink-0 mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold">Live</h2>
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? 'bg-[var(--color-accent)] animate-pulse' : 'bg-[var(--color-error)]'
            }`}
          />
          <span className="text-base text-[var(--color-muted)]">
            {connected ? 'streaming' : 'reconnecting...'}
          </span>
          <span className="text-base text-[var(--color-muted)]">
            {sessions.length} hot sessions
          </span>
          <span className="text-base text-[var(--color-muted)]">
            {activeSessionIds.size} active
          </span>
        </div>

        <div className="flex items-center gap-4 mt-2">
          <label className="flex items-center gap-1.5 text-base text-[var(--color-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={showThinking}
              onChange={(e) => setShowThinking(e.target.checked)}
              className="accent-[var(--color-thinking)]"
            />
            Show thinking
          </label>
          <label className="flex items-center gap-1.5 text-base text-[var(--color-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Auto-scroll
          </label>
          <button
            onClick={() => { setEntries([]); setExpandedEntries(new Set()); }}
            className="text-base text-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
          >
            Clear
          </button>
        </div>

        {/* Active sessions bar */}
        {sessions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {sessions.map((s) => (
              <SessionPopover
                key={s.sessionId}
                sessionId={s.sessionId}
                project={s.project}
                projectPath={s.originalPath}
                label={
                  <span
                    className="text-base px-2 py-0.5 rounded-full border inline-block"
                    style={{
                      borderColor: getColorForSession(s.sessionId),
                      color: getColorForSession(s.sessionId),
                    }}
                  >
                    {s.projectName}
                    <span className="opacity-50 ml-1">
                      {s.sessionId.slice(0, 6)}
                    </span>
                  </span>
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Live stream */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto font-mono text-base"
      >
        {entries.length === 0 && connected && (
          <div className="text-[var(--color-muted)] text-base py-8 text-center">
            Watching for activity across all sessions...
          </div>
        )}

        {entries.map((item, i) => {
          const e = item.entry;
          const color = getColorForSession(item.sessionId);
          const text = extractText(e);
          const thinking = showThinking ? extractThinking(e) : null;
          const tools = extractTools(e);
          const toolResults = extractToolResults(e);
          const model = e?.message?.model;
          const usage = e?.message?.usage;
          const isExpanded = expandedEntries.has(i);

          const isUser = e.type === 'user';
          const isAssistant = e.type === 'assistant';
          const isSystem = e.type === 'system';

          const typeTag = isUser ? 'USR' : isAssistant ? 'AST' : 'SYS';
          const typeBg = isUser
            ? 'var(--color-user)'
            : isAssistant
              ? 'var(--color-assistant)'
              : 'var(--color-muted)';

          // For user messages that are just tool results, show as tool output
          const isToolOutput = isUser && toolResults.length > 0 && !text.trim();
          const hasErrors = toolResults.some(r => r.isError);

          return (
            <div
              key={i}
              className={`group border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface)] transition-colors ${
                isToolOutput ? 'bg-[var(--color-background)]' : ''
              } ${hasErrors ? 'border-l-2 border-l-[var(--color-error)]' : ''}`}
            >
              {/* Header row — always visible */}
              <div
                className="flex gap-2 py-1.5 px-3 cursor-pointer select-none"
                onClick={() => toggleEntry(i)}
              >
                {/* Session dot + project */}
                <div className="shrink-0 flex items-center gap-1.5 w-36">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: color }}
                  />
                  <span className="truncate text-sm" style={{ color }}>
                    {item.projectName}
                  </span>
                </div>

                {/* Type badge */}
                <span
                  className="shrink-0 text-sm font-bold px-1.5 py-0.5 rounded"
                  style={{ color: typeBg }}
                >
                  {isToolOutput ? 'OUT' : typeTag}
                </span>

                {/* Timestamp */}
                <span className="shrink-0 text-[var(--color-muted)] text-sm w-16">
                  {e.timestamp
                    ? formatTimestamp(e.timestamp).slice(11, 19)
                    : ''}
                </span>

                {/* Preview content */}
                <div className="flex-1 min-w-0 truncate text-sm">
                  {/* Model tag for assistant */}
                  {isAssistant && model && (
                    <span className="text-[var(--color-muted)] mr-1.5">
                      [{shortModel(model)}
                      {usage ? ` in:${(usage.input_tokens / 1000).toFixed(0)}k out:${(usage.output_tokens / 1000).toFixed(0)}k` : ''}]
                    </span>
                  )}

                  {/* System subtype */}
                  {isSystem && (
                    <span className="text-[var(--color-muted)]">
                      {e.subtype ?? 'event'}
                      {e.durationMs ? ` (${(e.durationMs / 1000).toFixed(1)}s)` : ''}
                    </span>
                  )}

                  {/* Tool names */}
                  {tools.length > 0 && (
                    <span className="text-[var(--color-tool)]">
                      {tools.map((t, ti) => (
                        <span key={ti}>
                          [{t.name}]{' '}
                        </span>
                      ))}
                    </span>
                  )}

                  {/* Tool result preview */}
                  {isToolOutput && toolResults.length > 0 && (
                    <span className={hasErrors ? 'text-[var(--color-error)]' : 'text-[var(--color-foreground)] opacity-60'}>
                      {toolResults[0].content.split('\n')[0].slice(0, 120)}
                      {toolResults[0].content.split('\n').length > 1 ? '...' : ''}
                    </span>
                  )}

                  {/* Text preview */}
                  {text && !isToolOutput && (
                    <span className="text-[var(--color-foreground)]">
                      {text.split('\n')[0].slice(0, 200)}
                    </span>
                  )}
                </div>

                {/* Expand indicator */}
                <span className="shrink-0 text-[var(--color-muted)] text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                  {isExpanded ? '-' : '+'}
                </span>
              </div>

              {/* Expanded content — shown on click */}
              {isExpanded && (
                <div className="px-3 pb-3 pl-[13.5rem] space-y-2">
                  {/* Thinking */}
                  {thinking && (
                    <ExpandableContent maxHeight={200}>
                      <div className="text-[var(--color-thinking)] text-sm leading-relaxed whitespace-pre-wrap italic">
                        {thinking}
                      </div>
                    </ExpandableContent>
                  )}

                  {/* Tool calls with details */}
                  {tools.length > 0 && (
                    <div className="space-y-1.5">
                      {tools.map((t, ti) => (
                        <div key={ti}>
                          <div className="text-[var(--color-tool)] text-sm font-bold">
                            [{t.name}]
                            {t.detail && (
                              <span className="font-normal text-[var(--color-muted)] ml-1.5">{t.detail}</span>
                            )}
                          </div>
                          {/* Pretty-print non-trivial tool inputs */}
                          {t.input && t.name !== 'Bash' && t.name !== 'Read' && t.name !== 'Glob' && t.name !== 'Grep' && (
                            <ExpandableContent maxHeight={120}>
                              <pre className="text-xs text-[var(--color-muted)] bg-[var(--color-background)] rounded px-2 py-1 mt-0.5 overflow-x-auto">
                                {JSON.stringify(t.input, null, 2)}
                              </pre>
                            </ExpandableContent>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tool results */}
                  {toolResults.length > 0 && (
                    <div className="space-y-1.5">
                      {toolResults.map((r, ri) => (
                        <ToolResultBlock key={ri} content={r.content} isError={r.isError} />
                      ))}
                    </div>
                  )}

                  {/* Text content with markdown rendering */}
                  {text && (
                    <ExpandableContent maxHeight={300} label={`show full message (${text.split('\n').length} lines)`}>
                      <div className="text-sm text-[var(--color-foreground)] leading-relaxed whitespace-pre-wrap break-words">
                        {renderMarkdownish(text)}
                      </div>
                    </ExpandableContent>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
