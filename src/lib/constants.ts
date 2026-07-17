// The vault's master-password prompt is disabled - the app unlocks itself on
// launch with this fixed password instead of asking the user for one. Secrets
// are still encrypted at rest (Argon2id + AES-256-GCM), just with a key
// derived from this constant rather than something only the user knows.
export const VAULT_AUTO_UNLOCK_PASSWORD = "CorrectHorseBattery1";
