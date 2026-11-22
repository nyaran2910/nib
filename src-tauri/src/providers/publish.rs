use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use thiserror::Error;

#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum PublishError {
    #[error("Publish provider not configured")]
    NotConfigured,
    #[error("Authentication required (store token in OS Keychain)")]
    Unauthorized,
    #[error("Publish request failed: {0}")]
    Failed(String),
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishedNoteRecord {
    pub note_path: PathBuf,
    pub remote_id: String,
    pub public_url: String,
    pub published_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Local registry tracking which notes have been published to a web sharing SaaS.
/// Stored separately from credentials (which belong in the OS Keychain).
#[allow(dead_code)]
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct PublishRegistry {
    pub records: HashMap<PathBuf, PublishedNoteRecord>,
}

/// Abstraction for future one-click note publishing / cloud sharing.
#[allow(dead_code)]
#[async_trait]
pub trait PublishProvider: Send + Sync {
    async fn publish_note(
        &self,
        note_path: &PathBuf,
        title: &str,
        markdown: &str,
    ) -> Result<PublishedNoteRecord, PublishError>;

    async fn unpublish_note(&self, remote_id: &str) -> Result<(), PublishError>;
}
