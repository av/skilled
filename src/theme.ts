import { RGBA } from "@opentui/core";

export const colors = {
  bg: RGBA.fromHex("#0D1117"),
  surface: RGBA.fromHex("#161B22"),
  surfaceLight: RGBA.fromHex("#1C2333"),
  border: RGBA.fromHex("#30363D"),
  borderBright: RGBA.fromHex("#484F58"),
  text: RGBA.fromHex("#D4EDE5"),
  textMuted: RGBA.fromHex("#7A9E94"),
  textDim: RGBA.fromHex("#3D5C52"),
  accent: RGBA.fromHex("#50AE90"),
  transparent: RGBA.fromValues(0, 0, 0, 0),
};

export const barPalette = [
  "#50AE90", "#C49058", "#8EBE6E", "#D48E6E",
  "#5EB8B0", "#C4A850", "#78AE78", "#C88880",
  "#50A0A8", "#D4A870", "#8AAE58", "#B07868",
  "#68B898", "#A89050",
];

export const barColors = barPalette.map((h) => RGBA.fromHex(h));

export const heatmapPalette = ["#161B22", "#103328", "#20614D", "#3D9478", "#50AE90"];
export const heatmapColors = heatmapPalette.map((h) => RGBA.fromHex(h));

export const rainbowHex = [
  "#50AE90", "#C49058", "#8EBE6E", "#D48E6E",
  "#5EB8B0", "#C4A850", "#78AE78",
];

export const sparkColors = {
  bar: RGBA.fromHex("#50AE90"),
  barDim: RGBA.fromHex("#1A3D34"),
};
