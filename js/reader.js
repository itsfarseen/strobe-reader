// The reader: renders a whole chapter into a CSS multi-column layout and pages
// by translating the content horizontally. Page turns are instant (no
// animation). Tap zones drive navigation; the overlay UI is hidden by default.

import { sanitizeChapter } from "./sanitize.js";
import { saveProgress } from "./db.js";
import {
  activeTheme,
  getFontSize,
  setFontSize,
  setActiveTheme,
  allThemes,
  onChange,
  MIN_FONT,
  MAX_FONT,
} from "./themes.js";

let els = null; // cached DOM references
let onExit = null; // callback to return to the library

let epub = null; // current Epub instance
let bookId = null;
let spineIndex = 0;
let page = 0;
let pageCount = 1;
let pendingFraction = 0; // restore target within a freshly loaded chapter
let saveTimer = null;
let overlayVisible = false;

export function initReader(elements, exitCallback) {
  els = elements;
  onExit = exitCallback;

  // Navigation: clicks on the viewport are split into left / center / right
  // zones, but real links inside the text are followed instead.
  els.viewport.addEventListener("click", onViewportClick);

  els.backBtn.addEventListener("click", close);
  els.tocBtn.addEventListener("click", toggleToc);

  // Font size controls.
  els.fontDec.addEventListener("click", () => setFontSize(getFontSize() - 1));
  els.fontInc.addEventListener("click", () => setFontSize(getFontSize() + 1));

  // Keyboard paging for desktop.
  window.addEventListener("keydown", onKey);

  // Re-paginate on resize/orientation change, preserving reading fraction.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!isOpen()) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => repaginate(), 150);
  });

  // Theme / font-size changes re-flow the page; keep the reader's place.
  onChange(() => {
    if (isOpen()) repaginate();
  });
}

export function isOpen() {
  return epub !== null;
}

export async function openBook(record, parsedEpub) {
  epub = parsedEpub;
  bookId = record.id;
  const progress = record.progress || { spineIndex: 0, fraction: 0 };
  spineIndex = Math.min(progress.spineIndex || 0, epub.spine.length - 1);

  buildTocList();
  els.bookTitle.textContent = epub.title;
  hideOverlay();
  await loadChapter(spineIndex, progress.fraction || 0);
}

function close() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    persistNow();
  }
  if (epub) epub.revokeAll();
  epub = null;
  bookId = null;
  els.content.innerHTML = "";
  if (onExit) onExit();
}

// ---- Chapter loading & pagination ----

async function loadChapter(index, fraction) {
  spineIndex = Math.max(0, Math.min(index, epub.spine.length - 1));
  pendingFraction = fraction || 0;

  const item = epub.spine[spineIndex];
  const doc = epub.chapterDoc(item.path);
  els.content.innerHTML = "";
  if (doc) {
    const frag = sanitizeChapter(doc, epub, item.path);
    els.content.appendChild(frag);
    rewriteInternalLinks(item.path);
  }

  await waitForImages(els.content);
  repaginate();
}

// Compute column geometry and total page count, then jump to the target page.
function repaginate() {
  const margin = readMargin();
  const vw = els.viewport.clientWidth;
  const vh = els.viewport.clientHeight;
  const colWidth = Math.max(50, vw - 2 * margin);
  const gap = 2 * margin;

  const c = els.content;
  // The element's width MUST equal the column width: otherwise the browser
  // fits a single full-width column and our pages overflow their margins.
  // With width == colWidth and column-gap == 2*margin, consecutive columns sit
  // exactly one viewport-width (colWidth + gap == vw) apart.
  c.style.left = margin + "px";
  c.style.right = "auto";
  c.style.width = colWidth + "px";
  c.style.columnWidth = colWidth + "px";
  c.style.columnGap = gap + "px";
  c.style.columnFill = "auto";
  c.style.height = vh - 2 * margin + "px";
  c.style.top = margin + "px";
  c.style.bottom = "auto";

  // Force layout, then measure.
  const scrollWidth = c.scrollWidth;
  pageCount = Math.max(1, Math.round((scrollWidth + gap) / vw));

  // Restore target page from the pending fraction (set on chapter load) or
  // keep the current page proportionally on resize/theme change.
  const frac = pendingFraction != null ? pendingFraction : currentFraction();
  pendingFraction = null;
  page = Math.round(frac * (pageCount - 1));
  page = Math.max(0, Math.min(page, pageCount - 1));
  applyPage(vw);
  updateProgressUI();
}

function applyPage(vw) {
  if (vw == null) vw = els.viewport.clientWidth;
  // The content element already sits at left:margin, so column 0 is in place;
  // each page shifts the whole block by one viewport width.
  els.content.style.transform = `translateX(${-page * vw}px)`;
}

