/** Serialize an error without losing the useful part of its causal chain. */
export function errorMessageWithCause(error: unknown, maxLength = 4000): string {
  const messages: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current != null && !visited.has(current); depth += 1) {
    visited.add(current);
    const message = current instanceof Error
      ? current.message
      : typeof current === 'string'
        ? current
        : current && typeof current === 'object' && 'message' in current
          ? String((current as { message?: unknown }).message ?? '')
          : String(current);
    const trimmed = message.trim();
    if (trimmed && messages[messages.length - 1] !== trimmed) messages.push(trimmed);
    current = current && typeof current === 'object' && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }

  const text = messages.join('\nCaused by: ') || 'Unknown error.';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
