// Checks the pure parts of app/github.js — source parsing, link rewriting and
// the deck listing — without a browser: node scripts/test-github.js
import assert from "node:assert/strict";
import {
  deckPaths,
  isFolder,
  labelledSlideIndexes,
  pageHref,
  parseLink,
  parseSource,
  prepareMarkdown,
  splitSlides,
  splitTitle,
} from "../app/github.js";

const CLASS = { owner: "avery-gfs", repo: "classes-26", ref: "solutions" };
const BLOB = "https://github.com/avery-gfs/classes-26/blob/solutions";
let ran = 0;

function test(name, fn) {
  ran++;
  try {
    fn();
  } catch (err) {
    console.error(`FAIL  ${name}\n${err.message}\n`);
    process.exitCode = 1;
  }
}

// -- parseSource -------------------------------------------------------------

test("a bare path is not a link", () => {
  assert.throws(() => parseSource("cs-1/00-introduction"), /full link/);
});

test("other http links are fetched as they are", () => {
  assert.deepEqual(parseSource("https://example.com/notes/talk.md"), {
    url: "https://example.com/notes/talk.md",
  });
});

test("owner/repo shorthand, and links that are folders", () => {
  assert.deepEqual(parseLink("avery-gfs/classes-26"), {
    owner: "avery-gfs",
    repo: "classes-26",
    ref: "HEAD",
    path: "",
  });
  assert.deepEqual(parseLink("o/r@my/branch"), {
    owner: "o",
    repo: "r",
    ref: "my/branch",
    path: "",
  });
  assert.deepEqual(parseLink("https://github.com/o/r/tree/main/docs"), {
    owner: "o",
    repo: "r",
    ref: "main",
    path: "docs",
  });
  assert.throws(() => parseLink("example.com/a.md"), /full link/);
});

test("folders get contents, files get decks", () => {
  assert.equal(isFolder(parseLink("o/r")), true);
  assert.equal(
    isFolder(parseLink("https://github.com/o/r/tree/main/docs")),
    true,
  );
  assert.equal(
    isFolder(parseLink("https://github.com/o/r/blob/main/a.md")),
    false,
  );
  assert.equal(isFolder(parseLink("https://example.com/notes")), false);
});

test("generated links stay readable", () => {
  assert.equal(
    pageHref({ ...CLASS, path: "cs-1/readme.md" }),
    `?src=${BLOB}/cs-1/readme.md`,
  );
  assert.equal(
    pageHref({ ...CLASS, path: "cs-1" }),
    "?src=https://github.com/avery-gfs/classes-26/tree/solutions/cs-1",
  );
  assert.equal(
    pageHref({ owner: "o", repo: "r", ref: "HEAD", path: "" }),
    "?src=https://github.com/o/r",
  );
});

test("blob and tree urls", () => {
  assert.deepEqual(
    parseSource("https://github.com/owner/repo/blob/main/docs/README.md"),
    { owner: "owner", repo: "repo", ref: "main", path: "docs/README.md" },
  );
  assert.deepEqual(parseSource("https://github.com/owner/repo/tree/v2/docs"), {
    owner: "owner",
    repo: "repo",
    ref: "v2",
    path: "docs",
  });
});

test("a bare repo url uses HEAD", () => {
  assert.deepEqual(parseSource("github.com/owner/repo"), {
    owner: "owner",
    repo: "repo",
    ref: "HEAD",
    path: "",
  });
});

test("raw urls, including the refs/heads form", () => {
  assert.deepEqual(
    parseSource(
      "https://raw.githubusercontent.com/o/r/refs/heads/my/branch/a/readme.md",
    ),
    { owner: "o", repo: "r", ref: "refs/heads/my", path: "branch/a/readme.md" },
  );
  assert.deepEqual(
    parseSource("https://raw.githubusercontent.com/o/r/main/a/readme.md"),
    { owner: "o", repo: "r", ref: "main", path: "a/readme.md" },
  );
});

test("percent-encoded segments are decoded", () => {
  assert.equal(
    parseSource("https://github.com/o/r/blob/main/my%20notes/readme.md").path,
    "my notes/readme.md",
  );
});

test("unusable input is rejected", () => {
  assert.throws(() => parseSource(""), /No link/);
  assert.throws(() => parseSource("ftp://example.com/a.md"), /full link/);
  assert.throws(() => parseSource("https://github.com/o/r/issues/3"), /blob/);
});

