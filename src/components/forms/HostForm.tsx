import { FormEvent, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AuthMethod, Host, localReadTextFile } from "../../lib/tauri-bridge";
import { useHostsStore } from "../../state/hostsStore";
import { useVpnStore } from "../../state/vpnStore";
import { errorClass, inputClass, labelClass, primaryButtonClass, selectClass } from "./formStyles";
import RequiredMark from "./RequiredMark";

interface HostFormProps {
  host?: Host;
  defaultGroupId?: string | null;
  onDone: () => void;
}

type InlineAuthMethod = Extract<AuthMethod, "password" | "private_key">;

export default function HostForm({ host, defaultGroupId, onDone }: HostFormProps) {
  const groups = useHostsStore((s) => s.groups);
  const identities = useHostsStore((s) => s.identities);
  const keys = useHostsStore((s) => s.keys);
  const hosts = useHostsStore((s) => s.hosts);
  const createHost = useHostsStore((s) => s.createHost);
  const updateHost = useHostsStore((s) => s.updateHost);
  const createIdentity = useHostsStore((s) => s.createIdentity);
  const importKey = useHostsStore((s) => s.importKey);
  const vpnProfiles = useVpnStore((s) => s.profiles);
  const createVpnProfile = useVpnStore((s) => s.createProfile);

  const [label, setLabel] = useState(host?.label ?? "");
  const [hostname, setHostname] = useState(host?.hostname ?? "");
  const [port, setPort] = useState(host?.port ?? 22);
  const [groupId, setGroupId] = useState(host?.group_id ?? defaultGroupId ?? "");

  const [identityMode, setIdentityMode] = useState<"new" | "existing">(
    host?.identity_id ? "existing" : "new",
  );
  const [identityId, setIdentityId] = useState(host?.identity_id ?? "");
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<InlineAuthMethod>("password");
  const [password, setPassword] = useState("");
  const [sshKeyId, setSshKeyId] = useState("");
  const [keyMode, setKeyMode] = useState<"existing" | "import">(keys.length > 0 ? "existing" : "import");
  const [importKeyLabel, setImportKeyLabel] = useState("");
  const [importKeyPem, setImportKeyPem] = useState("");
  const [importKeyPassphrase, setImportKeyPassphrase] = useState("");

  const [jumpHostId, setJumpHostId] = useState(host?.jump_host_id ?? "");

  const [vpnMode, setVpnMode] = useState<"none" | "existing" | "new">(
    host?.vpn_profile_id ? "existing" : "none",
  );
  const [vpnProfileId, setVpnProfileId] = useState(host?.vpn_profile_id ?? "");
  const [vpnLabel, setVpnLabel] = useState("");
  const [vpnConfig, setVpnConfig] = useState("");
  const [vpnAuthUsername, setVpnAuthUsername] = useState("");
  const [vpnAuthPassword, setVpnAuthPassword] = useState("");
  const [vpnAvoidDefaultRoute, setVpnAvoidDefaultRoute] = useState(true);

  const [notes, setNotes] = useState(host?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleBrowseKey() {
    setError(null);
    try {
      const path = await open({
        multiple: false,
        title: "Select a private key file",
      });
      if (!path || Array.isArray(path)) return;
      const contents = await localReadTextFile(path);
      setImportKeyPem(contents);
      if (!importKeyLabel) {
        const fileName = path.split(/[/\\]/).pop() ?? "";
        setImportKeyLabel(fileName.replace(/\.(pem|key|pub)$/i, ""));
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleBrowseVpn() {
    setError(null);
    try {
      const path = await open({
        multiple: false,
        title: "Select a .ovpn profile",
        filters: [{ name: "OpenVPN config", extensions: ["ovpn", "conf"] }],
      });
      if (!path || Array.isArray(path)) return;
      const contents = await localReadTextFile(path);
      setVpnConfig(contents);
      if (!vpnLabel) {
        const fileName = path.split(/[/\\]/).pop() ?? "";
        setVpnLabel(fileName.replace(/\.(ovpn|conf)$/i, ""));
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (identityMode === "new" && authMethod === "private_key") {
      if (keyMode === "existing" && !sshKeyId) {
        setError("Select an SSH key, or switch to \"Import new key\".");
        return;
      }
      if (keyMode === "import" && !importKeyPem) {
        setError("Upload or paste a private key, or switch to \"Use saved key\".");
        return;
      }
    }
    // Credential data (a password, or a selected/imported key) only ever
    // gets saved as part of creating a new identity below, which itself
    // only happens `if (username)` - without this check, filling in a
    // password or picking a key while leaving Username blank silently
    // discarded that data with the host still saving successfully and no
    // indication anything was dropped.
    if (identityMode === "new" && !username) {
      const hasCredentialData =
        (authMethod === "password" && password) ||
        (authMethod === "private_key" && ((keyMode === "existing" && sshKeyId) || (keyMode === "import" && importKeyPem)));
      if (hasCredentialData) {
        setError("Enter a username, or clear the password/key to skip creating credentials for this host.");
        return;
      }
    }
    if (vpnMode === "new" && !vpnConfig) {
      setError("Upload or paste a .ovpn profile, or switch VPN back to \"None\".");
      return;
    }

    setSubmitting(true);
    try {
      let resolvedIdentityId = identityMode === "existing" ? identityId || null : null;

      if (identityMode === "new" && username) {
        let resolvedSshKeyId = sshKeyId;
        if (authMethod === "private_key" && keyMode === "import") {
          const key = await importKey({
            label: importKeyLabel || `${username}@${hostname || label}`,
            private_key_pem: importKeyPem,
            passphrase: importKeyPassphrase || null,
          });
          resolvedSshKeyId = key.id;
        }

        const identity = await createIdentity({
          label: `${username}@${hostname || label}`,
          username,
          auth_method: authMethod,
          ssh_key_id: authMethod === "private_key" ? resolvedSshKeyId : null,
          password: authMethod === "password" ? password : "",
        });
        resolvedIdentityId = identity.id;
      }

      let resolvedVpnProfileId = vpnMode === "existing" ? vpnProfileId || null : null;

      if (vpnMode === "new") {
        const profile = await createVpnProfile({
          label: vpnLabel || `${label || hostname} VPN`,
          config: vpnConfig,
          auth_username: vpnAuthUsername || null,
          auth_password: vpnAuthPassword || "",
          avoid_default_route: vpnAvoidDefaultRoute,
        });
        resolvedVpnProfileId = profile.id;
      }

      const input = {
        group_id: groupId || null,
        label,
        hostname,
        port,
        identity_id: resolvedIdentityId,
        jump_host_id: jumpHostId || null,
        vpn_profile_id: resolvedVpnProfileId,
        color: host?.color ?? null,
        notes: notes || null,
        sort_order: host?.sort_order ?? 0,
      };
      if (host) {
        await updateHost(host.id, input);
      } else {
        await createHost(input);
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
        placeholder="e.g. prod-web-1"
        required
      />

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={labelClass}>
            Hostname / IP
            <RequiredMark />
          </label>
          <input
            value={hostname}
            onChange={(e) => setHostname(e.currentTarget.value)}
            className={inputClass}
            required
          />
        </div>
        <div className="w-24">
          <label className={labelClass}>
            Port
            <RequiredMark />
          </label>
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(Number(e.currentTarget.value))}
            className={inputClass}
            required
          />
        </div>
      </div>

      <label className={labelClass}>Group</label>
      <select
        value={groupId}
        onChange={(e) => setGroupId(e.currentTarget.value)}
        className={selectClass}
      >
        <option value="">(none - top level)</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>

      <label className={labelClass}>Credentials</label>
      {identities.length > 0 && (
        <div className="mb-4 flex rounded-md border border-neutral-300 p-1 text-sm dark:border-neutral-700">
          <button
            type="button"
            onClick={() => setIdentityMode("new")}
            className={`flex-1 rounded px-3 py-1.5 ${identityMode === "new" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
          >
            New credentials
          </button>
          <button
            type="button"
            onClick={() => setIdentityMode("existing")}
            className={`flex-1 rounded px-3 py-1.5 ${identityMode === "existing" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
          >
            Use saved identity
          </button>
        </div>
      )}

      {identityMode === "existing" ? (
        <select
          value={identityId}
          onChange={(e) => setIdentityId(e.currentTarget.value)}
          className={selectClass}
        >
          <option value="">(none)</option>
          {identities.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label} ({i.username})
            </option>
          ))}
        </select>
      ) : (
        <div className="mb-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
          <label className={labelClass}>Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            className={inputClass}
            placeholder="e.g. root"
          />

          <label className={labelClass}>Authentication</label>
          <div className="mb-4 flex gap-4 text-sm text-neutral-700 dark:text-neutral-300">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={authMethod === "password"}
                onChange={() => setAuthMethod("password")}
              />
              Password
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={authMethod === "private_key"}
                onChange={() => setAuthMethod("private_key")}
              />
              Private key
            </label>
          </div>

          {authMethod === "password" ? (
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              className={inputClass}
              placeholder="Password"
            />
          ) : (
            <>
              {keys.length > 0 && (
                <div className="mb-3 flex rounded-md border border-neutral-300 p-1 text-sm dark:border-neutral-700">
                  <button
                    type="button"
                    onClick={() => setKeyMode("existing")}
                    className={`flex-1 rounded px-2 py-1.5 ${keyMode === "existing" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
                  >
                    Use saved key
                  </button>
                  <button
                    type="button"
                    onClick={() => setKeyMode("import")}
                    className={`flex-1 rounded px-2 py-1.5 ${keyMode === "import" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
                  >
                    Import new key
                  </button>
                </div>
              )}

              {keyMode === "existing" && keys.length > 0 ? (
                <select
                  value={sshKeyId}
                  onChange={(e) => setSshKeyId(e.currentTarget.value)}
                  className={selectClass}
                >
                  <option value="">Select a key…</option>
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label} ({k.key_type})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
                  <label className={labelClass}>Label</label>
                  <input
                    value={importKeyLabel}
                    onChange={(e) => setImportKeyLabel(e.currentTarget.value)}
                    className={inputClass}
                    placeholder="e.g. laptop key"
                  />

                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                      Private key (OpenSSH or PEM format)
                    </label>
                    <button
                      type="button"
                      onClick={handleBrowseKey}
                      className="text-xs text-teal-600 hover:underline dark:text-teal-400"
                    >
                      Browse…
                    </button>
                  </div>
                  <textarea
                    value={importKeyPem}
                    onChange={(e) => setImportKeyPem(e.currentTarget.value)}
                    className={`${inputClass} h-28 font-mono text-xs`}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  />

                  <label className={labelClass}>Passphrase (if the key is encrypted)</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={importKeyPassphrase}
                    onChange={(e) => setImportKeyPassphrase(e.currentTarget.value)}
                    className={inputClass}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      <label className={labelClass}>Jump host (ProxyJump)</label>
      <select
        value={jumpHostId}
        onChange={(e) => setJumpHostId(e.currentTarget.value)}
        className={selectClass}
      >
        <option value="">(none)</option>
        {hosts
          .filter((h) => h.id !== host?.id)
          .map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
      </select>
      <p className="mb-2 -mt-1 text-xs text-amber-600 dark:text-amber-400">
        Coming soon - saved here, but connecting doesn't chain through the jump host yet.
      </p>

      <label className={labelClass}>VPN (optional)</label>
      <p className="mb-2 -mt-1 text-xs text-neutral-400">
        If this host is only reachable over a VPN, assign a profile here - connecting will bring
        the VPN up first automatically.
      </p>
      <div className="mb-4 flex rounded-md border border-neutral-300 p-1 text-sm dark:border-neutral-700">
        <button
          type="button"
          onClick={() => setVpnMode("none")}
          className={`flex-1 rounded px-2 py-1.5 ${vpnMode === "none" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
        >
          None
        </button>
        <button
          type="button"
          onClick={() => setVpnMode("new")}
          className={`flex-1 rounded px-2 py-1.5 ${vpnMode === "new" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
        >
          Upload profile
        </button>
        {vpnProfiles.length > 0 && (
          <button
            type="button"
            onClick={() => setVpnMode("existing")}
            className={`flex-1 rounded px-2 py-1.5 ${vpnMode === "existing" ? "bg-teal-600 text-white" : "text-neutral-600 dark:text-neutral-300"}`}
          >
            Use saved profile
          </button>
        )}
      </div>

      {vpnMode === "existing" && (
        <select
          value={vpnProfileId}
          onChange={(e) => setVpnProfileId(e.currentTarget.value)}
          className={selectClass}
        >
          <option value="">(none)</option>
          {vpnProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      )}

      {vpnMode === "new" && (
        <div className="mb-4 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
          <label className={labelClass}>Label</label>
          <input
            value={vpnLabel}
            onChange={(e) => setVpnLabel(e.currentTarget.value)}
            className={inputClass}
            placeholder="e.g. office vpn"
          />

          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              OpenVPN config (.ovpn)
            </label>
            <button
              type="button"
              onClick={handleBrowseVpn}
              className="text-xs text-teal-600 hover:underline dark:text-teal-400"
            >
              Browse…
            </button>
          </div>
          <textarea
            value={vpnConfig}
            onChange={(e) => setVpnConfig(e.currentTarget.value)}
            className={`${inputClass} h-28 font-mono text-xs`}
            placeholder="Paste an .ovpn file's contents, or browse to one above"
          />

          <label className="mb-3 flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={vpnAvoidDefaultRoute}
              onChange={(e) => setVpnAvoidDefaultRoute(e.currentTarget.checked)}
              className="mt-0.5"
            />
            <span>
              Don&apos;t let this VPN take over my default internet route
              <span className="block text-xs text-neutral-400">
                This host stays reachable through it either way. Only limits this profile's
                effect on your other, unrelated traffic - recommended unless it's meant to route
                your whole connection.
              </span>
            </span>
          </label>

          <p className="mb-3 -mt-2 text-xs text-neutral-400">
            Only needed if this profile prompts for a separate username/password at login - most
            profiles with an embedded client certificate don't.
          </p>
          <label className={labelClass}>Username (optional)</label>
          <input
            value={vpnAuthUsername}
            onChange={(e) => setVpnAuthUsername(e.currentTarget.value)}
            className={inputClass}
          />

          <label className={labelClass}>Password (optional)</label>
          <input
            type="password"
            autoComplete="new-password"
            value={vpnAuthPassword}
            onChange={(e) => setVpnAuthPassword(e.currentTarget.value)}
            className={inputClass}
          />
        </div>
      )}

      <label className={labelClass}>Notes</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.currentTarget.value)}
        className={`${inputClass} h-20`}
      />

      {error && <p className={errorClass}>{error}</p>}

      <button type="submit" disabled={submitting} className={primaryButtonClass}>
        {submitting ? "Saving…" : host ? "Save changes" : "Create host"}
      </button>
    </form>
  );
}
