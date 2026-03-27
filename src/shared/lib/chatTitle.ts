export function makeChatTitleFromMessage(text: string): string {
  const firstLine = text.trim().split(/\r?\n/, 1)[0] ?? "";
  const sentenceMatch = firstLine.match(/^(.+?[.!?…])(\s|$)/);
  const base = (sentenceMatch?.[1] ?? firstLine).trim();
  const maxLen = 50;
  if (base.length > maxLen) return `${base.slice(0, maxLen).trimEnd()}...`;
  return base;
}

