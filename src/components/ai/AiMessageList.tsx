import { useEffect, useRef } from "react";
import { AiMessage } from "../../state/aiStore";
import AiMessageBubble from "./AiMessageBubble";

interface AiMessageListProps {
  messages: AiMessage[];
  running: boolean;
  liveSessionId?: string;
  onRun: (messageId: string, overrideDenylist?: boolean) => void;
  onSkip: (messageId: string) => void;
  onRunSnippet: (command: string) => void;
}

export default function AiMessageList({
  messages,
  running,
  liveSessionId,
  onRun,
  onSkip,
  onRunSnippet,
}: AiMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Ask anything about this server, or describe a goal for it to work on.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((m, i) => (
        // A proposed command is only ever unresolved while it's the very
        // last message (see aiStore.ts's hasPendingToolCall) - Run/Skip
        // always append a tool-result immediately once decided. Anything
        // earlier in the list has already been resolved one way or another,
        // so its Run/Skip buttons shouldn't still be clickable (a second
        // Run would append a second tool-result for the same proposal,
        // which is exactly the dangling/duplicate pairing providers reject).
        <AiMessageBubble
          key={m.id}
          message={m}
          running={running}
          resolved={i < messages.length - 1}
          liveSessionId={liveSessionId}
          onRun={onRun}
          onSkip={onSkip}
          onRunSnippet={onRunSnippet}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
