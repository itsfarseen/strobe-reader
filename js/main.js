// App bootstrap: register the service worker, load settings/themes, wire the
// library and reader views, and drive the theme editor modal.

import { initSettings, applyTheme } from "./themes.js";
import { initLibrary, refresh as refreshLibrary } from "./library.js";
import { initReader, openBook } from "./reader.js";
import {
  allThemes,
  activeTheme,
  setActiveTheme,
  saveCustomTheme,
  deleteCustomTheme,
  FONTS,
  DEFAULT_FONT,
  fontStack,
} from "./themes.js";

// Curated palette shown in place of the native rainbow color picker: a
// monochrome ramp plus a few warm and cool tones, suited to paper/ink reading.
const PALETTE = [
  // monochrome
  "#ffffff", "#e8e8e8", "#cfcfcf", "#9a9a9a",
  "#5a5a5a", "#2b2b2b", "#121212", "#000000",
  // warm
  "#faf3e6", "#f4ecd8", "#e4d5b7", "#5b4636", "#3a2f25",
  // cool
  "#eef2f7", "#d6dde6", "#94a3b8", "#2e3a46", "#0f1722",
];

const $ = (id) => document.getElementById(id);

async function main() {
  await initSettings();

  // ---- Views ----
  const libraryView = $("library");
  const readerView = $("reader");

  function showLibrary() {
    readerView.classList.remove("active");
    libraryView.classList.add("active");
    refreshLibrary();
  }
  function showReader() {
    libraryView.classList.remove("active");
    readerView.classList.add("active");
  }

  // ---- Library ----
  initLibrary(
    { importBtn: $("import-btn"), importInput: $("import-input"), grid: $("book-grid"), empty: $("empty-state") },
    async (record, epub) => {
      showReader();
      await openBook(record, epub);
    }
  );

  // ---- Reader ----
  initReader(
    {
      reader: readerView,
      viewport: $("reader-viewport"),
      content: $("reader-content"),
      backBtn: $("back-btn"),
      tocBtn: $("toc-btn"),
      bookTitle: $("book-title"),
      tocPanel: $("toc-panel"),
      tocList: $("toc-list"),
      fontDec: $("font-dec"),
      fontInc: $("font-inc"),
      fontValue: $("font-value"),
      progressBar: $("progress-bar"),
      progressLabel: $("progress-label"),
      strobeMode: $("strobe-mode"),
      strobeStop: $("strobe-stop"),
      strobeFreq: $("strobe-freq"),
      strobeFreqVal: $("strobe-freq-val"),
      strobeIntensity: $("strobe-intensity"),
      strobeIntensityVal: $("strobe-intensity-val"),
      strobeShape: $("strobe-shape"),
    },
    showLibrary
  );

  // ---- Theme editor ----
  wireThemeEditor();

  await refreshLibrary();
  registerServiceWorker();
}

// ----------------------- Theme editor modal -----------------------

