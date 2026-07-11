use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSnapshot {
    pub conversation: Value,
    #[serde(default)]
    pub run_events: Vec<Value>,
    #[serde(default)]
    pub artifacts: Vec<Value>,
}

pub struct NaviStorage {
    conn: Connection,
}

impl NaviStorage {
    pub fn open(path: impl AsRef<Path>) -> rusqlite::Result<Self> {
        if let Some(parent) = path.as_ref().parent() {
            fs::create_dir_all(parent).map_err(|error| rusqlite::Error::ToSqlConversionFailure(error.into()))?;
        }

        let storage = Self {
            conn: Connection::open(path)?,
        };
        storage.migrate()?;
        Ok(storage)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let storage = Self {
            conn: Connection::open_in_memory()?,
        };
        storage.migrate()?;
        Ok(storage)
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                project_name TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                processing TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tool_calls (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                server_name TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                status TEXT NOT NULL,
                risk TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS run_events (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                kind TEXT NOT NULL,
                source TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS provider_configs (
                id TEXT PRIMARY KEY,
                provider_type TEXT NOT NULL,
                name TEXT NOT NULL,
                base_url TEXT,
                default_model_id TEXT NOT NULL,
                has_api_key INTEGER NOT NULL DEFAULT 0,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS local_models (
                id TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_size_bytes INTEGER NOT NULL,
                added_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_id ON tool_calls(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_run_events_conversation_id ON run_events(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_artifacts_conversation_id ON artifacts(conversation_id);
            ",
        )
    }

    pub fn save_conversation_snapshot(&self, snapshot: &ConversationSnapshot) -> rusqlite::Result<()> {
        let conversation_id = string_at(&snapshot.conversation, "id");

        self.conn.execute(
            "
            INSERT INTO conversations (
                id,
                title,
                project_name,
                provider,
                model,
                processing,
                is_pinned,
                updated_at,
                payload_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                project_name = excluded.project_name,
                provider = excluded.provider,
                model = excluded.model,
                processing = excluded.processing,
                is_pinned = excluded.is_pinned,
                updated_at = excluded.updated_at,
                payload_json = excluded.payload_json
            ",
            params![
                conversation_id,
                string_at(&snapshot.conversation, "title"),
                string_at(&snapshot.conversation, "projectName"),
                string_at(&snapshot.conversation, "provider"),
                string_at(&snapshot.conversation, "model"),
                string_at(&snapshot.conversation, "processing"),
                bool_at(&snapshot.conversation, "isPinned") as i64,
                string_at(&snapshot.conversation, "updatedAt"),
                snapshot.conversation.to_string(),
            ],
        )?;

        self.conn.execute(
            "DELETE FROM messages WHERE conversation_id = ?1",
            params![conversation_id],
        )?;
        self.conn.execute(
            "DELETE FROM run_events WHERE conversation_id = ?1",
            params![conversation_id],
        )?;
        self.conn.execute(
            "DELETE FROM artifacts WHERE conversation_id = ?1",
            params![conversation_id],
        )?;

        if let Some(messages) = snapshot.conversation.get("messages").and_then(Value::as_array) {
            for message in messages {
                self.insert_message(&conversation_id, message)?;
            }
        }

        for event in &snapshot.run_events {
            self.insert_run_event(&conversation_id, event)?;
        }

        for artifact in &snapshot.artifacts {
            self.insert_artifact(&conversation_id, artifact)?;
        }

        Ok(())
    }

    pub fn load_conversation_snapshots(&self) -> rusqlite::Result<Vec<ConversationSnapshot>> {
        let mut statement = self.conn.prepare(
            "
            SELECT payload_json
            FROM conversations
            ORDER BY updated_at DESC, rowid DESC
            ",
        )?;

        let conversations = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut snapshots = Vec::new();

        for conversation_json in conversations {
            let conversation: Value = serde_json::from_str(&conversation_json?)
                .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, error.into()))?;
            let conversation_id = string_at(&conversation, "id");

            snapshots.push(ConversationSnapshot {
                conversation,
                run_events: self.load_json_payloads("run_events", &conversation_id)?,
                artifacts: self.load_json_payloads("artifacts", &conversation_id)?,
            });
        }

        Ok(snapshots)
    }

    pub fn save_provider_config(&self, config: &Value) -> rusqlite::Result<()> {
        let mut safe_config = config.clone();
        if let Some(object) = safe_config.as_object_mut() {
            object.remove("apiKey");
        }

        self.conn.execute(
            "
            INSERT INTO provider_configs (
                id,
                provider_type,
                name,
                base_url,
                default_model_id,
                has_api_key,
                payload_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
                provider_type = excluded.provider_type,
                name = excluded.name,
                base_url = excluded.base_url,
                default_model_id = excluded.default_model_id,
                has_api_key = excluded.has_api_key,
                payload_json = excluded.payload_json
            ",
            params![
                string_at(&safe_config, "id"),
                string_at(&safe_config, "type"),
                string_at(&safe_config, "name"),
                optional_string_at(&safe_config, "baseUrl"),
                string_at(&safe_config, "defaultModelId"),
                bool_at(&safe_config, "hasApiKey") as i64,
                safe_config.to_string(),
            ],
        )?;
        Ok(())
    }

    pub fn load_provider_configs(&self) -> rusqlite::Result<Vec<Value>> {
        let mut statement = self.conn.prepare(
            "
            SELECT payload_json
            FROM provider_configs
            ORDER BY rowid DESC
            ",
        )?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut configs = Vec::new();

        for row in rows {
            let value = serde_json::from_str(&row?)
                .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, error.into()))?;
            configs.push(value);
        }

        Ok(configs)
    }

    pub fn save_local_model(&self, model: &Value) -> rusqlite::Result<()> {
        self.conn.execute(
            "
            INSERT INTO local_models (
                id,
                file_name,
                file_path,
                file_size_bytes,
                added_at,
                payload_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                file_name = excluded.file_name,
                file_path = excluded.file_path,
                file_size_bytes = excluded.file_size_bytes,
                added_at = excluded.added_at,
                payload_json = excluded.payload_json
            ",
            params![
                string_at(model, "id"),
                string_at(model, "fileName"),
                string_at(model, "filePath"),
                model.get("fileSizeBytes").and_then(Value::as_i64).unwrap_or_default(),
                string_at(model, "addedAt"),
                model.to_string(),
            ],
        )?;
        Ok(())
    }

    pub fn load_local_models(&self) -> rusqlite::Result<Vec<Value>> {
        let mut statement = self.conn.prepare(
            "
            SELECT payload_json
            FROM local_models
            ORDER BY rowid DESC
            ",
        )?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut models = Vec::new();

        for row in rows {
            let value = serde_json::from_str(&row?)
                .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, error.into()))?;
            models.push(value);
        }

        Ok(models)
    }

    pub fn delete_local_model(&self, id: &str) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM local_models WHERE id = ?1", params![id])?;
        Ok(())
    }

    fn insert_message(&self, conversation_id: &str, message: &Value) -> rusqlite::Result<()> {
        self.conn.execute(
            "
            INSERT INTO messages (id, conversation_id, role, content, created_at, payload_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                string_at(message, "id"),
                conversation_id,
                string_at(message, "role"),
                string_at(message, "content"),
                string_at(message, "createdAt"),
                message.to_string(),
            ],
        )?;

        if let Some(tool_calls) = message.get("toolCalls").and_then(Value::as_array) {
            for tool_call in tool_calls {
                self.conn.execute(
                    "
                    INSERT INTO tool_calls (
                        id,
                        message_id,
                        conversation_id,
                        server_name,
                        tool_name,
                        status,
                        risk,
                        payload_json
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                    ",
                    params![
                        string_at(tool_call, "id"),
                        string_at(message, "id"),
                        conversation_id,
                        string_at(tool_call, "serverName"),
                        string_at(tool_call, "toolName"),
                        string_at(tool_call, "status"),
                        string_at(tool_call, "risk"),
                        tool_call.to_string(),
                    ],
                )?;
            }
        }

        Ok(())
    }

    fn insert_run_event(&self, conversation_id: &str, event: &Value) -> rusqlite::Result<()> {
        self.conn.execute(
            "
            INSERT INTO run_events (id, conversation_id, event_type, timestamp, payload_json)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ",
            params![
                string_at(event, "id"),
                conversation_id,
                string_at(event, "type"),
                string_at(event, "timestamp"),
                event.to_string(),
            ],
        )?;
        Ok(())
    }

    fn insert_artifact(&self, conversation_id: &str, artifact: &Value) -> rusqlite::Result<()> {
        self.conn.execute(
            "
            INSERT INTO artifacts (id, conversation_id, title, kind, source, payload_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                string_at(artifact, "id"),
                conversation_id,
                string_at(artifact, "title"),
                string_at(artifact, "kind"),
                string_at(artifact, "source"),
                artifact.to_string(),
            ],
        )?;
        Ok(())
    }

    fn load_json_payloads(&self, table: &str, conversation_id: &str) -> rusqlite::Result<Vec<Value>> {
        let sql = format!(
            "SELECT payload_json FROM {table} WHERE conversation_id = ?1 ORDER BY rowid ASC"
        );
        let mut statement = self.conn.prepare(&sql)?;
        let rows = statement.query_map(params![conversation_id], |row| row.get::<_, String>(0))?;
        let mut values = Vec::new();

        for row in rows {
            let value = serde_json::from_str(&row?)
                .map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, error.into()))?;
            values.push(value);
        }

        Ok(values)
    }

