# WareWoolf

WareWoolf is designed for one thing: writing fiction. It is intentionally simplified: you cannot change the font, line spacing, or color. But it has everything you need to organize, edit, and revise a novel--and you don't even need a mouse.

It is composed of three simple text-based panels with no icons: Chapters, Editor, and Notes. 

That's it. There is no toolbar with twenty buttons cluttering the screen. There isn't even a file menu unless you summon it. All formatting is done with shortcuts. (But don't worry, there aren't many to memorize, and you can always press **CTRL** + **H** to show them all in the Shortcut Helper. And it's not like you do a lot of formatting when writing fiction anyway.)
 
## Display Controls

On the left is the list of chapters, which you can re-order and rename. In the middle, the main editor. On the right, notes. These three panels can each be toggled on/off with **F1**, **F2**, and **F3**, so you can clear everything but the editor for a fully distraction-free experience, or make room for using a narrow vertical screen.

Speaking of room--the editor panel can be contracted or expanded using **CTRL** + **<** or **>** so you can see your paragraphs as they will look in a narrow paperback or a wide manuscript page. Similarly, you can adjust the font display size with **CTRL** + **-** or **+**.

## Navigating Chapters

To cycle through chapters, press **CTRL** + **Up** or **Down**. **CTRL** + **Right** and **Left** will jump between the notes and main editor. These are the *Navigation Keys*.

To move a chapter up or down in the list, press **CTRL** + **SHIFT** + **Up** or **Down**. To rename a chapter, **CTRL** + **SHIFT** + **Left**. These are the *Alteration Keys*.

## File Menu

Pressing **ALT** will reveal the file menu. Here you can import, export, compile, or use many other tools, all easily accessible without a mouse by navigating the menus with the **Arrow Keys** and **Escape**. In addition to the usual find/replace, spellcheck, etc., there is a simple Outliner with word count breakdowns for each chapter and a fields for writing summaries.

## Import/Export Tools

WareWoolf makes it easy to combine multiple files, edit and style them, and export them as a document in standard manuscript format. 

It is designed especially to work well for those who write first drafts in plain-text-based workflows, as is common with distraction-free writing devices such as the Astrohaus Freewrite, Alphasmart Neo, or various stripped-down applications.

## Two Ways To Write In Plain Text For Import Into WareWoolf

Of course, you can just start writing directly in WareWoolf, but if you *do* use plain text for your first drafts, there are two ways to approach it...

### 1. Just Write

Write whatever you want however you want and then edit/format it in WareWoolf. You will not lose manual tabs or white space on import, but you will have a few options for automatic styling of chapter headings and italics:

- Convert text you've marked as italics. The default marker is \*asterisks\*, but you can use any character.
- Convert the first line of every file to a Chapter Heading (Heading 1, centered)--convenient if you write each chapter as a separate text file.
- Split text into separate chapters at custom marker (default "\<ch\>")--helpful if you write all chapters in one file.

### 2. Use MarkdownFic, A Revised/Simplified Version of Markdown Designed For Fiction

Unlike Markdown, MarkdownFic allows you to use regular indented paragraphs without space between them. It will keep your manual tabs and your white space. You are freed from writing fiction like it's a blog!

- The supported syntax is all the same as Markdown:
  - Headings: '# My Heading 1', '## My Heading 2'
  - Italics: '\*italicized text\*'
  - Bold: '\*\*bold text\*\*'
  - Blockquote: '> blockquoted text'
  - Strikethrough: '\~\~struck through text\~\~'
  - Footnotes (will be supported but not yet):
    - 'Text with a footnote. [^1]'
    - '[^1]: The footnote.'

That's it! You don't need much formatting to write fiction. And since it is all the same as Markdown, anything exported as MarkdownFic should be usable in any Markdown editor, with the proviso that you may need to find/replace your tabs to newlines.

## Compile/Export options

Currently you can compile/export your work in plain text, MardownFic, or .docx, with some helpful options regarding headings and chapter breaks.

## WareWoolf's File Format

WareWoolf saves its projects as plain text JSON files so they are both human readable and quickly parsed by Javascript. There is a primary .woolf project file, and individual .pup files for each chapter in a subdirectory.

- Frankenstein.woolf
- Frankenstein_Pups
	- 1.pup
	- 2.pup
	- 3.pup

The reason for doing this rather than one (more convenient) file is speed. This way, WareWoolf does not hold your entire (perhaps very long) novel in memory, but only one chapter at a time--the chapter you are viewing. 

Please note that the pup files must be kept either in a subdirectory or the same directory as the project file. If you move them, WareWoolf will prompt you to show the new location at load.
