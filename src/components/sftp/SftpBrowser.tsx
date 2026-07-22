import { useCallback, useEffect, useRef, useState } from "react";
import {
  Host,
  localDelete,
  localHomeDir,
  localList,
  localMkdir,
  localRename,
  sftpCanonicalize,
  sftpConnect,
  sftpDisconnect,
  sftpDownload,
  sftpList,
  sftpMkdir,
  sftpRemoveDir,
  sftpRemoveFile,
  sftpRename,
  sftpUpload,
} from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useConfirm } from "../common/useConfirm";
import { usePrompt } from "../common/usePrompt";
import { friendlyError } from "../../lib/friendlyError";

interface SftpBrowserProps {
  host: Host;
  onClose: () => void;
}

interface BrowserEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number | null;
}

function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx);
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatModified(seconds: number | null): string {
  if (seconds === null) return "";
  return new Date(seconds * 1000).toLocaleString();
}

interface FilePaneProps {
  title: string;
  path: string;
  entries: BrowserEntry[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  onSelect: (path: string) => void;
  onNavigate: (path: string) => void;
  onNewFolder: () => void;
  onDelete: (entry: BrowserEntry) => void;
  onRename: (entry: BrowserEntry) => void;
  onRefresh: () => void;
}

function FilePane({
  title,
  path,
  entries,
  loading,
  error,
  selected,
  onSelect,
  onNavigate,
  onNewFolder,
  onDelete,
  onRename,
  onRefresh,
}: FilePaneProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col border-slate-200 dark:border-slate-800">
      <div className="border-b border-slate-200 p-2 dark:border-slate-800">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase text-slate-500">{title}</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onNavigate(parentPath(path))}
              className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Up one level"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={onRefresh}
              className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Refresh"
            >
              ⟳
            </button>
            <button
              type="button"
              onClick={onNewFolder}
              className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="New folder"
            >
              +folder
            </button>
          </div>
        </div>
        <input
          value={path}
          readOnly
          className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-3 text-sm text-slate-400">Loading…</p>}
        {error && <p className="p-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!loading &&
          !error &&
          entries.map((entry) => (
            <div
              key={entry.path}
              onClick={() => onSelect(entry.path)}
              onDoubleClick={() => entry.isDir && onNavigate(entry.path)}
              className={`group flex cursor-pointer items-center justify-between px-3 py-1.5 text-sm ${
                selected === entry.path
                  ? "bg-teal-50 dark:bg-teal-950"
                  : "hover:bg-slate-50 dark:hover:bg-slate-900"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span>{entry.isDir ? "📁" : "📄"}</span>
                <span className="truncate text-slate-800 dark:text-slate-200">
                  {entry.name}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-slate-400">
                  {entry.isDir ? "" : formatSize(entry.size)}
                </span>
                <span className="hidden text-xs text-slate-400 group-hover:inline">
                  {formatModified(entry.modified)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(entry);
                  }}
                  className="hidden text-xs text-slate-500 hover:text-teal-600 group-hover:inline"
                >
                  rename
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(entry);
                  }}
                  className="hidden text-xs text-slate-500 hover:text-red-600 group-hover:inline"
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        {!loading && !error && entries.length === 0 && (
          <p className="p-3 text-sm text-slate-400">Empty directory</p>
        )}
      </div>
    </div>
  );
}

export default function SftpBrowser({ host, onClose }: SftpBrowserProps) {
  const sftpIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);

  const [localPath, setLocalPath] = useState("");
  const [localEntries, setLocalEntries] = useState<BrowserEntry[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null);

  const [remotePath, setRemotePath] = useState("");
  const [remoteEntries, setRemoteEntries] = useState<BrowserEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [selectedRemote, setSelectedRemote] = useState<string | null>(null);

  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  // Name of the file currently mid-transfer, and which direction - the
  // backend doesn't report byte-level progress (sftpUpload/sftpDownload
  // resolve only once the whole file has moved), so this is an
  // indeterminate "something is happening, to this file" indicator rather
  // than a real percentage.
  const [transferringEntry, setTransferringEntry] = useState<{ name: string; direction: "upload" | "download" } | null>(
    null,
  );

  const { confirm, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();

  const refreshLocal = useCallback((path: string) => {
    setLocalLoading(true);
    setLocalError(null);
    localList(path)
      .then((entries) =>
        setLocalEntries(
          entries.map((e) => ({
            name: e.name,
            path: e.path,
            isDir: e.is_dir,
            size: e.size,
            modified: e.modified,
          })),
        ),
      )
      .catch((e) => setLocalError(String(e)))
      .finally(() => setLocalLoading(false));
  }, []);

  const refreshRemote = useCallback((path: string) => {
    if (!sftpIdRef.current) return;
    setRemoteLoading(true);
    setRemoteError(null);
    sftpList(sftpIdRef.current, path)
      .then((entries) =>
        setRemoteEntries(
          entries.map((e) => ({
            name: e.name,
            path: e.path,
            isDir: e.is_dir,
            size: e.size,
            modified: e.modified,
          })),
        ),
      )
      .catch((e) => setRemoteError(String(e)))
      .finally(() => setRemoteLoading(false));
  }, []);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const [id, home] = await Promise.all([sftpConnect(host.id), localHomeDir()]);
        if (disposed) {
          sftpDisconnect(id);
          return;
        }
        sftpIdRef.current = id;
        setLocalPath(home);
        const remoteHome = await sftpCanonicalize(id, ".");
        if (disposed) return;
        setRemotePath(remoteHome);
        setStatus("connected");
        useHostsStore.getState().loadAll();
      } catch (e) {
        if (!disposed) {
          setStatus("error");
          setError(friendlyError(e));
        }
      }
    })();

    return () => {
      disposed = true;
      if (sftpIdRef.current) sftpDisconnect(sftpIdRef.current);
    };
  }, [host.id]);

  useEffect(() => {
    if (localPath) refreshLocal(localPath);
  }, [localPath, refreshLocal]);

  useEffect(() => {
    if (remotePath && status === "connected") refreshRemote(remotePath);
  }, [remotePath, status, refreshRemote]);

  async function handleUpload() {
    if (!selectedLocal || !sftpIdRef.current) return;
    const entry = localEntries.find((e) => e.path === selectedLocal);
    if (!entry || entry.isDir) return;
    setTransferring(true);
    setTransferringEntry({ name: entry.name, direction: "upload" });
    setTransferError(null);
    try {
      await sftpUpload(sftpIdRef.current, entry.path, joinPath(remotePath, entry.name));
      refreshRemote(remotePath);
    } catch (e) {
      setTransferError(String(e));
    } finally {
      setTransferring(false);
      setTransferringEntry(null);
    }
  }

  async function handleDownload() {
    if (!selectedRemote || !sftpIdRef.current) return;
    const entry = remoteEntries.find((e) => e.path === selectedRemote);
    if (!entry || entry.isDir) return;
    setTransferring(true);
    setTransferringEntry({ name: entry.name, direction: "download" });
    setTransferError(null);
    try {
      await sftpDownload(sftpIdRef.current, entry.path, joinPath(localPath, entry.name));
      refreshLocal(localPath);
    } catch (e) {
      setTransferError(String(e));
    } finally {
      setTransferring(false);
      setTransferringEntry(null);
    }
  }

  async function handleLocalNewFolder() {
    const name = await prompt("New folder name:");
    if (!name) return;
    localMkdir(joinPath(localPath, name))
      .then(() => refreshLocal(localPath))
      .catch((e) => setLocalError(String(e)));
  }

  async function handleRemoteNewFolder() {
    if (!sftpIdRef.current) return;
    const name = await prompt("New folder name:");
    if (!name) return;
    sftpMkdir(sftpIdRef.current, joinPath(remotePath, name))
      .then(() => refreshRemote(remotePath))
      .catch((e) => setRemoteError(String(e)));
  }

  async function handleLocalRename(entry: BrowserEntry) {
    const name = await prompt("Rename to:", entry.name);
    if (!name || name === entry.name) return;
    localRename(entry.path, joinPath(localPath, name))
      .then(() => refreshLocal(localPath))
      .catch((e) => setLocalError(String(e)));
  }

  async function handleRemoteRename(entry: BrowserEntry) {
    if (!sftpIdRef.current) return;
    const name = await prompt("Rename to:", entry.name);
    if (!name || name === entry.name) return;
    sftpRename(sftpIdRef.current, entry.path, joinPath(remotePath, name))
      .then(() => refreshRemote(remotePath))
      .catch((e) => setRemoteError(String(e)));
  }

  async function handleLocalDelete(entry: BrowserEntry) {
    const ok = await confirm(`Delete ${entry.isDir ? "folder" : "file"} "${entry.name}"?`, { danger: true });
    if (!ok) return;
    localDelete(entry.path, entry.isDir)
      .then(() => refreshLocal(localPath))
      .catch((e) => setLocalError(String(e)));
  }

  async function handleRemoteDelete(entry: BrowserEntry) {
    if (!sftpIdRef.current) return;
    const ok = await confirm(`Delete ${entry.isDir ? "folder" : "file"} "${entry.name}"?`, { danger: true });
    if (!ok) return;
    const op = entry.isDir ? sftpRemoveDir : sftpRemoveFile;
    op(sftpIdRef.current, entry.path)
      .then(() => refreshRemote(remotePath))
      .catch((e) => setRemoteError(String(e)));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`h-2 w-2 rounded-full ${
              status === "connected"
                ? "bg-emerald-500"
                : status === "connecting"
                  ? "bg-amber-500"
                  : "bg-red-500"
            }`}
          />
          <span className="font-medium text-slate-900 dark:text-slate-100">
            SFTP — {host.label}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
        >
          Close
        </button>
      </div>

      {error && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}
      {transferError && (
        <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {transferError}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <FilePane
          title="Local"
          path={localPath}
          entries={localEntries}
          loading={localLoading}
          error={localError}
          selected={selectedLocal}
          onSelect={setSelectedLocal}
          onNavigate={setLocalPath}
          onNewFolder={handleLocalNewFolder}
          onDelete={handleLocalDelete}
          onRename={handleLocalRename}
          onRefresh={() => refreshLocal(localPath)}
        />

        <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-2 border-x border-slate-200 dark:border-slate-800">
          <button
            type="button"
            disabled={!selectedLocal || transferring}
            onClick={handleUpload}
            title="Upload to remote"
            className="rounded-lg bg-teal-600 shadow-sm px-2 py-1 text-xs font-medium text-white disabled:opacity-30"
          >
            Upload →
          </button>
          <button
            type="button"
            disabled={!selectedRemote || transferring}
            onClick={handleDownload}
            title="Download to local"
            className="rounded-lg bg-teal-600 shadow-sm px-2 py-1 text-xs font-medium text-white disabled:opacity-30"
          >
            ← Download
          </button>
          {transferringEntry && (
            <div className="mt-1 w-full px-1 text-center" title={transferringEntry.name}>
              <div className="h-1 w-full animate-pulse rounded-full bg-teal-500" />
              <p className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">
                {transferringEntry.direction === "upload" ? "↑" : "↓"} {transferringEntry.name}
              </p>
            </div>
          )}
        </div>

        <FilePane
          title="Remote"
          path={remotePath}
          entries={remoteEntries}
          loading={remoteLoading}
          error={remoteError}
          selected={selectedRemote}
          onSelect={setSelectedRemote}
          onNavigate={setRemotePath}
          onNewFolder={handleRemoteNewFolder}
          onDelete={handleRemoteDelete}
          onRename={handleRemoteRename}
          onRefresh={() => refreshRemote(remotePath)}
        />
      </div>
      {confirmDialog}
      {promptDialog}
    </div>
  );
}
