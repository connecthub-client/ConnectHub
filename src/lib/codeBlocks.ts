// Hand-rolled fenced-code-block splitter for the AI Assistant's replies - no
// markdown-rendering library is used anywhere in this app (see CLAUDE.md's
// "no external DnD library" precedent for the same reasoning: not worth a
// dependency for something this small), and a full markdown renderer would
// be solving a much bigger problem than "let the user act on a command the
// AI mentioned." This only recognizes ```lang\n...\n``` fences, which is all
// OpenAI/Anthropic ever actually produce for code in a chat reply.
export type TextSegment = { type: "text"; content: string };
export type CodeSegment = { type: "code"; language?: string; content: string };
export type MessageSegment = TextSegment | CodeSegment;

const FENCE_RE = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

export function parseCodeBlocks(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(FENCE_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, start) });
    }
    const [, language, content] = match;
    segments.push({
      type: "code",
      language: language || undefined,
      // A trailing newline right before the closing fence is just formatting,
      // not part of the command/code itself - trimming it means "Copy"/"Run"
      // don't carry a stray blank line.
      content: content.replace(/\n$/, ""),
    });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  return segments;
}
