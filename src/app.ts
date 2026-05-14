import {
  createCliRenderer,
  Box,
  Text,
  ASCIIFont,
  RGBA,
  type BoxRenderable,
  type ASCIIFontRenderable,
  type TextRenderable,
  type OptimizedBuffer,
  engine,
} from "@opentui/core";
import type { Provider } from "./providers/base.js";
import type { SkillCall, SkillCount } from "./models.js";
import { skillCounts, weeklyCounts, projectShort, timeAgo } from "./data.js";
import { colors, barColors, barPalette, heatmapColors, rainbowHex, sparkColors } from "./theme.js";

const BLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"];
const SPARK_CHARS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const HEATMAP_WEEKS = 16;

type SortMode = "count" | "alpha" | "recent";
const SORT_LABELS: Record<SortMode, string> = {
  count: "by count",
  alpha: "a-z",
  recent: "by recent",
};
const SORT_CYCLE: SortMode[] = ["count", "alpha", "recent"];

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

function rainbowGradient(offset: number, count: number): string[] {
  const out: string[] = [];
  const len = rainbowHex.length;
  for (let i = 0; i < count; i++) {
    const pos = ((offset + i * 0.12) % 1 + 1) % 1;
    const idx = pos * (len - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, len - 1);
    out.push(lerpHex(rainbowHex[lo]!, rainbowHex[hi]!, idx - lo));
  }
  return out;
}

function drawBar(buf: OptimizedBuffer, x: number, y: number, width: number, fg: RGBA, bg: RGBA) {
  const full = Math.floor(width);
  const frac = Math.round((width - full) * 8);
  for (let i = 0; i < full; i++) buf.setCell(x + i, y, "█", fg, bg);
  if (frac > 0) buf.setCell(x + full, y, BLOCKS[frac]!, fg, bg);
}

function sortSkills(skills: SkillCount[], mode: SortMode): SkillCount[] {
  const copy = [...skills];
  switch (mode) {
    case "count":
      return copy.sort((a, b) => b.count - a.count);
    case "alpha":
      return copy.sort((a, b) => a.skill.localeCompare(b.skill));
    case "recent":
      return copy.sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime());
  }
}

