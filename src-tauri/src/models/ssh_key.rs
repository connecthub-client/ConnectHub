use serde::{Deserialize, Serialize};
use uuid::Uuid;

// Private key material is never sent to the frontend after creation - only
// metadata needed to display and reference the key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKey {
    pub id: Uuid,
    pub label: String,
    pub key_type: String,
    pub public_key: String,
    pub fingerprint: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GenerateKeyInput {
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportKeyInput {
    pub label: String,
    pub private_key_pem: String,
    pub passphrase: Option<String>,
}