function currentFraction() {
  return pageCount > 1 ? page / (pageCount - 1) : 0;
}

function readMargin() {
  const v = getComputedStyle(document.documentElement).getPropertyValue(
    "--margin"
  );
  const n = parseInt(v, 10);
  return isNaN(n) ? 24 : n;
}

function waitForImages(container) {
  const imgs = Array.from(container.querySelectorAll("img"));
  if (!imgs.length) return Promise.resolve();
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) return resolve();
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        })
    )
  );
}

// ---- Navigation ----

function nextPage() {
  if (page < pageCount - 1) {
    page++;
    applyPage();
    afterTurn();
  } else if (spineIndex < epub.spine.length - 1) {
    loadChapter(spineIndex + 1, 0);
  }
}

function prevPage() {
  if (page > 0) {
    page--;
    applyPage();
    afterTurn();
  } else if (spineIndex > 0) {
    // Go to the last page of the previous chapter.
    loadChapter(spineIndex - 1, 1);
  }
}

function afterTurn() {
  updateProgressUI();
  scheduleSave();
}

function onViewportClick(e) {
  const link = e.target.closest && e.target.closest("a");
  if (link && link.getAttribute("href")) {
    handleLink(e, link);
    return;
  }
  const x = e.clientX;
  const w = els.viewport.clientWidth;
  if (x < w / 3) {
    hideOverlay();
    prevPage();
  } else if (x > (2 * w) / 3) {
    hideOverlay();
    nextPage();
  } else {
    toggleOverlay();
  }
}

function handleLink(e, link) {
  const href = link.getAttribute("href");
  if (/^https?:/i.test(href)) return; // external: default new-tab behavior
  e.preventDefault();
  // Internal link: resolve to a spine item.
  const item = epub.spine[spineIndex];
  const baseDir = item.path.includes("/")
    ? item.path.slice(0, item.path.lastIndexOf("/"))
    : "";
  const target = href.split("#")[0];
  const resolved = baseDir ? baseDir + "/" + target : target;
  const idx = epub.spineIndexForPath(resolved);
  if (idx >= 0) loadChapter(idx, 0);
}

function onKey(e) {
  if (!isOpen()) return;
  if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
    nextPage();
  } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
    prevPage();
  } else if (e.key === "Escape") {
    if (overlayVisible) hideOverlay();
    else close();
  }
}

// ---- Overlay + TOC ----

function toggleOverlay() {
  overlayVisible ? hideOverlay() : showOverlay();
}

function showOverlay() {
  overlayVisible = true;
  els.reader.classList.add("overlay-visible");
  buildThemeButtons();
  els.fontValue.textContent = getFontSize() + "px";
}

function hideOverlay() {
  overlayVisible = false;
  els.reader.classList.remove("overlay-visible");
  els.tocPanel.classList.remove("open");
}

function toggleToc() {
  els.tocPanel.classList.toggle("open");
}

function buildTocList() {
  els.tocList.innerHTML = "";
  epub.toc.forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = entry.label || "(untitled)";
    li.addEventListener("click", () => {
      const idx = epub.spineIndexForPath(entry.path);
      if (idx >= 0) {
        hideOverlay();
        loadChapter(idx, 0);
      }
    });
    els.tocList.appendChild(li);
  });
}

function buildThemeButtons() {
  els.themeRow.innerHTML = "";
  const active = activeTheme().id;
  allThemes().forEach((t) => {
    const b = document.createElement("button");
    b.className = "theme-chip" + (t.id === active ? " active" : "");
    b.style.background = t.bg;
    b.style.color = t.fg;
    b.textContent = t.name;
    b.addEventListener("click", () => {
      setActiveTheme(t.id);
      buildThemeButtons();
    });
    els.themeRow.appendChild(b);
  });
}

// Mark internal anchors so the click handler can intercept them cleanly.
function rewriteInternalLinks() {
  // No-op hook kept for clarity; link handling is done in handleLink via
  // event delegation. Present so future per-link processing has a home.
}

// ---- Progress ----

function updateProgressUI() {
  const total = epub.spine.length;
  const overall = (spineIndex + currentFraction()) / total;
  els.progressBar.style.width = Math.round(overall * 100) + "%";
  els.progressLabel.textContent =
    `${Math.round(overall * 100)}%  ·  ` +
    `${page + 1}/${pageCount}`;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 400);
}

function persistNow() {
  if (!bookId) return;
  saveProgress(bookId, {
    spineIndex,
    fraction: currentFraction(),
  }).catch(() => {});
}

export const _fontBounds = { MIN_FONT, MAX_FONT };
