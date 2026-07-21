// Tauri commands serialize a failed Result<T, AppError> to the frontend as
// a plain string (see AppError's Serialize impl in error.rs) - every
// String(e) in the codebase is that string verbatim. Some of those messages
// are written for a developer reading Rust source, not someone who just
// tried to connect to a host. This recognizes the handful of common,
// stable-prefixed cases worth a friendlier headline and leaves everything
// else untouched - the original message is always still shown alongside,
// never hidden, so nothing is lost if a translation is wrong or missing.
const RULES: { test: RegExp; friendly: string }[] = [
  {
    test: /^connection refused by /,
    friendly: "Couldn't connect - the host actively refused the connection. Check the port is correct and something is actually listening there.",
  },
  {
    test: /^connection to .+ timed out$/,
    friendly: "Connecting timed out. Check the host is reachable (and, if it's behind a VPN, that the VPN is actually connected).",
  },
  {
    test: /^could not resolve hostname /,
    friendly: "Couldn't resolve that hostname. Double-check it's spelled correctly.",
  },
  {
    test: /^authentication failed:/,
    friendly: "The server rejected the credentials for this identity. Check the username/password or key, or that this identity is set up for the right account.",
  },
  {
    test: /^vault is locked$/,
    friendly: "The vault is locked. Try restarting the app.",
  },
  {
    test: /^VPN privilege setup hasn't been run yet/,
    friendly: "This host's VPN needs a one-time setup step before it can connect - open the VPN tab and run setup.",
  },
];

export function friendlyError(error: unknown): string {
  const raw = String(error);
  const rule = RULES.find((r) => r.test.test(raw));
  return rule ? `${rule.friendly} (${raw})` : raw;
}
