# Plan: HTML and EPUB Import

Two new entries in the `File > Import` file-type list, sharing one converter:

1. **HTML** — a single `.html`/`.htm`/`.xhtml` file becomes one or more chapters.
2. **EPUB** — a `.epub` becomes one chapter per table-of-contents entry.

An EPUB *is* a zip of HTML documents plus a manifest, so the second feature is
the first one plus the OPF/nav plumbing. Build the HTML converter first; the
EPUB importer is then a reader that hands it one document at a time.

Everything in this document was checked against three real Project Gutenberg
books held in `test/fixtures/books/` (Frankenstein, Moby-Dick, Wuthering
Heights) in both formats — numbers quoted below are measured, not estimated.

## The target format

`render.js:65` is the whole of what a chapter can hold:

```js
formats: ['bold', 'italic', 'strike', 'underline', 'blockquote', 'header',
          'align', 'list', 'indent', 'footnote', 'footnoteBody', 'footnoteBodyCont']
```

So the import mapping is:

| HTML | Delta |
|---|---|
| `<i> <em> <cite> <var> <dfn>`, `font-style: italic\|oblique` | `italic` |
| `<b> <strong>`, `font-weight: bold\|bolder\|600-900` | `bold` |
| `<u> <ins>`, `text-decoration: underline` | `underline` |
| `<s> <strike> <del>`, `text-decoration: line-through` | `strike` |
| `<h1>`–`<h6>` | `header: 1..4` (h5/h6 clamp to 4) |
| `<blockquote>` | `blockquote` |
| `<li>` in `<ul>`/`<ol>` | `list: bullet\|ordered`, `indent: 1..3` by nesting depth |
| `text-align: center\|right\|justify` | `align` |
| `<br>` | paragraph break |
| `<hr>` | a centered `* * *` line |
| `<a href>` | its text only — link is dropped |
| `<img> <svg> <video> <audio> <iframe> <object> <canvas> <script> <form>` | dropped entirely |
| `<table>` | markdown pipe rows (see below) |
| `<pre>`, `white-space: pre*` | text kept verbatim, no whitespace collapsing |

There is no `link`, `image`, `code-block`, `color`, `background`, `font` or
`size` format, so everything in that column above the table row either maps or
disappears. That is the whole "strip everything unsupported" job.

## Why not `dangerouslyPasteHTML`

