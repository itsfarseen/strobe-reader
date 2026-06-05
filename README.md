# Strobe Reader

A minimal, distraction-free **EPUB reader** that installs as a Progressive Web
App. Import `.epub` files, store them locally in your browser, and read with
instant tap-driven page turns, selectable themes, and adjustable font size.

No build step — it's plain static files (vanilla JS, ES modules). Just serve the
folder.

**Live demo:** https://itsfarseen.github.io/strobe-reader/

## Features

- **Import & store** EPUBs locally via **IndexedDB** (works on all browsers,
  including mobile/iOS). Books persist across reloads; no server, no account.
- **Distraction-free reader**: full-screen, no chrome. A whole chapter is laid
  out in CSS multi-column form and "page turns" are instant horizontal shifts —
  no animations.
- **Tap zones**: left third = previous page, right third = next page, center =
  toggle the overlay UI (back, table of contents, themes, font size, progress).
  Chapter boundaries are crossed automatically. Arrow / Page keys work on desktop.
- **Themes** apply to the entire UI: background & text color, line height,
  paragraph spacing, and page margin. Ships with **Light / Sepia / Dark** presets
  plus a **custom theme editor** (saved locally).
- **Font size** adjustment that applies only to book text.
- **Reading progress** is saved per book and restored on reopen.
- **Offline**: a service worker precaches the app shell, so the reader and your
  stored books work without a network.

## Run it

It's a static site — serve the project root over HTTP (a service worker requires
`http://localhost` or HTTPS, not `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Or deploy the folder to any static host. This repo is deployed via **GitHub
Pages** at <https://itsfarseen.github.io/strobe-reader/>.

## How it works

| Area | File |
| --- | --- |
| App shell & UI markup | `index.html`, `css/app.css` |
| Bootstrap, view switching, theme editor | `js/main.js` |
| Local storage (IndexedDB) | `js/db.js` |
| EPUB parsing (ZIP → OPF → spine/TOC/resources) | `js/epub.js` |
| Library / bookshelf | `js/library.js` |
| Paging engine, tap zones, navigation | `js/reader.js` |
| Themes & font size (CSS custom properties) | `js/themes.js` |
| HTML sanitization & image resolution | `js/sanitize.js` |
| PWA | `manifest.webmanifest`, `service-worker.js`, `icons/` |

EPUB files are ZIP archives. The reader unzips them with the vendored
[`fflate`](https://github.com/101arrowz/fflate) library
(`vendor/fflate.module.js`) and parses all XML/XHTML with the browser's native
`DOMParser`. The book's own stylesheets are intentionally stripped so a single,
consistent theme applies throughout; images are resolved to in-memory blob URLs.

## Notes & limitations

Initial version does not cover: cross-device sync, highlights/annotations,
in-book search, audio/MathML/fixed-layout EPUBs, or right-to-left / vertical
writing modes.

## License

`vendor/fflate.module.js` is bundled under the MIT license (see
`vendor/fflate.LICENSE`).
