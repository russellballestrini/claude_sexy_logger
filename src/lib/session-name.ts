/**
 * Generate a human-readable session display name from the first prompt.
 * Deterministic — no LLM needed. Strips system tags, truncates at word boundary.
 */
export function generateSessionName(
  firstPrompt: string | null,
  sessionUuid: string
): string {
  if (!firstPrompt) return sessionUuid.slice(0, 8);

  // Strip XML/system tags and their content
  let cleaned = firstPrompt
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n+/g, ' ')
    .trim();

  // Strip common prefixes that add no value
  cleaned = cleaned
    .replace(/^(?:Please|Can you|Could you|I want you to|I need you to)\s+/i, '')
    .trim();

  if (!cleaned) return sessionUuid.slice(0, 8);
  if (cleaned.length <= 60) return cleaned;

  const truncated = cleaned.slice(0, 60);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 30 ? truncated.slice(0, lastSpace) : truncated) + '...';
}
