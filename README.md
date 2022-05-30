# WareWoolf

A minimalist novel-writing system designed to be usable without a mouse. Allows you to compose, sort, and reorder chapters, then compile them into one file (or export to separate files).

It is designed especially to work well for those who write first drafts in plain text-based workflows, as is common with distraction-free writing devices such as the Astrohaus Freewrite, Alphasmart Neo, or various stripped-down applications.

## Two Ways To Write In Plain Text For Import Into WareWoolf

Of course, you can just start writing directly in WareWoolf, but if you *do* use plain text for your first drafts, there are two ways to approach it...

### 1. Just Write

Write whatever you want however you want and then edit/format it in WareWoolf. You will not lose manual tabs or white space on import, but you will have a few options for automatic styling of chapter headings and italics:

- Convert text you've marked as italics. The default marker is \*asterisks\*, but you can use any character.
- Convert the first line of every file to a Chapter Heading (Heading 1, centered)--convenient if you write each chapter as a separate text file.
- Split text into separate chapters at indicated string (## is the default)--helpful if you write all chapters in one file.

### 2. Use MarkdownFic, A Revised/Simplified Version of Markdown Designed For Fiction

- Unlike Markdown, MarkdownFic allows you to use regular indented paragraphs without space between them. It will keep your manual tabs and your white space. You are freed from writing fiction like it's a blog!
- The following syntax is all the same as Markdown:
  - Headings: '# My Heading 1', '## My Heading 2'
  - Italics: '\*italicized text\*'
  - Bold: '\**bold text\**'
  - Blockquote: '> blockquoted text'
  - Footnotes (will be supported but not yet)
- And the following is specific to MarkdownFic:
  - Center Align: '[>c] Centered text.'
  - Right Align: '[>r] Right-aligned text.'
  - Justify Align: '[>j] Justified text.'
  - (Defaults to left-align.)

## Compile/Export options

Currently you can compile/export your work in plain text, MardownFic, or .docx, with some helpful options regarding headings and chapter breaks.
