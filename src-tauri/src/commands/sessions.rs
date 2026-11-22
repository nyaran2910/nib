use crate::core::sessions::{SessionRecord, SessionStore};
use crate::state::AppState;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> SessionStore {
    state
        .sessions
        .lock()
        .map(|mgr| mgr.store.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_last_session(state: State<'_, AppState>) -> Option<SessionRecord> {
    state
        .sessions
        .lock()
        .ok()
        .and_then(|mgr| mgr.get_last_session())
}

#[tauri::command]
pub fn sync_live_session(
    window: WebviewWindow,
    state: State<'_, AppState>,
    record: SessionRecord,
) -> Result<(), String> {
    let mut mgr = state
        .sessions
        .lock()
        .map_err(|_| "Session lock poisoned".to_string())?;
    mgr.sync_live(window.label(), record);
    Ok(())
}

#[tauri::command]
pub fn save_session_snapshot(
    app: AppHandle,
    state: State<'_, AppState>,
    record: SessionRecord,
    as_named: bool,
) -> Result<SessionRecord, String> {
    let ring_size = state
        .config
        .read()
        .map(|c| c.session.ring_buffer_size)
        .unwrap_or(8);

    let mut mgr = state
        .sessions
        .lock()
        .map_err(|_| "Session lock poisoned".to_string())?;

    let saved = if as_named || record.kind == "named" {
        mgr.save_named(record)?
    } else {
        mgr.save_ephemeral(record, ring_size)?
    };
    let store_snapshot = mgr.store.clone();
    drop(mgr);

    let _ = app.emit("sessions:updated", store_snapshot);
    Ok(saved)
}

#[tauri::command]
pub fn delete_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut mgr = state
        .sessions
        .lock()
        .map_err(|_| "Session lock poisoned".to_string())?;
    mgr.delete(&session_id)?;
    let store_snapshot = mgr.store.clone();
    drop(mgr);

    let _ = app.emit("sessions:updated", store_snapshot);
    Ok(())
}
