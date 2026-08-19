import { parseCodeBlocks } from "../../lib/codeBlocks";
import { copyCommandText, pasteCommandToTerminal } from "../../lib/aiCommandActions";
import { AiMessage } from "../../state/aiStore";
import AiCodeBlock from "./AiCodeBlock";

interface AiMessageBubbleProps {
  message: AiMessage;
  running: boolean;
  // Whether this proposed command already has a tool-result later in the
  // conversation (see AiMessageList) - once true, Run/Skip are no longer
  // offered, since acting on it again would append a second tool-result for
  // the same proposal.
  resolved: boolean;
  // The host's live terminal session, if one is open - threaded down to
  // every code block's "Paste in server" action (see AiCodeBlock).
  liveSessionId?: string;
  onRun: (messageId: string, overrideDenylist?: boolean) => void;
  onSkip: (messageId: string) => void;
  // For a command found in the AI's plain text (not a formal tool-call
  // proposal) - see AiChatPanel.tsx's wiring to aiStore.ts's proposeAndRun.
  onRunSnippet: (command: string) => void;
}

export default function AiMessageBubble({
  message,
  running,
  resolved,
  liveSessionId,
  onRun,
  onSkip,
  onRunSnippet,
}: AiMessageBubbleProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-teal-600 px-3 py-2 text-sm whitespace-pre-wrap text-white">
          {message.text}
        </div>
      </div>
    );
  }

  if (message.role === "tool-result") {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-100 p-2 text-xs dark:border-slate-800 dark:bg-slate-900">
        <p className="mb-1 font-mono text-slate-500 dark:text-slate-400">$ {message.toolCall?.command}</p>
        {message.ranInTerminal ? (
          <p className="text-slate-500 dark:text-slate-400">Sent to the terminal - check the session for output.</p>
        ) : message.skipped ? (
          <p className="text-slate-500 dark:text-slate-400">Skipped - not run.</p>
        ) : (
          <>
            {message.execOutput?.stdout && (
              <pre className="whitespace-pre-wrap break-all font-mono text-slate-700 dark:text-slate-300">
                {message.execOutput.stdout}
              </pre>
            )}
            {message.execOutput?.stderr && (
              <pre className="whitespace-pre-wrap break-all font-mono text-red-600 dark:text-red-400">
                {message.execOutput.stderr}
              </pre>
            )}
            <p className="mt-1 text-slate-400">
              exit {message.execOutput?.exit_status ?? "unknown"}
              {message.execOutput?.truncated ? " · output truncated" : ""}
            </p>
          </>
        )}
      </div>
    );
  }

  // assistant - a text reply (with zero or more code blocks in it), a
  // proposed command, or both.
  const segments = message.text ? parseCodeBlocks(message.text) : [];

  return (
    <div className="flex max-w-[85%] flex-col gap-2">
      {segments.map((segment, i) =>
        segment.type === "code" ? (
          <AiCodeBlock
            key={i}
            content={segment.content}
            language={segment.language}
            liveSessionId={liveSessionId}
            running={running}
            onRun={() => onRunSnippet(segment.content)}
          />
        ) : segment.content.trim() ? (
          <div
            key={i}
            className="rounded-lg bg-slate-100 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800 dark:bg-slate-800 dark:text-slate-200"
          >
            {segment.content}
          </div>
        ) : null,
      )}
      {message.toolCall && (
        <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
          <p className="mb-1 text-slate-500 dark:text-slate-400">{message.toolCall.purpose}</p>
          <p className="mb-2 overflow-x-auto rounded bg-slate-100 px-2 py-1 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">
            {message.toolCall.command}
          </p>
          <div className="mb-2 flex gap-1">
            <button
              type="button"
              onClick={() => copyCommandText(message.toolCall!.command)}
              className="flex-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => liveSessionId && pasteCommandToTerminal(liveSessionId, message.toolCall!.command)}
              disabled={!liveSessionId}
              title={liveSessionId ? undefined : "Open a terminal session for this host first"}
              className="flex-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Paste in server
            </button>
          </div>
          {!resolved &&
            (message.needsConfirmation ? (
              <div>
                <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  This command matches a pattern that needs manual confirmation ({message.needsConfirmation.pattern}).
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onRun(message.id, true)}
                    disabled={running}
                    className="flex-1 rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Run anyway
                  </button>
                  <button
                    type="button"
                    onClick={() => onSkip(message.id)}
                    disabled={running}
                    className="flex-1 rounded-md bg-slate-200 px-2 py-1 font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-50 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                  >
                    Skip
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onRun(message.id)}
                disabled={running}
                className="w-full rounded-md bg-teal-600 px-2 py-1 font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {running ? "Running…" : "Run"}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