function wireThemeEditor() {
  const modal = $("theme-editor");
  const fields = {
    name: $("te-name"),
    line: $("te-line"),
    para: $("te-para"),
    margin: $("te-margin"),
  };
  const labels = {
    line: $("te-line-val"),
    para: $("te-para-val"),
    margin: $("te-margin-val"),
  };
  let editingId = null; // null => creating a new theme
  // Color + font selections live in JS state (no native inputs).
  let bgVal = "#ffffff";
  let fgVal = "#1a1a1a";
  let fontVal = DEFAULT_FONT;

  // Build the curated swatch grid once; selecting a swatch updates `setVal`,
  // re-highlights, and live-previews.
  function buildSwatches(container, getVal, setVal) {
    container.innerHTML = "";
    PALETTE.forEach((color) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.style.background = color;
      b.title = color;
      b.addEventListener("click", () => {
        setVal(color);
        highlightSwatches(container, getVal());
        preview();
      });
      container.appendChild(b);
    });
  }
  function highlightSwatches(container, value) {
    const v = value.toLowerCase();
    for (const b of container.children) {
      b.classList.toggle("active", b.title.toLowerCase() === v);
    }
  }

  // Build the reading-font picker once.
  function buildFontOptions() {
    const container = $("te-font");
    container.innerHTML = "";
    FONTS.forEach((f) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "font-option";
      b.textContent = f.name;
      b.style.fontFamily = f.stack;
      b.dataset.id = f.id;
      b.addEventListener("click", () => {
        fontVal = f.id;
        highlightFonts();
        preview();
      });
      container.appendChild(b);
    });
  }
  function highlightFonts() {
    for (const b of $("te-font").children) {
      b.classList.toggle("active", b.dataset.id === fontVal);
    }
  }

  buildSwatches($("te-bg-swatches"), () => bgVal, (v) => (bgVal = v));
  buildSwatches($("te-fg-swatches"), () => fgVal, (v) => (fgVal = v));
  buildFontOptions();

  function open() {
    // Seed the form from the active theme as a convenient starting point.
    const t = activeTheme();
    editingId = t.preset ? null : t.id;
    loadForm(t);
    buildList();
    modal.classList.add("open");
  }
  function close() {
    modal.classList.remove("open");
    applyTheme(); // discard any live-preview overrides
  }

  function loadForm(t) {
    fields.name.value = t.preset ? "" : t.name;
    bgVal = t.bg;
    fgVal = t.fg;
    fontVal = t.fontFamily || DEFAULT_FONT;
    fields.line.value = t.lineHeight;
    fields.para.value = t.paraSpacing;
    fields.margin.value = t.margin;
    highlightSwatches($("te-bg-swatches"), bgVal);
    highlightSwatches($("te-fg-swatches"), fgVal);
    highlightFonts();
    syncLabels();
    updateHeading();
  }

  function syncLabels() {
    labels.line.textContent = (+fields.line.value).toFixed(2);
    labels.para.textContent = (+fields.para.value).toFixed(1) + "em";
    labels.margin.textContent = fields.margin.value + "px";
  }

  function updateHeading() {
    $("editor-heading").textContent = editingId ? "Edit theme" : "New theme";
    $("te-delete").hidden = !editingId;
  }

  // Live preview: write the in-progress values straight to the CSS variables.
  function preview() {
    const root = document.documentElement.style;
    root.setProperty("--bg", bgVal);
    root.setProperty("--fg", fgVal);
    root.setProperty("--reading-font", fontStack(fontVal));
    root.setProperty("--line-height", fields.line.value);
    root.setProperty("--para-spacing", fields.para.value + "em");
    root.setProperty("--margin", fields.margin.value + "px");
    syncLabels();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", bgVal);
  }

  for (const k of ["line", "para", "margin"]) {
    fields[k].addEventListener("input", preview);
  }

  function buildList() {
    const list = $("editor-theme-list");
    list.innerHTML = "";
    const active = activeTheme().id;
    for (const t of allThemes()) {
      const row = document.createElement("div");
      row.className = "editor-theme-row" + (t.id === active ? " active" : "");

      const chip = document.createElement("button");
      chip.className = "theme-chip";
      chip.style.background = t.bg;
      chip.style.color = t.fg;
      chip.textContent = t.name + (t.preset ? "" : " ✎");
      chip.addEventListener("click", () => {
        setActiveTheme(t.id);
        editingId = t.preset ? null : t.id;
        loadForm(t);
        buildList();
      });
      row.appendChild(chip);
      list.appendChild(row);
    }
  }

  $("edit-theme-btn").addEventListener("click", open);
  $("te-cancel").addEventListener("click", close);
  $("te-save").addEventListener("click", async () => {
    const theme = {
      id: editingId || undefined,
      name: fields.name.value.trim() || "Custom",
      bg: bgVal,
      fg: fgVal,
      fontFamily: fontVal,
      lineHeight: +fields.line.value,
      paraSpacing: +fields.para.value,
      margin: +fields.margin.value,
    };
    const saved = await saveCustomTheme(theme);
    await setActiveTheme(saved.id);
    editingId = saved.id;
    buildList();
    updateHeading();
  });
  $("te-delete").addEventListener("click", async () => {
    if (!editingId) return;
    await deleteCustomTheme(editingId);
    editingId = null;
    loadForm(activeTheme());
    buildList();
  });

  // Close when tapping the backdrop.
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
}

// ----------------------- Service worker -----------------------

// Set when the user accepts an update, so the controllerchange handler below
// reloads only for a deliberate swap — not for the clients.claim() that fires
// on a first-ever install.
let updateAccepted = false;

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  // Register right away. main() is async, so by the time we get here the
  // window "load" event may have already fired — don't gate on it.
  navigator.serviceWorker
    .register("service-worker.js")
    .then((reg) => {
      // An update may have finished installing on a prior visit and be sitting
      // in "waiting"; surface it now.
      if (reg.waiting && navigator.serviceWorker.controller) {
        promptUpdate(reg.waiting);
      }

      // A new worker started installing while the app is open.
      reg.addEventListener("updatefound", () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener("statechange", () => {
          // "installed" with an existing controller means an update (rather
          // than the first install) is ready and waiting to take over.
          if (
            incoming.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            promptUpdate(incoming);
          }
        });
      });
    })
    .catch((err) => console.warn("SW registration failed", err));

  // The new worker has taken control after the user accepted — reload once so
  // the page runs the fresh shell.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateAccepted) window.location.reload();
  });
}

// Show the "new version available" banner. On accept, tell the waiting worker
// to activate; the controllerchange handler then reloads the page.
function promptUpdate(worker) {
  const banner = $("update-banner");
  if (!banner || banner.dataset.shown === "1") return;
  banner.dataset.shown = "1";
  banner.hidden = false;

  $("update-reload").onclick = () => {
    updateAccepted = true;
    $("update-reload").disabled = true;
    worker.postMessage({ type: "SKIP_WAITING" });
  };
  $("update-dismiss").onclick = () => {
    banner.hidden = true;
    banner.dataset.shown = "";
  };
}

main();
