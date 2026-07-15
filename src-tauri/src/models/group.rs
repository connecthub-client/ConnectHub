use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub name: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GroupInput {
    pub parent_id: Option<Uuid>,
    pub name: String,
    pub sort_order: i32,
}
