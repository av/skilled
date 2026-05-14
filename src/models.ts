export interface SkillCall {
  skill: string;
  timestamp: Date;
  project: string;
  sessionId: string;
  source: string;
}

export interface SkillCount {
  skill: string;
  count: number;
  projects: number;
  sessions: number;
  lastUsed: Date;
}

export interface DayCount {
  date: string;
  count: number;
}
