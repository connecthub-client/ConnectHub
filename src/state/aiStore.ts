import { create } from "zustand";
import {
  AiCommandExecResult,
  AiMessageInput,
  AiProvider,
  Host,
  aiChatSend,
  aiCommandCheck,
  aiCommandExec,
  ExecOutput,
  sessionWrite,
} from "../lib/tauri-bridge";
import { findLiveSessionId, useSessionsStore } from "./sessionsStore";
import { useVpnStore } from "./vpnStore";

// A confused (or adversarially-prompted-via-content-it-read-back) AI could
// otherwise loop indefinitely proposing/running commands - this bounds a
// single autonomous run regardless of what it's doing, independent of the
// user's own Stop button.
const MAX_AUTONOMOUS_ITERATIONS = 25;

export interface AiMessage {
  id: string;
  role: "user" | "assistant" | "tool-result";
  text?: string;
  toolCall?: { command: string; purpose: string };
  execOutput?: ExecOutput;
  // Set instead of execOutput when this command was run by writing it into
  // an already-open terminal session (see runCommand) rather than through
  // the one-off exec channel - there's no stdout/stderr/exit code to show
  // here since the command ran interactively in a session the user is
  // already looking at, not a channel this app captured.
  ranInTerminal?: boolean;
  // Set instead of execOutput when the user clicked "Skip" on a denylisted
  // proposal rather than running it - see skipCommand. Needed because every
  // provider's wire format (see openai.rs/anthropic.rs) requires a tool
  // response immediately after a tool_calls message; leaving it dangling
  // instead of appending this would make the very next turn resend an
  // unresolved tool_calls entry, which OpenAI/Anthropic reject outright.
  skipped?: boolean;
  // Set when a Run attempt hit the backend denylist backstop - always
  // pauses for an explicit "Run anyway" click regardless of mode, per the
  // guarded-autonomy design (see ai_commands.rs::ai_command_exec, the sole
  // authoritative enforcement point - this is UI state reflecting that,
  // not a second copy of the check).
  needsConfirmation?: { pattern: string };
}

export type AiMode = "ask" | "autonomous";

export interface AiConversation {
  messages: AiMessage[];
  mode: AiMode;
  // Set once, from the first message sent - autonomous continuations
  // (requestNextTurn's recursive call from runCommand) need to know which
  // provider to keep using without the caller re-passing it every time.
  provider: AiProvider | null;
  running: boolean;
  stopRequested: boolean;
  iterationCount: number;
  error: string | null;
}

function emptyConversation(): AiConversation {
  return {
    messages: [],
    mode: "ask",
    provider: null,
    running: false,
    stopRequested: false,
    iterationCount: 0,
    error: null,
  };
}

// A single stable reference for "no conversation yet", reused by
// getConversation below - allocating a fresh object on every call (as
// emptyConversation() does, intentionally, for the update() seeding case)
// would give useAiStore's selector a different snapshot identity on every
// render for a host with no conversation, which is exactly the unstable-
// snapshot pattern useSyncExternalStore warns about and can render-loop on.
const EMPTY_CONVERSATION = emptyConversation();

interface AiState {
  // Keyed per-host, mirroring how sessionsStore keys live sessions per tab
  // - an AI conversation is tied to the server it's about. Deliberately
  // NOT persisted (no `persist` middleware, unlike most other stores
  // here): conversations may contain real command output pulled from the
  // user's servers, and unlike the vault, localStorage has no encryption.
  conversations: Record<string, AiConversation>;
  getConversation: (hostId: string) => AiConversation;
  sendUserMessage: (host: Host, provider: AiProvider, text: string) => Promise<void>;
  runCommand: (host: Host, messageId: string, overrideDenylist?: boolean) => Promise<void>;
  // For a command found in the AI's plain-text reply (see codeBlocks.ts) via
  // the code block's "Run" button - not something the model proposed
  // through structured tool-calling. Synthesizes the same kind of proposal
  // message runCommand already expects, then runs it, so this gets the
  // exact same denylist gate / live-terminal-write / exec-fallback /
  // autonomous-continuation behavior as any other proposed command, rather
  // than a parallel, easier-to-get-wrong execution path.
  proposeAndRun: (host: Host, command: string, purpose: string) => Promise<void>;
  // Dismisses a pending confirmation without running it - the other half
  // of the denylist backstop's "Run anyway" / "Skip" pair.
  skipCommand: (hostId: string, messageId: string) => void;
  setMode: (hostId: string, mode: AiMode) => void;
  stop: (hostId: string) => void;
  clearConversation: (hostId: string) => void;
}