    #[cfg(test)]
    fn count_rows(&self, table: &str) -> rusqlite::Result<i64> {
        self.conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
    }
}

fn string_at(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn optional_string_at(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(ToString::to_string)
}

fn bool_at(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> ConversationSnapshot {
        ConversationSnapshot {
            conversation: serde_json::json!({
                "id": "chat-1",
                "title": "SQLite test",
                "projectName": "Navi",
                "provider": "Test provider",
                "model": "Test model",
                "processing": "local",
                "isPinned": true,
                "updatedAt": "Today",
                "messages": [
                    {
                        "id": "message-1",
                        "role": "user",
                        "content": "Persist this.",
                        "createdAt": "2026-07-11T00:00:00.000Z"
                    },
                    {
                        "id": "message-2",
                        "role": "assistant",
                        "content": "Saved.",
                        "createdAt": "2026-07-11T00:00:01.000Z",
                        "toolCalls": [
                            {
                                "id": "tool-1",
                                "serverName": "Local project",
                                "toolName": "read_plan",
                                "status": "completed",
                                "risk": "read",
                                "summary": "Read PLAN.md"
                            }
                        ]
                    }
                ]
            }),
            run_events: vec![serde_json::json!({
                "id": "event-1",
                "type": "run_completed",
                "timestamp": "2026-07-11T00:00:02.000Z"
            })],
            artifacts: vec![serde_json::json!({
                "id": "artifact-1",
                "title": "Artifact",
                "kind": "markdown",
                "source": "# Artifact"
            })],
        }
    }

    #[test]
    fn saves_and_loads_conversation_snapshots() {
        let storage = NaviStorage::open_in_memory().expect("storage should open");

        storage
            .save_conversation_snapshot(&snapshot())
            .expect("snapshot should save");

        let snapshots = storage
            .load_conversation_snapshots()
            .expect("snapshots should load");

        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].conversation["title"], "SQLite test");
        assert_eq!(snapshots[0].run_events.len(), 1);
        assert_eq!(snapshots[0].artifacts.len(), 1);
        assert_eq!(storage.count_rows("messages").unwrap(), 2);
        assert_eq!(storage.count_rows("tool_calls").unwrap(), 1);
    }

    #[test]
    fn saves_provider_config_without_secret_material() {
        let storage = NaviStorage::open_in_memory().expect("storage should open");
        let config = serde_json::json!({
            "id": "provider-1",
            "type": "openai-compatible",
            "name": "Local compatible",
            "baseUrl": "http://localhost:8080/v1",
            "defaultModelId": "local-model",
            "hasApiKey": true,
            "models": [
                {
                    "id": "local-model",
                    "name": "local-model",
                    "provider": "Local compatible",
                    "location": "external",
                    "capabilities": ["tools"],
                    "contextTokens": 128000
                }
            ],
            "apiKey": "should-not-save"
        });

        storage
            .save_provider_config(&config)
            .expect("provider should save");

        let configs = storage
            .load_provider_configs()
            .expect("providers should load");

        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0]["name"], "Local compatible");
        assert!(configs[0].get("apiKey").is_none());
        assert!(!configs[0].to_string().contains("should-not-save"));
    }

    #[test]
    fn saves_loads_and_deletes_local_models() {
        let storage = NaviStorage::open_in_memory().expect("storage should open");
        let model = serde_json::json!({
            "id": "model-1",
            "fileName": "test-model.gguf",
            "filePath": "/models/test-model.gguf",
            "fileSizeBytes": 4_294_967_296i64,
            "addedAt": "2026-07-11T00:00:00.000Z",
            "architecture": "llama",
            "quantization": "Q4_K_M",
            "contextLength": 8192,
            "parseStatus": "parsed"
        });

        storage.save_local_model(&model).expect("model should save");

        let models = storage.load_local_models().expect("models should load");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0]["fileName"], "test-model.gguf");
        assert_eq!(models[0]["architecture"], "llama");

        storage.delete_local_model("model-1").expect("model should delete");
        let models = storage.load_local_models().expect("models should load");
        assert_eq!(models.len(), 0);
    }
}