// -- prepareMarkdown ---------------------------------------------------------

const at = { ...CLASS, path: "cs-1/00-introduction/readme.md" };
const raw = "https://raw.githubusercontent.com/avery-gfs/classes-26/solutions";

test("relative images become raw urls", () => {
  assert.equal(
    prepareMarkdown("![](assets/x.png)", at),
    `![](${raw}/cs-1/00-introduction/assets/x.png)`,
  );
  assert.equal(
    prepareMarkdown('<img src="assets/x.png" width="200">', at),
    `<img src="${raw}/cs-1/00-introduction/assets/x.png" width="200">`,
  );
});

test("../ walks up from the file's folder", () => {
  assert.equal(
    prepareMarkdown("![](../../assets/maze.png)", at),
    `![](${raw}/assets/maze.png)`,
  );
});

test("absolute urls and anchors are untouched", () => {
  const md = "![](https://example.com/a.png) [x](#section) [y](mailto:a@b.c)";
  assert.equal(prepareMarkdown(md, at), md);
});

test("links to markdown and folders open in the viewer", () => {
  const root = { ...CLASS, path: "readme.md" };
  assert.equal(
    prepareMarkdown("[CS 1](cs-1)", root),
    "[CS 1](?src=https://github.com/avery-gfs/classes-26/tree/solutions/cs-1)",
  );
  assert.equal(
    prepareMarkdown("[next](../01-variables/readme.md)", at),
    `[next](?src=${BLOB}/cs-1/01-variables/readme.md)`,
  );
});

test("links to other files open on github", () => {
  assert.equal(
    prepareMarkdown("[code](solution.py)", at),
    "[code](https://github.com/avery-gfs/classes-26/blob/solutions/cs-1/00-introduction/solution.py)",
  );
});

test("outside the class repo, links stay in that repo", () => {
  const other = { owner: "o", repo: "r", ref: "main", path: "docs/readme.md" };
  assert.equal(
    prepareMarkdown("![](img/a.png)", other),
    "![](https://raw.githubusercontent.com/o/r/main/docs/img/a.png)",
  );
  assert.equal(
    prepareMarkdown("[more](more.md)", other),
    "[more](?src=https://github.com/o/r/blob/main/docs/more.md)",
  );
});

test("links in a web document resolve against its url", () => {
  const web = { url: "https://example.com/notes/talk.md" };
  assert.equal(
    prepareMarkdown("![](img/a.png) [next](../more.md) [pdf](a.pdf#p2)", web),
    "![](https://example.com/notes/img/a.png) " +
      "[next](?src=https://example.com/more.md) " +
      "[pdf](https://example.com/notes/a.pdf#p2)",
  );
});

test("a local file's relative links are left alone", () => {
  assert.equal(
    prepareMarkdown("![](a.png)", { file: "talk.md" }),
    "![](a.png)",
  );
});

