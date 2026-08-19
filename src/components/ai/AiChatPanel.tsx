import { AiProvider, Host } from "../../lib/tauri-bridge";
import { AiMode, hasPendingToolCall, useAiStore } from "../../state/aiStore";
import { findLiveSessionId, useSessionsStore } from "../../state/sessionsStore";
import AiInputBox from "./AiInputBox";
import AiMessageList from "./AiMessageList";

interface AiChatPanelProps {
  host: Host;
  provider: AiProvider;
}

export default function AiChatPanel({ host, provider }: AiChatPanelProps) {
  const convo = useAiStore((s) => s.getConversation(host.id));
  const sendUserMessage = useAiStore((s) => s.sendUserMessage);
  const runCommand = useAiStore((s) => s.runCommand);
  const proposeAndRun = useAiStore((s) => s.proposeAndRun);
  const skipCommand = useAiStore((s) => s.skipCommand);
  const setMode = useAiStore((s) => s.setMode);
  const stop = useAiStore((s) => s.stop);
  const openSessions = useSessionsStore((s) => s.openSessions);
  const sessionIds = useSessionsStore((s) => s.sessionIds);
  const liveSessionId = findLiveSessionId(openSessions, sessionIds, host.id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-3">
        {convo.error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {convo.error}
          </p>
        )}
        <AiMessageList
          messages={convo.messages}
          running={convo.running}
          liveSessionId={liveSessionId}
          onRun={(messageId, overrideDenylist) => runCommand(host, messageId, overrideDenylist)}
          onSkip={(messageId) => skipCommand(host.id, messageId)}
          onRunSnippet={(command) => proposeAndRun(host, command, "Extracted from the AI's answer")}
        />
      </div>
      <AiInputBox
        mode={convo.mode}
        running={convo.running}
        pendingToolCall={hasPendingToolCall(convo.messages)}
        onSend={(text) => sendUserMessage(host, provider, text)}
        onModeChange={(mode: AiMode) => setMode(host.id, mode)}
        onStop={() => stop(host.id)}
      />
    </div>
  );
}
