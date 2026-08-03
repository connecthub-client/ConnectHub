import { KeyboardEvent, useMemo, useState } from "react";
import { useTagsStore } from "../../state/tagsStore";

interface TagInputProps {
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
}

// Chip-style multi-value input for assigning tags to a host - there's no
// existing free-text multi-value widget anywhere else in the codebase
// (RunSnippetForm's checkbox list is a one-off host-picker, not a reusable
// pattern) - so this is new. Typing and pressing Enter/comma either picks a
// matching existing tag or creates a brand-new one via tagsStore's
// get-or-create createTag action.
export default function TagInput({ selectedTagIds, onChange }: TagInputProps) {
  const allTags = useTagsStore((s) => s.tags);
  const createTag = useTagsStore((s) => s.createTag);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => selectedTagIds.map((id) => allTags.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t),
    [selectedTagIds, allTags],
  );

  const query = text.trim().toLowerCase();
  const suggestions = query
    ? allTags.filter((t) => !selectedTagIds.includes(t.id) && t.label.toLowerCase().includes(query)).slice(0, 6)
    : [];

  function addTagId(id: string) {
    if (!selectedTagIds.includes(id)) onChange([...selectedTagIds, id]);
    setText("");
  }

  function removeTagId(id: string) {
    onChange(selectedTagIds.filter((existing) => existing !== id));
  }

  async function commitTypedLabel() {
    const label = text.trim();
    if (!label) return;
    setError(null);
    const existing = allTags.find((t) => t.label.toLowerCase() === label.toLowerCase());
    if (existing) {
      addTagId(existing.id);
      return;
    }
    try {
      const created = await createTag(label);
      addTagId(created.id);
    } catch (err) {
      setError(String(err));
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTypedLabel();
    } else if (e.key === "Backspace" && !text && selected.length > 0) {
      removeTagId(selected[selected.length - 1].id);
    } else if (e.key === "Escape") {
      setText("");
    }
  }

  return (
    <div className="relative mb-4">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1.5 focus-within:border-teal-500 dark:border-slate-700 dark:bg-slate-900">
        {selected.map((tag) => (
          <span
            key={tag.id}
            className="flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700 dark:bg-teal-950 dark:text-teal-300"
          >
            {tag.label}
            <button
              type="button"
              onClick={() => removeTagId(tag.id)}
              title={`Remove tag "${tag.label}"`}
              className="text-teal-500 hover:text-teal-800 dark:hover:text-teal-100"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitTypedLabel}
          placeholder={selected.length === 0 ? "e.g. prod, us-east" : ""}
          className="min-w-24 flex-1 bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {suggestions.map((tag) => (
            <button
              key={tag.id}
              type="button"
              // Suppress the input's onBlur (which would otherwise fire
              // first on mousedown and commit whatever partial text is
              // still in the box as a stray new tag) so only this click's
              // addTagId runs.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTagId(tag.id)}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {tag.label}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
