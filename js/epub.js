// EPUB parsing: an EPUB is a ZIP archive. We unzip it into a path -> bytes map,
// then read the OCF container, the OPF package document, and the navigation
// document / NCX to build the reading order (spine) and table of contents.

import { unzipSync, strFromU8 } from "../vendor/fflate.module.js";

const XML = "application/xml";

// Normalize a path that may contain "../" or "./" segments. Paths inside an
// EPUB are stored with forward slashes regardless of platform.
function normalizePath(path) {
  const parts = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

// Resolve an href relative to a base file path (directory of the base file).
function resolveHref(baseFilePath, href) {
  // Strip any fragment (#...) — we only address files here.
  const clean = href.split("#")[0];
  const baseDir = baseFilePath.includes("/")
    ? baseFilePath.slice(0, baseFilePath.lastIndexOf("/"))
    : "";
  return normalizePath(baseDir ? baseDir + "/" + clean : clean);
}

function mimeFor(path) {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return (
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      svg: "image/svg+xml",
      webp: "image/webp",
      css: "text/css",
      xhtml: "application/xhtml+xml",
      html: "text/html",
      ncx: "application/x-dtbncx+xml",
      otf: "font/otf",
      ttf: "font/ttf",
      woff: "font/woff",
      woff2: "font/woff2",
    }[ext] || "application/octet-stream"
  );
}

export class Epub {
  constructor(files) {
    this.files = files; // { path: Uint8Array }
    this.title = "Untitled";
    this.author = "";
    this.opfPath = "";
    this.manifest = {}; // id -> { href, path, mediaType, properties }
    this.spine = []; // [{ id, href, path }]
    this.toc = []; // [{ label, href, path }]
    this.coverPath = null;
    this._urlCache = new Map(); // path -> object URL
  }

  static async fromBlob(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const files = unzipSync(buf);
    const epub = new Epub(files);
    epub._parse();
    return epub;
  }

  _text(path) {
    const bytes = this.files[path];
    if (!bytes) return null;
    return strFromU8(bytes);
  }

  _xml(path) {
    const text = this._text(path);
    if (text == null) return null;
    return new DOMParser().parseFromString(text, XML);
  }

  _parse() {
    // 1. OCF container -> OPF path
    const container = this._xml("META-INF/container.xml");
    const rootfile = container && container.querySelector("rootfile");
    this.opfPath = normalizePath(
      (rootfile && rootfile.getAttribute("full-path")) || "content.opf"
    );

    // 2. OPF package document
    const opf = this._xml(this.opfPath);
    if (!opf) throw new Error("Invalid EPUB: missing package document");

    // Metadata
    const titleEl = opf.querySelector("metadata title, title");
    if (titleEl && titleEl.textContent.trim())
      this.title = titleEl.textContent.trim();
    const creatorEl = opf.querySelector("metadata creator, creator");
    if (creatorEl) this.author = creatorEl.textContent.trim();

    // Manifest
    const idToItem = {};
    opf.querySelectorAll("manifest > item").forEach((item) => {
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      if (!id || !href) return;
      const entry = {
        href,
        path: resolveHref(this.opfPath, href),
        mediaType: item.getAttribute("media-type") || mimeFor(href),
        properties: item.getAttribute("properties") || "",
      };
      this.manifest[id] = entry;
      idToItem[id] = entry;
    });

    // Cover image: EPUB3 properties="cover-image", else EPUB2 meta name=cover
    for (const id in this.manifest) {
      if (this.manifest[id].properties.split(/\s+/).includes("cover-image")) {
        this.coverPath = this.manifest[id].path;
        break;
      }
    }
    if (!this.coverPath) {
      const metaCover = opf.querySelector('metadata meta[name="cover"]');
      const coverId = metaCover && metaCover.getAttribute("content");
      if (coverId && this.manifest[coverId])
        this.coverPath = this.manifest[coverId].path;
    }

    // Spine = reading order
    opf.querySelectorAll("spine > itemref").forEach((ref) => {
      const idref = ref.getAttribute("idref");
      const item = idToItem[idref];
      if (!item) return;
      // linear="no" items are still navigable; keep them in order.
      this.spine.push({ id: idref, href: item.href, path: item.path });
    });

    // Table of contents
    this._parseToc(opf, idToItem);
  }

