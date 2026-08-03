import { useEffect, useRef, useState } from "react";
import { Host } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useConfirm } from "./useConfirm";

interface ContextMenuState {
  host: Host;
  x: number;
  y: number;
}

// Shared right-click context menu (Connect/Duplicate/Edit/Delete) for a
// host row/card - originally only HostTree.tsx's sidebar rows had this;
// extracted so the center Hosts grid's cards can offer the exact same menu
// rather than a second, independently-maintained copy. None of this logic
// is actually tree-specific - it only needs where to send Connect/Edit and
// the shared hostsStore actions for Duplicate/Delete.
export function useHostContextMenu(onConnectHost: (host: Host) => void, onEditHost: (host: Host) => void) {
  const createHost = useHostsStore((s) => s.createHost);
  const deleteHost = useHostsStore((s) => s.deleteHost);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    // Move focus into the menu so Tab/Shift+Tab and Enter work immediately
    // for keyboard users, without requiring a Tab press first to reach it
    // from wherever focus happened to be.
    menuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const close = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      // Previously closed on ANY keydown, which meant ArrowDown/Enter -
      // the natural way to navigate a menu from the keyboard - dismissed
      // it instead of navigating. Only Escape should close it here; Tab
      // and Enter are left to behave normally on whichever menu button
      // currently has focus.
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

  async function handleDuplicate(host: Host) {
    setContextMenu(null);
    await createHost({
      group_id: host.group_id,
      label: `${host.label} (copy)`,
      hostname: host.hostname,
      port: host.port,
      identity_id: host.identity_id,
      vpn_profile_id: host.vpn_profile_id,
      color: host.color,
      icon: host.icon,
      notes: host.notes,
      sort_order: host.sort_order,
      tag_ids: host.tags.map((t) => t.id),
    });
  }

  // Exported directly (not just used internally by the menu) since
  // HostTree.tsx's own hover-revealed inline "del" quick-action calls this
  // the same way, bypassing the context menu entirely.
  async function handleDeleteHost(host: Host) {
    setContextMenu(null);
    setDeleteError(null);
    if (await confirm(`Delete host "${host.label}"?`, { danger: true })) {
      try {
        await deleteHost(host.id);
      } catch (err) {
        setDeleteError(String(err));
      }
    }
  }

  function openContextMenu(host: Host, e: { clientX: number; clientY: number }) {
    setContextMenu({ host, x: e.clientX, y: e.clientY });
  }

  const menu = contextMenu && (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 w-40 rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800"
      style={{ top: contextMenu.y, left: contextMenu.x }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={!contextMenu.host.identity_id}
        onClick={() => {
          onConnectHost(contextMenu.host);
          setContextMenu(null);
        }}
        className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-slate-700 dark:disabled:text-slate-600"
      >
        Connect
      </button>
      <button
        type="button"
        onClick={() => handleDuplicate(contextMenu.host)}
        className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        Duplicate
      </button>
      <button
        type="button"
        onClick={() => {
          onEditHost(contextMenu.host);
          setContextMenu(null);
        }}
        className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => handleDeleteHost(contextMenu.host)}
        className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        Delete
      </button>
    </div>
  );

  return { openContextMenu, menu, confirmDialog, deleteError, handleDeleteHost };
}