function buildHeatmapGrid(calls: SkillCall[]): { grid: number[][]; maxVal: number } {
  const now = new Date();
  const todayDow = (now.getDay() + 6) % 7;
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

export async function run(providers: Provider[]) {
  const allCalls: SkillCall[] = [];
  const sourceNames: Set<string> = new Set();
  for (const p of providers) {
    if (p.available()) {
      const calls = p.collect();
      allCalls.push(...calls);
      if (calls.length > 0) sourceNames.add(p.name);
    }
  }
  allCalls.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const allSkills = skillCounts(allCalls);
  const weekly = weeklyCounts(allCalls, 30);
  const uniqueProjects = new Set(allCalls.map((c) => c.project)).size;
  const { grid: heatGrid, maxVal: heatMax } = buildHeatmapGrid(allCalls);
  const recentCalls = allCalls.slice(0, 20);

  // --- mutable state ---
  const state = {
    sortMode: "count" as SortMode,
    skills: sortSkills(allSkills, "count"),
    scroll: 0,
    visibleRows: 0,
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

      // === HEADER ===
      Box(
        { justifyContent: "center", alignItems: "center", paddingTop: 1 },
        ASCIIFont({
          id: "header-font",
          text: "SKILLED",
          font: renderer.height >= 32 ? "slick" : "tiny",
          color: rainbowHex,
          backgroundColor: "#0D1117",
        }),
      ),

      // === STATS ROW ===
      Box(
        { flexDirection: "row", paddingX: 2, gap: 1, height: 3 },
        ...makeStatCards(allCalls.length, allSkills.length, uniqueProjects, sourceNames.size),
      ),

      // === MAIN ===
      Box(
        { flexDirection: "row", flexGrow: 1, paddingX: 1, paddingTop: 1, gap: 1 },

        // --- LEFT COLUMN ---
        Box(
          { flexGrow: 3, flexDirection: "column", gap: 1 },

          // bar chart
          Box({
            id: "bars",
            flexGrow: 1,
            border: true,
            borderStyle: "rounded",
            borderColor: "#30363D",
            backgroundColor: "#0D1117",
            title: " skill frequency ",
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

                buf.drawText(name, ox + 1, oy + i, t > 0 ? colors.textMuted : colors.textDim, colors.bg);
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
                buf.drawText("▲", ox + cw - 1, oy, colors.accent, colors.bg);
              }
              if (scroll + ch < total) {
                buf.drawText("▼", ox + cw - 1, oy + ch - 1, colors.accent, colors.bg);
              }

              // sort mode + position in bottom title
              const sortLabel = SORT_LABELS[state.sortMode];
              const posLabel = total > ch
                ? ` ${scroll + 1}-${Math.min(scroll + ch, total)}/${total} `
                : "";
              const bottomStr = ` ${sortLabel}${posLabel}`;
              this.bottomTitle = bottomStr;
              this.bottomTitleAlignment = "right";
            },
          }),

          // sparkline
          Box({
            height: 4,
            border: true,
            borderStyle: "rounded",
            borderColor: "#30363D",
            backgroundColor: "#0D1117",
            title: " weekly pulse ",
            renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
              const elapsed = Date.now() - startTime;
              const ox = this.screenX + 1;
              const oy = this.screenY + 1;
              const cw = this.width - 2;
              const ch = this.height - 2;
              if (ch < 1 || cw < 1) return;
              const maxW = Math.min(weekly.length, cw);
              const maxVal = Math.max(...weekly, 1);

              for (let i = 0; i < maxW; i++) {
                const revealT = Math.max(0, Math.min(1, (elapsed - i * 30) / 800));
                const normalized = (weekly[i]! / maxVal) * outExpo(revealT);
                const height = normalized * ch;
                const fullRows = Math.floor(height);
                const fracLevel = Math.min(8, Math.round((height - fullRows) * 8));

                for (let row = 0; row < ch; row++) {
                  const rowFromBottom = ch - 1 - row;
                  if (rowFromBottom < fullRows) {
                    const intensity = rowFromBottom / ch;
                    const barColor = intensity > 0.5
                      ? sparkColors.bar
                      : RGBA.fromHex(lerpHex("#1F3A5F", "#58A6FF", Math.min(1, intensity * 2)));
                    buf.setCell(ox + i, oy + row, "█", barColor, colors.bg);
                  } else if (rowFromBottom === fullRows && fracLevel > 0) {
                    buf.setCell(ox + i, oy + row, SPARK_CHARS[fracLevel]!, sparkColors.barDim, colors.bg);
                  }
                }
              }
            },
          }),
        ),

        // --- RIGHT COLUMN ---
        Box(
          { flexGrow: 2, flexDirection: "column", gap: 1 },

          // heatmap
          Box({
            height: 9,
            border: true,
            borderStyle: "rounded",
            borderColor: "#30363D",
            backgroundColor: "#0D1117",
            title: " activity map ",
            renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
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

                  const val = heatGrid[wIdx]?.[d] ?? 0;
                  const rawIntensity = heatMax > 0
                    ? Math.min(4, Math.ceil((val / heatMax) * 4))
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

          // activity
          Box({
            flexGrow: 1,
            border: true,
            borderStyle: "rounded",
            borderColor: "#30363D",
            backgroundColor: "#0D1117",
            title: " recent ",
            renderAfter(this: BoxRenderable, buf: OptimizedBuffer) {
              const ox = this.screenX + 2;
              const oy = this.screenY + 1;
              const cw = this.width - 4;
              const ch = this.height - 2;
              if (ch < 1 || cw < 10) return;
              const visible = Math.min(recentCalls.length, ch);

              const nameW = Math.min(17, Math.floor(cw * 0.4));
              const projW = Math.min(11, Math.floor(cw * 0.25));
              const agoW = 4;

              for (let i = 0; i < visible; i++) {
                const c = recentCalls[i]!;
                const skillIdx = allSkills.findIndex((s) => s.skill === c.skill);
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

      // === FOOTER ===
      Box(
        { id: "footer", height: 1, paddingX: 2, flexDirection: "row" },
        Text({
          id: "footer-text",
          content: "  q quit  r refresh  s sort  ↑↓/jk scroll",
          fg: "#484F58",
        }),
      ),
    ),
  );

  // cycling header gradient
  const headerFont = renderer.root.findDescendantById("header-font") as
    | ASCIIFontRenderable
    | undefined;

  renderer.setFrameCallback(async () => {
    if (headerFont) {
      const offset = ((Date.now() - startTime) / 4000) % 1;
      headerFont.color = rainbowGradient(offset, 10);
    }
  });

  // --- keyboard ---
  renderer.keyInput.on("keypress", (key) => {
    const maxScroll = Math.max(0, state.skills.length - state.visibleRows);

    switch (key.name) {
      case "q":
      case "escape":
        renderer.destroy();
        process.exit(0);
        break;

      case "r":
        renderer.destroy();
        run(providers);
        break;

      case "s": {
        const idx = SORT_CYCLE.indexOf(state.sortMode);
        state.sortMode = SORT_CYCLE[(idx + 1) % SORT_CYCLE.length]!;
        state.skills = sortSkills(allSkills, state.sortMode);
        state.scroll = 0;
        renderer.requestRender();
        break;
      }

      case "j":
      case "down":
        if (state.scroll < maxScroll) {
          state.scroll++;
          renderer.requestRender();
        }
        break;

      case "k":
      case "up":
        if (state.scroll > 0) {
          state.scroll--;
          renderer.requestRender();
        }
        break;

      case "g":
        state.scroll = 0;
        renderer.requestRender();
        break;

      case "G":
        state.scroll = maxScroll;
        renderer.requestRender();
        break;

      case "d":
        if (key.ctrl) {
          state.scroll = Math.min(maxScroll, state.scroll + Math.floor(state.visibleRows / 2));
          renderer.requestRender();
        }
        break;

      case "u":
        if (key.ctrl) {
          state.scroll = Math.max(0, state.scroll - Math.floor(state.visibleRows / 2));
          renderer.requestRender();
        }
        break;
    }
  });
}

function makeStatCards(
  total: number,
  skillCount: number,
  projects: number,
  sources: number,
) {
  const stats = [
    { label: total === 1 ? "CALL" : "CALLS", value: total, color: "#58A6FF" },
    { label: skillCount === 1 ? "SKILL" : "SKILLS", value: skillCount, color: "#34D399" },
    { label: projects === 1 ? "PROJECT" : "PROJECTS", value: projects, color: "#FBBF24" },
    { label: sources === 1 ? "SOURCE" : "SOURCES", value: sources, color: "#A78BFA" },
  ];

  return stats.map((s) =>
    Box(
      {
        flexGrow: 1,
        border: true,
        borderStyle: "rounded",
        borderColor: "#30363D",
        backgroundColor: "#161B22",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "row",
        gap: 1,
      },
      Text({ content: String(s.value), fg: s.color, attributes: 1 }),
      Text({ content: s.label, fg: "#8B949E" }),
    ),
  );
}