Quill's clipboard would do a chunk of this, but it gets the exact case that
motivates the feature wrong. `matchStyles`
([clipboard.js:309-317](../node_modules/quill/modules/clipboard.js#L309)):

```js
let style = node.style || {};
if (style.fontStyle && computeStyle(node).fontStyle === 'italic') {
  formats.italic = true;
}
```

The guard is `node.style.fontStyle` — the **inline `style` attribute**. A
document that marks italics with a class (`<span class="c3">` plus
`.c3 { font-style: italic }`) has an empty `node.style`, so the `computeStyle`
check is never reached and the italics are silently lost. That is precisely how
Google Docs' "Download as HTML" writes every run, and how Gutenberg writes its
`.right`/`.poem`/`.letter2` blocks. So the one library feature that looks like
it solves the styles-vs-tags problem is the one that doesn't.

Three more reasons, any one of which would be enough on its own:

- `matchSpacing` reads `offsetHeight`/`offsetTop`, which need real layout. The
  importer runs against a parsed document, not a rendered one.
- `clipboard.convert()` needs a live Quill attached to the DOM. Every other
  importer here (`docx-import.js`, `markdownFic.js`) is a pure function over a
  string, which is why they are testable under jsdom without an app.
- It gives no control over the two decisions that actually matter for a book:
  where chapters break, and what happens to tables.

`getComputedStyle` on a hidden iframe was the other candidate and is rejected
for a related reason: **jsdom's cascade is partial**. Measured — `font-style`
inherits correctly through it, but `text-align` set on a `<div>` does *not*
reach a child `<p>`. An importer built on it would behave one way in the app
and another way under the test suite, which is the worst of both.

## The converter

`src/components/controllers/html-import.js` — one exported function,
`convertHtmlToDelta(htmlString, options)`, pure string/DOM work with `DOMParser`
as its only global. The same shape `docx-import.js` already has, and testable
the same way (`test/docx-import.test.js:11` already installs jsdom's `DOMParser`
as a global for exactly this).

Three parts:

**1. A rule table from the document's own `<style>` blocks.** Parse each
`<style>` into `{ selector, declarations }` pairs, keeping only the seven
properties that can affect the output (`font-style`, `font-weight`,
`text-decoration`, `text-decoration-line`, `text-align`, `white-space`,
`display`). Resolve per element with `el.matches(selector)` in source order,
then overlay the element's own `style` attribute. This is ~40 lines, it is
deterministic, it needs no layout, and it is what makes class-driven italics
work where Quill's clipboard fails.

Specificity is deliberately not implemented — source order only. A stylesheet
that overrides a later rule with a higher-specificity earlier one will lose,
which in this property set means an occasional wrong italic. That is a fair
trade against pulling in a CSS engine.

**2. A single post-order walk** carrying three pieces of inherited state: the
active inline attributes, the inherited alignment, and whether we are inside
`white-space: pre`. Text nodes collapse runs of whitespace to one space unless
`pre` is set; block elements flush the pending inline ops and emit the `\n` that
carries the block attributes.

**3. Two whitespace rules that are easy to miss and very visible when wrong.**
Gutenberg writes paragraphs as:

```html
<p>
So strange an accident has happened to us that I cannot forbear recording it,
although it is very probable that you will see me before these papers can come
</p>
```

Newlines inside a paragraph are formatting, not content — they collapse to
spaces. And the leading/trailing whitespace at a block edge is dropped, or every
imported paragraph arrives with a stray space at each end. Both are HTML's own
rules; both were caught by running the prototype rather than by reading.

### The body-alignment trap

Gutenberg's stylesheet opens with `body { text-align: justify }`. Taken
literally, that lands an `align: justify` on all 766 paragraphs of
Frankenstein — a document where nothing was deliberately aligned at all.

So: read the alignment computed for `<body>` first and treat it as the
baseline; only emit `align` where a block *differs* from it. Measured on
Wuthering Heights this takes the `align` count from 2039 to 54, and those 54 are
the genuinely centered and right-aligned lines.

### The anchor-underline trap

Gutenberg's stylesheet also carries `a { text-decoration: underline }`. Without
a guard, every link in the book imports as underlined text — the counts came out
exactly equal (33 links / 33 underlines in Frankenstein, 143/143 in Moby-Dick).
An `<a>` element's own decoration is browser chrome, not authorial emphasis, so
`<a>` never contributes `underline` or `strike`. A `<u>` *inside* an anchor
still does.

### Tables

Your instinct is right, and for a reason the samples make clear: tables in
fiction are almost always **layout** tables, not data tables. Moby-Dick's is the
Etymology list (3 columns, first one empty); Frankenstein's is the two-column
table of contents. Neither has a header row.

So: convert each `<tr>` to one paragraph of `| cell | cell | cell |`, with
inline formatting inside cells preserved and `|` escaped in cell text. No header
separator row is emitted, because inferring which row is a header from a layout
table gets it wrong more often than not — and a writer who wants one can add it.
Cells that themselves contain block content get their blocks joined with a space.

One refinement worth having: a **single-column** table emits its cells as plain
paragraphs with no pipes at all. That is the Frankenstein TOC case, where
`| Letter 1 |` is pure noise.

### Chapter splitting

`import_display.js` gets an "HTML Options" fieldset alongside the existing
plaintext and docx ones:

- **Split into chapters at headings (level N)** — a level selector rather than
  docx's hardcoded level 1, because Gutenberg HTML puts chapter titles in `<h2>`
  (Frankenstein has 32 of them, Moby-Dick 141, Wuthering Heights 37) and `<h1>`
  is the book title. Defaulting to level 1 here would produce one chapter.
- **Split at horizontal rules** — off by default.
- **Strip Project Gutenberg boilerplate** — the header and footer between the
  `*** START OF ...` and `*** END OF ...` markers, or `id="pg-header"` /
  `id="pg-footer"`. Off by default, and it is the one format-specific hack in
  the feature; it earns its place because these files are the single most common
  thing a writer will have on hand to import.

The two split modes are **independent options, not one flag with a level beside
it**. A single `splitChapters.split` boolean gating both was the obvious shape
and the wrong one: it makes "split at horizontal rules" silently do nothing
whenever the heading box happens to be unticked, which the dialog lets a writer
choose. So the converter takes `splitChapters: { headingLevel, atRules }`, where
a null `headingLevel` means "do not split at headings" — which is also what a
bare call gets, and what the EPUB importer wants when it is already splitting by
table-of-contents entry. The dialog sends null when its checkbox is clear rather
than the level still showing in the selector.

The split itself is the same shape as the docx importer's: accumulate ops,
start a new delta at each heading of the chosen level.
`breakHeadingsIntoChapters` in `headings-to-chapters.js` is *not* reusable here —
it operates on a live `editorQuill` and mutates its contents — but the loop it
runs is worth reading before writing this one.

## The EPUB importer

### What the TOC is actually for

The idea in the brief was to skip the TOC and import the chapters. It is worth
inverting that, because the spine is not a chapter list:

| Book | Spine items | TOC entries |
|---|---|---|
| Frankenstein | 32 | 32 |
| Wuthering Heights | 37 | 36 |
| **Moby-Dick** | **12** | **146** |

Gutenberg's EPUB generator packs many chapters into one XHTML file — Moby-Dick's
141 chapters live in 11 documents, one of which holds 22 of them. Import by
spine item and you get twelve 150KB chapters. The TOC is where the real chapter
boundaries are, as `href="doc.xhtml#pgepubid00042"` fragments, and every one of
them resolves: **214 of 214 fragments across the three books, zero misses.**

So the default is: read the TOC, and for each entry, take the content of its
target document from that entry's anchor up to the next entry's anchor. Same
document with no fragment, or no TOC at all, falls back to one chapter per spine
item. Nested `navPoint`s flatten to a single list — a sub-chapter is still a
chapter here.

Also worth an option, off by default: **split at TOC depth 1 only**, which for
Moby-Dick means treating the "Extracts" sub-entries as part of their parent
rather than as 20-odd chapters of their own.

### Reading the container

Standard, and no library needed beyond the `unzipper` already in `package.json`:

1. `META-INF/container.xml` → `<rootfile full-path>` → the OPF path.
2. OPF `<manifest>` → id → href/media-type; `<spine>` → ordered `itemref`s.
   Skip `linear="no"` items.
3. TOC: prefer the EPUB 3 nav document (`properties="nav"` in the manifest),
   fall back to the EPUB 2 `toc.ncx` named by `spine[toc]`. Both were present
   and agreed in all three samples; only one is guaranteed in the wild.
4. `<dc:title>` and `<dc:creator>` from the OPF metadata — good defaults for the
   project title and author fields, which no other importer can offer.

Every href resolves relative to the file that names it, not to the archive root
(the OPF lives in `OEBPS/`, so its hrefs need that prefix; the ncx's hrefs
resolve relative to the ncx). Getting this wrong is the single most common EPUB
reader bug and costs nothing to get right.

`OEBPS/wrap0000.xhtml` — a cover-image wrapper — is in the spine of all three
samples and in the TOC of none. It contains one `<img>` and so imports as an
empty chapter. Drop spine items whose converted delta has no text.

### The platform command

One new group F command, matching the shape `importDocx` already established
([platform-node.js:867](../src/components/controllers/platform-node.js#L867)):

```js
importEpub: { group: 'F', params: ['path'], returns: '{ entries: { [path]: string } }',
  note: 'Text entries only - xhtml/html/opf/ncx/css. Images and fonts are never read, which is where "images are stripped" is actually enforced. Returns the text, not a temp directory, the same as importDocx.' }
```

**Built** — with one departure from the plan as written. There is no temp
directory: `unzipper.Open` reads the archive's central directory and pulls one
entry's bytes at a time, so nothing is extracted, there is nothing to clean up if
the process dies mid-import, and a hostile entry name (`../../..`) cannot write
anywhere because nothing is written at all. `importDocx`'s `mkdtempSync` +
`finally{ cleanup() }` is the older shape and stays as it is; it works and is
tested, and rewriting a shipped import path buys nothing a writer would notice.

Entries are selected by extension rather than by the OPF's declared media types,
because the manifest is one of the things being read and so cannot be consulted
to decide what to read.

Measured on the samples: 23–48ms each, no binary entry read, and Frankenstein's
258KB cover jpeg never touched. Payload sizes are 0.47MB, 1.44MB and 0.70MB of
text.

A second command is *not* needed. Per rule 4 in `platform.js` — "Multi-step
operations are one command" — a `readZipEntry` the renderer calls in a loop would
put the archive's structure and the ordering of native steps back in the renderer,
which is the thing that contract exists to prevent.

### An epub links its CSS — which changes the converter

The one finding from building this that affects work still to come. An epub
chapter does not carry a `<style>` block; it carries

```html
<link href="0.css" rel="stylesheet" type="text/css"/>
```

and every chapter of all three sample books is written that way. `html-import.js`
builds its rule table from the document's own `<style>` tags, so an epub chapter
handed to it as-is resolves *no* class-driven styling at all — which is the exact
failure that whole resolver exists to prevent, arriving through the back door.

Two consequences:

1. `importEpub` returns `.css` entries, not just markup. Dropping them at the
   boundary would make the fix impossible further up.
2. `html-import.js` needs an `extraCss` option — an array of stylesheet texts
   whose rules are collected *before* the document's own `<style>` blocks, since
   a linked sheet sits in `<head>` ahead of any inline one and source order is
   what stands in for specificity there. `epub-import.js` resolves each chapter's
   `<link rel="stylesheet">` hrefs against the returned entries and passes the
   text through. That is a change to the converter, not just to the epub reader,
   and it belongs in step 4.

A second command is *not* needed. Per rule 4 in `platform.js` — "Multi-step
operations are one command" — a `readZipEntry` the renderer calls in a loop
would put the archive's structure and the ordering of native steps back in the
renderer, which is the thing that contract exists to prevent.

## Wiring

- `import_display.js` — two new filetypes, `htmlSelect` (`html`, `htm`, `xhtml`)
  and `epubSelect` (`epub`); one new options fieldset each, enabled/disabled by
  the same `importForm.onchange` the docx one uses.
- `import.js` — two new branches in `importFilesAsync`, each ending in
  `recurse(packagedDeltas)` exactly as the docx branch does. The existing
  fallthrough that logs an unrecognized `fileType.id` stays honest for free.
- Chapter titles: heading text where a split produced one, TOC label for an EPUB
  entry, else `generateChapTitleFromFirstLine`. The existing filename/first-line
  radio still applies.

Both the docx and the HTML importer turn one file into any number of chapters, so
both need the same answer to what each chapter is called — including the
numbering that keeps filename-labelled chapters distinguishable, which was a
regression fix on the docx side. `packageDeltas` in `import.js` is the one copy
of it, so a third importer inherits the fix rather than reintroducing the bug.

## Testing

`test/html-import.test.js` and `test/epub-import.test.js`, jsdom for `DOMParser`
and `test/fake-bridge.js` for the platform, as `docx-import.test.js` does.

Worth pinning explicitly, since each is a bug that shipped in the prototype or
would have:

- Class-driven italics (`<span class="c3">` + a `<style>` rule) — the case
  Quill's clipboard loses.
- `<p>\n  text\n</p>` collapses to `text`, with no leading or trailing space.
- `body { text-align: justify }` produces **no** `align` attributes.
- `a { text-decoration: underline }` produces no `underline`.
- `<pre>` keeps its newlines and runs of spaces.
- A 3-column table becomes pipe rows; a 1-column table becomes plain paragraphs.
- EPUB: two TOC entries pointing into one XHTML file produce two chapters split
  at the second one's anchor.
- EPUB: hrefs resolve relative to the OPF and to the ncx, not to the root.
- **Round trip** — `epub.js` builds a book out of `mdfc-to-html.js` output, so
  an epub WareWoolf exported should import back with its formatting intact.
  This is a real regression test on both halves and costs one test to write.

## Order of work

1. ~~`html-import.js` + its tests. Standalone and useful on its own.~~ **Done** —
   53 tests in `test/html-import.test.js`. One thing not in the plan turned out
   to be needed: the style rules are *indexed* by what their rightmost compound
   selector requires (id, then class, then tag) rather than each being tested
   against every element. A 300-rule, 24,000-element document — the shape Google
   Docs produces for a novel — took 8.3 seconds the naive way and 1.0 with the
   index, for identical output. The index is load-bearing for correctness too, so
   it carries its own tests: source order across buckets, keyless selectors, and
   the two traps it hides (`p:not(.a, .b)` must not be filed under class `a`, a
   class its targets are guaranteed not to have; and a dot inside `a[href=".x"]`
   is not a class).
2. ~~HTML wiring in `import.js` / `import_display.js`.~~ **Done** — the file type,
   the options fieldset, `importHtml`, and the shared `packageDeltas`. Frankenstein
   imports end-to-end as 31 chapters in ~320ms with its 42 italic runs intact.
3. ~~`importEpub` in `platform.js`, `platform-node.js`,
   `docs/native-command-inventory.md`.~~ **Done** — 8 tests, each run twice
   (directly and across the real structured-clone bridge), and verified against
   the three sample books. Building it turned up the linked-CSS problem above,
   which adds an `extraCss` option to `html-import.js` in step 4.
4. ~~`epub-import.js` (container/OPF/nav → per-chapter HTML → `html-import.js`)
   + tests, and `extraCss` in `html-import.js`.~~ **Done** — 35 tests, including the
   round trip against `epub.js`'s own output. Four things the plan did not
   anticipate, all recorded below.
5. ~~EPUB wiring, and the title/author defaults.~~ **Done** — the `epubSelect`
   file type, an EPUB options fieldset, `importEpubFile`, `applyBookMetadata`,
   and a new "Importing HTML and EPUB" chapter in the bundled Help doc.

## What step 5 turned up

**The book's metadata rides out on the finish callback.** It needed a way from
`importFilesAsync` to the project, and threading a fourth callback through
`showImportOptions` → `initiateImport` → `importFilesAsync` would have touched
every caller and test of all three. But "the import has finished" is exactly the
moment a project would take its defaults, and `cback` already marks it — and
`detached()` in `render.js` forwards arguments, so `cback(bookMetadata)` reaches
the handler with no new parameter anywhere. Every existing caller ignores the
argument and behaves as it always did.

**"First line" means something slightly different for an EPUB.** The book's table
of contents has already named every chapter, and that name is better than the
first line in every case where the two differ — so the label option prefers it,
falling back to the first line only where the contents named nothing. "Filename"
still numbers chapters after the file, as for every other format.

**The title/author defaults fill blanks only.** A writer who has already named
their manuscript does not want importing a reference book to rename it, and a
project field has no undo. `applyBookMetadata` lives in `import.js` rather than
`render.js` so the rule is actually testable — `render.js` is not reachable from
the suite — and it marks the project dirty only when something moved, so a no-op
cannot prompt a save of a file nothing changed in.

**The EPUB fieldset has no split options at all**, which is the point: the book
already says where its chapters are. Only the two genuinely-the-writer's choices
are offered — strip Gutenberg boilerplate, and use the book's title and author.

## The fixtures

The three books live in `test/fixtures/books/`, in both formats, and
`test/real-books.test.js` asserts on them as wholes. They are under `test/`
rather than `src/examples/` because `packagerConfig.ignore` excludes only
`^/test($|/)` — 4.4 MB of test data in `src/examples/` would go into every
installer, nearly quadrupling what that directory contributes to it.

Having *both* formats of each book is what earns their size. The two importers
reach the same text by completely different routes — one document with an inline
`<style>` block, versus a zip of XHTML with linked stylesheets and a table of
contents — so the same book has to come out with the same emphasis either way.
That is one assertion no hand-written fixture can make, and the counts line up
exactly: 42, 392 and 297 italic runs from each format.

Committing them immediately paid for itself. Moby-Dick's contents page is written

```html
<p class="toc">
  <a href="#..."> ETYMOLOGY. </a>
</p>
```

and every entry of it was importing as `"ETYMOLOGY. "`, with a trailing space.
The closing newline is a text node of its own, so `trimLineEdges` was trimming
*that* op to nothing and leaving the real last op's space behind — the empty op
was then filtered out and the space survived. Both edges are now walked inward
past ops that trim away to nothing. `html-import.js` had 64 passing tests and
none of them had this shape in it.

## What step 4 turned up

**Splitting is positional, not structural.** The plan said to take each TOC
entry's target "from that entry's anchor up to the next entry's anchor", which
reads as DOM surgery. It cannot be done that way: in Moby-Dick's packed files the
anchor *is* the chapter's top-level block, but Frankenstein's title page has two
TOC entries whose anchors (`h1` and `h3`) sit inside a single `<div>` — find each
anchor's top-level block there and both entries collide on the same one, losing a
chapter. So `html-import.js` takes a `splitChapters.atIds` option and records a
split point when the walk *reaches* an element with one of those ids. Same rule
for both shapes, one pass per document instead of one clone per chapter, and no
detached-element problems in the style resolver.

Each returned delta carries `splitId` — which named id it began at — rather than
`epub-import.js` counting deltas and hoping the arithmetic lines up. It does not:
a document with front matter ahead of its first anchor returns one more delta
than it has entries, and that front matter is a real untitled chapter.

**A `linear="no"` exclusion beats the incomplete-spine fallback.** Two rules
collided: "a TOC entry naming a document the spine omits is still imported" and
"`linear="no"` is not part of the reading order". A spine that excludes something
deliberately is not the same as a spine that forgot it, so the explicit exclusion
wins.

**The navigation document is not a chapter.** `epub.js` puts its generated
contents page in the spine as well as the manifest, so a WareWoolf-exported epub
imported its own list of links back as an untitled chapter. The document the
manifest declares `properties="nav"` is skipped. A contents page a writer put in
the prose is a different thing and still imports — Gutenberg's books have one.

**Reading the linked stylesheets cost more than everything else combined.**
Parsing each document a second time just to find its three `<link>` tags was
566ms of Moby-Dick's 1073ms. A `<link>` only ever lives in the head, so only the
head is handed to the parser: 7ms, and the import went to 649ms.
