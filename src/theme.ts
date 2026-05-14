import { RGBA } from "@opentui/core";

export const colors = {
  bg: RGBA.fromHex("#0D1117"),
  surface: RGBA.fromHex("#161B22"),
  surfaceLight: RGBA.fromHex("#1C2333"),
  border: RGBA.fromHex("#30363D"),
  borderBright: RGBA.fromHex("#484F58"),
  text: RGBA.fromHex("#E6EDF3"),
  textMuted: RGBA.fromHex("#8B949E"),
  textDim: RGBA.fromHex("#484F58"),
  accent: RGBA.fromHex("#58A6FF"),
  transparent: RGBA.fromValues(0, 0, 0, 0),
};

export const barPalette = [
  "#FF6B6B", "#FBBF24", "#34D399", "#60A5FA",
  "#A78BFA", "#F472B6", "#FB923C", "#2DD4BF",
  "#818CF8", "#E879F9", "#F87171", "#4ADE80",
  "#38BDF8", "#C084FC",
];

export const barColors = barPalette.map((h) => RGBA.fromHex(h));

export const heatmapPalette = ["#161B22", "#0E4429", "#006D32", "#26A641", "#39D353"];
export const heatmapColors = heatmapPalette.map((h) => RGBA.fromHex(h));

export const rainbowHex = [
  "#FF6B6B", "#FF9F43", "#FBBF24", "#34D399",
  "#60A5FA", "#A78BFA", "#F472B6",
];

export const sparkColors = {
  bar: RGBA.fromHex("#58A6FF"),
  barDim: RGBA.fromHex("#1F3A5F"),
};
