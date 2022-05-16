# WareWoolf

A minimalist novel writing system designed to be usable without a mouse. Allows you to compose, sort, and reorder chapters, then compile them into one file (or export to separate files).

It is designed especially to work well with plain-text-based workflows, such as with the Astrohaus Freewrite, since that is what I use for first drafts.

## Workflow:

1. Draft each chapter as a separate document on the Freewrite (or whatever) saved as a .txt file. Each chapter begins with the chapter title as the first line. Italics are marked as in Markdown, with either asterics or underscores.
2. Use the Import tool in Warewoolf to import these text files as chapters. Leave options checked to automatically convert the first line of every chapter into a Heading 1, styled bold and centered, and to convert marked italics.
3. Edit in WareWoolf, which has spellcheck, find/replace, easy chapter reordering, note taking features, etc.
4. Use the Compile function to export draft as one .docx file.
5. Either treat this as the final file and do any tweaks in Libre Office/Word/whatever, or with my method...
6. Print draft from LibreOffice, mark up by hand, type up revisions in LibreOffice.
7. If desired, you can import the .docx back into WareWoolf. (The reason for exporting to a .docx and then importing again is because WareWoolf is not a "What You See Is What You Get" editor. If you're going to print the draft for hand revision, it is much easier to do so with a WYSIWYG editor like LibreOffice/Word, since the location of the edits on your printed page will match the text on the screen.) Right now, the way to import a .docx into WareWoolf is to copy all the text, paste it into the WareWoolf editor, and use the "Break Headings Into Chapters" tool to automatically break the pasted document into individual chapters. (This will only work if you've styled the chapter headings in your .docx as Heading 1.) Eventually this will be a one-click import.

## Why doesn't it just use Markdown?

Because I despise Markdown for the sole reason that it cannot record manual indentations. I do not want all paragraphs indented, and I often don't want all the indented ones indented the same amount. This is, in my view, Markdown's only major flaw, but a fatal one.

WareWoolf is still in early stages of development.
