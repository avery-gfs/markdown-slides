// Everything that knows where a document comes from: turning a user-supplied
// link into a location, fetching markdown from it, listing a GitHub repo's
// readmes, and rewriting relative links inside a document so images and
// cross-references still resolve once the markdown has been lifted out of its
// home.
//
// A location is one of:
//   { owner, repo, ref, path }  a file or folder in a GitHub repo
//   { url }                     any other markdown on the web (needs CORS)
//   { file }                    a local file, by name; its text is held by the
//                               page, and relative links can't be resolved

const RAW_HOST = "https://raw.githubusercontent.com";
const API_HOST = "https://api.github.com";

// -- locations ---------------------------------------------------------------

export function isGitHub(loc) {
  return !!loc?.owner;
}

// raw.githubusercontent caches a *branch* URL for five minutes and nothing the
// client sends gets past it — not a query string, not `Cache-Control: no-cache`.
// A commit SHA is a different URL for every push, so once we know a branch's
// head commit we read content from that instead and a push is visible
// immediately.
const commitPins = new Map();

function repoKey({ owner, repo, ref }) {
  return `${owner}/${repo}@${ref}`;
}

export function rawUrl(loc) {
  const at = commitPins.get(repoKey(loc)) ?? loc.ref;
  return `${RAW_HOST}/${loc.owner}/${loc.repo}/${at}/${encodePath(loc.path)}`;
}

export function blobUrl({ owner, repo, ref, path }) {
  const kind = path ? "blob" : "tree";
  return `https://github.com/${owner}/${repo}/${kind}/${ref}/${
    encodePath(path)
  }`;
}

export function treeUrl({ owner, repo, ref, path }) {
  const base = `https://github.com/${owner}/${repo}`;
  if (!path && (!ref || ref === "HEAD")) return base;
  return `${base}/tree/${ref}` + (path ? `/${encodePath(path)}` : "");
}

// A GitHub location with no file extension is a folder (or the repo itself),
// which gets a contents listing rather than a deck.
export function isFolder(loc) {
  return isGitHub(loc) && !/\.[a-z0-9]+$/i.test(loc.path);
}

// The string `parseLink` turns back into this location.
export function sourceString(loc) {
  if (!isGitHub(loc)) return loc.url;
  return isFolder(loc) ? treeUrl(loc) : blobUrl(loc);
}

// This page, showing a location: a deck for a document, contents for a folder.
// Query-only, so it works wherever the site is served from.
export function pageHref(loc) {
  return "?src=" + encodeParam(sourceString(loc));
}

// Query values keep their slashes, colons and @s, which are all legal there, so
// a deck's address stays readable.
function encodeParam(value) {
  return encodeURIComponent(value).replace(/%(2F|3A|40)/g, decodeURIComponent);
}