  _parseToc(opf, idToItem) {
    // EPUB3 nav document (manifest item with properties containing "nav")
    let navItem = null;
    for (const id in this.manifest) {
      if (this.manifest[id].properties.split(/\s+/).includes("nav")) {
        navItem = this.manifest[id];
        break;
      }
    }
    if (navItem) {
      const doc = this._xml(navItem.path);
      if (doc) {
        // Find the toc nav (epub:type="toc") or fall back to the first nav.
        let nav = null;
        doc.querySelectorAll("nav").forEach((n) => {
          const type =
            n.getAttribute("epub:type") || n.getAttribute("type") || "";
          if (!nav || type.includes("toc")) {
            if (!nav || type.includes("toc")) nav = n;
          }
        });
        if (nav) {
          nav.querySelectorAll("a[href]").forEach((a) => {
            const href = a.getAttribute("href");
            this.toc.push({
              label: a.textContent.trim(),
              href,
              path: resolveHref(navItem.path, href),
            });
          });
          if (this.toc.length) return;
        }
      }
    }

    // EPUB2 NCX
    const spineEl = opf.querySelector("spine");
    const ncxId = spineEl && spineEl.getAttribute("toc");
    const ncxItem =
      (ncxId && idToItem[ncxId]) ||
      Object.values(this.manifest).find(
        (m) => m.mediaType === "application/x-dtbncx+xml"
      );
    if (ncxItem) {
      const doc = this._xml(ncxItem.path);
      if (doc) {
        doc.querySelectorAll("navMap navPoint").forEach((pt) => {
          const labelEl = pt.querySelector("navLabel text");
          const contentEl = pt.querySelector("content");
          const href = contentEl && contentEl.getAttribute("src");
          if (!href) return;
          this.toc.push({
            label: labelEl ? labelEl.textContent.trim() : "",
            href,
            path: resolveHref(ncxItem.path, href),
          });
        });
      }
    }

    // Fallback: derive a minimal TOC from the spine.
    if (!this.toc.length) {
      this.toc = this.spine.map((s, i) => ({
        label: `Section ${i + 1}`,
        href: s.href,
        path: s.path,
      }));
    }
  }

  // Raw bytes for a resource path inside the archive.
  getBytes(path) {
    return this.files[normalizePath(path)] || null;
  }

  // A cached object URL for a resource (used for images/cover). Caller-agnostic;
  // URLs are revoked via revokeAll() when the book is closed.
  resourceUrl(path) {
    const norm = normalizePath(path);
    if (this._urlCache.has(norm)) return this._urlCache.get(norm);
    const bytes = this.files[norm];
    if (!bytes) return null;
    const url = URL.createObjectURL(
      new Blob([bytes], { type: mimeFor(norm) })
    );
    this._urlCache.set(norm, url);
    return url;
  }

  coverBlob() {
    if (!this.coverPath) return null;
    const bytes = this.files[this.coverPath];
    if (!bytes) return null;
    return new Blob([bytes], { type: mimeFor(this.coverPath) });
  }

  // Chapter XHTML as a parsed Document (for the reader to sanitize/render).
  chapterDoc(path) {
    const text = this._text(normalizePath(path));
    if (text == null) return null;
    // Parse as HTML so malformed XHTML still renders; namespaces are dropped
    // but that's fine for our minimal rendering.
    return new DOMParser().parseFromString(text, "text/html");
  }

  // Index of the spine item whose path matches a TOC/href target.
  spineIndexForPath(path) {
    const norm = normalizePath(path);
    return this.spine.findIndex((s) => s.path === norm);
  }

  revokeAll() {
    for (const url of this._urlCache.values()) URL.revokeObjectURL(url);
    this._urlCache.clear();
  }
}
