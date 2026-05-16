pub struct SkillCall {
    pub skill: String,
    pub timestamp_ms: i64,
    pub project: String,
    pub session_id: String,
    pub source: String,
}

pub struct ProviderResult {
    pub name: String,
    pub available: bool,
    pub calls: Vec<SkillCall>,
}