test("code is never rewritten", () => {
  const fenced = ["```py", 'print("![](a.png)")', "```", "", "![](a.png)"].join(
    "\n",
  );
  const out = prepareMarkdown(fenced, at);
  assert.match(out, /print\("!\[\]\(a\.png\)"\)/);
  assert.match(out, /!\[\]\(https:\/\/raw\./);
  assert.equal(
    prepareMarkdown("`[x](y.md)` and [x](y.md)", at).split("`")[1],
    "[x](y.md)",
  );
});

test("html comments are stripped", () => {
  assert.equal(prepareMarkdown("<!-- notes\nhere -->\n# Title", at), "# Title");
});

// -- splitSlides -------------------------------------------------------------

test("every `##` starts a slide", () => {
  assert.deepEqual(splitSlides("intro\n\n## One\n\na\n\n## Two\n\nb"), [
    "intro",
    "## One\n\na",
    "## Two\n\nb",
  ]);
});

test("`---` starts a slide that repeats the heading", () => {
  assert.deepEqual(
    splitSlides("## One\n\na\n\n---\n\nb\n\n---\n\nc\n\n## Two\n\nd"),
    [
      "## One\n\na",
      "## One\n\nb",
      "## One\n\nc",
      "## Two\n\nd",
    ],
  );
});

test("section indexes skip repeated slides and retain repeated heading labels", () => {
  assert.deepEqual(
    labelledSlideIndexes(
      "intro\n\n## One\n\na\n\n---\n\nb\n\n## One\n\nc\n\n...\n\nd",
    ),
    [1, 3],
  );
});

test("the first `<<<` is a no-op; later ones erase back to it", () => {
  assert.deepEqual(
    splitSlides(
      "## One\n\nsetup\n\n<<<\n\na\n\n...\n\nA\n\n<<<\n\nb\n\n<<<\n\nc",
    ),
    [
      "## One\n\nsetup\n\na\n\n...\n\nA",
      "## One\n\nsetup\n\nb",
      "## One\n\nsetup\n\nc",
    ],
  );
});

test("`<<<` keeps earlier fragments revealed when it repeats them", () => {
  assert.deepEqual(
    splitSlides("## One\n\nq\n\n...\n\nr\n\n<<<\n\na\n\n<<<\n\nb"),
    [
      "## One\n\nq\n\n...\n\nr\n\na",
      "## One\n\nq\n\nr\n\nb",
    ],
  );
});

test("`<<<` doesn't reach back across `---` or `##`", () => {
  assert.deepEqual(
    splitSlides(
      "## One\n\nx\n\n<<<\n\na\n\n---\n\ny\n\n<<<\n\nb\n\n<<<\n\nc\n\n## Two\n\nz\n\n<<<\n\nd",
    ),
    [
      "## One\n\nx\n\na",
      "## One\n\ny\n\nb",
      "## One\n\ny\n\nc",
      "## Two\n\nz\n\nd",
    ],
  );
});

test("`<<<` inside a code fence is left alone", () => {
  const md = "## One\n\n```\n<<<\n```\n\n<<<\n\n```\n<<<\n```";
  assert.deepEqual(splitSlides(md), [
    "## One\n\n```\n<<<\n```\n\n```\n<<<\n```",
  ]);
});

test("`---` before any heading just splits", () => {
  assert.deepEqual(splitSlides("a\n\n---\n\nb"), ["a", "b"]);
});

test("markers inside a code fence are left alone", () => {
  const md = "## One\n\n```\n---\n## not a heading\n```\n\ntail";
  assert.deepEqual(splitSlides(md), [md]);
});

test("a `---` with no blank line above it underlines the text, as in markdown", () => {
  const md = "## One\n\na\n---\n\nb";
  assert.deepEqual(splitSlides(md), [md]);
});

// -- splitTitle --------------------------------------------------------------

test("a lone title heading is lifted out, leaving no title slide", () => {
  assert.deepEqual(splitTitle("# Hello There\n\n## One\n\nbody"), {
    title: "Hello There",
    body: "## One\n\nbody",
  });
});

test("an introduction under the title stays as the first slide", () => {
  assert.deepEqual(splitTitle("# T\n\nIntro text.\n\n## One"), {
    title: "T",
    body: "Intro text.\n\n## One",
  });
});

test("badges above the title are kept, the title is still found", () => {
  assert.deepEqual(splitTitle("![badge](b.svg)\n\n# T\n\n## One"), {
    title: "T",
    body: "![badge](b.svg)\n\n## One",
  });
});

test("documents with no usable title are left alone", () => {
  const noHeading = "## One\n\nbody";
  assert.deepEqual(splitTitle(noHeading), { title: "", body: noHeading });

  // An `#` that only turns up after the first slide is a heading, not a title.
  const late = "## One\n\n# Later";
  assert.deepEqual(splitTitle(late), { title: "", body: late });

  // Nothing but a title still has to render as something.
  assert.deepEqual(splitTitle("# Only"), { title: "", body: "# Only" });
});

// -- deckPaths -------------------------------------------------------------

test("readmes plus top-level markdown, sorted naturally", () => {
  assert.deepEqual(
    deckPaths([
      "readme.md",
      "cs-1/00-introduction/readme.md",
      "cs-1/00-introduction/assets/x.png",
      "cs-1/01-variables-and-io/README.md",
      "cs-1/10-recursion/readme.md",
      "cs-1/2-loops/readme.md",
      "cs-1/notes.md",
      "sequence.md",
    ]),
    [
      "readme.md",
      "sequence.md",
      "cs-1/00-introduction/readme.md",
      "cs-1/01-variables-and-io/README.md",
      "cs-1/2-loops/readme.md",
      "cs-1/10-recursion/readme.md",
    ],
  );
});

if (!process.exitCode) console.log(`${ran} checks passed`);
