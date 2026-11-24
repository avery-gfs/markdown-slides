import { deckPaths, dirOf, fetchTree, pageHref, treeUrl } from "./github.js";

const outlineEl = document.getElementById("outline");
const freshnessEl = document.getElementById("freshness");

// Lists the readmes in a GitHub folder (or a whole repo) as a directory tree.
// Throws if the repo can't be listed at all.
export async function showContents(loc, { force = false } = {}) {
  const repo = { owner: loc.owner, repo: loc.repo, ref: loc.ref };
  const tree = await fetchTree(repo, { force });

  const under = loc.path ? `${loc.path}/` : "";
  const units = deckPaths(tree.paths)
    .filter((path) => path.startsWith(under))
    .map((path) => ({
      dir: dirOf(path).slice(under.length),
      loc: { ...repo, path },
      name: path.slice(under.length),
    }));

  outlineEl.replaceChildren(
    breadcrumbs(loc),
    units.length
      ? renderTree(buildTree(units))
      : el("p", { class: "status" }, "No readmes found here."),
  );

  // Only a stale list is worth saying anything about: it is out of date and
  // there is a reason why.
  freshnessEl.textContent = tree.stale
    ? `Showing a cached list — ${
      tree.error?.message ?? "GitHub is unreachable."
    }`
    : "";
}

// owner/repo / folder / folder, each part linking to its own contents, and the
// repo name to its page on GitHub.
function breadcrumbs(loc) {
  const repo = { owner: loc.owner, repo: loc.repo, ref: loc.ref };
  const ref = loc.ref && loc.ref !== "HEAD" ? `@${loc.ref}` : "";
  const parts = loc.path ? loc.path.split("/") : [];

  const crumbs = [
    el(
      "a",
      { href: parts.length ? pageHref({ ...repo, path: "" }) : treeUrl(repo) },
      `${loc.owner}/${loc.repo}${ref}`,
    ),
  ];
  parts.forEach((part, i) => {
    const path = parts.slice(0, i + 1).join("/");
    crumbs.push(
      " / ",
      i === parts.length - 1
        ? part
        : el("a", { href: pageHref({ ...repo, path }) }, part),
    );
  });
  return el("h1", { class: "crumbs" }, crumbs);
}

// Folds the flat, sorted deck list into a directory tree. A folder with a
// readme links to its deck; one without is just a label for what's inside.
// Files at the top hang off the root under their own names.
function buildTree(units) {
  const root = { children: new Map() };
  for (const { dir, loc, name } of units) {
    if (!dir) {
      root.children.set(name, {
        label: name,
        href: pageHref(loc),
        children: new Map(),
      });
      continue;
    }
    let node = root;
    for (const part of dir.split("/")) {
      if (!node.children.has(part)) {
        node.children.set(part, { label: part, children: new Map() });
      }
      node = node.children.get(part);
    }
    node.href = pageHref(loc);
  }
  return root;
}

function renderTree(node) {
  return el(
    "ul",
    { class: "decks" },
    [...node.children.values()].map((child) =>
      el("li", {}, [
        child.href
          ? el("a", { href: child.href }, child.label)
          : el("span", { class: "folder" }, `${child.label}/`),
        child.children.size ? renderTree(child) : null,
      ])
    ),
  );
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child != null) node.append(child);
  }
  return node;
}
