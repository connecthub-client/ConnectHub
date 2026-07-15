import { FormEvent, useState } from "react";
import { Group } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { errorClass, inputClass, labelClass, primaryButtonClass, selectClass } from "./formStyles";

interface GroupFormProps {
  group?: Group;
  defaultParentId?: string | null;
  onDone: () => void;
}

export default function GroupForm({ group, defaultParentId, onDone }: GroupFormProps) {
  const groups = useHostsStore((s) => s.groups);
  const createGroup = useHostsStore((s) => s.createGroup);
  const updateGroup = useHostsStore((s) => s.updateGroup);

  const [name, setName] = useState(group?.name ?? "");
  const [parentId, setParentId] = useState(group?.parent_id ?? defaultParentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const input = { name, parent_id: parentId || null, sort_order: group?.sort_order ?? 0 };
      if (group) {
        await updateGroup(group.id, input);
      } else {
        await createGroup(input);
      }
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label className={labelClass}>Name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        className={inputClass}
        required
      />

      <label className={labelClass}>Parent group</label>
      <select
        value={parentId}
        onChange={(e) => setParentId(e.currentTarget.value)}
        className={selectClass}
      >
        <option value="">(none - top level)</option>
        {groups
          .filter((g) => g.id !== group?.id)
          .map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
      </select>

      {error && <p className={errorClass}>{error}</p>}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? "Saving…" : group ? "Save changes" : "Create group"}
      </button>
    </form>
  );
}
