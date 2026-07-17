import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import HostTree from "../components/sidebar/HostTree";
import Modal from "../components/common/Modal";
import GroupForm from "../components/forms/GroupForm";
import HostForm from "../components/forms/HostForm";
import IdentityForm from "../components/forms/IdentityForm";
import KeyForm from "../components/forms/KeyForm";
import HostContextPanel from "../components/panels/HostContextPanel";
import IdentitiesPanel from "../components/panels/IdentitiesPanel";
import KeysPanel from "../components/panels/KeysPanel";
import TunnelsPanel from "../components/panels/TunnelsPanel";
import TunnelForm from "../components/forms/TunnelForm";
import SnippetsPanel from "../components/panels/SnippetsPanel";
import SnippetForm from "../components/forms/SnippetForm";
import RunSnippetForm from "../components/forms/RunSnippetForm";
import SettingsPanel from "../components/panels/SettingsPanel";
import TerminalView from "../components/terminal/TerminalView";
import SftpBrowser from "../components/sftp/SftpBrowser";
import { Group, Host, Identity, ImportSummary, localReadTextFile, localWriteTextFile, Snippet } from "../lib/tauri-bridge";
import { useHostsStore } from "../state/hostsStore";
import { useSessionsStore } from "../state/sessionsStore";

type ManageTab = "hosts" | "identities" | "keys" | "tunnels" | "snippets" | "settings";
type MainView = { type: "manage"; tab: ManageTab } | { type: "session"; tabId: string };

type ModalState =
  | { kind: "group"; group?: Group; parentId?: string | null }
  | { kind: "host"; host?: Host; groupId?: string | null }
  | { kind: "identity"; identity?: Identity }
  | { kind: "key" }
  | { kind: "tunnel"; defaultHostId?: string }
  | { kind: "snippet"; snippet?: Snippet }
  | { kind: "run-snippet"; snippet: Snippet }
  | null;

