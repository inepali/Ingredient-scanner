// Puts the public report link into a post description (pure; used by the server and the browser).

const MARKER = "Full ingredient breakdown:";

/**
 * Adds "Full ingredient breakdown: <url>" right after the "not medical advice"
 * line, or at the end if that line isn't there. Does nothing without a link or
 * if the link is already in the text.
 */
export function withPublicLink(description: string, url: string | null | undefined): string {
  const text = description.trim();
  if (!url || text.includes(url)) return text;
  const line = `${MARKER} ${url}`;
  const note = /not medical advice\.?/i.exec(text);
  if (!note) return text ? `${text}\n\n${line}` : line;
  const at = note.index + note[0].length;
  const rest = text.slice(at).trim();
  return `${text.slice(0, at)}\n\n${line}${rest ? `\n\n${rest}` : ""}`;
}
