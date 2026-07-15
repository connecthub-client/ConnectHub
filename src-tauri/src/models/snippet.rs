use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: Uuid,
    pub label: String,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SnippetInput {
    pub label: String,
    pub body: String,
}
