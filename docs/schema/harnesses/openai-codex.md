# OpenAI Codex CLI — Harness Format

**Provider**: OpenAI
**Status**: Documented (adapter planned)
**Adapter**: `packages/core/codex-adapter.ts` (planned)

## Overview

OpenAI's Codex CLI is an open-source coding agent: https://github.com/openai/codex

It uses the OpenAI **Responses API** format (not chat completions) with `ResponseItem` types.

## File Location

```
$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl    # session transcripts
~/.codex/log/codex-tui.log                          # debug log (not transcripts)
```

Sessions chain via `previous_response_id`. Resume with `codex --resume` or `codex --continue`.

## Native Format

Codex uses `ResponseItem` types from the Responses API:

### User Message

```jsonc
{
  "type": "message",
  "role": "user",
  "content": [{ "type": "input_text", "text": "Fix the login page" }]
}
```

### Assistant Message

```jsonc
{
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "output_text", "text": "I'll fix that." }]
}
```

### Function Call

```jsonc
{
  "type": "function_call",
  "name": "shell",
  "arguments": "{\"cmd\": [\"ls\", \"src/\"]}",
  "call_id": "call_abc123"
}
```

### Function Call Output

```jsonc
{
  "type": "function_call_output",
  "call_id": "call_abc123",
  "output": "{\"output\": \"login.css\\napp.js\", \"metadata\": {\"exit_code\": 0, \"duration_seconds\": 1.2}}"
}
```

### Usage

```jsonc
{
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "total_tokens": 1801,
    "prompt_tokens_details": {
      "cached_tokens": 890
    },
    "completion_tokens_details": {
      "reasoning_tokens": 120
    }
  }
}
```

## Field Mapping → Unfirehose

| Codex (Responses API) | Unfirehose | Transform |
|---|---|---|
| `type: "message", role: "user"` | `role: "user"` | direct |
| `type: "message", role: "assistant"` | `role: "assistant"` | direct |
| `content[].type: "input_text"` | `content[].type: "text"` | rename |
| `content[].type: "output_text"` | `content[].type: "text"` | rename |
| `type: "function_call"` | `content[].type: "tool-call"` | restructure |
| `function_call.name` | `content[].toolName` | rename |
| `function_call.arguments` | `content[].input` | JSON parse |
| `function_call.call_id` | `content[].toolCallId` | rename |
| `type: "function_call_output"` | `content[].type: "tool-result"` | restructure |
| `function_call_output.call_id` | `content[].toolCallId` | rename |
| `function_call_output.output` | `content[].output` | JSON parse |
| `usage.prompt_tokens` | `usage.inputTokens` | rename |
| `usage.completion_tokens` | `usage.outputTokens` | rename |
| `usage.prompt_tokens_details.cached_tokens` | `usage.inputTokenDetails.cacheReadTokens` | nest + rename |
| `usage.completion_tokens_details.reasoning_tokens` | `usage.outputTokenDetails.reasoningTokens` | nest + rename |
| `finish_reason: "tool_calls"` | `stopReason: "tool_calls"` | camelCase |
| `finish_reason: "stop"` | `stopReason: "end_turn"` | normalize |

## Tools

Codex CLI uses a sandboxed execution model:

| Codex Tool | Canonical Name |
|------------|---------------|
| `shell` | `Bash` |
| `read_file` | `Read` |
| `write_file` | `Write` |
| `apply_diff` | `Edit` |
| `list_dir` | `Glob` |

## Thinking Support

OpenAI o-series models (o3, o4-mini) have internal reasoning, but the reasoning text is **not exposed** in the API response. Only `reasoning_tokens` appears in usage stats.

This means Codex sessions have no thought traces extractable for the thinking stream — only a token count of how much reasoning occurred.

## Key Differences from Claude Code

| Aspect | Claude Code | Codex CLI |
|--------|------------|-----------|
| Content format | Block array always | String or null + separate tool_calls |
| Tool calls | Inline `tool_use` blocks | Separate `tool_calls[]` array |
| Tool results | `tool_result` in user message | Separate `tool` role message |
| Thinking | Full text exposed | Token count only |
| Cache tokens | `cache_read_input_tokens` | `prompt_tokens_details.cached_tokens` |
| Sandbox | None (user approved) | Docker container |