function update(hostId: string, fn: (c: AiConversation) => AiConversation) {
  useAiStore.setState((s) => ({
    conversations: { ...s.conversations, [hostId]: fn(s.conversations[hostId] ?? emptyConversation()) },
  }));
}

function toMessageInputs(messages: AiMessage[]): AiMessageInput[] {
  return messages.map((m): AiMessageInput => {
    if (m.role === "user") return { role: "user", text: m.text ?? "" };
    if (m.role === "tool-result") {
      let output: ExecOutput;
      if (m.ranInTerminal) {
        output = {
          stdout:
            "(Sent to the user's live terminal session to run interactively - output isn't captured here. Ask the user what happened if you need to know.)",
          stderr: "",
          exit_status: null,
          truncated: false,
        };
      } else if (m.skipped) {
        output = {
          stdout: "(The user chose not to run this command.)",
          stderr: "",
          exit_status: null,
          truncated: false,
        };
      } else {
        output = m.execOutput ?? { stdout: "", stderr: "", exit_status: null, truncated: false };
      }
      return { role: "tool_result", command: m.toolCall?.command ?? "", output };
    }
    return { role: "assistant", text: m.text ?? null, tool_call: m.toolCall ?? null };
  });
}

// True while the conversation ends on an assistant-proposed command that
// hasn't been resolved yet (no Run/Run-anyway/Skip decision made - see
// runCommand/skipCommand, which always append a tool-result immediately
// after resolving one). Sending a new user message while this is true would
// leave that tool_calls entry dangling in history with nothing responding
// to it, which every provider's API rejects on the very next turn - see
// sendUserMessage's guard and AiChatPanel's use of this to disable input.
export function hasPendingToolCall(messages: AiMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last?.role === "assistant" && !!last.toolCall;
}

// Sends the conversation-so-far to the provider and appends whatever it
// comes back with - shared by sendUserMessage (the first turn after a new
// user message) and runCommand's autonomous continuation (every turn
// after a tool result lands). Manual "ask" mode always stops once a tool
// call is proposed, waiting for an explicit Run click; autonomous mode
// runs it immediately unless it needs confirmation, which always pauses
// regardless of mode - see AiMessage.needsConfirmation.
async function requestNextTurn(host: Host, provider: AiProvider) {
  const hostId = host.id;

  let result;
  try {
    const messages = useAiStore.getState().getConversation(hostId).messages;
    result = await aiChatSend(provider, toMessageInputs(messages));
  } catch (e) {
    update(hostId, (c) => ({ ...c, running: false, error: String(e) }));
    return;
  }

  const assistantMessage: AiMessage =
    result.type === "text"
      ? { id: crypto.randomUUID(), role: "assistant", text: result.text }
      : {
          id: crypto.randomUUID(),
          role: "assistant",
          toolCall: { command: result.command, purpose: result.purpose },
        };
  update(hostId, (c) => ({ ...c, messages: [...c.messages, assistantMessage] }));

  if (result.type === "text") {
    update(hostId, (c) => ({ ...c, running: false }));
    return;
  }

  const afterAppend = useAiStore.getState().getConversation(hostId);
  if (afterAppend.mode === "autonomous" && !afterAppend.stopRequested) {
    await useAiStore.getState().runCommand(host, assistantMessage.id);
  } else {
    update(hostId, (c) => ({ ...c, running: false }));
  }
}

