import { FormEvent, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { VpnProfile, localReadTextFile } from "../../lib/tauri-bridge";
import { useVpnStore } from "../../state/vpnStore";
import { errorClass, inputClass, labelClass, primaryButtonClass } from "./formStyles";
import RequiredMark from "./RequiredMark";

interface VpnProfileFormProps {
  profile?: VpnProfile;
  onDone: () => void;
}

export default function VpnProfileForm({ profile, onDone }: VpnProfileFormProps) {
  const createProfile = useVpnStore((s) => s.createProfile);
  const updateProfile = useVpnStore((s) => s.updateProfile);

  const [label, setLabel] = useState(profile?.label ?? "");
  const [config, setConfig] = useState(profile?.config ?? "");
  const [authUsername, setAuthUsername] = useState(profile?.auth_username ?? "");
  const [authPassword, setAuthPassword] = useState("");
  const [avoidDefaultRoute, setAvoidDefaultRoute] = useState(profile?.avoid_default_route ?? true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleBrowse() {
    setError(null);
    try {
      const path = await open({
        multiple: false,
        title: "Select a .ovpn profile",
        filters: [{ name: "OpenVPN config", extensions: ["ovpn", "conf"] }],
      });
      if (!path || Array.isArray(path)) return;
      const contents = await localReadTextFile(path);
      setConfig(contents);
      if (!label) {
        const fileName = path.split(/[/\\]/).pop() ?? "";
        setLabel(fileName.replace(/\.(ovpn|conf)$/i, ""));
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const input = {
        label,
        config,
        auth_username: authUsername || null,
        // Leave the stored password untouched on update unless the user typed
        // something in this session; on create, empty just means no password.
        auth_password: authPassword || (profile ? null : ""),
        avoid_default_route: avoidDefaultRoute,
      };
      if (profile) {
        await updateProfile(profile.id, input);
      } else {
        await createProfile(input);
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
      <label className={labelClass}>
        Label
        <RequiredMark />
      </label>
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.currentTarget.value)}
        className={inputClass}
        placeholder="e.g. office vpn"
        required
      />

      <div className="mb-1 flex items-center justify-between">
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          OpenVPN config (.ovpn)
          <RequiredMark />
        </label>
        <button
          type="button"
          onClick={handleBrowse}
          className="text-xs text-teal-600 hover:underline dark:text-teal-400"
        >
          Browse…
        </button>
      </div>
      <textarea
        value={config}
        onChange={(e) => setConfig(e.currentTarget.value)}
        className={`${inputClass} h-40 font-mono text-xs`}
        placeholder="Paste an .ovpn file's contents, or browse to one above"
        required
      />

      <label className="mb-4 flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        <input
          type="checkbox"
          checked={avoidDefaultRoute}
          onChange={(e) => setAvoidDefaultRoute(e.currentTarget.checked)}
          className="mt-0.5"
        />
        <span>
          Don&apos;t let this VPN take over my default internet route
          <span className="block text-xs text-neutral-400">
            Hosts assigned to this profile are always reachable through it either way - it's
            already routed explicitly per host, so this doesn't affect that. This only limits
            everything else: your other, unrelated traffic. Recommended unless this profile is
            specifically meant to route your whole connection (e.g. a privacy VPN).
          </span>
        </span>
      </label>

      <p className="mb-4 -mt-2 text-xs text-neutral-400">
        Only needed if this profile prompts for a separate username/password at login - most
        profiles with an embedded client certificate don't.
      </p>
      <label className={labelClass}>Username (optional)</label>
      <input
        value={authUsername}
        onChange={(e) => setAuthUsername(e.currentTarget.value)}
        className={inputClass}
      />

      <label className={labelClass}>
        Password{profile?.has_auth_password ? " (leave blank to keep current)" : " (optional)"}
      </label>
      <input
        type="password"
        autoComplete="new-password"
        value={authPassword}
        onChange={(e) => setAuthPassword(e.currentTarget.value)}
        className={inputClass}
      />

      {error && <p className={errorClass}>{error}</p>}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? "Saving…" : profile ? "Save changes" : "Add VPN profile"}
      </button>
    </form>
  );
}
