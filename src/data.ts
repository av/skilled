import type { SkillCall, SkillCount, DayCount } from "./models.js";

export function skillCounts(calls: SkillCall[]): SkillCount[] {
  const counts = new Map<string, { count: number; projects: Set<string>; sessions: Set<string>; lastUsed: Date }>();

  for (const c of calls) {
    let entry = counts.get(c.skill);
    if (!entry) {
      entry = { count: 0, projects: new Set(), sessions: new Set(), lastUsed: c.timestamp };
      counts.set(c.skill, entry);
    }
    entry.count++;
    entry.projects.add(c.project);
    entry.sessions.add(c.sessionId);
    if (c.timestamp > entry.lastUsed) entry.lastUsed = c.timestamp;
  }

  return [...counts.entries()]
    .map(([skill, e]) => ({
      skill,
      count: e.count,
      projects: e.projects.size,
      sessions: e.sessions.size,
      lastUsed: e.lastUsed,
    }))
    .sort((a, b) => b.count - a.count);
}

export function dailyCounts(calls: SkillCall[]): DayCount[] {
  const counts = new Map<string, number>();
  for (const c of calls) {
    const day = c.timestamp.toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function weeklyCounts(calls: SkillCall[], weeks: number): number[] {
  const now = new Date();
  const result = new Array(weeks).fill(0);

  for (const c of calls) {
    const diffMs = now.getTime() - c.timestamp.getTime();
    const weekIdx = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    if (weekIdx >= 0 && weekIdx < weeks) {
      result[weeks - 1 - weekIdx]++;
    }
  }
  return result;
}

export function projectShort(path: string): string {
  const parts = path.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || path;
}

export function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