function encodePath(path) {
  return String(path || "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

// -- parsing user input ------------------------------------------------------

// A link to a document: any http(s) URL, with github.com and
// raw.githubusercontent links understood as locations in a repo.
export function parseSource(input) {
  let src = String(input || "").trim();
  if (/^<.*>$/s.test(src)) src = src.slice(1, -1).trim();
  if (!src) throw new Error("No link given.");

  if (/^((www\.)?github\.com|raw\.githubusercontent\.com)\//i.test(src)) {
    src = "https://" + src;
  }
  if (!/^https?:\/\//i.test(src)) {
    throw new Error(
      "Paste a full link starting with https://, or owner/repo for a GitHub repo.",
    );
  }

  let url;
  try {
    url = new URL(src);
  } catch {
    throw new Error(`Not a valid link: ${src}`);
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "github.com" || host === "raw.githubusercontent.com") {
    return parseGitHubUrl(url, host);
  }
  return { url: url.href };
}

// Anything the page accepts: a link (see `parseSource`), or `owner/repo` with
// an optional `@ref` as shorthand for a GitHub repo.
export function parseLink(input) {
  const src = String(input || "").trim().replace(/^<(.*)>$/s, "$1").trim();
  // GitHub user and org names can't contain dots, so `example.com/x` isn't one.
  const short = /^([\w-]+)\/([\w.-]+?)(?:\.git)?(?:@(.+))?$/.exec(src);
  if (short) {
    const [, owner, repo, ref = "HEAD"] = short;
    return { owner, repo, ref, path: "" };
  }
  return parseSource(src);
}

function parseGitHubUrl(url, host) {
  const seg = url.pathname.split("/").filter(Boolean).map(safeDecode);

  if (host === "raw.githubusercontent.com") {
    const [owner, repo, ...rest] = seg;
    if (!owner || !repo) throw new Error(`Not a file link: ${url.href}`);
    return { owner, repo, ...splitRef(rest) };
  }

  const [owner, rawRepo, kind, ...rest] = seg;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo) throw new Error(`Not a repository link: ${url.href}`);
  if (!kind) return { owner, repo, ref: "HEAD", path: "" };
  if (!["blob", "tree", "raw", "blame"].includes(kind)) {
    throw new Error(
      `Link a file or folder in a repo (a /blob/ or /tree/ URL), not /${kind}/.`,
    );
  }
  return { owner, repo, ...splitRef(rest) };
}

// `rest` is everything after owner/repo/blob. The first segment is the ref,
// except for the fully-qualified `refs/heads/<branch>` form GitHub now emits.
// Branch names containing a slash are indistinguishable from paths here, so
// they only work in the `refs/heads/` form.
function splitRef(rest) {
  if (!rest.length) return { ref: "HEAD", path: "" };
  if (
    rest[0] === "refs" && ["heads", "tags"].includes(rest[1]) && rest.length > 2
  ) {
    return {
      ref: rest.slice(0, 3).join("/"),
      path: normalizePath(rest.slice(3).join("/")),
    };
  }
  return { ref: rest[0], path: normalizePath(rest.slice(1).join("/")) };
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function normalizePath(path) {
  const out = [];
  for (const part of String(path || "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export function dirOf(path) {
  const i = String(path || "").lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function resolvePath(baseDir, rel) {
  if (rel.startsWith("/")) return normalizePath(rel);
  return normalizePath(baseDir ? `${baseDir}/${rel}` : rel);
}

// -- fetching ----------------------------------------------------------------

const README_NAMES = ["readme.md", "README.md", "Readme.md", "index.md"];
const MARKDOWN_RE = /\.(md|markdown|mdown|mkd)$/i;

export function isMarkdownPath(path) {
  return MARKDOWN_RE.test(path);
}

// Fetches the markdown a location points at, and returns it along with the
// location it actually came from (so relative links resolve against the file,
// not the folder the user typed).
export async function fetchMarkdown(loc) {
  return isGitHub(loc) ? fetchFromGitHub(loc) : fetchFromUrl(loc);
}

async function fetchFromUrl(loc) {
  let res;
  try {
    res = await fetch(loc.url, { cache: "no-cache" });
  } catch {
    throw new Error(
      `Couldn't fetch ${loc.url}. Either the site is unreachable, or it doesn't ` +
        `allow other sites to read its files (CORS). For files on your own ` +
        `computer, serve them with CORS on, e.g. \`npx http-server --cors\`.`,
    );
  }
  if (!res.ok) throw new Error(`${loc.url} returned ${res.status}.`);
  return { loc: { url: res.url || loc.url }, text: await res.text() };
}

async function fetchFromGitHub(loc) {
  let candidates;
  if (isMarkdownPath(loc.path)) {
    const dir = dirOf(loc.path);
    const base = loc.path.slice(dir ? dir.length + 1 : 0);
    // Casing is the usual reason a readme link 404s; try the other spellings.
    candidates = /^readme\.md$/i.test(base)
      ? README_NAMES.map((n) => (dir ? `${dir}/${n}` : n))
      : [loc.path];
  } else {
    candidates = README_NAMES.map((n) => (loc.path ? `${loc.path}/${n}` : n));
  }

  let status = 0;
  for (const path of candidates) {
    const at = { ...loc, path };
    let res;
    try {
      // raw.githubusercontent sends `max-age=300`, so without this the browser
      // serves a readme from its own disk cache for five minutes after a push
      // without ever asking. `no-cache` revalidates every time — unchanged
      // files still come back as a cheap 304.
      res = await fetch(rawUrl(at), { cache: "no-cache" });
    } catch (err) {
      throw new Error(`Could not reach GitHub (${err.message}).`);
    }
    if (res.ok) return { loc: at, text: await res.text() };
    status = res.status;
    if (status !== 404) break;
  }

  const where = `${loc.owner}/${loc.repo}@${loc.ref}/${loc.path}`;
  if (status === 404) {
    throw new Error(
      isMarkdownPath(loc.path)
        ? `No such file: ${where}`
        : `No readme.md found in ${where}`,
    );
  }
  throw new Error(`GitHub returned ${status} for ${where}`);
}

// -- link rewriting ----------------------------------------------------------

// Strips HTML comments and points every relative URL somewhere that works from
// this site: images at the file itself, markdown at our own viewer, and
// anything else at the file (or, on GitHub, its page there).
export function prepareMarkdown(text, loc) {
  const stripped = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!isGitHub(loc) && !loc.url) return stripped;
  return outsideCode(stripped, (chunk) => rewriteLinks(chunk, loc));
}

// Runs `fn` over the parts of the markdown that aren't fenced blocks or inline
// code spans, so code samples are never touched.
function outsideCode(md, fn) {
  const fences = md.split(
    /(^ {0,3}(?:```|~~~)[\s\S]*?^ {0,3}(?:```|~~~)[^\n]*$)/gm,
  );
  return fences
    .map((part, i) => {
      if (i % 2) return part;
      return part
        .split(/(`+[^`]*`+)/g)
        .map((piece, j) => (j % 2 ? piece : fn(piece)))
        .join("");
    })
    .join("");
}

function rewriteLinks(text, loc) {
  return (
    text
      // ![alt](url "title") and [text](url "title")
      .replace(
        /(!?)\[([^\]]*)\]\(\s*<?([^)<>\s]*)>?(\s+["'][^)]*)?\)/g,
        (m, bang, label, url, title) =>
          `${bang}[${label}](${retarget(url, loc, bang ? "image" : "link")}${
            title || ""
          })`,
      )
      // [id]: url "title"
      .replace(
        /^( {0,3}\[[^\]]+\]:\s*)(\S+)/gm,
        (m, head, url) => head + retarget(url, loc, "link"),
      )
      // <img src="..."> / <source src="...">
      .replace(
        /(<(?:img|source|video|audio)\b[^>]*?\bsrc\s*=\s*)("[^"]*"|'[^']*')/gi,
        (m, head, quoted) =>
          head + requote(quoted, (u) => retarget(u, loc, "image")),
      )
      // <a href="...">
      .replace(
        /(<a\b[^>]*?\bhref\s*=\s*)("[^"]*"|'[^']*')/gi,
        (m, head, quoted) =>
          head + requote(quoted, (u) => retarget(u, loc, "link")),
      )
  );
}

function requote(quoted, fn) {
  const q = quoted[0];
  return q + fn(quoted.slice(1, -1)) + q;
}

function retarget(url, loc, kind) {
  const raw = String(url).trim();
  // Absolute, protocol-relative, in-page anchors and templating are left alone.
  if (!raw || /^([a-z][a-z0-9+.-]*:|\/\/|#|\{)/i.test(raw)) return url;

  const hash = raw.indexOf("#");
  const target = hash < 0 ? raw : raw.slice(0, hash);
  const frag = hash < 0 ? "" : raw.slice(hash);
  if (!target) return url;

  if (!isGitHub(loc)) {
    let abs;
    try {
      abs = new URL(target, loc.url);
    } catch {
      return url;
    }
    if (kind === "link" && isMarkdownPath(abs.pathname)) {
      return pageHref({ url: abs.href }) + frag;
    }
    return abs.href + frag;
  }

  const at = { ...loc, path: resolvePath(dirOf(loc.path), target) };

  if (kind === "image") return rawUrl(at) + frag;
  // A markdown file, or a path with no extension (a folder), is something this
  // page can show itself.
  if (isMarkdownPath(at.path) || isFolder(at)) return pageHref(at) + frag;
  return blobUrl(at) + frag;
}

// -- listing a repo ----------------------------------------------------------

const CACHE_TTL_MS = 10 * 60 * 1000;

// The recursive tree API is one request for the whole repo, but unauthenticated
// callers get 60 requests an hour per IP — and a classroom shares one. So the
// result is cached, and a stale cache is preferred over an error.
export async function fetchTree(repo, { force = false } = {}) {
  const key = `slides:tree:${repoKey(repo)}`;
  const stored = readCache(key);
  const cached = Array.isArray(stored?.paths) ? stored : null;
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    pin(repo, cached.sha);
    return { ...cached, stale: false };
  }

  try {
    const url = `${API_HOST}/repos/${repo.owner}/${repo.repo}` +
      `/git/trees/${encodeURIComponent(repo.ref)}?recursive=1`;
    const res = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw await apiError(res, repo);

    const data = await res.json();
    const entry = {
      at: Date.now(),
      sha: data.sha,
      paths: data.tree.filter((e) => e.type === "blob").map((e) => e.path),
      truncated: !!data.truncated,
    };
    writeCache(key, entry);
    pin(repo, entry.sha);
    return { ...entry, stale: false };
  } catch (err) {
    if (cached) return { ...cached, stale: true, error: err };
    throw err;
  }
}

// Resolves a repo's head commit so a deck is read from an immutable URL. A
// cached listing already knows it; otherwise one small API call does. Failure
// is not worth reporting: without a pin the branch URL still works, it is just
// up to five minutes behind.
export async function pinToHead(loc, { force = false } = {}) {
  if (!isGitHub(loc)) return;
  const tree = readCache(`slides:tree:${repoKey(loc)}`);
  const key = `slides:sha:${repoKey(loc)}`;
  const cached = readCache(key);
  const fresh = [tree, cached]
    .filter((c) => c && Date.now() - c.at < CACHE_TTL_MS)
    .sort((a, b) => b.at - a.at)[0];
  if (!force && fresh) {
    pin(loc, fresh.sha);
    return;
  }

  try {
    const res = await fetch(
      `${API_HOST}/repos/${loc.owner}/${loc.repo}/commits/${
        encodeURIComponent(loc.ref)
      }`,
      { headers: { Accept: "application/vnd.github.sha" } },
    );
    if (!res.ok) return;
    const sha = (await res.text()).trim();
    writeCache(key, { at: Date.now(), sha });
    pin(loc, sha);
  } catch {
    // Offline, or the API's hourly limit is used up.
  }
}

function pin(repo, sha) {
  if (sha) commitPins.set(repoKey(repo), sha);
}

async function apiError(res, repo) {
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
      const at = reset ? new Date(reset).toLocaleTimeString() : "shortly";
      return new Error(
        `GitHub's hourly request limit for this network is used up (resets around ${at}). ` +
          `Slides themselves still open — it's only this list that needs the API.`,
      );
    }
  }
  if (res.status === 404 || res.status === 422) {
    return new Error(
      repo.ref === "HEAD"
        ? `No public repo ${repo.owner}/${repo.repo}.`
        : `No branch "${repo.ref}" in ${repo.owner}/${repo.repo}.`,
    );
  }
  return new Error(`GitHub returned ${res.status} listing the repository.`);
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key, entry) {
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Private browsing, full quota — it just won't be cached.
  }
}

// -- deck listing ----------------------------------------------------------

// The markdown that gets a deck: every readme in the repo, plus any other
// top-level `.md` file. Sorted by path, with the repo-root files first.
export function deckPaths(paths) {
  return paths
    .filter((p) => /(^|\/)readme\.md$/i.test(p) || !p.includes("/"))
    .filter((p) => /\.md$/i.test(p))
    .sort((a, b) => {
      const rootA = !a.includes("/");
      const rootB = !b.includes("/");
      if (rootA !== rootB) return rootA ? -1 : 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
}

// -- slides ------------------------------------------------------------------

// Cuts a document into one string per slide. A `##` heading starts a new slide,
// and so does a `---` rule — which carries the heading it sits under along with
// it, so a run of them steps through one section a screenful at a time, each
// step replacing the last. Within one of those, the first `<<<` changes nothing,
// but each later one starts a slide that keeps what came before the first —
// already revealed — and drops what came since, so a shared setup stays on
// screen while the parts under it take turns. Markers inside a fenced code block
// are left alone.
export function splitSlides(markdown) {
  return splitSlideRecords(markdown).map(({ text }) => text);
}

// The slide positions at which a fresh `##` section begins. Unlike comparing
// rendered headings, this preserves a boundary between two sections that happen
// to use the same heading text.
export function labelledSlideIndexes(markdown) {
  return splitSlideRecords(markdown)
    .map(({ labelled }, index) => (labelled ? index : -1))
    .filter((index) => index !== -1);
}

function splitSlideRecords(markdown) {
  const slides = [];
  let heading = ""; // the `##` line the slides in this section repeat
  let lines = [];
  let fence = "";
  let labelled = false;
  // What sits above this slide's first `<<<`, with its `...` breaks taken out,
  // or null before there is one.
  let kept = null;
  let afterMarker = false; // so the marker's own blank lines don't pile up
  // Whether the next line starts a block. A `---` that doesn't is a setext
  // heading underline, which is what markdown makes of it too.
  let open = true;

  const flush = () => {
    const body = lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
    const text = heading && body ? `${heading}\n\n${body}` : heading || body;
    if (text) slides.push({ text, labelled });
    lines = [];
    labelled = false;
  };

  // A `##` or `---` starts over, so a `<<<` after it is a first one again.
  const startSlide = () => {
    flush();
    kept = null;
  };

  for (const line of String(markdown || "").split("\n")) {
    const token = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];

    if (fence) {
      if (token && token[0] === fence[0] && token.length >= fence.length) {
        fence = "";
      }
    } else if (token) {
      fence = token;
    } else if (/^##/.test(line)) {
      startSlide();
      heading = line;
      labelled = true;
      open = true;
      continue;
    } else if (open && /^ {0,3}-{3,}\s*$/.test(line)) {
      startSlide();
      continue;
    } else if (/^ {0,3}<{3}\s*$/.test(line)) {
      if (kept === null) {
        kept = withoutFragmentBreaks(lines);
      } else {
        flush();
        lines = [...kept];
      }
      // Keep the blocks either side of the marker apart, with one blank line.
      if (lines.length && lines.at(-1).trim()) lines.push("");
      afterMarker = true;
      open = true;
      continue;
    }

    if (afterMarker && !line.trim() && !lines.at(-1)?.trim()) continue;
    afterMarker = false;
    lines.push(line);
    open = !fence && !line.trim();
  }

  flush();
  return slides;
}

// The lines of a slide with its `...` fragment breaks taken out, so that
// repeating them shows everything they held at once. Mirrors the test in
// view.js's `isFragmentBreak`, and leaves fenced code alone.
function withoutFragmentBreaks(lines) {
  const out = [];
  let fence = "";
  let dropped = false;
  for (const line of lines) {
    const token = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (token && token[0] === fence[0] && token.length >= fence.length) {
        fence = "";
      }
    } else if (token) {
      fence = token;
    } else if (/^\s*(\.\.\.|…)\s*$/.test(line)) {
      dropped = true;
      continue;
    } else if (dropped && !line.trim() && !out.at(-1)?.trim()) {
      continue;
    }
    dropped = false;
    out.push(line);
  }
  return out;
}

// The document's `# Title` is the name of the whole deck, so it becomes a
// running header rather than a title slide of its own. Only the line itself is
// taken — badges or a language switcher above it, and any real introduction
// below it, stay behind as the first slide.
export function splitTitle(markdown) {
  const heading = /^ {0,3}#\s+(.+?)\s*#*\s*$/m.exec(markdown);
  const firstSlide = markdown.search(/^ {0,3}##\s/m);
  if (!heading || (firstSlide !== -1 && heading.index > firstSlide)) {
    return { title: "", body: markdown };
  }

  const title = heading[1].trim();
  const before = markdown.slice(0, heading.index).replace(/\n+$/, "");
  const after = markdown.slice(heading.index + heading[0].length).replace(
    /^\n+/,
    "",
  );
  let body = before ? `${before}\n\n${after}` : after;

  // Nothing but the title before the first `##` means there is no first slide.
  const preamble = body.split(/\n(?=##)/, 1)[0];
  if (!preamble.trim()) body = body.slice(preamble.length).replace(/^\n+/, "");

  // A document that is nothing but its title still needs one slide.
  return body.trim() ? { title, body } : { title: "", body: markdown };
}
