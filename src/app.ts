import {
  createCliRenderer,
  Box,
  RGBA,
  type BoxRenderable,
  type OptimizedBuffer,
  engine,
} from "@opentui/core";
import type { Provider } from "./providers/base.js";
import type { SkillCall, SkillCount } from "./models.js";
import { skillCounts, hourlyCounts, projectShort, timeAgo, skillDetail, auditSkills } from "./data.js";
import type { SkillDetail, SkillAudit } from "./data.js";
import { colors, barColors, barPalette, heatmapColors } from "./theme.js";
import { fbm } from "./noise.js";

const BLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const HEATMAP_WEEKS = 16;

const NOISE_CHARS = [" ", "░", "▒", "▓", "█"];
const NOISE_COLORS = [
  RGBA.fromHex("#040E0D"), RGBA.fromHex("#0A1E1A"), RGBA.fromHex("#103328"),
  RGBA.fromHex("#184A3A"), RGBA.fromHex("#20614D"), RGBA.fromHex("#2D7A62"),
  RGBA.fromHex("#3D9478"), RGBA.fromHex("#50AE90"),
];
const FONT_FG = RGBA.fromHex("#D4EDE5");
const FONT_SHADOW = RGBA.fromHex("#061A15");
const GLITCH_CHARS = ["█", "▓", "▒", "░", "╌", "╍", "┃", "╳", "▞", "▚"];
const GLITCH_COLORS = [
  RGBA.fromHex("#C49058"), RGBA.fromHex("#50AE90"), RGBA.fromHex("#88A074"),
  RGBA.fromHex("#D4EDE5"), RGBA.fromHex("#A89866"), RGBA.fromHex("#3D9478"),
];

const PIXEL_FONT: Record<string, number[][]> = {
  S: [
    [1, 1, 1, 1],
    [1, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 1],
    [1, 1, 1, 1],
  ],
  K: [
    [1, 0, 0, 1],
    [1, 0, 1, 0],
    [1, 1, 0, 0],
    [1, 0, 1, 0],
    [1, 0, 0, 1],
  ],
  I: [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 1],
  ],
  L: [
    [1, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 1, 1, 1],
  ],
  E: [
    [1, 1, 1, 1],
    [1, 0, 0, 0],
    [1, 1, 1, 0],
    [1, 0, 0, 0],
    [1, 1, 1, 1],
  ],
  D: [
    [1, 1, 1, 0],
    [1, 0, 0, 1],
    [1, 0, 0, 1],
    [1, 0, 0, 1],
    [1, 1, 1, 0],
  ],
};

type SortMode = "count" | "alpha" | "recent";
const SORT_LABELS: Record<SortMode, string> = {
  count: "by count",
  alpha: "a-z",
  recent: "by recent",
};
const SORT_CYCLE: SortMode[] = ["count", "alpha", "recent"];
const SORT_DEFAULT_ASC: Record<SortMode, boolean> = {
  count: false,
  alpha: true,
  recent: false,
};

interface FilterCriteria {
  sources: string[];
  projects: string[];
  skills: string[];
}

function parseFilterExpr(expr: string): FilterCriteria {
  const sources: string[] = [];
  const projects: string[] = [];
  const skills: string[] = [];
  for (const token of expr.trim().split(/\s+/)) {
    if (!token) continue;
    const m = token.match(/^(source|src|s|project|proj|p):(.+)$/i);
    if (m) {
      const tag = m[1]!.toLowerCase();
      const val = m[2]!.toLowerCase();
      if (tag === "s" || tag === "src" || tag === "source") sources.push(val);
      else projects.push(val);
    } else {
      skills.push(token.toLowerCase());
    }
  }
  return { sources, projects, skills };
}

function exprColors(expr: string): RGBA[] {
  const result = new Array<RGBA>(expr.length).fill(RGBA.fromHex("#3D5C52"));
  let pos = 0;
  const accent = RGBA.fromHex("#50AE90");
  const text = RGBA.fromHex("#D4EDE5");
  const muted = RGBA.fromHex("#7A9E94");
  while (pos < expr.length) {
    if (expr[pos] === " ") { pos++; continue; }
    let end = pos;
    while (end < expr.length && expr[end] !== " ") end++;
    const token = expr.slice(pos, end);
    const m = token.match(/^(source|src|s|project|proj|p):(.*)$/i);
    if (m) {
      const tagLen = m[1]!.length + 1;
      for (let i = pos; i < pos + tagLen; i++) result[i] = accent;
      for (let i = pos + tagLen; i < end; i++) result[i] = text;
    } else {
      for (let i = pos; i < end; i++) result[i] = muted;
    }
    pos = end;
  }
  return result;
}

function outExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function outBack(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

function lerpHex(a: string, b: string, t: number): string {
  const p = (s: string, o: number) => parseInt(s.slice(o, o + 2), 16);
  const mix = (ao: number) => Math.round(p(a, ao) + (p(b, ao) - p(a, ao)) * t);
  const r = mix(1), g = mix(3), bl = mix(5);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}


function drawBar(buf: OptimizedBuffer, x: number, y: number, width: number, fg: RGBA, bg: RGBA) {
  const full = Math.floor(width);
  const frac = Math.round((width - full) * 8);
  for (let i = 0; i < full; i++) buf.setCell(x + i, y, "█", fg, bg);
  if (frac > 0) buf.setCell(x + full, y, BLOCKS[frac]!, fg, bg);
}

function sortSkills(skills: SkillCount[], mode: SortMode, asc: boolean): SkillCount[] {
  const copy = [...skills];
  switch (mode) {
    case "count":
      return copy.sort((a, b) => asc ? a.count - b.count : b.count - a.count);
    case "alpha":
      return copy.sort((a, b) => asc ? a.skill.localeCompare(b.skill) : b.skill.localeCompare(a.skill));
    case "recent":
      return copy.sort((a, b) => asc ? a.lastUsed.getTime() - b.lastUsed.getTime() : b.lastUsed.getTime() - a.lastUsed.getTime());
  }
}

function buildHeatmapGrid(calls: SkillCall[]): { grid: number[][]; maxVal: number } {
  const now = new Date();
  const todayDow = (now.getUTCDay() + 6) % 7;
  const startMs = now.getTime() - ((HEATMAP_WEEKS - 1) * 7 + todayDow) * 86400000;

  const dayCounts = new Map<string, number>();
  for (const c of calls) {
    const d = c.timestamp.toISOString().slice(0, 10);
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  }

  let maxVal = 0;
  const grid: number[][] = [];
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const col: number[] = [];
    for (let d = 0; d < 7; d++) {
      const ms = startMs + (w * 7 + d) * 86400000;
      const dateStr = new Date(ms).toISOString().slice(0, 10);
      const v = dayCounts.get(dateStr) ?? 0;
      if (v > maxVal) maxVal = v;
      col.push(v);
    }
    grid.push(col);
  }
  return { grid, maxVal };
}