export default function AppShell() {
  const loadAll = useHostsStore((s) => s.loadAll);
  const loaded = useHostsStore((s) => s.loaded);
  const hosts = useHostsStore((s) => s.hosts);
  const exportHostsCsv = useHostsStore((s) => s.exportHostsCsv);
  const importHostsCsv = useHostsStore((s) => s.importHostsCsv);

  const openSessions = useSessionsStore((s) => s.openSessions);
  const openSession = useSessionsStore((s) => s.openSession);
  const closeSession = useSessionsStore((s) => s.closeSession);

  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<MainView>({ type: "manage", tab: "hosts" });
  const [modal, setModal] = useState<ModalState>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  useEffect(() => {
    loadAll().catch((e) => setLoadError(String(e)));
  }, [loadAll]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key.toLowerCase() === "w") {
        if (mainView.type === "session") {
          e.preventDefault();
          handleCloseTab(mainView.tabId);
        }
        return;
      }

      if (e.key === "Tab" && openSessions.length > 0) {
        e.preventDefault();
        const currentIndex =
          mainView.type === "session" ? openSessions.findIndex((s) => s.tabId === mainView.tabId) : -1;
        const delta = e.shiftKey ? -1 : 1;
        const nextIndex = (currentIndex + delta + openSessions.length) % openSessions.length;
        setMainView({ type: "session", tabId: openSessions[nextIndex].tabId });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainView, openSessions]);

  const selectedHost = hosts.find((h) => h.id === selectedHostId) ?? null;

  const activeSession =
    mainView.type === "session" ? openSessions.find((s) => s.tabId === mainView.tabId) : undefined;
  // Look up the live host record rather than using the session's snapshot
  // (taken once, at connect time) so fields like last_connected_at stay
  // current after the connection completes.
  const contextHost =
    mainView.type === "session"
      ? (hosts.find((h) => h.id === activeSession?.host.id) ?? activeSession?.host ?? null)
      : mainView.type === "manage" && mainView.tab === "hosts"
        ? selectedHost
        : null;
  const contextHostSessionOpen = contextHost
    ? openSessions.some((s) => s.host.id === contextHost.id)
    : false;

  function handleConnect(host: Host) {
    const tabId = openSession(host, "terminal");
    setMainView({ type: "session", tabId });
  }

  function handleOpenSftp(host: Host) {
    const tabId = openSession(host, "sftp");
    setMainView({ type: "session", tabId });
  }

  function handleCloseTab(tabId: string) {
    const remaining = openSessions.filter((s) => s.tabId !== tabId);
    closeSession(tabId);
    if (mainView.type === "session" && mainView.tabId === tabId) {
      const fallback = remaining[remaining.length - 1];
      setMainView(fallback ? { type: "session", tabId: fallback.tabId } : { type: "manage", tab: "hosts" });
    }
  }

  async function handleExportCsv() {
    setCsvError(null);
    try {
      const csv = await exportHostsCsv();
      const path = await save({
        title: "Export hosts to CSV",
        defaultPath: "termora-hosts.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await localWriteTextFile(path, csv);
    } catch (e) {
      setCsvError(String(e));
    }
  }

  async function handleImportCsv() {
    setCsvError(null);
    try {
      const path = await open({
        title: "Import hosts from CSV",
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path || Array.isArray(path)) return;
      const content = await localReadTextFile(path);
      const summary = await importHostsCsv(content);
      setImportResult(summary);
    } catch (e) {
      setCsvError(String(e));
    }
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        <p className="text-red-600 dark:text-red-400">{loadError}</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-neutral-50 dark:bg-neutral-900">
      <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex gap-2 border-b border-neutral-200 p-2 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setModal({ kind: "host" })}
            className="flex-1 rounded-md bg-teal-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-teal-700"
          >
            + Host
          </button>
          <button
            type="button"
            onClick={() => setModal({ kind: "group" })}
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            + Group
          </button>
        </div>
        <div className="flex gap-2 border-b border-neutral-200 p-2 dark:border-neutral-800">
          <button
            type="button"
            onClick={handleExportCsv}
            title="Export all hosts to a CSV file"
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleImportCsv}
            title="Import hosts from a CSV file"
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Import CSV
          </button>
        </div>
        {csvError && (
          <p className="border-b border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {csvError}
          </p>
        )}
        <div className="flex-1 overflow-y-auto p-2">
          <HostTree
            selectedHostId={selectedHostId}
            onSelectHost={(host) => {
              setSelectedHostId(host.id);
              setMainView({ type: "manage", tab: "hosts" });
            }}
            onConnectHost={(host) => {
              setSelectedHostId(host.id);
              handleConnect(host);
            }}
            onEditGroup={(group) => setModal({ kind: "group", group })}
            onEditHost={(host) => setModal({ kind: "host", host })}
            onNewHost={(groupId) => setModal({ kind: "host", groupId })}
            onNewSubgroup={(parentId) => setModal({ kind: "group", parentId })}
          />
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-neutral-200 p-2 dark:border-neutral-800">
          {(["hosts", "identities", "keys", "tunnels", "snippets", "settings"] as ManageTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setMainView({ type: "manage", tab: t })}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium capitalize ${
                mainView.type === "manage" && mainView.tab === t
                  ? "bg-teal-600 text-white"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        {openSessions.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-neutral-200 bg-neutral-100 p-2 dark:border-neutral-800 dark:bg-neutral-950">
            {openSessions.map((s) => {
              const active = mainView.type === "session" && mainView.tabId === s.tabId;
              return (
                <div
                  key={s.tabId}
                  className={`group flex shrink-0 items-center gap-2 rounded-t-md border-b-2 px-3 py-1.5 text-sm ${
                    active
                      ? "border-teal-500 bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50"
                      : "border-transparent text-neutral-500 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-900/60"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setMainView({ type: "session", tabId: s.tabId })}
                    className="flex max-w-48 items-center gap-1.5 truncate"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-emerald-500" : "bg-neutral-400 dark:bg-neutral-600"}`}
                    />
                    {s.kind === "sftp" ? "📁 " : ""}
                    {s.host.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCloseTab(s.tabId)}
                    className="text-xs text-neutral-400 opacity-0 hover:text-neutral-700 group-hover:opacity-100 dark:hover:text-neutral-200"
                    title="Close session"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="relative flex-1 overflow-hidden">
          <div
            className={`absolute inset-0 overflow-y-auto p-6 ${
              mainView.type === "manage" ? "visible" : "invisible"
            }`}
          >
            {mainView.type === "manage" && mainView.tab === "hosts" && (
              selectedHost ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <p className="text-lg font-medium text-neutral-700 dark:text-neutral-300">
                    {selectedHost.label}
                  </p>
                  <p className="mt-1 text-sm text-neutral-400">
                    Use the panel on the right to connect, browse files, or run a quick command.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-neutral-400">
                  Select a host from the sidebar, or create a new one.
                </p>
              )
            )}
            {mainView.type === "manage" && mainView.tab === "identities" && (
              <IdentitiesPanel
                onNew={() => setModal({ kind: "identity" })}
                onEdit={(identity) => setModal({ kind: "identity", identity })}
              />
            )}
            {mainView.type === "manage" && mainView.tab === "keys" && (
              <KeysPanel onNew={() => setModal({ kind: "key" })} />
            )}
            {mainView.type === "manage" && mainView.tab === "tunnels" && (
              <TunnelsPanel onNew={() => setModal({ kind: "tunnel" })} />
            )}
            {mainView.type === "manage" && mainView.tab === "snippets" && (
              <SnippetsPanel
                onNew={() => setModal({ kind: "snippet" })}
                onEdit={(snippet) => setModal({ kind: "snippet", snippet })}
                onRun={(snippet) => setModal({ kind: "run-snippet", snippet })}
              />
            )}
            {mainView.type === "manage" && mainView.tab === "settings" && <SettingsPanel />}
          </div>

          {/* Every open session stays mounted so its SSH connection and
              scrollback survive switching tabs. Uses visibility rather than
              display:none - xterm.js's renderer stops painting rows (and can
              drop the most recent one) when its container collapses to a
              display:none 0x0 box; visibility:hidden keeps the layout box
              (and painting) alive so nothing is lost when switching back. */}
          {openSessions.map((s) => (
            <div
              key={s.tabId}
              className={`absolute inset-0 ${
                mainView.type === "session" && mainView.tabId === s.tabId ? "visible" : "invisible"
              }`}
            >
              {s.kind === "terminal" ? (
                <TerminalView host={s.host} onClose={() => handleCloseTab(s.tabId)} />
              ) : (
                <SftpBrowser host={s.host} onClose={() => handleCloseTab(s.tabId)} />
              )}
            </div>
          ))}
        </div>
      </main>

      {contextHost && (
        <HostContextPanel
          host={contextHost}
          sessionOpen={contextHostSessionOpen}
          onEdit={() => setModal({ kind: "host", host: contextHost })}
          onConnect={() => handleConnect(contextHost)}
          onOpenSftp={() => handleOpenSftp(contextHost)}
          onNewTunnel={() => setModal({ kind: "tunnel", defaultHostId: contextHost.id })}
        />
      )}

      {modal?.kind === "group" && (
        <Modal title={modal.group ? "Edit group" : "New group"} onClose={() => setModal(null)}>
          <GroupForm group={modal.group} defaultParentId={modal.parentId} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "host" && (
        <Modal title={modal.host ? "Edit host" : "New host"} onClose={() => setModal(null)}>
          <HostForm host={modal.host} defaultGroupId={modal.groupId} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "identity" && (
        <Modal title={modal.identity ? "Edit identity" : "New identity"} onClose={() => setModal(null)}>
          <IdentityForm identity={modal.identity} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "key" && (
        <Modal title="New SSH key" onClose={() => setModal(null)}>
          <KeyForm onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "tunnel" && (
        <Modal title="New tunnel" onClose={() => setModal(null)}>
          <TunnelForm defaultHostId={modal.defaultHostId} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "snippet" && (
        <Modal title={modal.snippet ? "Edit snippet" : "New snippet"} onClose={() => setModal(null)}>
          <SnippetForm snippet={modal.snippet} onDone={() => setModal(null)} />
        </Modal>
      )}
      {modal?.kind === "run-snippet" && (
        <Modal title={`Run "${modal.snippet.label}"`} onClose={() => setModal(null)}>
          <RunSnippetForm snippet={modal.snippet} onDone={() => setModal(null)} />
        </Modal>
      )}
      {importResult && (
        <Modal title="Import complete" onClose={() => setImportResult(null)}>
          <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
            Imported {importResult.imported} host{importResult.imported === 1 ? "" : "s"}.
          </p>
          {importResult.warnings.length > 0 && (
            <div className="mb-4 max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              {importResult.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setImportResult(null)}
            className="w-full rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            Close
          </button>
        </Modal>
      )}
    </div>
  );
}
