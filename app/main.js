// The one page of the site. What it shows depends on the URL:
//
//   ?src=<link to a GitHub repo or folder>   the readmes there, as a tree
//   ?src=<link to a markdown file>           that file, as slides
//   ?file=<name>                             a local file picked earlier
//   nothing                                  a box to paste a link or pick a file

import {
  fetchMarkdown,
  isFolder,
  isGitHub,
  pageHref,
  parseLink,
  pinToHead,
} from "./github.js";
import { el, showContents } from "./contents.js";

const panelEl = document.getElementById("panel");
const messageEl = document.getElementById("message");
const pickerEl = document.getElementById("picker");
const outlineEl = document.getElementById("outline");
const inputEl = document.getElementById("src-input");
const fileEl = document.getElementById("file-input");

// A local file's text can't go in the URL, so it waits in sessionStorage for
// the `?file=` page to pick up — which also lets a reload show it again.
const LOCAL_KEY = "slides:local";

// The repo listing and the head commit live in localStorage, which no amount of
// reloading clears — so a reload, hard or not, is the way to ask for a fresh
// copy from GitHub. A plain visit uses the cache while it's fresh.
const force = navigationType() === "reload";

const params = new URLSearchParams(location.search);
const src = params.get("src");
const localName = params.get("file");

async function show(src) {
  try {
    const loc = parseLink(src);

    if (isFolder(loc)) {
      document.title = `${loc.owner}/${loc.repo}` +
        (loc.path ? `/${loc.path}` : "") + " — Slides";
      outlineEl.replaceChildren(el("p", { class: "status" }, "Loading…"));
      await showContents(loc, { force });
      return;
    }

    // Reading a deck from the head commit rather than the branch is what makes
    // an edit show up straight away.
    await pinToHead(loc, { force });
    const found = await fetchMarkdown(loc);
    await openDeck(found.loc, found.text);
  } catch (err) {
    showPicker(err.message);
  }
}

// -- slides ------------------------------------------------------------------

const DECK_CSS = [
  "vendor/reveal/dist/reset.css",
  "vendor/reveal/dist/reveal.css",
  "vendor/reveal/dist/theme/white.css",
  "app/google-light.css",
  "app/slides.css",
];

// Reveal and its styles are only loaded once there's a deck to show, so they
// don't restyle the contents and picker.
async function openDeck(loc, text) {
  const [{ showDeck }] = await Promise.all([
    import("./deck.js"),
    ...DECK_CSS.map(loadStylesheet),
  ]);

  panelEl.hidden = true;
  document.querySelector(".reveal").hidden = false;
  document.querySelector(".deck-bar").hidden = false;

  const back = document.getElementById("back");
  if (isGitHub(loc)) {
    back.href = pageHref({ ...loc, path: "" });
    back.textContent = `← ${loc.owner}/${loc.repo}`;
  } else {
    back.href = location.pathname;
  }

  await showDeck(loc, text);
}

function loadStylesheet(href) {
  return new Promise((resolve) => {
    const link = el("link", { rel: "stylesheet", href });
    link.onload = link.onerror = resolve;
    document.head.append(link);
  });
}

// -- choosing a source -------------------------------------------------------

function showPicker(error = "") {
  document.title = "Slides";
  outlineEl.replaceChildren();

  if (error) {
    messageEl.replaceChildren(
      el("h1", {}, "Couldn't open that"),
      el("p", {}, error),
    );
    messageEl.hidden = false;
  }

  inputEl.value = src ?? "";
  pickerEl.hidden = false;
  inputEl.focus();
}

function wirePicker() {
  pickerEl.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      location.assign(pageHref(parseLink(inputEl.value)));
    } catch (err) {
      showPicker(err.message);
    }
  });

  fileEl.addEventListener("change", () => openFile(fileEl.files[0]));

  // Dropping a file anywhere on the picker page opens it.
  document.addEventListener("dragover", (event) => {
    if (pickerEl.hidden) return;
    event.preventDefault();
    pickerEl.classList.add("dragging");
  });
  document.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget) pickerEl.classList.remove("dragging");
  });
  document.addEventListener("drop", (event) => {
    if (pickerEl.hidden) return;
    event.preventDefault();
    pickerEl.classList.remove("dragging");
    openFile(event.dataTransfer.files[0]);
  });
}

async function openFile(file) {
  if (!file) return;
  const text = await file.text();
  try {
    sessionStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({ name: file.name, text }),
    );
  } catch {
    // Too big to keep, or storage is off: show it, but a reload will lose it.
    await openDeck({ file: file.name }, text);
    return;
  }
  location.assign("?file=" + encodeURIComponent(file.name));
}

function readLocal() {
  try {
    return JSON.parse(sessionStorage.getItem(LOCAL_KEY));
  } catch {
    return null;
  }
}

function navigationType() {
  try {
    return performance.getEntriesByType("navigation")[0]?.type;
  } catch {
    return "";
  }
}

// -- start -------------------------------------------------------------------

// Last, so every constant above is initialised before anything runs.
wirePicker();

if (src) {
  show(src);
} else if (localName !== null) {
  const local = readLocal();
  if (local?.name === localName) {
    openDeck({ file: local.name }, local.text).catch((err) =>
      showPicker(err.message)
    );
  } else showPicker(`Choose ${localName || "the file"} again to reopen it.`);
} else {
  showPicker();
}
