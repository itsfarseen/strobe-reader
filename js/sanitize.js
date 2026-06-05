// Sanitize untrusted EPUB chapter HTML and rewrite image references to blob
// URLs from the archive. We also strip the book's own styling so only our
// minimal reader styles + active theme apply (per project decision).

const REMOVE_TAGS = new Set([
  "script",
  "style",
  "link",
  "iframe",
  "object",
  "embed",
  "meta",
  "base",
  "title",
]);

const DANGEROUS_PROTOCOL = /^\s*(javascript|data|vbscript):/i;

// Build a clean DocumentFragment from a parsed chapter Document.
//  - epub:    the Epub instance (for resolving image hrefs to object URLs)
//  - chapterPath: archive path of the chapter (to resolve relative image src)
export function sanitizeChapter(doc, epub, chapterPath) {
  const body = doc.body || doc.documentElement;
  const frag = document.createDocumentFragment();
  for (const node of Array.from(body.childNodes)) {
    const clean = cleanNode(node, epub, chapterPath);
    if (clean) frag.appendChild(clean);
  }
  return frag;
}

function cleanNode(node, epub, chapterPath) {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.nodeValue);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const tag = node.tagName.toLowerCase();
  if (REMOVE_TAGS.has(tag)) return null;

  const el = document.createElement(tag);

  // Copy a safe subset of attributes.
  for (const attr of Array.from(node.attributes)) {
    const name = attr.name.toLowerCase();
    let value = attr.value;

    if (name.startsWith("on")) continue; // event handlers
    if (name === "style") continue; // strip inline styling
    if (name === "class" || name === "id") {
      el.setAttribute(name, value);
      continue;
    }

    if ((name === "href" || name === "xlink:href") && tag === "a") {
      if (DANGEROUS_PROTOCOL.test(value)) continue;
      // Internal anchors only; external links open in a new tab.
      el.setAttribute("href", value);
      if (/^https?:/i.test(value)) {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      continue;
    }

    if (
      (tag === "img" && (name === "src" || name === "srcset")) ||
      (tag === "image" && (name === "href" || name === "xlink:href"))
    ) {
      // Resolve to a blob URL from the archive.
      const url = resolveImageUrl(value, epub, chapterPath);
      if (url) el.setAttribute(name === "srcset" ? "src" : "src", url);
      continue;
    }

    // Allow other harmless attributes (alt, title, colspan, etc.).
    if (!DANGEROUS_PROTOCOL.test(value)) el.setAttribute(name, value);
  }

  // SVG <image> needs its href set in the SVG namespace; handle simply by
  // recreating as namespaced when inside <svg>. For our minimal renderer we
  // convert standalone SVG-image to a plain <img>.
  if (tag === "image") {
    const img = document.createElement("img");
    const src = el.getAttribute("src");
    if (src) img.setAttribute("src", src);
    return img;
  }

  for (const child of Array.from(node.childNodes)) {
    const clean = cleanNode(child, epub, chapterPath);
    if (clean) el.appendChild(clean);
  }
  return el;
}

function resolveImageUrl(href, epub, chapterPath) {
  if (!href) return null;
  if (DANGEROUS_PROTOCOL.test(href)) return null;
  if (/^https?:/i.test(href)) return href; // remote image, leave as-is

  // srcset may contain multiple candidates; take the first URL.
  const first = href.trim().split(/\s+/)[0].split(",")[0];

  const baseDir = chapterPath.includes("/")
    ? chapterPath.slice(0, chapterPath.lastIndexOf("/"))
    : "";
  const combined = baseDir ? baseDir + "/" + first : first;
  return epub.resourceUrl(combined);
}
