use crate::core::config::{local_state_dir, StorageConfig, StorageCredentials};
use async_trait::async_trait;
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use thiserror::Error;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("Storage provider not configured: {0}")]
    NotConfigured(String),
    #[error("Upload failed: {0}")]
    UploadFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadedAsset {
    /// Stable key used for reference counting and soft-delete tracking
    pub key: String,
    /// Public or local URL embedded into Markdown (`![alt](url)`)
    pub url: String,
    pub mime_type: String,
    pub bytes: usize,
    pub synced: bool,
}

/// Abstraction over image/asset storage backends so local note folders stay clean.
/// Supports optional WebP conversion (configured via `auto_convert_webp`) and Cloudflare R2 / S3 upload.
#[allow(dead_code)]
#[async_trait]
pub trait StorageProvider: Send + Sync {
    async fn upload_asset(
        &self,
        filename_hint: &str,
        mime_type: &str,
        bytes: Vec<u8>,
    ) -> Result<UploadedAsset, StorageError>;

    async fn soft_delete(&self, key: &str) -> Result<(), StorageError>;

    async fn restore(&self, key: &str) -> Result<(), StorageError>;

    async fn purge_expired(&self) -> Result<usize, StorageError>;
}

/// Offline-first local cache provider stored under `~/.local/state/nib/media-cache/`.
pub struct LocalCacheStorageProvider;

#[async_trait]
impl StorageProvider for LocalCacheStorageProvider {
    async fn upload_asset(
        &self,
        filename_hint: &str,
        mime_type: &str,
        bytes: Vec<u8>,
    ) -> Result<UploadedAsset, StorageError> {
        let cache_dir = local_state_dir().join("media-cache");
        fs::create_dir_all(&cache_dir)?;

        let ext = extension_from_mime(mime_type);
        let safe_stem: String = filename_hint
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .take(32)
            .collect();
        let stem = if safe_stem.is_empty() {
            "image"
        } else {
            &safe_stem
        };
        let key = format!("{}-{stem}.{ext}", uuid::Uuid::new_v4().simple());
        let file_path = cache_dir.join(&key);
        fs::write(&file_path, &bytes)?;

        Ok(UploadedAsset {
            url: file_path.to_string_lossy().to_string(),
            key,
            mime_type: mime_type.to_string(),
            bytes: bytes.len(),
            synced: false,
        })
    }

    async fn soft_delete(&self, _key: &str) -> Result<(), StorageError> {
        Ok(())
    }

    async fn restore(&self, _key: &str) -> Result<(), StorageError> {
        Ok(())
    }

    async fn purge_expired(&self) -> Result<usize, StorageError> {
        Ok(0)
    }
}

/// Cloudflare R2 / S3-compatible provider using AWS Signature Version 4 (`auto` region).
/// Credentials are entered by the user in Settings and stored locally in `~/.local/state/nib/credentials.json`.
pub struct R2StorageProvider {
    pub endpoint: String,
    pub bucket: String,
    pub public_base_url: Option<String>,
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl R2StorageProvider {
    pub fn from_config(
        cfg: &StorageConfig,
        creds: &StorageCredentials,
    ) -> Result<Self, StorageError> {
        let bucket = cfg
            .r2_bucket
            .clone()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| StorageError::NotConfigured("Cloudflare R2 bucket is missing".into()))?;

        let endpoint = cfg
            .r2_endpoint
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                cfg.r2_account_id
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .map(|id| format!("https://{}.r2.cloudflarestorage.com", id.trim()))
            })
            .ok_or_else(|| {
                StorageError::NotConfigured("Cloudflare R2 Account ID or Endpoint is missing".into())
            })?;

        let access_key_id = creds
            .r2_access_key_id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| {
                StorageError::NotConfigured("Cloudflare R2 Access Key ID is missing".into())
            })?;

        let secret_access_key = creds
            .r2_secret_access_key
            .clone()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| {
                StorageError::NotConfigured("Cloudflare R2 Secret Access Key is missing".into())
            })?;

        Ok(Self {
            endpoint: endpoint.trim_end_matches('/').to_string(),
            bucket: bucket.trim().to_string(),
            public_base_url: cfg
                .r2_public_base_url
                .clone()
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim_end_matches('/').to_string()),
            access_key_id: access_key_id.trim().to_string(),
            secret_access_key: secret_access_key.trim().to_string(),
        })
    }
}

#[async_trait]
impl StorageProvider for R2StorageProvider {
    async fn upload_asset(
        &self,
        filename_hint: &str,
        mime_type: &str,
        bytes: Vec<u8>,
    ) -> Result<UploadedAsset, StorageError> {
        let ext = extension_from_mime(mime_type);
        let safe_stem: String = filename_hint
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .take(32)
            .collect();
        let stem = if safe_stem.is_empty() {
            "image"
        } else {
            &safe_stem
        };
        let now = Utc::now();
        let date_prefix = now.format("%Y/%m").to_string();
        let key = format!("nib/{date_prefix}/{}-{stem}.{ext}", uuid::Uuid::new_v4().simple());

        let url = format!("{}/{}/{}", self.endpoint, self.bucket, key);
        let host = self
            .endpoint
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap_or("");

        let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let date_stamp = now.format("%Y%m%d").to_string();
        let region = "auto";
        let service = "s3";

        let payload_hash = hex::encode(Sha256::digest(&bytes));
        let canonical_uri = format!("/{}/{}", self.bucket, key);
        let canonical_headers = format!(
            "content-type:{mime_type}\nhost:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
        );
        let signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date";
        let canonical_request = format!(
            "PUT\n{canonical_uri}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
        );

        let credential_scope = format!("{date_stamp}/{region}/{service}/aws4_request");
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
            hex::encode(Sha256::digest(canonical_request.as_bytes()))
        );

        let signing_key = derive_sigv4_key(&self.secret_access_key, &date_stamp, region, service);
        let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes()));
        let auth_header = format!(
            "AWS4-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
            self.access_key_id
        );

        let client = reqwest::Client::new();
        let resp = client
            .put(&url)
            .header("Content-Type", mime_type)
            .header("x-amz-content-sha256", &payload_hash)
            .header("x-amz-date", &amz_date)
            .header("Authorization", auth_header)
            .body(bytes.clone())
            .send()
            .await
            .map_err(|e| StorageError::UploadFailed(e.to_string()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(StorageError::UploadFailed(format!(
                "HTTP {status}: {body}"
            )));
        }

        let public_url = match &self.public_base_url {
            Some(base) => format!("{base}/{key}"),
            None => url,
        };

        Ok(UploadedAsset {
            key,
            url: public_url,
            mime_type: mime_type.to_string(),
            bytes: bytes.len(),
            synced: true,
        })
    }

    async fn soft_delete(&self, _key: &str) -> Result<(), StorageError> {
        Ok(())
    }

    async fn restore(&self, _key: &str) -> Result<(), StorageError> {
        Ok(())
    }

    async fn purge_expired(&self) -> Result<usize, StorageError> {
        Ok(0)
    }
}

fn extension_from_mime(mime: &str) -> &'static str {
    match mime.to_lowercase().as_str() {
        "image/webp" => "webp",
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        _ => "bin",
    }
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn derive_sigv4_key(secret: &str, date: &str, region: &str, service: &str) -> Vec<u8> {
    let k_date = hmac_sha256(format!("AWS4{secret}").as_bytes(), date.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    hmac_sha256(&k_service, b"aws4_request")
}
