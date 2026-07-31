import { Group, Host, Identity, VpnProfile } from "../../lib/tauri-bridge";
import GroupForm from "../forms/GroupForm";
import HostForm from "../forms/HostForm";
import IdentityForm from "../forms/IdentityForm";
import KeyForm from "../forms/KeyForm";
import VpnProfileForm from "../forms/VpnProfileForm";

export type InlineFormModalState =
  | { kind: "group"; group?: Group; parentId?: string | null }
  | { kind: "host"; host?: Host; groupId?: string | null }
  | { kind: "identity"; identity?: Identity }
  | { kind: "key" }
  | { kind: "vpn-profile"; profile?: VpnProfile };

const INLINE_FORM_KINDS: ReadonlySet<string> = new Set(["group", "host", "identity", "key", "vpn-profile"]);

// Narrows any modal-like state (AppShell.tsx's ModalState also includes
// "snippet"/"run-snippet", which stay as actual Modal popups, not this
// panel) down to the five kinds this component handles.
export function isInlineFormModal(modal: { kind: string } | null): modal is InlineFormModalState {
  return modal !== null && INLINE_FORM_KINDS.has(modal.kind);
}

function titleFor(modal: InlineFormModalState): string {
  switch (modal.kind) {
    case "group":
      return modal.group ? "Edit group" : "New group";
    case "host":
      return modal.host ? "Edit host" : "New host";
    case "identity":
      return modal.identity ? "Edit identity" : "New identity";
    case "key":
      return "New SSH key";
    case "vpn-profile":
      return modal.profile ? "Edit VPN profile" : "New VPN profile";
  }
}

interface InlineFormPanelProps {
  modal: InlineFormModalState;
  onDone: () => void;
  onSaveAndConnectHost?: (host: Host) => void;
}

// Add/Edit forms for Host/Group/Identity/Key/VpnProfile render inline in
// the right panel here instead of in a popup Modal - the right panel's own
// slot already gives each of its contents (HostContextPanel, SnippetsDrawer)
// responsibility for its own scrolling, so this follows the same pattern
// rather than needing Modal.tsx's backdrop-scroll trick for a tall form.
// Snippet/RunSnippet forms are NOT part of this - they stay as actual
// Modal popups (AppShell.tsx still renders those separately).
export default function InlineFormPanel({ modal, onDone, onSaveAndConnectHost }: InlineFormPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">{titleFor(modal)}</h2>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {modal.kind === "group" && (
          <GroupForm group={modal.group} defaultParentId={modal.parentId} onDone={onDone} />
        )}
        {modal.kind === "host" && (
          <HostForm
            host={modal.host}
            defaultGroupId={modal.groupId}
            onDone={onDone}
            onSaveAndConnect={onSaveAndConnectHost}
          />
        )}
        {modal.kind === "identity" && <IdentityForm identity={modal.identity} onDone={onDone} />}
        {modal.kind === "key" && <KeyForm onDone={onDone} />}
        {modal.kind === "vpn-profile" && <VpnProfileForm profile={modal.profile} onDone={onDone} />}
      </div>
    </div>
  );
}
