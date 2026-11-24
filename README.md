# Slides

Renders markdown as reveal.js decks, entirely in the browser: documents and
images are fetched straight from where they live, with no server or build step.

Published at <https://avery-gfs.github.io/slides/>.

## Usage

Everything is one page, driven by `?src=`:

- **A GitHub repo or folder** lists every `readme.md` under it (plus top-level
  `.md` files) as a directory tree. `owner/repo` or `owner/repo@ref` works as
  shorthand.
- **A markdown file** renders as slides. GitHub links are read from the repo;
  any other URL is fetched as is, which needs the site to allow CORS.
- **Nothing** shows a box to paste either kind of link, plus a file picker (or
  drop a file on the page).

```
?src=avery-gfs/classes-26@public
?src=https://github.com/owner/repo/tree/main/docs
?src=https://github.com/owner/repo/blob/main/README.md
?src=https://example.com/talk.md
```

A picked file opens at `?file=name`, held in `sessionStorage`: it survives a
reload but not a new tab, and its relative links (e.g. images) can't resolve.
For local files with images, use a local server with CORS on instead, e.g.
`npx http-server --cors` in their folder, then
`?src=http://localhost:8080/talk.md`. Relative images resolve against that
server too. `view.html`, where decks used to live, redirects here.

HTML comments are stripped. Relative links are rewritten against the document's
location: images to the file itself (`raw.githubusercontent.com` on GitHub),
markdown and folders to this page, everything else to the file (or its GitHub
page). Only fences that name a language are highlighted; bare ``` blocks are
treated as program output and shown verbatim.

## Syntax

The `# heading` becomes a small running header on every slide; anything else
before the first `##` is the first slide. Each `##` starts a new slide, and
these markers (on their own line, blank lines around, ignored inside code
fences) control steps within it:

| Marker | Effect                                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------- |
| `---`  | New slide with the same heading, **replacing** what was shown.                                                       |
| `...`  | **Adds** the next block below as a fragment.                                                                         |
| `<<<`  | First one does nothing; each later one **erases back to the previous `<<<`**, keeping the setup above the first.     |
| `///`  | Splits the slide into **two columns**. Only the first per slide counts; it repeats with the `<<<` setup if above it. |

```
## Evaluating

f(2)

---

f(2) = 2 * 2 + 1

...

which is 5
```

Two slides headed "Evaluating", the second revealed in two presses.

```
## Lookups

games = [...]

<<<

games[0]

...

{"away_team": ...}

<<<

games[0]["away_team"]
```

Two slides, both topped by `games = [...]`: the first steps through `games[0]`
and its answer, the second replaces them with `games[0]["away_team"]`.

A `...` in a left column holds back the rest of it and the whole right column;
in the right column, just what follows it. `<<<` never reaches back past a `---`
or `##`. Tall slides scroll.

## Controls

Transitions are instant. Reveal's keys work (space, `o` overview, `s` notes, `f`
fullscreen, `?` help); `ctrl`+`←`/`→` jump between `##` sections; `alt`+`←`/`→`
are left to browser history. Append `&print-pdf` for a printable layout.

## Caching

Edits show up on the next load:

- Readmes are fetched with `cache: "no-cache"`, overriding
  `raw.githubusercontent.com`'s `max-age=300`.
- GitHub's CDN serves branch URLs up to five minutes stale, so GitHub content is
  read from the head commit's SHA instead, cached for ten minutes per repo.
  Reloading re-resolves it.

GitHub's API allows 60 requests/hour per IP (shared across a school), so repo
listings are cached in `localStorage` for ten minutes and shown stale if the
limit is hit. Reloading always refetches. Decks fall back to the branch URL if
the head commit can't be resolved.

The site itself is served with `max-age=600`; hard-reload (ctrl+shift+R) to pick
up viewer changes immediately.

## Layout

```
index.html            the page: picker, contents and deck
view.html             redirect from the old deck URL
app/main.js           routing, the link picker, local files
app/contents.js       repo/folder listing
app/deck.js           slides (loaded with reveal only when needed)
app/github.js         link parsing, fetching, link rewriting, listing
app/site.css          picker and contents styling
app/slides.css        deck styling
app/google-light.css  highlight.js theme
vendor/reveal/        vendored reveal.js subset
scripts/              vendoring and tests
```

## Development

Run from the repo root:

```sh
npm run serve    # http://localhost:6700 (Cache-Control: no-store)
npm test
npm run fmt
```

`file://` won't load ES modules, and `python -m http.server` lets the browser
cache `app/*.js`, so use `npm run serve`.

To update reveal.js, bump it in `package.json`, then
`npm install && npm run vendor`. `vendor/` is committed; only MathJax loads from
a CDN, and only on decks with math.
