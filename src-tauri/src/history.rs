use crate::error::AppResult;
use crate::paths::db_path;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dictation {
    pub id: String,
    pub text: String,
    pub raw_text: String,
    pub language: String,
    pub model_id: String,
    pub duration_ms: u64,
    pub created_at: DateTime<Utc>,
    pub kind: String,
}

pub struct HistoryDb {
    conn: Mutex<Connection>,
}

impl HistoryDb {
    pub fn open() -> AppResult<Self> {
        let conn = Connection::open(db_path())?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS dictations (
              id TEXT PRIMARY KEY,
              text TEXT NOT NULL,
              raw_text TEXT NOT NULL,
              language TEXT NOT NULL,
              model_id TEXT NOT NULL,
              duration_ms INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              kind TEXT NOT NULL DEFAULT 'dictation'
            );
            CREATE INDEX IF NOT EXISTS idx_dictations_created ON dictations(created_at DESC);
            CREATE TABLE IF NOT EXISTS meetings (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              transcript TEXT NOT NULL,
              summary TEXT NOT NULL,
              created_at TEXT NOT NULL,
              duration_ms INTEGER NOT NULL
            );
            "#,
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn insert_dictation(
        &self,
        text: &str,
        raw_text: &str,
        language: &str,
        model_id: &str,
        duration_ms: u64,
        kind: &str,
    ) -> AppResult<Dictation> {
        let item = Dictation {
            id: Uuid::new_v4().to_string(),
            text: text.to_string(),
            raw_text: raw_text.to_string(),
            language: language.to_string(),
            model_id: model_id.to_string(),
            duration_ms,
            created_at: Utc::now(),
            kind: kind.to_string(),
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO dictations (id, text, raw_text, language, model_id, duration_ms, created_at, kind)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                item.id,
                item.text,
                item.raw_text,
                item.language,
                item.model_id,
                item.duration_ms as i64,
                item.created_at.to_rfc3339(),
                item.kind
            ],
        )?;
        Ok(item)
    }

    pub fn list(&self, limit: usize) -> AppResult<Vec<Dictation>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, text, raw_text, language, model_id, duration_ms, created_at, kind
             FROM dictations ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], |row| {
            Ok(Dictation {
                id: row.get(0)?,
                text: row.get(1)?,
                raw_text: row.get(2)?,
                language: row.get(3)?,
                model_id: row.get(4)?,
                duration_ms: row.get::<_, i64>(5)? as u64,
                created_at: DateTime::parse_from_rfc3339(&row.get::<_, String>(6)?)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                kind: row.get(7)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get(&self, id: &str) -> AppResult<Option<Dictation>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, text, raw_text, language, model_id, duration_ms, created_at, kind
             FROM dictations WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([id], |row| {
            Ok(Dictation {
                id: row.get(0)?,
                text: row.get(1)?,
                raw_text: row.get(2)?,
                language: row.get(3)?,
                model_id: row.get(4)?,
                duration_ms: row.get::<_, i64>(5)? as u64,
                created_at: DateTime::parse_from_rfc3339(&row.get::<_, String>(6)?)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                kind: row.get(7)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn search(&self, query: &str, limit: usize) -> AppResult<Vec<Dictation>> {
        let conn = self.conn.lock().unwrap();
        let like = format!("%{query}%");
        let mut stmt = conn.prepare(
            "SELECT id, text, raw_text, language, model_id, duration_ms, created_at, kind
             FROM dictations WHERE text LIKE ?1 OR raw_text LIKE ?1
             ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![like, limit as i64], |row| {
            Ok(Dictation {
                id: row.get(0)?,
                text: row.get(1)?,
                raw_text: row.get(2)?,
                language: row.get(3)?,
                model_id: row.get(4)?,
                duration_ms: row.get::<_, i64>(5)? as u64,
                created_at: DateTime::parse_from_rfc3339(&row.get::<_, String>(6)?)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                kind: row.get(7)?,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn insert_meeting(
        &self,
        title: &str,
        transcript: &str,
        summary: &str,
        duration_ms: u64,
    ) -> AppResult<Meeting> {
        let item = Meeting {
            id: Uuid::new_v4().to_string(),
            title: title.to_string(),
            transcript: transcript.to_string(),
            summary: summary.to_string(),
            created_at: Utc::now(),
            duration_ms,
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO meetings (id, title, transcript, summary, created_at, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                item.id,
                item.title,
                item.transcript,
                item.summary,
                item.created_at.to_rfc3339(),
                item.duration_ms as i64
            ],
        )?;
        Ok(item)
    }

    pub fn list_meetings(&self, limit: usize) -> AppResult<Vec<Meeting>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, transcript, summary, created_at, duration_ms
             FROM meetings ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], |row| {
            Ok(Meeting {
                id: row.get(0)?,
                title: row.get(1)?,
                transcript: row.get(2)?,
                summary: row.get(3)?,
                created_at: DateTime::parse_from_rfc3339(&row.get::<_, String>(4)?)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                duration_ms: row.get::<_, i64>(5)? as u64,
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn get_meeting(&self, id: &str) -> AppResult<Option<Meeting>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, transcript, summary, created_at, duration_ms
             FROM meetings WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map([id], |row| {
            Ok(Meeting {
                id: row.get(0)?,
                title: row.get(1)?,
                transcript: row.get(2)?,
                summary: row.get(3)?,
                created_at: DateTime::parse_from_rfc3339(&row.get::<_, String>(4)?)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
                duration_ms: row.get::<_, i64>(5)? as u64,
            })
        })?;
        Ok(rows.next().transpose()?)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub transcript: String,
    pub summary: String,
    pub created_at: DateTime<Utc>,
    pub duration_ms: u64,
}
