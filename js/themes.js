// Theme + font-size management. A theme styles the ENTIRE UI via CSS custom
// properties on :root. Font size is separate and applies only to book text
// (the reader reads --font-size for #reader-content).

import { getSettings, putSettings } from "./db.js";

// A theme: bg/fg colors, line height (unitless), paragraph spacing (em),
// and page margin (px). accent is derived for UI chrome.
export const PRESETS = [
  {
    id: "light",
    name: "Light",
    bg: "#ffffff",
    fg: "#1a1a1a",
    lineHeight: 1.6,
    paraSpacing: 1.0,
    margin: 24,
    preset: true,
  },
  {
    id: "sepia",
    name: "Sepia",
    bg: "#f4ecd8",
    fg: "#5b4636",
    lineHeight: 1.6,
    paraSpacing: 1.0,
    margin: 24,
    preset: true,
  },
  {
    id: "dark",
    name: "Dark",
    bg: "#121212",
    fg: "#cfcfcf",
    lineHeight: 1.7,
    paraSpacing: 1.0,
    margin: 24,
    preset: true,
  },
];

const DEFAULTS = {
  activeThemeId: "light",
  fontSize: 18,
  customThemes: [],
};

export const MIN_FONT = 12;
export const MAX_FONT = 32;

let state = { ...DEFAULTS };
const listeners = new Set();

export async function initSettings() {
  const saved = await getSettings();
  if (saved) state = { ...DEFAULTS, ...saved };
  applyTheme();
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
    fontSize: state.fontSize,
    customThemes: state.customThemes,
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

export function getFontSize() {
  return state.fontSize;
}

// Push the active theme + font size into CSS custom properties.
export function applyTheme() {
  const t = activeTheme();
  const root = document.documentElement.style;
  root.setProperty("--bg", t.bg);
  root.setProperty("--fg", t.fg);
  root.setProperty("--line-height", String(t.lineHeight));
  root.setProperty("--para-spacing", `${t.paraSpacing}em`);
  root.setProperty("--margin", `${t.margin}px`);
  root.setProperty("--font-size", `${state.fontSize}px`);
  // Keep the browser/OS UI (status bar) in sync in standalone mode.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t.bg);
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

function makeId() {
  return "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
