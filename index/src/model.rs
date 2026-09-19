#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillCall {
    pub skill: String,
    pub timestamp_ms: i64,
    pub project: String,
    pub session_id: String,
    pub source: String,
    /// Session/history file the call was read from (empty when unknown).
    pub file: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderResult {
    pub name: String,
    pub available: bool,
    pub calls: Vec<SkillCall>,
}
