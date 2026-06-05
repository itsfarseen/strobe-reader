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
} from "./themes.js";

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
      themeRow: $("theme-row"),
      fontDec: $("font-dec"),
      fontInc: $("font-inc"),
      fontValue: $("font-value"),
      progressBar: $("progress-bar"),
      progressLabel: $("progress-label"),
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
    bg: $("te-bg"),
    fg: $("te-fg"),
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
    fields.bg.value = t.bg;
    fields.fg.value = t.fg;
    fields.line.value = t.lineHeight;
    fields.para.value = t.paraSpacing;
    fields.margin.value = t.margin;
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
    root.setProperty("--bg", fields.bg.value);
    root.setProperty("--fg", fields.fg.value);
    root.setProperty("--line-height", fields.line.value);
    root.setProperty("--para-spacing", fields.para.value + "em");
    root.setProperty("--margin", fields.margin.value + "px");
    syncLabels();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", fields.bg.value);
  }

  for (const k of ["bg", "fg", "line", "para", "margin"]) {
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
      bg: fields.bg.value,
      fg: fields.fg.value,
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

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    // Register right away. main() is async, so by the time we get here the
    // window "load" event may have already fired — don't gate on it.
    navigator.serviceWorker
      .register("service-worker.js")
      .catch((err) => console.warn("SW registration failed", err));
  }
}

main();
