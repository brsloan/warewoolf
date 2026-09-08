# Real books, as import fixtures

Three Project Gutenberg titles, each in both of the formats the importer reads:

| | HTML | EPUB |
|---|---|---|
| Frankenstein (Mary Shelley) | 468 KB | 474 KB |
| Moby-Dick (Herman Melville) | 1.4 MB | 812 KB |
| Wuthering Heights (Emily Brontë) | 725 KB | 587 KB |

They are the fixtures for `real-books.test.js`. Everything else under `test/` builds
its own small fixtures inline, which is the right way to pin one behaviour at a
time — but a synthetic fixture only ever contains what its author thought to put
in it, and most of what went wrong while `html-import.js` and `epub-import.js`
were being written was found by running them over real books:

- `body { text-align: justify }` in Gutenberg's stylesheet, which put an
  alignment attribute on all 766 paragraphs of Frankenstein.
- `a { text-decoration: underline }`, which underlined every link in every book.
- Paragraphs written one wrapped source line per line, which arrived with a
  stray space at each end.
- Moby-Dick's 141 chapters living in 11 spine documents, which is the entire
  reason the EPUB importer follows the table of contents rather than the spine.
- Frankenstein's title page, where two table-of-contents entries share one
  `<div>` — the case that ruled out splitting by DOM structure.

Having *both* formats of the same book is what makes them worth their size: the
two importers reach the same text by completely different routes, so the same
book converted from HTML and from EPUB has to come out with the same emphasis in
it. `real-books.test.js` asserts exactly that, and no fixture written by hand
can.

## Why they live under `test/` rather than `src/examples/`

`src/examples/` ships inside the packaged app — `packagerConfig.ignore` in
`package.json` excludes only `^/test($|/)`. These 4.4 MB are test data, not
sample projects a writer would open, and putting them in `src/examples/` would
put them in every installer, nearly quadrupling what that directory contributes.

## Provenance

Downloaded from [Project Gutenberg](https://www.gutenberg.org/), where they are
in the public domain in the United States. Each file still carries Gutenberg's
own licence header and footer, which is deliberate — the importer's
"Strip Project Gutenberg Boilerplate" option exists to remove them, and these
files are what tests that it does.

Do not re-download or update them in place. The tests assert exact chapter and
formatting counts, so a re-issued edition would look like a regression in the
importer rather than a change of input.