export async function run(providers: Provider[], getProviders?: () => Provider[]) {
  const allCalls: SkillCall[] = [];
  const sourceNames: string[] = [];
  for (const p of providers) {
    if (p.available()) {
      const calls = p.collect();
      allCalls.push(...calls);
      if (calls.length > 0) sourceNames.push(p.name);
    }
  }
  allCalls.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // --- filter + derived data ---
  function applyFilter(calls: SkillCall[]): SkillCall[] {
    const { sources, projects, skills } = parseFilterExpr(state.filterExpr);
    let result = calls;
    if (sources.length) result = result.filter(c => sources.some(s => c.source.toLowerCase().includes(s)));
    if (projects.length) result = result.filter(c => projects.some(p => projectShort(c.project).toLowerCase().includes(p)));
    if (skills.length) result = result.filter(c => skills.some(s => c.skill.toLowerCase().includes(s)));
    return result;
  }

  function recompute() {
    const filtered = applyFilter(allCalls);
    state.filteredCalls = filtered;
    state.skills = sortSkills(skillCounts(filtered), state.sortMode, state.sortAsc);
    state.hourly = hourlyCounts(filtered);
    state.heatData = buildHeatmapGrid(filtered);
    state.recentCalls = filtered.slice(0, 20);
    state.uniqueProjects = new Set(filtered.map((c) => c.project)).size;
    state.uniqueSources = new Set(filtered.map((c) => c.source)).size;
    state.scroll = 0;
    state.selectedIndex = Math.min(state.selectedIndex, Math.max(0, state.skills.length - 1));
    if (state.detailSkill) {
      if (state.skills.length > 0) {
        // Try to keep the detail on the same skill after filtering/sorting.
        // If the skill is still in the list, track it; otherwise follow selectedIndex.
        const keepIdx = state.skills.findIndex(s => s.skill === state.detailSkill);
        if (keepIdx >= 0) {
          state.selectedIndex = keepIdx;
          if (state.selectedIndex < state.scroll) {
            state.scroll = state.selectedIndex;
          }
        }
        state.detailSkill = state.skills[state.selectedIndex]!.skill;
        state.detailData = skillDetail(state.filteredCalls, state.detailSkill);
      } else {
        // Filter eliminated all skills — close the detail view to avoid
        // showing stale data that doesn't reflect the active filter.
        state.detailSkill = null;
        state.detailData = null;
      }
    }
  }

  function buildAuditLines() {
    if (!state.auditData) { state.auditLines = []; return; }
    const audit = state.auditData;
    const lines: { text: string; fg: RGBA }[] = [];
    const warn = RGBA.fromHex("#C49058");
    const info = RGBA.fromHex("#50AE90");
    const danger = RGBA.fromHex("#CC6644");
    const success = RGBA.fromHex("#6BA783");
    const purple = RGBA.fromHex("#D4EDE5");
    const pink = RGBA.fromHex("#A89866");

    function section(icon: string, title: string, count: number, color: RGBA, items: string[]) {
      lines.push({ text: `${icon} ${title} (${count})`, fg: color });
      lines.push({ text: "─".repeat(56), fg: colors.border });
      if (items.length === 0) {
        lines.push({ text: "  none", fg: colors.textDim });
      } else {
        for (const item of items) lines.push({ text: `  ${item}`, fg: colors.textMuted });
      }
      lines.push({ text: "", fg: colors.bg });
    }

    section("★", "MOST USED — last 4 weeks", audit.mostUsed.length, purple,
      audit.mostUsed.map(h => {
        const pct = `${Math.round(h.share * 100)}%`.padStart(4);
        return `${h.skill.skill.padEnd(22)} ${pct}   ${String(h.skill.count).padStart(4)} calls   ${h.skill.projects} proj`;
      }));

    section("▲", "RISING — 50%+ growth last 4w", audit.rising.length, success,
      audit.rising.map(r => {
        return `${r.skill.skill.padEnd(22)} now: ${String(r.recentCount).padStart(3)}  was: ${String(r.priorCount).padStart(3)}   ↑${r.pct}%`;
      }));

    section("▼", "DECLINING — 50%+ drop last 4w", audit.declining.length, danger,
      audit.declining.map(d => {
        return `${d.skill.skill.padEnd(22)} now: ${String(d.recentCount).padStart(3)}  was: ${String(d.priorCount).padStart(3)}   ↓${d.pct}%`;
      }));

    section("⚠", "STALE — unused 28+ days", audit.stale.length, warn,
      audit.stale.map(s => `${s.skill.padEnd(22)} last: ${timeAgo(s.lastUsed)}   ${String(s.count).padStart(4)} calls`));

    section("◈", "CROSS-PROJECT — used in 3+ projects", audit.crossProject.length, info,
      audit.crossProject.map(s => `${s.skill.padEnd(22)} ${s.projects} projects   ${String(s.count).padStart(4)} calls`));

    section("◇", "ONE-OFF — used once", audit.oneOff.length, info,
      audit.oneOff.map(s => `${s.skill.padEnd(22)} ${timeAgo(s.lastUsed)} ago`));

    section("▪", "SINGLE-PROJECT — 1 project only", audit.singleProject.length, pink,
      audit.singleProject.slice(0, 10).map(s => `${s.skill.padEnd(22)} ${String(s.count).padStart(4)} calls`));

    state.auditLines = lines;
  }

  // --- mutable state ---
  const state = {
    sortMode: "count" as SortMode,
    sortAsc: false,
    filterExpr: "",
    filterFocused: false,
    cursorPos: 0,
    skills: sortSkills(skillCounts(allCalls), "count", false),
    hourly: hourlyCounts(allCalls),
    heatData: buildHeatmapGrid(allCalls),
    recentCalls: allCalls.slice(0, 20),
    filteredCalls: allCalls,
    uniqueProjects: new Set(allCalls.map((c) => c.project)).size,
    uniqueSources: sourceNames.length,
    scroll: 0,
    visibleRows: 0,
    selectedIndex: 0,
    detailSkill: null as string | null,
    detailData: null as SkillDetail | null,
    auditOpen: false,
    auditData: null as SkillAudit | null,
    auditScroll: 0,
    auditLines: [] as { text: string; fg: RGBA }[],
    mainArea: { x: 0, y: 0, w: 0, h: 0 },
  };

  const startTime = Date.now();
  const barStagger = 70;

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    clearOnShutdown: true,
    targetFps: 30,
    backgroundColor: "#0D1117",
  });

  engine.attach(renderer);

  renderer.root.add(
    Box(
      {
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: "#0D1117",
        live: true,
      },

      // === HEADER — perlin noise + blocky font ===
      Box({
        id: "header-noise",
        height: renderer.height >= 32 ? 7 : 5,
        renderAfter(this: BoxRenderable, buf: OptimizedBuffer, deltaTime: number) {
          const now = Date.now();
          const t = (now - startTime) / 1000;
          const ox = this.screenX;
          const oy = this.screenY;
          const w = this.width;
          const h = this.height;

          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const n = fbm(x * 0.06 + t * 0.4, y * 0.12 + t * 0.2);
              const v = Math.max(0, Math.min(1, (n + 0.5)));
              const charIdx = Math.min(4, Math.floor(v * 5));
              const colorIdx = Math.min(7, Math.floor(v * 8));
              buf.setCell(ox + x, oy + y, NOISE_CHARS[charIdx]!, NOISE_COLORS[colorIdx]!, colors.bg);
            }
          }

          const text = "SKILLED";
          const glyphs = text.split("").map((ch) => PIXEL_FONT[ch]!);
          const fontH = 5;
          const pw = renderer.height >= 32 ? 2 : 1;
          const totalW = glyphs.reduce((s, g) => s + g[0]!.length * pw + pw, -pw);
          const startX = Math.floor((w - totalW) / 2);
          const startY = Math.floor((h - fontH) / 2);

          let cx = startX;
          for (const glyph of glyphs) {
            const gw = glyph[0]!.length;
            for (let gy = 0; gy < fontH; gy++) {
              for (let gx = 0; gx < gw; gx++) {
                if (glyph[gy]![gx]) {
                  for (let px = 0; px < pw; px++) {
                    const sx = ox + cx + gx * pw + px;
                    const sy = oy + startY + gy;
                    if (sx > ox) buf.setCell(sx - 1, sy + 1, "█", FONT_SHADOW, FONT_SHADOW);
                    buf.setCell(sx, sy, "█", FONT_FG, FONT_FG);
                  }
                }
              }
            }
            cx += gw * pw + pw;
          }

          // glitch: occasional bursts
          const glitchPhase = Math.sin(t * 2.5) * Math.sin(t * 7.1);
          if (glitchPhase > 0.7) {
            const intensity = Math.floor((glitchPhase - 0.7) * 30);
            for (let i = 0; i < intensity; i++) {
              const gx = ox + Math.floor(Math.random() * w);
              const gy = oy + Math.floor(Math.random() * h);
              const gc = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]!;
              const gcolor = GLITCH_COLORS[Math.floor(Math.random() * GLITCH_COLORS.length)]!;
              buf.setCell(gx, gy, gc, gcolor, colors.bg);
            }
            // row shift — displace a random row
            if (Math.random() > 0.5) {
              const row = oy + Math.floor(Math.random() * h);
              const shift = Math.floor(Math.random() * 5) - 2;
              const raw = buf.buffers;
              const bw = buf.width;
              for (let x = 0; x < w; x++) {
                const srcX = ox + ((x - shift + w) % w);
                const dstIdx = row * bw + ox + x;
                const srcIdx = row * bw + srcX;
                raw.char[dstIdx] = raw.char[srcIdx]!;
                raw.fg[dstIdx] = raw.fg[srcIdx]!;
              }
            }
          }
        },
      }),

      // === SEPARATOR ===
      Box({
        height: 1,
        renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
          const ox = this.screenX;
          const oy = this.screenY;
          const w = this.width;
          for (let x = 0; x < w; x++) {
            buf.setCell(ox + x, oy, "░", colors.border, colors.bg);
          }
        },
      }),

      // === STATS ROW ===
      Box({
        marginX: 1,
        height: 3,
        border: true,
        borderStyle: "rounded",
        borderColor: "#30363D",
        backgroundColor: "#0D1117",
        renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
          const ox = this.screenX + 1;
          const oy = this.screenY + 1;
          const cw = this.width - 2;
          const stats = [
            { icon: "⚡", label: state.filteredCalls.length === 1 ? "CALL" : "CALLS", value: state.filteredCalls.length, color: RGBA.fromHex("#50AE90") },
            { icon: "◆", label: state.skills.length === 1 ? "SKILL" : "SKILLS", value: state.skills.length, color: RGBA.fromHex("#6BA783") },
            { icon: "▪", label: state.uniqueProjects === 1 ? "PROJECT" : "PROJECTS", value: state.uniqueProjects, color: RGBA.fromHex("#C49058") },
            { icon: "●", label: state.uniqueSources === 1 ? "SOURCE" : "SOURCES", value: state.uniqueSources, color: RGBA.fromHex("#88A074") },
          ];
          const cellW = Math.floor(cw / stats.length);
          for (let i = 0; i < stats.length; i++) {
            const s = stats[i]!;
            const str = `${s.icon} ${s.value} ${s.label}`;
            const cx = ox + i * cellW + Math.floor((cellW - str.length) / 2);
            buf.drawText(s.icon, cx, oy, s.color, colors.bg);
            buf.drawText(` ${s.value}`, cx + s.icon.length, oy, s.color, colors.bg);
            buf.drawText(` ${s.label}`, cx + s.icon.length + 1 + String(s.value).length, oy, colors.textMuted, colors.bg);
          }
        },
      }),

      // === MAIN ===
      Box(
        {
          flexDirection: "row",
          flexGrow: 1,
          paddingX: 1,
          gap: 1,
          renderAfter(this: BoxRenderable) {
            state.mainArea = { x: this.screenX, y: this.screenY, w: this.width, h: this.height };
          },
        },

        // --- LEFT COLUMN ---
        Box(
          { flexGrow: 3, flexDirection: "column" },

          // bar chart
          Box({
            id: "bars",
            flexGrow: 1,
            border: true,
            borderStyle: "rounded",
            borderColor: "#30363D",
            backgroundColor: "#0D1117",
            title: " ◆ skill frequency ",
            renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
              const now = Date.now();
              const ox = this.screenX + 1;
              const oy = this.screenY + 1;
              const cw = this.width - 2;
              const ch = this.height - 2;
              if (cw < 10 || ch < 1) return;

              state.visibleRows = ch;
              const { skills: sorted, scroll } = state;
              const total = sorted.length;
              const maxScroll = Math.max(0, total - ch);
              if (state.scroll > maxScroll) state.scroll = maxScroll;

              const labelW = Math.min(22, Math.floor(cw * 0.35));
              const countW = 4;
              const barMaxW = cw - labelW - countW - 3;
              if (barMaxW <= 0) return;
              const maxCount = sorted.reduce((m, s) => Math.max(m, s.count), 1);
              const visible = Math.min(total - scroll, ch);

              for (let i = 0; i < visible; i++) {
                const s = sorted[scroll + i]!;
                const elapsed = now - startTime - i * barStagger;
                const t = Math.max(0, Math.min(1, elapsed / 1200));
                const progress = outBack(t);

                const name = s.skill.length > labelW
                  ? s.skill.slice(0, labelW - 1) + "…"
                  : s.skill.padEnd(labelW);
                const barW = Math.max(0, (s.count / maxCount) * barMaxW * progress);
                const colorIdx = (scroll + i) % barColors.length;
                const color = barColors[colorIdx]!;
                const hex = barPalette[colorIdx]!;
                const dimColor = RGBA.fromHex(lerpHex(hex, "#0D1117", 0.78));

                const isSelected = scroll + i === state.selectedIndex;
                if (isSelected) buf.drawText("▸", ox, oy + i, colors.accent, colors.bg);
                buf.drawText(name, ox + 1, oy + i, isSelected ? colors.text : (t > 0 ? colors.textMuted : colors.textDim), colors.bg);
                drawBar(buf, ox + labelW + 2, oy + i, barW, color, colors.bg);

                const barEnd = Math.ceil(barW);
                for (let x = barEnd; x < barMaxW; x++) {
                  buf.setCell(ox + labelW + 2 + x, oy + i, "░", dimColor, colors.bg);
                }

                buf.drawText(
                  String(s.count).padStart(countW),
                  ox + cw - countW - 1, oy + i,
                  t > 0.5 ? color : colors.textDim, colors.bg,
                );
              }

              // scroll indicators
              if (scroll > 0) {
                buf.drawText("▲", ox + cw - 2, oy, colors.accent, colors.bg);
                buf.drawText("╏", ox + cw - 1, oy, colors.borderBright, colors.bg);
              }
              if (scroll + ch < total) {
                buf.drawText("▼", ox + cw - 2, oy + ch - 1, colors.accent, colors.bg);
                buf.drawText("╏", ox + cw - 1, oy + ch - 1, colors.borderBright, colors.bg);
              }

              // sort mode + position in bottom title
              const sortLabel = SORT_LABELS[state.sortMode];
              const dirIndicator = state.sortAsc ? "▲" : "▼";
              const posLabel = total > ch
                ? ` ${scroll + 1}–${Math.min(scroll + ch, total)}/${total} `
                : "";
              const bottomStr = ` ◇ ${sortLabel} ${dirIndicator}${posLabel}`;
              this.bottomTitle = bottomStr;
              this.bottomTitleAlignment = "right";
            },
          }),

        ),

        // --- RIGHT COLUMN ---
        Box(
          { flexGrow: 2, flexDirection: "column" },

          // heatmap
          Box({
            height: 9,
            border: true,
            borderStyle: "rounded",
            borderColor: "#30363D",
            backgroundColor: "#0D1117",
            title: " ▣ activity map ",
            renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
              if (state.detailSkill && state.detailData) {
                this.title = ` ◆ ${state.detailSkill} `;
                const d = state.detailData;
                const ix = this.screenX + 1;
                const iy = this.screenY + 1;
                const iw = this.width - 2;
                const ih = this.height - 2;
                for (let y = 0; y < ih; y++)
                  for (let x = 0; x < iw; x++)
                    buf.setCell(ix + x, iy + y, " ", colors.bg, colors.bg);
                buf.drawText(`${d.count} calls`, ix + 1, iy, colors.accent, colors.bg);
                buf.drawText(`${d.sessions} sessions`, ix + 1, iy + 2, colors.textMuted, colors.bg);
                const firstAgo = timeAgo(d.firstUsed);
                const lastAgo = timeAgo(d.lastUsed);
                buf.drawText(`First  ${firstAgo}`, ix + 1, iy + 3, colors.textMuted, colors.bg);
                buf.drawText(`Last   ${lastAgo}`, ix + 1, iy + 4, colors.textMuted, colors.bg);
                return;
              }
              this.title = " ▣ activity map ";
              const elapsed = Date.now() - startTime;
              const ox = this.screenX + 1;
              const oy = this.screenY + 1;
              const cw = this.width - 2;
              if (cw < 8) return;

              const cellW = 2;
              const labelW = 4;
              const maxCols = Math.min(HEATMAP_WEEKS, Math.floor((cw - labelW) / cellW));

              for (let d = 0; d < 7; d++) {
                buf.drawText(DAYS[d]!, ox, oy + d, colors.textDim, colors.bg);
                for (let w = 0; w < maxCols; w++) {
                  const wIdx = HEATMAP_WEEKS - maxCols + w;
                  const revealDelay = (w * 7 + d) * 12;
                  const t = Math.max(0, Math.min(1, (elapsed - revealDelay) / 500));

                  const val = state.heatData.grid[wIdx]?.[d] ?? 0;
                  const rawIntensity = state.heatData.maxVal > 0
                    ? Math.min(4, Math.ceil((val / state.heatData.maxVal) * 4))
                    : 0;
                  const visIntensity = Math.round(rawIntensity * outExpo(t));
                  const color = heatmapColors[visIntensity]!;
                  const cx = ox + labelW + w * cellW;
                  buf.setCell(cx, oy + d, "█", color, colors.bg);
                  buf.setCell(cx + 1, oy + d, "█", color, colors.bg);
                }
              }

              if (this.height >= 12) {
                const legendY = oy + 8;
                buf.drawText("less", ox, legendY, colors.textDim, colors.bg);
                for (let i = 0; i < 5; i++) {
                  buf.setCell(ox + 5 + i * 2, legendY, "█", heatmapColors[i]!, colors.bg);
                  buf.setCell(ox + 6 + i * 2, legendY, "█", heatmapColors[i]!, colors.bg);
                }
                buf.drawText("more", ox + 16, legendY, colors.textDim, colors.bg);
              }
            },
          }),

          // time of day
          Box({
            height: 4,
            border: true,
            borderStyle: "rounded",
            borderColor: "#30363D",
            backgroundColor: "#0D1117",
            title: " ◑ time of day ",
            renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
              if (state.detailSkill && state.detailData) {
                this.title = " ▸ weekly trend ";
                const d = state.detailData;
                const ix = this.screenX + 1;
                const iy = this.screenY + 1;
                const iw = this.width - 2;
                const ih = this.height - 2;
                for (let y = 0; y < ih; y++)
                  for (let x = 0; x < iw; x++)
                    buf.setCell(ix + x, iy + y, " ", colors.bg, colors.bg);
                const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
                const weeks = d.weeklyUsage;
                const maxW = Math.max(...weeks, 1);
                const bw = Math.max(1, Math.floor(iw / 16));
                for (let w = 0; w < 16 && w * bw < iw; w++) {
                  const val = weeks[w]!;
                  const si = val > 0 ? Math.min(7, Math.round((val / maxW) * 7)) : -1;
                  const ch = si >= 0 ? SPARK[si]! : " ";
                  const clr = si >= 0 ? colors.accent : colors.textDim;
                  for (let b = 0; b < bw; b++)
                    buf.setCell(ix + w * bw + b, iy, ch, clr, colors.bg);
                }
                if (ih > 1) {
                  buf.drawText("-16w", ix, iy + 1, colors.textDim, colors.bg);
                  buf.drawText("now", ix + iw - 3, iy + 1, colors.textDim, colors.bg);
                }
                return;
              }
              this.title = " ◑ time of day ";
              const elapsed = Date.now() - startTime;
              const ox = this.screenX + 1;
              const oy = this.screenY + 1;
              const cw = this.width - 2;
              const ch = this.height - 2;
              if (ch < 1 || cw < 3) return;

              const maxVal = Math.max(...state.hourly, 1);
              const todColors = [
                RGBA.fromHex("#161B22"),
                RGBA.fromHex("#103328"),
                RGBA.fromHex("#20614D"),
                RGBA.fromHex("#3D9478"),
                RGBA.fromHex("#50AE90"),
              ];

              for (let h = 0; h < 24; h++) {
                const revealT = Math.max(0, Math.min(1, (elapsed - h * 25) / 600));
                const x0 = ox + Math.floor((h * cw) / 24);
                const x1 = ox + Math.floor(((h + 1) * cw) / 24);
                const intensity = (state.hourly[h]! / maxVal) * outExpo(revealT);
                const ci = Math.min(4, Math.round(intensity * 4));
                const color = todColors[ci]!;

                for (let row = 0; row < ch - 1; row++) {
                  for (let x = x0; x < x1; x++) {
                    buf.setCell(x, oy + row, "█", color, colors.bg);
                  }
                }

                if (h % 6 === 0) {
                  const label = h.toString().padStart(2, " ");
                  buf.drawText(label, x0, oy + ch - 1, colors.textDim, colors.bg);
                }
              }
            },
          }),

          // activity
          Box({
            flexGrow: 1,
            border: true,
            borderStyle: "rounded",
            borderColor: "#30363D",
            backgroundColor: "#0D1117",
            title: " ● recent ",
            renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
              if (state.detailSkill && state.detailData) {
                this.title = " ▪ by project ";
                const d = state.detailData;
                const ix = this.screenX + 2;
                const iy = this.screenY + 1;
                const iw = this.width - 4;
                const ih = this.height - 2;
                for (let y = 0; y < ih; y++)
                  for (let x = 0; x < iw; x++)
                    buf.setCell(ix + x, iy + y, " ", colors.bg, colors.bg);
                if (d.projects.length === 0) {
                  buf.drawText("no projects", ix, iy, colors.textDim, colors.bg);
                  return;
                }
                const maxProj = d.projects[0]!.count;
                const nameW = Math.min(16, Math.floor(iw * 0.35));
                const cntW = 4;
                const barMax = iw - nameW - cntW - 3;
                const vis = Math.min(d.projects.length, ih);
                for (let i = 0; i < vis; i++) {
                  const p = d.projects[i]!;
                  const nm = p.name.length > nameW ? p.name.slice(0, nameW - 1) + "…" : p.name.padEnd(nameW);
                  const bw = Math.max(0, (p.count / maxProj) * barMax);
                  buf.drawText(nm, ix, iy + i, colors.textMuted, colors.bg);
                  drawBar(buf, ix + nameW + 1, iy + i, bw, colors.accent, colors.bg);
                  buf.drawText(String(p.count).padStart(cntW), ix + iw - cntW, iy + i, colors.accent, colors.bg);
                }
                return;
              }
              this.title = " ● recent ";
              const ox = this.screenX + 2;
              const oy = this.screenY + 1;
              const cw = this.width - 4;
              const ch = this.height - 2;
              if (ch < 1 || cw < 10) return;
              const visible = Math.min(state.recentCalls.length, ch);

              const nameW = Math.min(17, Math.floor(cw * 0.4));
              const projW = Math.min(11, Math.floor(cw * 0.25));
              const agoW = 4;

              for (let i = 0; i < visible; i++) {
                const c = state.recentCalls[i]!;
                const skillIdx = state.skills.findIndex((s) => s.skill === c.skill);
                const dotColor = RGBA.fromHex(
                  barPalette[skillIdx >= 0 ? skillIdx % barPalette.length : 0]!,
                );

                const skillName = c.skill.length > nameW
                  ? c.skill.slice(0, nameW - 1) + "…"
                  : c.skill.padEnd(nameW);
                const proj = projectShort(c.project);
                const projStr = (proj.length > projW
                  ? proj.slice(0, projW - 1) + "…"
                  : proj
                ).padEnd(projW);
                const ago = timeAgo(c.timestamp).padStart(agoW);

                buf.setCell(ox, oy + i, "●", dotColor, colors.bg);
                buf.drawText(` ${skillName}`, ox + 1, oy + i, colors.text, colors.bg);
                buf.drawText(projStr, ox + nameW + 2, oy + i, colors.textDim, colors.bg);
                buf.drawText(ago, ox + cw - agoW, oy + i, colors.textMuted, colors.bg);
              }
            },
          }),
        ),
      ),

      Box({ height: 1 }),

      // === FILTER BAR ===
      Box({
        id: "filter-bar",
        height: 1,
        paddingX: 1,
        live: true,
        renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
          const ox = this.screenX + 1;
          const oy = this.screenY;
          const maxW = this.width - 2;
          const focused = state.filterFocused;
          const expr = state.filterExpr;

          buf.setCell(ox, oy, "▍", focused ? colors.accent : colors.border, colors.bg);

          if (!expr && !focused) {
            buf.drawText("/ filter", ox + 2, oy, colors.textDim, colors.bg);
            buf.drawText(" · ", ox + 10, oy, colors.border, colors.bg);
            buf.drawText("s:", ox + 13, oy, colors.accent, colors.bg);
            buf.drawText("source  ", ox + 15, oy, colors.textDim, colors.bg);
            buf.drawText("p:", ox + 23, oy, colors.accent, colors.bg);
            buf.drawText("project  ", ox + 25, oy, colors.textDim, colors.bg);
            buf.drawText("bare text matches skill name", ox + 34, oy, colors.textDim, colors.bg);
            return;
          }

          const cArr = exprColors(expr);
          let sx = ox + 2;
          for (let i = 0; i < expr.length && sx < ox + maxW; i++) {
            const ch = expr[i]!;
            const fg = cArr[i]!;
            if (focused && i === state.cursorPos) {
              buf.setCell(sx, oy, ch, colors.bg, fg);
            } else {
              buf.setCell(sx, oy, ch, fg, colors.bg);
            }
            sx++;
          }
          if (focused && state.cursorPos >= expr.length) {
            buf.setCell(sx, oy, " ", colors.bg, colors.accent);
          }
        },
      }),

      // === FOOTER ===
      Box({
        id: "footer",
        height: 1,
        paddingX: 2,
        live: true,
        renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
          const ox = this.screenX + 2;
          const oy = this.screenY;
          let cx = ox;

          function hint(key: string, label: string, last?: boolean) {
            buf.drawText(key, cx, oy, colors.textMuted, colors.bg);
            cx += key.length;
            buf.drawText(` ${label} `, cx, oy, colors.textDim, colors.bg);
            cx += label.length + 2;
            if (!last) { buf.drawText("│", cx, oy, colors.border, colors.bg); cx += 1; }
          }

          buf.drawText(" ◇ ", cx, oy, colors.border, colors.bg);
          cx += 4;

          if (state.filterFocused) {
            hint("←→", "move");
            hint("ctrl-u", "clear");
            hint("esc", "close", true);
          } else if (state.auditOpen) {
            hint("esc/a", "close");
            hint("↑↓", "scroll");
            hint("q", "quit", true);
          } else if (state.detailSkill) {
            hint("esc", "close");
            hint("↑↓", "nav");
            hint("s/tab", "sort");
            hint("a", "audit", true);
          } else {
            hint("q", "quit");
            hint("s/tab", "sort");
            hint("⏎", "detail");
            hint("a", "audit");
            hint("↑↓", "nav", true);
          }

          buf.drawText(" ◇", cx, oy, colors.border, colors.bg);

          if (state.auditOpen && state.auditLines.length > 0 && state.mainArea.h > 0) {
            const ax = state.mainArea.x + 1;
            const ay = state.mainArea.y;
            const aw = state.mainArea.w - 2;
            const ah = state.mainArea.h;
            if (aw < 6) return;
            const bf = colors.border;

            for (let ry = 0; ry < ah; ry++)
              for (let rx = -1; rx <= aw; rx++)
                buf.setCell(ax + rx, ay + ry, " ", colors.bg, colors.bg);

            buf.setCell(ax, ay, "╭", bf, colors.bg);
            buf.setCell(ax + aw - 1, ay, "╮", bf, colors.bg);
            buf.setCell(ax, ay + ah - 1, "╰", bf, colors.bg);
            buf.setCell(ax + aw - 1, ay + ah - 1, "╯", bf, colors.bg);
            for (let x = 1; x < aw - 1; x++) {
              buf.setCell(ax + x, ay, "─", bf, colors.bg);
              buf.setCell(ax + x, ay + ah - 1, "─", bf, colors.bg);
            }
            for (let y = 1; y < ah - 1; y++) {
              buf.setCell(ax, ay + y, "│", bf, colors.bg);
              buf.setCell(ax + aw - 1, ay + y, "│", bf, colors.bg);
            }

            buf.drawText(" ▧ skill audit ", ax + 2, ay, colors.text, colors.bg);

            const contentX = ax + 2;
            const contentY = ay + 1;
            const contentW = aw - 4;
            const contentH = ah - 2;
            const visRows = contentH;
            const maxScr = Math.max(0, state.auditLines.length - visRows);
            if (state.auditScroll > maxScr) state.auditScroll = maxScr;

            const start = state.auditScroll;
            const end = Math.min(state.auditLines.length, start + visRows);

            for (let i = start; i < end; i++) {
              const line = state.auditLines[i]!;
              const text = line.text.length > contentW ? line.text.slice(0, contentW) : line.text;
              buf.drawText(text, contentX, contentY + (i - start), line.fg, colors.bg);
            }

            if (state.auditLines.length > visRows) {
              if (start > 0) buf.drawText("▲", ax + aw - 2, ay + 1, colors.accent, colors.bg);
              if (end < state.auditLines.length) buf.drawText("▼", ax + aw - 2, ay + ah - 2, colors.accent, colors.bg);
              const posStr = ` ${start + 1}–${end}/${state.auditLines.length} `;
              buf.drawText(posStr, ax + aw - posStr.length - 2, ay + ah - 1, colors.textDim, colors.bg);
            }
          }
        },
      }),
    ),
  );

  // --- keyboard ---
  function filterInsert(ch: string) {
    state.filterExpr = state.filterExpr.slice(0, state.cursorPos) + ch + state.filterExpr.slice(state.cursorPos);
    state.cursorPos += ch.length;
    recompute();
    renderer.requestRender();
  }

  renderer.keyInput.on("keypress", (key) => {
    // --- filter input focused ---
    if (state.filterFocused) {
      if (key.name === "escape" || key.name === "return") {
        state.filterFocused = false;
        renderer.requestRender();
        return;
      }
      if (key.name === "left") {
        if (state.cursorPos > 0) { state.cursorPos--; renderer.requestRender(); }
        return;
      }
      if (key.name === "right") {
        if (state.cursorPos < state.filterExpr.length) { state.cursorPos++; renderer.requestRender(); }
        return;
      }
      if (key.name === "home" || (key.name === "a" && key.ctrl)) {
        state.cursorPos = 0;
        renderer.requestRender();
        return;
      }
      if (key.name === "end" || (key.name === "e" && key.ctrl)) {
        state.cursorPos = state.filterExpr.length;
        renderer.requestRender();
        return;
      }
      if (key.name === "u" && key.ctrl) {
        state.filterExpr = "";
        state.cursorPos = 0;
        recompute();
        renderer.requestRender();
        return;
      }
      if (key.name === "w" && key.ctrl) {
        const before = state.filterExpr.slice(0, state.cursorPos);
        const trimmed = before.trimEnd();
        const lastSp = trimmed.lastIndexOf(" ");
        const newPos = lastSp === -1 ? 0 : lastSp + 1;
        state.filterExpr = state.filterExpr.slice(0, newPos) + state.filterExpr.slice(state.cursorPos);
        state.cursorPos = newPos;
        recompute();
        renderer.requestRender();
        return;
      }
      if (key.name === "backspace") {
        if (state.cursorPos > 0) {
          state.filterExpr = state.filterExpr.slice(0, state.cursorPos - 1) + state.filterExpr.slice(state.cursorPos);
          state.cursorPos--;
          recompute();
          renderer.requestRender();
        }
        return;
      }
      if (key.name === "delete") {
        if (state.cursorPos < state.filterExpr.length) {
          state.filterExpr = state.filterExpr.slice(0, state.cursorPos) + state.filterExpr.slice(state.cursorPos + 1);
          recompute();
          renderer.requestRender();
        }
        return;
      }
      if (key.name === "tab") {
        filterInsert("  ");
        return;
      }
      if (!key.ctrl && !key.meta && key.name && key.name.length === 1) {
        filterInsert(key.name);
        return;
      }
      return;
    }

    // --- audit mode ---
    if (state.auditOpen) {
      // Subtract 2 for the top/bottom border rows of the overlay panel,
      // matching the visible content height in the render path.
      const visRows = Math.max(1, state.mainArea.h - 2);
      const maxScr = Math.max(0, state.auditLines.length - visRows);
      if (key.name === "escape" || key.name === "a") {
        state.auditOpen = false;
        renderer.requestRender();
      } else if (key.name === "q") {
        renderer.destroy();
        process.exit(0);
      } else if (key.name === "j" || key.name === "down") {
        state.auditScroll = Math.min(maxScr, state.auditScroll + 1);
        renderer.requestRender();
      } else if (key.name === "k" || key.name === "up") {
        state.auditScroll = Math.max(0, state.auditScroll - 1);
        renderer.requestRender();
      } else if (key.name === "g" && !key.shift) {
        state.auditScroll = 0;
        renderer.requestRender();
      } else if ((key.name === "G") || (key.name === "g" && key.shift)) {
        state.auditScroll = maxScr;
        renderer.requestRender();
      } else if (key.name === "d" && key.ctrl) {
        state.auditScroll = Math.min(maxScr, state.auditScroll + Math.floor(visRows / 2));
        renderer.requestRender();
      } else if (key.name === "u" && key.ctrl) {
        state.auditScroll = Math.max(0, state.auditScroll - Math.floor(visRows / 2));
        renderer.requestRender();
      }
      return;
    }

    // --- normal mode ---
    function moveCursor(newIdx: number) {
      if (state.skills.length === 0) return;
      state.selectedIndex = Math.max(0, Math.min(state.skills.length - 1, newIdx));
      if (state.selectedIndex < state.scroll) {
        state.scroll = state.selectedIndex;
      } else if (state.selectedIndex >= state.scroll + state.visibleRows) {
        state.scroll = state.selectedIndex - state.visibleRows + 1;
      }
      if (state.detailSkill && state.skills[state.selectedIndex]) {
        state.detailSkill = state.skills[state.selectedIndex]!.skill;
        state.detailData = skillDetail(state.filteredCalls, state.detailSkill);
      }
    }

    switch (key.name) {
      case "q":
        renderer.destroy();
        process.exit(0);
        break;

      case "escape":
        if (state.detailSkill) {
          state.detailSkill = null;
          state.detailData = null;
          renderer.requestRender();
        } else {
          renderer.destroy();
          process.exit(0);
        }
        break;

      case "r":
        renderer.destroy();
        run(getProviders ? getProviders() : providers, getProviders);
        break;

      case "s": {
        const idx = SORT_CYCLE.indexOf(state.sortMode);
        state.sortMode = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]!;
        state.sortAsc = SORT_DEFAULT_ASC[state.sortMode]!;
        state.skills = sortSkills(skillCounts(state.filteredCalls), state.sortMode, state.sortAsc);
        state.scroll = 0;
        state.selectedIndex = 0;
        if (state.detailSkill && state.skills.length > 0) {
          state.detailSkill = state.skills[0]!.skill;
          state.detailData = skillDetail(state.filteredCalls, state.detailSkill);
        }
        renderer.requestRender();
        break;
      }

      case "tab":
        state.sortAsc = !state.sortAsc;
        state.skills = sortSkills(skillCounts(state.filteredCalls), state.sortMode, state.sortAsc);
        state.scroll = 0;
        state.selectedIndex = 0;
        if (state.detailSkill && state.skills.length > 0) {
          state.detailSkill = state.skills[0]!.skill;
          state.detailData = skillDetail(state.filteredCalls, state.detailSkill);
        }
        renderer.requestRender();
        break;

      case "return":
        if (state.skills.length > 0) {
          if (state.detailSkill) {
            state.detailSkill = null;
            state.detailData = null;
          } else {
            state.detailSkill = state.skills[state.selectedIndex]!.skill;
            state.detailData = skillDetail(state.filteredCalls, state.detailSkill);
          }
          renderer.requestRender();
        }
        break;

      case "a":
        state.auditOpen = true;
        state.auditData = auditSkills(state.filteredCalls, state.skills);
        state.auditScroll = 0;
        buildAuditLines();
        state.detailSkill = null;
        state.detailData = null;
        renderer.requestRender();
        break;

      case "/":
      case "f":
        state.filterFocused = true;
        state.cursorPos = state.filterExpr.length;
        renderer.requestRender();
        break;

      case "j":
      case "down":
        moveCursor(state.selectedIndex + 1);
        renderer.requestRender();
        break;

      case "k":
      case "up":
        moveCursor(state.selectedIndex - 1);
        renderer.requestRender();
        break;

      case "g":
        if (key.shift) {
          moveCursor(state.skills.length - 1);
        } else {
          moveCursor(0);
        }
        renderer.requestRender();
        break;

      case "G":
        moveCursor(state.skills.length - 1);
        renderer.requestRender();
        break;

      case "d":
        if (key.ctrl) {
          moveCursor(state.selectedIndex + Math.floor(state.visibleRows / 2));
          renderer.requestRender();
        }
        break;

      case "u":
        if (key.ctrl) {
          moveCursor(state.selectedIndex - Math.floor(state.visibleRows / 2));
          renderer.requestRender();
        }
        break;
    }
  });
}

