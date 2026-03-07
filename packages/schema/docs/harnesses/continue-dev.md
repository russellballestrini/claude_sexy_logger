# Continue.dev — Harness Format

**Provider**: Multi-provider (OpenAI, Anthropic, Ollama, etc.)
**Status**: Researched (adapter planned)
**Adapter**: planned

## Overview

Continue is an open-source coding assistant as a VS Code/JetBrains extension: https://github.com/continuedev/continue

## Session Storage

Continue stores session history in JSON files:

```
~/.continue/sessions/                  # Session storage
~/.continue/config.json                # Configuration
~/.continue/dev_data/                  # Analytics/telemetry data
```

### Session Format

```typescript
// From core/index.d.ts
interface Session {
  sessionId: string;
  title: string;
  workspaceDirectory: string;
  history: ChatHistoryItem[];
}
```

### Message Roles

Continue has **5 roles** (more than most harnesses):

```typescript
type ChatMessageRole = "user" | "assistant" | "thinking" | "system" | "tool";
```

### ChatHistoryItem (wraps messages with metadata)

```typescript
interface ChatHistoryItem {
  message: ChatMessage;
  contextItems: ContextItemWithId[];  // files, search results, etc.
  editorState?: any;
  promptLogs?: PromptLog[];
  toolCallState?: ToolCallState;
  reasoning?: { active: boolean; text: string; startAt: number; endAt?: number; };
}
```

### Tool Calls

```typescript
interface ToolCallDelta {
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string; };
}
```

### Thinking Messages

Continue has native thinking support as a distinct role:

```typescript
interface ThinkingChatMessage {
  role: "thinking";
  content: MessageContent;
  signature?: string;          // Anthropic thinking signature
  redactedThinking?: string;
}
```

### Data Export (JSONL)

Continue supports structured data export via config:

```jsonc
// config.json
{
  "data": {
    "destination": "file://~/.continue/export.jsonl"
    // or HTTP endpoint
  }
}
```

Exports `autocomplete`, `chatInteraction`, and other event types in JSONL with schema versioning (0.1.0, 0.2.0).

## Field Mapping → Unfirehose

| Continue.dev | Unfirehose | Transform |
|---|---|---|
| `history[].message.role` | `role` | direct |
| `history[].message.content` | `content: [{type: "text", text}]` | wrap in block |
| `history[].contextItems` | not mapped | context, not messages |
| `history[].edits[].filepath` | `content[].toolName: "Edit"` | extract as tool-call |
| `sessionId` | `sessionId` | direct |
| `dateCreated` | `createdAt` | rename |

## Adapter Challenges

1. **JSON not JSONL**: Sessions are full JSON documents, not append-only streams
2. **Context items**: Rich context (file contents, codebase search) attached to messages but not tool calls
3. **Edits inline**: File edits are part of the assistant message, not separate tool calls
4. **No token tracking**: Usage not logged in session files
5. **No timestamps per message**: Only session creation time

## Key Differences from Claude Code

| Aspect | Claude Code | Continue.dev |
|--------|------------|-------------|
| Format | JSONL (append-only) | JSON (full document) |
| Tool calls | Named function calls | Inline edits |
| Context | Implicit (model sees files) | Explicit `contextItems` |
| Token tracking | Full | None in logs |
| Open source | Yes (CLI) | Yes (extension) |
| IDE | Terminal | VS Code / JetBrains |