export const useAiStore = create<AiState>((set, get) => ({
  conversations: {},

  getConversation: (hostId) => get().conversations[hostId] ?? EMPTY_CONVERSATION,

  setMode: (hostId, mode) => update(hostId, (c) => ({ ...c, mode })),

  stop: (hostId) => update(hostId, (c) => ({ ...c, stopRequested: true })),

  clearConversation: (hostId) => {
    set((s) => {
      const next = { ...s.conversations };
      delete next[hostId];
      return { conversations: next };
    });
  },

  skipCommand: (hostId, messageId) => {
    update(hostId, (c) => {
      const message = c.messages.find((m) => m.id === messageId);
      if (!message?.toolCall) return c;
      return {
        ...c,
        messages: [
          ...c.messages.map((m) => (m.id === messageId ? { ...m, needsConfirmation: undefined } : m)),
          { id: crypto.randomUUID(), role: "tool-result", toolCall: message.toolCall, skipped: true },
        ],
      };
    });
  },

  sendUserMessage: async (host, provider, text) => {
    const hostId = host.id;
    const convo = get().getConversation(hostId);
    if (convo.running || hasPendingToolCall(convo.messages)) return;
    update(hostId, (c) => ({
      ...c,
      provider,
      messages: [...c.messages, { id: crypto.randomUUID(), role: "user", text }],
      running: true,
      stopRequested: false,
      error: null,
    }));
    await requestNextTurn(host, provider);
  },

  runCommand: async (host, messageId, overrideDenylist = false) => {
    const hostId = host.id;
    const convo = get().getConversation(hostId);
    // Re-entrancy guard: without this, two overlapping invocations (e.g. a
    // double-fired click) can each append their own tool-result for the
    // same command, leaving two consecutive tool messages in history with
    // only one preceding tool_calls - providers reject that on every
    // subsequent turn, permanently stuck until the conversation is cleared.
    if (convo.running) return;
    const message = convo.messages.find((m) => m.id === messageId);
    const provider = convo.provider;
    if (!message?.toolCall || !provider) return;

    update(hostId, (c) => ({ ...c, running: true, error: null }));

    // If a terminal session for this host is already open, run the command
    // there instead of the one-off exec channel below - same reasoning as
    // Quick Commands (HostContextPanel.tsx): the user is already looking at
    // that session, so running it where they can see and interact with it
    // beats a separate result box, and matches what they're used to from
    // Quick Commands. The denylist is still enforced first via
    // ai_command_check - the same Rust-side check ai_command_exec makes -
    // only the execution/output-capture mechanism differs; there's no
    // stdout/stderr to capture from a session write, so this always stops
    // afterward rather than treating it as a completed turn - an
    // autonomous run pauses here just like a fresh needs_confirmation would,
    // waiting for the user to relay back what happened if they want to
    // continue (see AiMessage.ranInTerminal).
    const { openSessions, sessionIds } = useSessionsStore.getState();
    const liveSessionId = findLiveSessionId(openSessions, sessionIds, hostId);

    if (liveSessionId) {
      if (!overrideDenylist) {
        let pattern: string | null;
        try {
          pattern = await aiCommandCheck(message.toolCall.command);
        } catch (e) {
          update(hostId, (c) => ({ ...c, running: false, error: String(e) }));
          return;
        }
        if (pattern) {
          update(hostId, (c) => ({
            ...c,
            running: false,
            messages: c.messages.map((m) =>
              m.id === messageId ? { ...m, needsConfirmation: { pattern } } : m,
            ),
          }));
          return;
        }
      }

      try {
        await sessionWrite(liveSessionId, `${message.toolCall.command}\r`);
      } catch (e) {
        update(hostId, (c) => ({ ...c, running: false, error: String(e) }));
        return;
      }

      const toolCall = message.toolCall;
      update(hostId, (c) => ({
        ...c,
        running: false,
        messages: [
          ...c.messages,
          { id: crypto.randomUUID(), role: "tool-result", toolCall, ranInTerminal: true },
        ],
      }));
      return;
    }

    const gate = await useVpnStore.getState().ensureVpnUp(host);
    if (!gate.ok) {
      update(hostId, (c) => ({ ...c, running: false, error: gate.message ?? "Could not connect the VPN." }));
      return;
    }

    let result: AiCommandExecResult;
    try {
      result = await aiCommandExec(host.id, message.toolCall.command, overrideDenylist);
    } catch (e) {
      update(hostId, (c) => ({ ...c, running: false, error: String(e) }));
      return;
    }

    if (result.type === "needs_confirmation") {
      update(hostId, (c) => ({
        ...c,
        running: false,
        messages: c.messages.map((m) =>
          m.id === messageId ? { ...m, needsConfirmation: { pattern: result.pattern } } : m,
        ),
      }));
      return;
    }

    const toolCall = message.toolCall;
    update(hostId, (c) => ({
      ...c,
      messages: [...c.messages, { id: crypto.randomUUID(), role: "tool-result", toolCall, execOutput: result.output }],
    }));

    const afterResult = get().getConversation(hostId);
    if (
      afterResult.mode === "autonomous" &&
      !afterResult.stopRequested &&
      afterResult.iterationCount < MAX_AUTONOMOUS_ITERATIONS
    ) {
      update(hostId, (c) => ({ ...c, iterationCount: c.iterationCount + 1 }));
      await requestNextTurn(host, provider);
    } else {
      update(hostId, (c) => ({ ...c, running: false }));
    }
  },

  proposeAndRun: async (host, command, purpose) => {
    const hostId = host.id;
    const convo = get().getConversation(hostId);
    // Same guard sendUserMessage uses - appending another proposal on top of
    // one that's already running or unresolved would violate the "exactly
    // one pending tool_call, always immediately resolved" invariant (see
    // hasPendingToolCall).
    if (convo.running || hasPendingToolCall(convo.messages) || !convo.provider) return;
    const messageId = crypto.randomUUID();
    update(hostId, (c) => ({
      ...c,
      messages: [...c.messages, { id: messageId, role: "assistant", toolCall: { command, purpose } }],
    }));
    await get().runCommand(host, messageId);
  },
}));
