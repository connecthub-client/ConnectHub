use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rand::RngCore;

use super::kdf::VaultKey;
use crate::error::{AppError, AppResult};

pub const NONCE_LEN: usize = 12;

pub struct Encrypted {
    pub nonce: [u8; NONCE_LEN],
    pub ciphertext: Vec<u8>,
}

pub fn encrypt(key: &VaultKey, plaintext: &[u8]) -> AppResult<Encrypted> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Crypto(format!("encryption failed: {e}")))?;

    Ok(Encrypted {
        nonce: nonce_bytes,
        ciphertext,
    })
}

pub fn decrypt(key: &VaultKey, nonce: &[u8], ciphertext: &[u8]) -> AppResult<Vec<u8>> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_bytes()));
    let nonce = Nonce::from_slice(nonce);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AppError::Crypto("decryption failed".into()))
}
