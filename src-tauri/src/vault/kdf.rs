use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::{AppError, AppResult};

pub const SALT_LEN: usize = 16;
pub const KEY_LEN: usize = 32;

// Matches Bitwarden's Argon2id defaults: strong enough for an offline vault
// that's only unlocked occasionally, not a high-frequency auth path.
pub const DEFAULT_M_COST_KIB: u32 = 65536; // 64 MiB
pub const DEFAULT_T_COST: u32 = 3;
pub const DEFAULT_P_COST: u32 = 4;

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct VaultKey(pub [u8; KEY_LEN]);

impl VaultKey {
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

pub struct KdfParams {
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            m_cost: DEFAULT_M_COST_KIB,
            t_cost: DEFAULT_T_COST,
            p_cost: DEFAULT_P_COST,
        }
    }
}

pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

pub fn derive_key(password: &str, salt: &[u8], params: &KdfParams) -> AppResult<VaultKey> {
    let argon2_params = Params::new(params.m_cost, params.t_cost, params.p_cost, Some(KEY_LEN))
        .map_err(|e| AppError::Crypto(format!("invalid argon2 params: {e}")))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon2_params);

    let mut out = [0u8; KEY_LEN];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| AppError::Crypto(format!("key derivation failed: {e}")))?;

    Ok(VaultKey(out))
}

#[cfg(test)]
// Cheap, fixed-cost KDF params so data-layer tests (which just need *a* key,
// not a realistic one) don't each pay the real ~64MB/3-iter Argon2id cost.
pub fn test_key() -> VaultKey {
    let params = KdfParams {
        m_cost: 8,
        t_cost: 1,
        p_cost: 1,
    };
    derive_key("test-password", b"0123456789abcdef", &params).unwrap()
}
