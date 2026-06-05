// The library (bookshelf): import .epub files, list stored books, open or
// delete them. Books are persisted in IndexedDB as the raw file blob plus
// extracted metadata (title, author, cover) and reading progress.

import { Epub } from "./epub.js";
import { getAllBooks, putBook, deleteBook, getBook } from "./db.js";

let els = null;
let onOpen = null;
let coverUrls = []; // object URLs to revoke on re-render

export function initLibrary(elements, openCallback) {
  els = elements;
  onOpen = openCallback;

  els.importInput.addEventListener("change", onFilesPicked);
  els.importBtn.addEventListener("click", () => els.importInput.click());
}

export async function refresh() {
  const books = await getAllBooks();
  books.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  render(books);
}

function render(books) {
  // Revoke previous cover URLs to avoid leaks.
  coverUrls.forEach((u) => URL.revokeObjectURL(u));
  coverUrls = [];

  els.grid.innerHTML = "";
  els.empty.style.display = books.length ? "none" : "block";

  for (const book of books) {
    els.grid.appendChild(renderCard(book));
  }
}

function renderCard(book) {
  const card = document.createElement("div");
  card.className = "book-card";

  const cover = document.createElement("div");
  cover.className = "book-cover";
  if (book.coverBlob) {
    const url = URL.createObjectURL(book.coverBlob);
    coverUrls.push(url);
    const img = document.createElement("img");
    img.src = url;
    img.alt = book.title;
    cover.appendChild(img);
  } else {
    cover.classList.add("no-cover");
    cover.textContent = book.title;
  }
  cover.addEventListener("click", () => open(book.id));

  const meta = document.createElement("div");
  meta.className = "book-meta";
  const title = document.createElement("div");
  title.className = "book-title";
  title.textContent = book.title;
  const author = document.createElement("div");
  author.className = "book-author";
  author.textContent = book.author || "";
  meta.appendChild(title);
  meta.appendChild(author);

  // Reading progress bar.
  if (book.progress && book.progress.spineIndex != null) {
    const bar = document.createElement("div");
    bar.className = "card-progress";
    const fill = document.createElement("div");
    fill.style.width = "100%";
    bar.appendChild(fill);
    meta.appendChild(bar);
  }

  const del = document.createElement("button");
  del.className = "book-delete";
  del.title = "Delete book";
  del.textContent = "×";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    remove(book);
  });

  card.appendChild(cover);
  card.appendChild(meta);
  card.appendChild(del);
  return card;
}

async function onFilesPicked(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = ""; // allow re-importing the same file later
  for (const file of files) {
    try {
      await importFile(file);
    } catch (err) {
      console.error("Failed to import", file.name, err);
      alert(`Could not import "${file.name}": ${err.message}`);
    }
  }
  await refresh();
}

async function importFile(file) {
  const blob = file.slice(0, file.size, "application/epub+zip");
  const epub = await Epub.fromBlob(blob);
  const record = {
    id:
      (crypto.randomUUID && crypto.randomUUID()) ||
      "b-" + Date.now().toString(36) + Math.random().toString(36).slice(2),
    title: epub.title || file.name.replace(/\.epub$/i, ""),
    author: epub.author || "",
    coverBlob: epub.coverBlob(),
    fileBlob: blob,
    addedAt: Date.now(),
    progress: { spineIndex: 0, fraction: 0 },
  };
  epub.revokeAll();
  await putBook(record);
}

async function open(id) {
  const record = await getBook(id);
  if (!record) return;
  const epub = await Epub.fromBlob(record.fileBlob);
  onOpen(record, epub);
}

async function remove(book) {
  if (!confirm(`Delete "${book.title}"? This cannot be undone.`)) return;
  await deleteBook(book.id);
  await refresh();
}