export async function runSplash() {
  const startTime = Date.now();

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    clearOnShutdown: true,
    targetFps: 30,
    backgroundColor: "#0D1117",
  });

  engine.attach(renderer);

  renderer.root.add(
    Box({
      width: "100%",
      height: "100%",
      backgroundColor: "#0D1117",
      live: true,
      renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
        const now = Date.now();
        const t = (now - startTime) / 1000;
        const ox = this.screenX;
        const oy = this.screenY;
        const w = this.width;
        const h = this.height;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const n = fbm(x * 0.06 + t * 0.4, y * 0.12 + t * 0.2);
            const v = Math.max(0, Math.min(1, (n + 0.5)));
            const charIdx = Math.min(4, Math.floor(v * 5));
            const colorIdx = Math.min(7, Math.floor(v * 8));
            buf.setCell(ox + x, oy + y, NOISE_CHARS[charIdx]!, NOISE_COLORS[colorIdx]!, colors.bg);
          }
        }

        const text = "SKILLED";
        const glyphs = text.split("").map((ch) => PIXEL_FONT[ch]!);
        const fontH = 5;
        const pw = h >= 20 ? 2 : 1;
        const totalW = glyphs.reduce((s, g) => s + g[0]!.length * pw + pw, -pw);
        const startX = Math.floor((w - totalW) / 2);
        const startY = Math.floor((h - fontH) / 2);

        let cx = startX;
        for (const glyph of glyphs) {
          const gw = glyph[0]!.length;
          for (let gy = 0; gy < fontH; gy++) {
            for (let gx = 0; gx < gw; gx++) {
              if (glyph[gy]![gx]) {
                for (let px = 0; px < pw; px++) {
                  const sx = ox + cx + gx * pw + px;
                  const sy = oy + startY + gy;
                  if (sx > ox) buf.setCell(sx - 1, sy + 1, "█", FONT_SHADOW, FONT_SHADOW);
                  buf.setCell(sx, sy, "█", FONT_FG, FONT_FG);
                }
              }
            }
          }
          cx += gw * pw + pw;
        }

        const glitchPhase = Math.sin(t * 2.5) * Math.sin(t * 7.1);
        if (glitchPhase > 0.7) {
          const intensity = Math.floor((glitchPhase - 0.7) * 30);
          for (let i = 0; i < intensity; i++) {
            const gx = ox + Math.floor(Math.random() * w);
            const gy = oy + Math.floor(Math.random() * h);
            const gc = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]!;
            const gcolor = GLITCH_COLORS[Math.floor(Math.random() * GLITCH_COLORS.length)]!;
            buf.setCell(gx, gy, gc, gcolor, colors.bg);
          }
          if (Math.random() > 0.5) {
            const row = oy + Math.floor(Math.random() * h);
            const shift = Math.floor(Math.random() * 5) - 2;
            const raw = buf.buffers;
            const bw = buf.width;
            for (let x = 0; x < w; x++) {
              const srcX = ox + ((x - shift + w) % w);
              const dstIdx = row * bw + ox + x;
              const srcIdx = row * bw + srcX;
              raw.char[dstIdx] = raw.char[srcIdx]!;
              raw.fg[dstIdx] = raw.fg[srcIdx]!;
            }
          }
        }
      },
    }),
  );

  renderer.keyInput.on("keypress", (key) => {
    if (key.name === "q" || key.name === "escape") {
      renderer.destroy();
      process.exit(0);
    }
  });
}

