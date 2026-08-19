import { useState } from "react";
import { copyCommandText, pasteCommandToTerminal } from "../../lib/aiCommandActions";

interface AiCodeBlockProps {
  content: string;
  language?: string;
  // The host's live terminal session, if one is open - "Paste in server" is
  // disabled without one, since there's no equivalent of "insert without
  // running" for a one-off exec connection.
  liveSessionId?: string;
  running: boolean;
  onRun: () => void;
}

// A ```lang ... ``` block found in the AI's plain-text reply (see
// lib/codeBlocks.ts), given the same three actions ChatGPT-style code
// blocks get elsewhere, adapted for a feature that can actually reach a
// server: Copy / Copy-and-paste-in-server / Run.
export default function AiCodeBlock({ content, language, liveSessionId, running, onRun }: AiCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyCommandText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-xs dark:border-slate-700 dark:bg-slate-900">
      {language && (
        <div className="border-b border-slate-200 px-2 py-1 text-[10px] tracking-wide text-slate-400 uppercase dark:border-slate-700">
          {language}
        </div>
      )}
      <pre className="overflow-x-auto px-2 py-1.5 font-mono text-slate-800 dark:text-slate-200">{content}</pre>
      <div className="flex gap-1 border-t border-slate-200 p-1 dark:border-slate-700">
        <button
          type="button"
          onClick={handleCopy}
          className="flex-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={() => liveSessionId && pasteCommandToTerminal(liveSessionId, content)}
          disabled={!liveSessionId}
          title={liveSessionId ? undefined : "Open a terminal session for this host first"}
          className="flex-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Paste in server
        </button>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="flex-1 rounded-md bg-teal-600 px-2 py-1 font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {running ? "Running…" : "Run"}
        </button>
      </div>
    </div>
  );
}
