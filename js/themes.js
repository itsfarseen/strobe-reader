// Theme + font-size management. A theme styles the ENTIRE UI via CSS custom
// properties on :root. Font size is separate and applies only to book text
// (the reader reads --font-size for #reader-content).

import { getSettings, putSettings } from "./db.js";

// Reading fonts, vendored as woff2 under /fonts (see css/app.css @font-face).
// Each stack ends in a system fallback so text still renders if a file is
// missing. The `id` is what gets stored on a theme's `fontFamily`.
export const FONTS = [
  {
    id: "serif",
    name: "Serif",
    stack: '"Literata", Georgia, "Times New Roman", serif',
  },
  {
    id: "sans",
    name: "Sans",
    stack:
      '"Atkinson Hyperlegible", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: "mono",
    name: "Mono",
    stack: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },
];

export const DEFAULT_FONT = "serif";

export function fontStack(id) {
  const f = FONTS.find((x) => x.id === id);
  return (f || FONTS.find((x) => x.id === DEFAULT_FONT)).stack;
}

// A theme: bg/fg colors only. Typography (reading font, spacing, margin) is a
// separate concern, kept in typography presets below, so changing a theme's
// colors no longer disturbs the reading layout. accent is derived for UI chrome.
export const PRESETS = [
  {
    id: "light",
    name: "Light",
    bg: "#ffffff",
    fg: "#1a1a1a",
    preset: true,
  },
  {
    id: "sepia",
    name: "Sepia",
    bg: "#f4ecd8",
    fg: "#5b4636",
    preset: true,
  },
  {
    id: "dark",
    name: "Dark",
    bg: "#121212",
    fg: "#cfcfcf",
    preset: true,
  },
];

// A typography preset: reading font family (a FONTS id), line height (unitless),
// paragraph spacing (em), and page margin (px). Independent of the theme, so the
// reading layout stays put when colors change. Font size is separate and global.
export const TYPO_PRESETS = [
  {
    id: "typo-serif",
    name: "Serif",
    fontFamily: "serif",
    lineHeight: 1.6,
    paraSpacing: 1.0,
    margin: 24,
    preset: true,
  },
  {
    id: "typo-sans",
    name: "Sans",
    fontFamily: "sans",
    lineHeight: 1.7,
    paraSpacing: 1.0,
    margin: 24,
    preset: true,
  },
  {
    id: "typo-compact",
    name: "Compact",
    fontFamily: "sans",
    lineHeight: 1.4,
    paraSpacing: 0.6,
    margin: 16,
    preset: true,
  },
];

export const DEFAULT_TYPO = "typo-serif";

const DEFAULTS = {
  activeThemeId: "light",
  activeTypographyId: DEFAULT_TYPO,
  fontSize: 18,
  customThemes: [],
  customTypographies: [],
  // Strobe config persists; the on/off state is transient (reader.js) so the
  // effect always starts disabled when a book is opened.
  strobeFreq: 10,
  strobeIntensity: 50,
  strobeShape: "square",
  // Jiggle config persists; the mode (off/horizontal/vertical) is transient
  // (reader.js) so the effect always starts disabled when a book is opened.
  jiggleFreq: 5,
  jiggleIntensity: 20,
};

export const MIN_FONT = 12;
export const MAX_FONT = 32;

export const MIN_STROBE_FREQ = 1;
export const MAX_STROBE_FREQ = 60;

export const MIN_JIGGLE_FREQ = 1;
export const MAX_JIGGLE_FREQ = 30;

let state = { ...DEFAULTS };
const listeners = new Set();

export async function initSettings() {
  const saved = await getSettings();
  if (saved) state = { ...DEFAULTS, ...saved };
  applyTheme();
  applyTypography();
  return state;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(state);
}

async function persist() {
  await putSettings({
    activeThemeId: state.activeThemeId,
    activeTypographyId: state.activeTypographyId,
    fontSize: state.fontSize,
    customThemes: state.customThemes,
    customTypographies: state.customTypographies,
    strobeFreq: state.strobeFreq,
    strobeIntensity: state.strobeIntensity,
    strobeShape: state.strobeShape,
    jiggleFreq: state.jiggleFreq,
    jiggleIntensity: state.jiggleIntensity,
  });
}

export function allThemes() {
  return [...PRESETS, ...state.customThemes];
}

export function activeTheme() {
  return (
    allThemes().find((t) => t.id === state.activeThemeId) || PRESETS[0]
  );
}

export function allTypographies() {
  return [...TYPO_PRESETS, ...state.customTypographies];
}

export function activeTypography() {
  return (
    allTypographies().find((t) => t.id === state.activeTypographyId) ||
    TYPO_PRESETS[0]
  );
}

export function getFontSize() {
  return state.fontSize;
}

export function getStrobeFreq() {
  return state.strobeFreq;
}
export function getStrobeIntensity() {
  return state.strobeIntensity;
}
export function getStrobeShape() {
  return state.strobeShape;
}

export function getJiggleFreq() {
  return state.jiggleFreq;
}
export function getJiggleIntensity() {
  return state.jiggleIntensity;
}

// "#rrggbb" -> the per-channel inverse "#rrggbb" (255 - v). Used as the color
// the reader background flickers toward. Falls back to black on bad input.
export function inverseColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return "#000000";
  const n = parseInt(m[1], 16);
  const r = 255 - ((n >> 16) & 0xff);
  const g = 255 - ((n >> 8) & 0xff);
  const b = 255 - (n & 0xff);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// Push the active theme's colors + the global font size into CSS custom
