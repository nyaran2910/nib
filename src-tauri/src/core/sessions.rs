use crate::core::config::local_state_dir;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionContainerState {
    pub id: String,
    pub kind: String,
    pub pane_id: String,
    pub title: String,
    pub path: Option<String>,
    /// Unsaved or untitled buffer content preserved across detach/reattach
    pub draft_content: Option<String>,
    pub dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPaneState {
    pub id: String,
    pub panel: String,
    pub active_container_id: Option<String>,
    #[serde(default = "default_pane_weight")]
    pub weight: f64,
}

fn default_pane_weight() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub name: String,
    /// "named" (permanent until deleted) | "ephemeral" (auto ring-buffer)
    pub kind: String,
    pub root_dir: Option<String>,
    pub panes: Vec<SessionPaneState>,
    pub containers: Vec<SessionContainerState>,
    pub active_pane_id: String,
    pub active_editor_id: Option<String>,
    pub left_visible: bool,
    pub right_visible: bool,
    pub bottom_visible: bool,
    pub left_width: u16,
    pub right_width: u16,
    pub bottom_height: u16,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SessionStore {
    pub last_session_id: Option<String>,
    /// Permanent user-created named sessions (never evicted by ring buffer)
    pub named: Vec<SessionRecord>,
    /// Automatic ring-buffer history (newest first; oldest evicted past ring_buffer_size)
    pub history: Vec<SessionRecord>,
}

pub fn sessions_file() -> PathBuf {
    local_state_dir().join("sessions.json")
}

/// In-memory tmux-style session server backed by `~/.local/state/nib/sessions.json`.
pub struct SessionManager {
    pub store: SessionStore,
    /// Live active session state per open window label (exists while app process is alive)
    pub live_by_window: HashMap<String, SessionRecord>,
}

impl SessionManager {
    pub fn load() -> Self {
        let store = Self::read_from_disk();
        Self {
            store,
            live_by_window: HashMap::new(),
        }
    }

    fn read_from_disk() -> SessionStore {
        let path = sessions_file();
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<SessionStore>(&raw) {
                return parsed;
            }
        }
        SessionStore::default()
    }

    pub fn flush_to_disk(&self) -> Result<(), String> {
        let dir = local_state_dir();
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create state dir: {e}"))?;
        let serialized = serde_json::to_string_pretty(&self.store)
            .map_err(|e| format!("Failed to serialize sessions: {e}"))?;
        fs::write(sessions_file(), serialized)
            .map_err(|e| format!("Failed to write sessions file: {e}"))
    }

    /// Keeps live state warm in the in-process tmux server (and keeps live named sessions fresh).
    pub fn sync_live(&mut self, window_label: &str, record: SessionRecord) {
        if record.kind == "named" {
            if let Some(existing) = self.store.named.iter_mut().find(|s| s.id == record.id) {
                *existing = record.clone();
            }
        }
        self.live_by_window.insert(window_label.to_string(), record);
    }

    pub fn remove_live_window(&mut self, window_label: &str) -> Option<SessionRecord> {
        self.live_by_window.remove(window_label)
    }

    /// Saves a named persistent session (never overwritten by ring buffer).
    pub fn save_named(&mut self, mut record: SessionRecord) -> Result<SessionRecord, String> {
        record.kind = "named".to_string();
        if let Some(pos) = self.store.named.iter().position(|s| s.id == record.id) {
            self.store.named[pos] = record.clone();
        } else {
            self.store.named.insert(0, record.clone());
        }
        self.store.last_session_id = Some(record.id.clone());
        self.flush_to_disk()?;
        Ok(record)
    }

    /// Saves an ephemeral snapshot into the ring buffer, evicting oldest entries beyond `max_entries`.
    pub fn save_ephemeral(
        &mut self,
        mut record: SessionRecord,
        max_entries: usize,
    ) -> Result<SessionRecord, String> {
        let cap = max_entries.max(1);
        record.kind = "ephemeral".to_string();
        self.store.history.retain(|s| s.id != record.id);
        self.store.history.insert(0, record.clone());
        if self.store.history.len() > cap {
            self.store.history.truncate(cap);
        }
        self.store.last_session_id = Some(record.id.clone());
        self.flush_to_disk()?;
        Ok(record)
    }

    pub fn delete(&mut self, session_id: &str) -> Result<(), String> {
        self.store.named.retain(|s| s.id != session_id);
        self.store.history.retain(|s| s.id != session_id);
        if self.store.last_session_id.as_deref() == Some(session_id) {
            self.store.last_session_id = self
                .store
                .named
                .first()
                .or_else(|| self.store.history.first())
                .map(|s| s.id.clone());
        }
        self.flush_to_disk()
    }

    pub fn get_session(&self, session_id: &str) -> Option<SessionRecord> {
        self.store
            .named
            .iter()
            .chain(self.store.history.iter())
            .find(|s| s.id == session_id)
            .cloned()
    }

    pub fn get_last_session(&self) -> Option<SessionRecord> {
        if let Some(id) = self.store.last_session_id.as_deref() {
            if let Some(found) = self.get_session(id) {
                return Some(found);
            }
        }
        self.store
            .history
            .first()
            .or_else(|| self.store.named.first())
            .cloned()
    }

    /// Flushes all active live window sessions on app exit (`Cmd+Q`) so nothing is ever lost.
    pub fn flush_live_on_exit(&mut self, ring_buffer_size: usize) {
        let live: Vec<SessionRecord> = self.live_by_window.values().cloned().collect();
        if live.is_empty() {
            return;
        }
        for rec in live {
            if rec.kind == "named" {
                let _ = self.save_named(rec);
            } else {
                let _ = self.save_ephemeral(rec, ring_buffer_size);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_session(id: &str, name: &str, kind: &str) -> SessionRecord {
        SessionRecord {
            id: id.into(),
            name: name.into(),
            kind: kind.into(),
            root_dir: Some("/tmp/notes".into()),
            panes: vec![SessionPaneState {
                id: "pane-main-1".into(),
                panel: "center".into(),
                active_container_id: Some("c-1".into()),
                weight: 1.0,
            }],
            containers: vec![SessionContainerState {
                id: "c-1".into(),
                kind: "editor".into(),
                pane_id: "pane-main-1".into(),
                title: "hello".into(),
                path: Some("/tmp/notes/hello.md".into()),
                draft_content: None,
                dirty: false,
            }],
            active_pane_id: "pane-main-1".into(),
            active_editor_id: Some("c-1".into()),
            left_visible: true,
            right_visible: false,
            bottom_visible: false,
            left_width: 248,
            right_width: 248,
            bottom_height: 220,
            created_at: "2026-11-22T00:00:00Z".into(),
            updated_at: "2026-11-22T00:00:00Z".into(),
        }
    }

    #[test]
    fn ring_buffer_evicts_oldest_without_affecting_named_sessions() {
        let mut mgr = SessionManager {
            store: SessionStore::default(),
            live_by_window: HashMap::new(),
        };

        // Insert a permanent named session directly into store
        mgr.store.named.push(sample_session("n1", "work", "named"));

        // Push 4 ephemeral snapshots with ring buffer capacity 2
        for i in 1..=4 {
            let rec = sample_session(&format!("e{i}"), &format!("auto-{i}"), "ephemeral");
            mgr.store.history.retain(|s| s.id != rec.id);
            mgr.store.history.insert(0, rec);
            if mgr.store.history.len() > 2 {
                mgr.store.history.truncate(2);
            }
        }

        assert_eq!(mgr.store.named.len(), 1);
        assert_eq!(mgr.store.named[0].id, "n1");
        assert_eq!(mgr.store.history.len(), 2);
        assert_eq!(mgr.store.history[0].id, "e4");
        assert_eq!(mgr.store.history[1].id, "e3");
    }
}
