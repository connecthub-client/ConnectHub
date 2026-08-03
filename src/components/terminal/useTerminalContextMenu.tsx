import { useEffect, useRef, useState } from "react";

interface TerminalContextMenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

// Right-click Copy/Paste menu for the terminal - mirrors
// useHostContextMenu.tsx's shape (outside-click/contextmenu/Escape closing,
// same fixed-position styling) rather than the classic X11/PuTTY
// instant-paste-on-right-click convention: an accidental right-click here
// would otherwise silently paste into a live remote shell, and every other
// right-click surface in this app already uses this menu pattern.
export function useTerminalContextMenu(opts: { onCopy: () => void; onPaste: () => void }) {
  const [contextMenu, setContextMenu] = useState<TerminalContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  function openContextMenu(e: React.MouseEvent, hasSelection: boolean) {
    e.preventDefault();
    // Without this, the same native contextmenu event keeps bubbling to the
    // window-level listener the effect above just attached, closing the
    // menu the instant it opens - see CLAUDE.md/HostTree.tsx's note on this
    // exact gotcha.
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, hasSelection });
  }

  const menu = contextMenu && (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 w-32 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800"
      style={{ top: contextMenu.y, left: contextMenu.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={!contextMenu.hasSelection}
        onClick={() => {
          opts.onCopy();
          setContextMenu(null);
        }}
        className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-slate-700 dark:disabled:text-slate-600"
      >
        Copy
      </button>
      <button
        type="button"
        onClick={() => {
          opts.onPaste();
          setContextMenu(null);
        }}
        className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        Paste
      </button>
    </div>
  );

  return { openContextMenu, menu };
}
