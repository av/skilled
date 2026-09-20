/**
 * The TUI's header, ported cell for cell: fractional-Brownian-motion noise drawn
 * with the ░▒▓█ ramp, the 5-row pixel-font wordmark with a 1-cell shadow, and the
 * occasional glitch burst with a row shift. Same noise function (src/noise.ts),
 * same coefficients, same colours. Rendered on a canvas at ~24 fps; paused when the
 * window is hidden or the user prefers reduced motion (then a single frame).
 */
import { useEffect, useRef } from "react";
import { fbm } from "../../../src/noise";

const NOISE_CHARS = [" ", "░", "▒", "▓", "█"];
const NOISE_COLORS = ["#040E0D", "#0A1E1A", "#103328", "#184A3A", "#20614D", "#2D7A62", "#3D9478", "#50AE90"];
const FONT_FG = "#D4EDE5";
const FONT_SHADOW = "#061A15";
const GLITCH_CHARS = ["█", "▓", "▒", "░", "╌", "╍", "┃", "╳", "▞", "▚"];
const GLITCH_COLORS = ["#C49058", "#50AE90", "#88A074", "#D4EDE5", "#A89866", "#3D9478"];
const BG = "#0D1117";

const PIXEL_FONT: Record<string, number[][]> = {
  S: [[1, 1, 1, 1], [1, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 1], [1, 1, 1, 1]],
  K: [[1, 0, 0, 1], [1, 0, 1, 0], [1, 1, 0, 0], [1, 0, 1, 0], [1, 0, 0, 1]],
  I: [[1, 1, 1], [0, 1, 0], [0, 1, 0], [0, 1, 0], [1, 1, 1]],
  L: [[1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 1, 1, 1]],
  E: [[1, 1, 1, 1], [1, 0, 0, 0], [1, 1, 1, 0], [1, 0, 0, 0], [1, 1, 1, 1]],
  D: [[1, 1, 1, 0], [1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1], [1, 1, 1, 0]],
};

const ROWS = 7;          // terminal rows in the TUI header (>= 32-line terminals)
const CELL_H = 10;       // px per row
const CELL_W = 6;        // px per column (terminal cell aspect ~0.6)
const FPS = 24;

export function Header() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    let last = 0;

    const draw = (nowMs: number) => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = ROWS * CELL_H;
      if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.font = `${CELL_H}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
      ctx.textBaseline = "top";

      const cols = Math.ceil(cssW / CELL_W);
      const t = (nowMs - start) / 1000;
      const cells: { ch: string; color: string }[][] = [];
      for (let y = 0; y < ROWS; y++) {
        const row: { ch: string; color: string }[] = [];
        for (let x = 0; x < cols; x++) {
          const n = fbm(x * 0.06 + t * 0.4, y * 0.12 + t * 0.2);
          const v = Math.max(0, Math.min(1, n + 0.5));
          row.push({ ch: NOISE_CHARS[Math.min(4, Math.floor(v * 5))]!, color: NOISE_COLORS[Math.min(7, Math.floor(v * 8))]! });
        }
        cells.push(row);
      }

      // wordmark: pixel font, 2 cells per pixel, centred, with a 1-cell shadow
      const glyphs = "SKILLED".split("").map(ch => PIXEL_FONT[ch]!);
      const pw = 2;
      const totalW = glyphs.reduce((s, g) => s + g[0]!.length * pw + pw, -pw);
      const startX = Math.floor((cols - totalW) / 2);
      const startY = Math.floor((ROWS - 5) / 2);
      const solid = new Map<string, string>();
      let cx = startX;
      for (const glyph of glyphs) {
        const gw = glyph[0]!.length;
        for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < gw; gx++) if (glyph[gy]![gx]) for (let px = 0; px < pw; px++) {
          const sx = cx + gx * pw + px, sy = startY + gy;
          if (sx > 0 && !solid.has(`${sx - 1},${sy + 1}`)) solid.set(`${sx - 1},${sy + 1}`, FONT_SHADOW);
          solid.set(`${sx},${sy}`, FONT_FG);
        }
        cx += gw * pw + pw;
      }

      // glitch bursts + row shift, exactly as the TUI does them
      const glitchPhase = Math.sin(t * 2.5) * Math.sin(t * 7.1);
      if (!reduced && glitchPhase > 0.7) {
        const intensity = Math.floor((glitchPhase - 0.7) * 30);
        for (let i = 0; i < intensity; i++) {
          const gx = Math.floor(Math.random() * cols), gy = Math.floor(Math.random() * ROWS);
          cells[gy]![gx] = { ch: GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]!, color: GLITCH_COLORS[Math.floor(Math.random() * GLITCH_COLORS.length)]! };
        }
        if (Math.random() > 0.5) {
          const row = Math.floor(Math.random() * ROWS);
          const shift = Math.floor(Math.random() * 5) - 2;
          const src = cells[row]!;
          cells[row] = src.map((_, x) => src[(x - shift + cols) % cols]!);
        }
      }

      for (let y = 0; y < ROWS; y++) for (let x = 0; x < cols; x++) {
        const s = solid.get(`${x},${y}`);
        if (s) { ctx.fillStyle = s; ctx.fillRect(x * CELL_W, y * CELL_H, CELL_W, CELL_H); continue; }
        const c = cells[y]![x]!;
        if (c.ch === " ") continue;
        ctx.fillStyle = c.color;
        ctx.fillText(c.ch, x * CELL_W, y * CELL_H);
      }
    };

    const loop = (now: number) => {
      if (now - last >= 1000 / FPS) { last = now; draw(now); }
      raf = requestAnimationFrame(loop);
    };
    draw(start);
    if (!reduced) raf = requestAnimationFrame(loop);
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reduced) raf = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVis);
    const ro = new ResizeObserver(() => draw(performance.now()));
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="hero" aria-label="Skilled" role="img" style={{ height: ROWS * CELL_H }} />;
}
