use crate::core::config::local_state_dir;
use chrono::{DateTime, Duration, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashEntry {
    pub image_key: String,
    pub deleted_at: DateTime<Utc>,
    pub purge_after: DateTime<Utc>,
}

/// Centralized image reference counter across all indexed Markdown files.
/// When a note removes an image link and its reference count reaches 0,
/// the image is soft-deleted into the persisted trash queue rather than immediately purged.
pub struct ImageRefManager {
    /// image_key -> set of note paths referencing it
    refs: HashMap<String, HashSet<PathBuf>>,
    /// note path -> last known image keys in that note
    doc_images: HashMap<PathBuf, HashSet<String>>,
    /// soft-deleted images awaiting retention expiry
    trash: Vec<TrashEntry>,
    image_regex: Regex,
    trash_file: Option<PathBuf>,
}

impl ImageRefManager {
    pub fn new() -> Self {
        let trash_file = local_state_dir().join("trash.json");
        let trash = fs::read_to_string(&trash_file)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<TrashEntry>>(&raw).ok())
            .unwrap_or_default();

        Self {
            refs: HashMap::new(),
            doc_images: HashMap::new(),
            trash,
            image_regex: Regex::new(r"!\[[^\]]*\]\(([^)\s]+)").expect("valid image regex"),
            trash_file: Some(trash_file),
        }
    }

    #[cfg(test)]
    fn new_in_memory() -> Self {
        Self {
            refs: HashMap::new(),
            doc_images: HashMap::new(),
            trash: Vec::new(),
            image_regex: Regex::new(r"!\[[^\]]*\]\(([^)\s]+)").expect("valid image regex"),
            trash_file: None,
        }
    }

    fn persist_trash(&self) {
        let Some(ref path) = self.trash_file else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.trash) {
            let _ = fs::write(path, json);
        }
    }

    /// Reconciles image references for a saved document and returns any newly unreferenced keys
    /// that were moved to the soft-delete trash.
    pub fn update_document(
        &mut self,
        doc_path: &Path,
        markdown: &str,
        retention_days: u32,
    ) -> Vec<TrashEntry> {
        let new_keys: HashSet<String> = self
            .image_regex
            .captures_iter(markdown)
            .filter_map(|cap| cap.get(1).map(|m| m.as_str().to_string()))
            .collect();

        let prev_keys = self
            .doc_images
            .insert(doc_path.to_path_buf(), new_keys.clone())
            .unwrap_or_default();

        let mut trash_changed = false;

        // Add newly referenced images (and restore from trash if re-referenced)
        for key in new_keys.difference(&prev_keys) {
            self.refs
                .entry(key.clone())
                .or_default()
                .insert(doc_path.to_path_buf());
            let before = self.trash.len();
            self.trash.retain(|t| t.image_key != *key);
            if self.trash.len() != before {
                trash_changed = true;
            }
        }

        // Decrement removed images; soft-delete when ref count reaches 0
        let mut newly_trashed = Vec::new();
        for key in prev_keys.difference(&new_keys) {
            if let Some(holders) = self.refs.get_mut(key) {
                holders.remove(doc_path);
                if holders.is_empty() {
                    self.refs.remove(key);
                    let now = Utc::now();
                    let entry = TrashEntry {
                        image_key: key.clone(),
                        deleted_at: now,
                        purge_after: now + Duration::days(retention_days as i64),
                    };
                    self.trash.push(entry.clone());
                    newly_trashed.push(entry);
                    trash_changed = true;
                }
            }
        }

        if trash_changed {
            self.persist_trash();
        }

        newly_trashed
    }

    pub fn trash_entries(&self) -> &[TrashEntry] {
        &self.trash
    }

    /// Removes expired trash entries and deletes local media-cache files when applicable.
    pub fn purge_expired(&mut self) -> Vec<String> {
        let now = Utc::now();
        let mut purged = Vec::new();
        let cache_dir = local_state_dir().join("media-cache");

        self.trash.retain(|entry| {
            if entry.purge_after <= now {
                let p = PathBuf::from(&entry.image_key);
                if p.starts_with(&cache_dir) && p.exists() {
                    let _ = fs::remove_file(&p);
                }
                purged.push(entry.image_key.clone());
                false
            } else {
                true
            }
        });

        if !purged.is_empty() {
            self.persist_trash();
        }
        purged
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_ref_count_and_soft_delete_lifecycle() {
        let mut mgr = ImageRefManager::new_in_memory();
        let note_a = PathBuf::from("/notes/a.md");
        let note_b = PathBuf::from("/notes/b.md");

        let t1 = mgr.update_document(&note_a, "Hello ![pic](https://cdn.example/img1.webp)", 30);
        let t2 = mgr.update_document(&note_b, "Also ![pic](https://cdn.example/img1.webp)", 30);
        assert!(t1.is_empty());
        assert!(t2.is_empty());

        let t3 = mgr.update_document(&note_a, "Hello without image", 30);
        assert!(t3.is_empty());
        assert!(mgr.trash_entries().is_empty());

        let t4 = mgr.update_document(&note_b, "No image here either", 30);
        assert_eq!(t4.len(), 1);
        assert_eq!(t4[0].image_key, "https://cdn.example/img1.webp");
        assert_eq!(mgr.trash_entries().len(), 1);

        mgr.update_document(&note_a, "Restored ![pic](https://cdn.example/img1.webp)", 30);
        assert!(mgr.trash_entries().is_empty());
    }

    #[test]
    fn purge_expired_removes_only_expired_entries() {
        let mut mgr = ImageRefManager::new_in_memory();
        let now = Utc::now();
        mgr.trash.push(TrashEntry {
            image_key: "expired.webp".into(),
            deleted_at: now - Duration::days(31),
            purge_after: now - Duration::days(1),
        });
        mgr.trash.push(TrashEntry {
            image_key: "active.webp".into(),
            deleted_at: now,
            purge_after: now + Duration::days(29),
        });
        let purged = mgr.purge_expired();
        assert_eq!(purged, vec!["expired.webp"]);
        assert_eq!(mgr.trash_entries().len(), 1);
        assert_eq!(mgr.trash_entries()[0].image_key, "active.webp");
    }
}
