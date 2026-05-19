import type { SkillCall, SkillCount } from "./models.js";

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

export function hourlyCounts(calls: SkillCall[]): number[] {
  const result = new Array(24).fill(0);
  for (const c of calls) {
    result[c.timestamp.getHours()]++;
  }
  return result;
}

export function projectShort(path: string): string {
  const parts = path.replace(/[\\/]$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function timeAgo(date: Date): string {
  const ts = date.getTime();
  if (!Number.isFinite(ts)) return "unknown";
  const diff = Date.now() - ts;
  if (diff < 0) return "future";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months}mo`;
  }
  const years = Math.floor(days / 365);
  return `${years}y`;
}

export interface SkillDetail {
  skill: string;
  count: number;
  sessions: number;
  firstUsed: Date;
  lastUsed: Date;
  projects: { name: string; count: number }[];
  weeklyUsage: number[];
}

export function skillDetail(calls: SkillCall[], skillName: string): SkillDetail {
  const filtered = calls.filter(c => c.skill === skillName);
  if (filtered.length === 0) {
    return { skill: skillName, count: 0, sessions: 0, firstUsed: new Date(), lastUsed: new Date(), projects: [], weeklyUsage: new Array(16).fill(0) };
  }

  const sessions = new Set<string>();
  let firstUsed = filtered[0]!.timestamp;
  let lastUsed = filtered[0]!.timestamp;
  const projCounts = new Map<string, number>();

  for (const c of filtered) {
    sessions.add(c.sessionId);
    if (c.timestamp < firstUsed) firstUsed = c.timestamp;
    if (c.timestamp > lastUsed) lastUsed = c.timestamp;
    const name = projectShort(c.project);
    projCounts.set(name, (projCounts.get(name) ?? 0) + 1);
  }

  const projects = [...projCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Compute weekly buckets using local-time date arithmetic to avoid DST bugs.
  // Fixed ms arithmetic (7 * 86400000) can miscategorize calls near week
  // boundaries when a DST transition adds or removes an hour.
  const nowDate = new Date();
  const nowDay = nowDate.getDay(); // 0=Sun … 6=Sat
  // Start of the current week (Monday 00:00 local time)
  const mondayOffset = (nowDay + 6) % 7; // days since Monday
  const weekStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - mondayOffset);
  const weekStartMs = weekStart.getTime();

  const weeklyUsage = new Array(16).fill(0) as number[];
  for (const c of filtered) {
    // Compute days between the call and the current week's Monday using
    // local-time day boundaries, not fixed ms.  We find the Monday of the
    // call's week and compare to the current Monday.
    const cd = c.timestamp;
    const callDow = (cd.getDay() + 6) % 7; // Mon=0
    const callMonday = new Date(cd.getFullYear(), cd.getMonth(), cd.getDate() - callDow);
    // Weeks ago = difference in Mondays (in whole days / 7).
    // Using ms between two local midnights is safe: both are 00:00 local,
    // so the difference is always an exact multiple of 7 * 86400000 even
    // across DST boundaries (both dates have the same UTC offset at midnight
    // of their respective Mondays, and rounding handles the rare edge case).
    const weeksAgo = Math.round((weekStartMs - callMonday.getTime()) / (7 * 86400000));
    const idx = 15 - weeksAgo;
    if (idx >= 0 && idx < 16) weeklyUsage[idx]!++;
  }

  return { skill: skillName, count: filtered.length, sessions: sessions.size, firstUsed, lastUsed, projects, weeklyUsage };
}

export interface TrendEntry { skill: SkillCount; recentCount: number; priorCount: number; pct: number }
export interface MostUsedEntry { skill: SkillCount; share: number }

export interface SkillAudit {
  stale: SkillCount[];
  oneOff: SkillCount[];
  declining: TrendEntry[];
  rising: TrendEntry[];
  mostUsed: MostUsedEntry[];
  crossProject: SkillCount[];
  singleProject: SkillCount[];
}

export function auditSkills(calls: SkillCall[], skills: SkillCount[]): SkillAudit {
  const now = Date.now();
  const fourWeeksAgo = now - 28 * 86400000;
  const eightWeeksAgo = now - 56 * 86400000;

  const oneOff = skills.filter(s => s.count === 1);
  const oneOffSet = new Set(oneOff.map(s => s.skill));
  const stale = skills.filter(s => s.lastUsed.getTime() < fourWeeksAgo && !oneOffSet.has(s.skill));
  const staleSet = new Set(stale.map(s => s.skill));

  const recentCounts = new Map<string, number>();
  const priorCounts = new Map<string, number>();
  for (const c of calls) {
    const t = c.timestamp.getTime();
    if (t >= fourWeeksAgo) {
      recentCounts.set(c.skill, (recentCounts.get(c.skill) ?? 0) + 1);
    } else if (t >= eightWeeksAgo) {
      priorCounts.set(c.skill, (priorCounts.get(c.skill) ?? 0) + 1);
    }
  }

  const declining: TrendEntry[] = skills
    .filter(s => {
      if (staleSet.has(s.skill) || oneOffSet.has(s.skill)) return false; // already classified
      const recent = recentCounts.get(s.skill) ?? 0;
      const prior = priorCounts.get(s.skill) ?? 0;
      return prior > 0 && recent <= prior * 0.5;
    })
    .map(s => {
      const recentCount = recentCounts.get(s.skill) ?? 0;
      const priorCount = priorCounts.get(s.skill) ?? 0;
      const pct = Math.round((1 - recentCount / priorCount) * 100);
      return { skill: s, recentCount, priorCount, pct };
    });

  const rising: TrendEntry[] = skills
    .filter(s => {
      if (staleSet.has(s.skill) || oneOffSet.has(s.skill)) return false;
      const recent = recentCounts.get(s.skill) ?? 0;
      const prior = priorCounts.get(s.skill) ?? 0;
      return prior > 0 && recent >= prior * 1.5;
    })
    .map(s => {
      const recentCount = recentCounts.get(s.skill) ?? 0;
      const priorCount = priorCounts.get(s.skill) ?? 0;
      const pct = Math.round((recentCount / priorCount - 1) * 100);
      return { skill: s, recentCount, priorCount, pct };
    });

  const decliningSet = new Set(declining.map(d => d.skill.skill));
  const risingSet = new Set(rising.map(r => r.skill.skill));
  const recentTotal = [...recentCounts.values()].reduce((sum, n) => sum + n, 0);
  const mostUsed = [...skills]
    .filter(s => !decliningSet.has(s.skill) && !risingSet.has(s.skill) && !staleSet.has(s.skill) && !oneOffSet.has(s.skill))
    .sort((a, b) => (recentCounts.get(b.skill) ?? 0) - (recentCounts.get(a.skill) ?? 0))
    .slice(0, 10)
    .filter(s => (recentCounts.get(s.skill) ?? 0) > 0)
    .map(s => ({ skill: s, share: recentTotal > 0 ? (recentCounts.get(s.skill) ?? 0) / recentTotal : 0 }));

  const crossProject = skills
    .filter(s => s.projects >= 3)
    .sort((a, b) => b.projects - a.projects);

  const singleProject = skills
    .filter(s => s.projects === 1 && !oneOffSet.has(s.skill))
    .sort((a, b) => b.count - a.count);

  return { stale, oneOff, declining, rising, mostUsed, crossProject, singleProject };
}