// properties. Typography (font/spacing/margin) lives in applyTypography().
export function applyTheme() {
  const t = activeTheme();
  const root = document.documentElement.style;
  root.setProperty("--bg", t.bg);
  root.setProperty("--fg", t.fg);
  root.setProperty("--font-size", `${state.fontSize}px`);
  // Keep the browser/OS UI (status bar) in sync in standalone mode.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.bg);
  // The strobe's target color is derived from this theme's background, so keep
  // it in sync whenever the theme changes.
  applyStrobe();
  applyJiggle();
}

// Push the active typography preset into CSS custom properties. Independent of
// the theme so colors and reading layout can change without disturbing each
// other.
export function applyTypography() {
  const t = activeTypography();
  const root = document.documentElement.style;
  root.setProperty("--reading-font", fontStack(t.fontFamily));
  root.setProperty("--line-height", String(t.lineHeight));
  root.setProperty("--para-spacing", `${t.paraSpacing}em`);
  root.setProperty("--margin", `${t.margin}px`);
}

// Push strobe parameters into CSS custom properties consumed by the keyframe
// animation in app.css. JS sets these once per change; the animation itself
// runs entirely in CSS.
export function applyStrobe() {
  const root = document.documentElement.style;
  root.setProperty("--strobe-color", inverseColor(activeTheme().bg));
  root.setProperty("--strobe-max", String(state.strobeIntensity / 100));
  root.setProperty("--strobe-duration", `${1 / state.strobeFreq}s`);
  root.setProperty(
    "--strobe-shape",
    state.strobeShape === "sine" ? "strobe-sine" : "strobe-square"
  );
  // Foreground strobe shares the shape/intensity but uses its own keyframes
  // (which dim the text rather than fading in an overlay color).
  root.setProperty(
    "--strobe-fg-shape",
    state.strobeShape === "sine" ? "strobe-fg-sine" : "strobe-fg-square"
  );
}

// Push jiggle parameters into CSS custom properties consumed by the keyframe
// animation in app.css. Amplitude is the slider value (0-100) mapped to 0-1em;
// duration is one oscillation period derived from the frequency.
export function applyJiggle() {
  const root = document.documentElement.style;
  root.setProperty("--jiggle-amp", `${state.jiggleIntensity / 100}em`);
  root.setProperty("--jiggle-duration", `${1 / state.jiggleFreq}s`);
}

export async function setActiveTheme(id) {
  state.activeThemeId = id;
  applyTheme();
  await persist();
  notify();
}

export async function setFontSize(px) {
  state.fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, px));
  applyTheme();
  await persist();
  notify();
}

// Strobe setters update CSS vars via applyStrobe() and persist. They do NOT
// call notify(): the only onChange listener re-paginates the page, which these
// params don't affect, so skipping it avoids needless re-flow while dragging.
export async function setStrobeFreq(hz) {
  state.strobeFreq = Math.max(MIN_STROBE_FREQ, Math.min(MAX_STROBE_FREQ, hz));
  applyStrobe();
  await persist();
}

export async function setStrobeIntensity(pct) {
  state.strobeIntensity = Math.max(0, Math.min(100, pct));
  applyStrobe();
  await persist();
}

export async function setStrobeShape(shape) {
  state.strobeShape = shape === "sine" ? "sine" : "square";
  applyStrobe();
  await persist();
}

// Jiggle setters mirror the strobe ones: update CSS vars + persist, and skip
// notify() since jiggle doesn't affect pagination.
export async function setJiggleFreq(hz) {
  state.jiggleFreq = Math.max(MIN_JIGGLE_FREQ, Math.min(MAX_JIGGLE_FREQ, hz));
  applyJiggle();
  await persist();
}

export async function setJiggleIntensity(units) {
  state.jiggleIntensity = Math.max(0, Math.min(100, units));
  applyJiggle();
  await persist();
}

function makeId(prefix = "custom") {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function setActiveTypography(id) {
  state.activeTypographyId = id;
  applyTypography();
  await persist();
  notify();
}

export async function saveCustomTypography(typo) {
  // typo without id => create; with id => update existing custom typography.
  if (typo.id && state.customTypographies.some((t) => t.id === typo.id)) {
    state.customTypographies = state.customTypographies.map((t) =>
      t.id === typo.id ? { ...typo, preset: false } : t
    );
  } else {
    typo = { ...typo, id: makeId("typo-custom"), preset: false };
    state.customTypographies.push(typo);
  }
  await persist();
  if (typo.id === state.activeTypographyId) applyTypography();
  notify();
  return typo;
}

export async function deleteCustomTypography(id) {
  state.customTypographies = state.customTypographies.filter((t) => t.id !== id);
  if (state.activeTypographyId === id) {
    state.activeTypographyId = TYPO_PRESETS[0].id;
    applyTypography();
  }
  await persist();
  notify();
}

export async function saveCustomTheme(theme) {
  // theme without id => create; with id => update existing custom theme.
  if (theme.id && state.customThemes.some((t) => t.id === theme.id)) {
    state.customThemes = state.customThemes.map((t) =>
      t.id === theme.id ? { ...theme, preset: false } : t
    );
  } else {
    theme = { ...theme, id: makeId(), preset: false };
    state.customThemes.push(theme);
  }
  await persist();
  if (theme.id === state.activeThemeId) applyTheme();
  notify();
  return theme;
}

export async function deleteCustomTheme(id) {
  state.customThemes = state.customThemes.filter((t) => t.id !== id);
  if (state.activeThemeId === id) {
    state.activeThemeId = PRESETS[0].id;
    applyTheme();
  }
  await persist();
  notify();
}
