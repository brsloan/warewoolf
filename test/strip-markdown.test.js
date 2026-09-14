const test = require('node:test');
const assert = require('node:assert');

const { stripMarkdown } = require('../src/components/controllers/strip-markdown');

test('headings lose their hashes and keep their words', function(){
  assert.strictEqual(stripMarkdown('# Title'), 'Title');
  assert.strictEqual(stripMarkdown('### Fixed'), 'Fixed');
  assert.strictEqual(stripMarkdown('## Fixed ##'), 'Fixed');
  assert.strictEqual(stripMarkdown('#### Deeply nested heading'), 'Deeply nested heading');
});

//Seven hashes is no heading in markdown either, so the line is the author's own text.
test('more than six hashes is not a heading', function(){
  assert.strictEqual(stripMarkdown('####### not a heading'), '####### not a heading');
});

test('a hash with no space after it is not a heading', function(){
  assert.strictEqual(stripMarkdown('#hashtag'), '#hashtag');
  assert.strictEqual(stripMarkdown('C# support'), 'C# support');
});

test('a setext heading loses its underline and keeps its words', function(){
  assert.strictEqual(stripMarkdown('Title\n====='), 'Title');
  assert.strictEqual(stripMarkdown('Subtitle\n---'), 'Subtitle');
});

test('emphasis markers come off and leave the emphasized words', function(){
  assert.strictEqual(stripMarkdown('**Blockquotes.** Now supported.'), 'Blockquotes. Now supported.');
  assert.strictEqual(stripMarkdown('*italic* and _also italic_'), 'italic and also italic');
  assert.strictEqual(stripMarkdown('__bold__ and ***both***'), 'bold and both');
  assert.strictEqual(stripMarkdown('~~struck out~~'), 'struck out');
});

//The whole reason underscores are matched by a rule of their own: a word may contain them, and a
//release note naming a file or an identifier is naming it exactly as it is spelled.
test('underscores inside a word are the writer\'s own characters, not emphasis', function(){
  assert.strictEqual(stripMarkdown('snake_case_name'), 'snake_case_name');
  assert.strictEqual(stripMarkdown('warewoolf_3.0.0_Windows_x64.exe'), 'warewoolf_3.0.0_Windows_x64.exe');
  assert.strictEqual(stripMarkdown('a warewoolf_3.0.0_Windows_x64.exe file'), 'a warewoolf_3.0.0_Windows_x64.exe file');
});

//Not the same case as the one above, however much it looks like it: "__init__" opens at a word
//boundary, so GitHub renders it bold and a reader of the notes there saw "init". Matching what they
//saw is the whole job, and an author who wants the underscores back writes them in a code span.
test('a word wrapped in underscores is emphasis, the way GitHub reads it', function(){
  assert.strictEqual(stripMarkdown('__init__ is a method'), 'init is a method');
  assert.strictEqual(stripMarkdown('`__init__` is a method'), '__init__ is a method');
});

test('an asterisk that opens nothing stays an asterisk', function(){
  assert.strictEqual(stripMarkdown('3 * 4 = 12'), '3 * 4 = 12');
  assert.strictEqual(stripMarkdown('a lone * here'), 'a lone * here');
});

test('a link reads as its own text', function(){
  assert.strictEqual(
    stripMarkdown('Based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).'),
    'Based on Keep a Changelog.'
  );
});

test('a link with no text of its own falls back to the URL', function(){
  assert.strictEqual(stripMarkdown('See [](https://warewoolf.org).'), 'See https://warewoolf.org.');
});

test('a titled link drops the title along with the URL', function(){
  assert.strictEqual(stripMarkdown('[the docs](https://example.com "Docs")'), 'the docs');
});

test('an image reads as its alt text, or its URL when it has none', function(){
  assert.strictEqual(stripMarkdown('![The logo](https://example.com/logo.png)'), 'The logo');
  assert.strictEqual(stripMarkdown('![](https://example.com/logo.png)'), 'https://example.com/logo.png');
});

test('a reference link reads as its text and its definition line is dropped', function(){
  assert.strictEqual(
    stripMarkdown('See [the releases page][rel].\n\n[rel]: https://example.com/releases'),
    'See the releases page.'
  );
});

//A changelog section pasted into a release body carries the whole set of its definitions, usually
//below the lines that use them - so the definitions are gathered before anything is stripped.
test('a bare label reads as its own text where the body defined it', function(){
  assert.strictEqual(
    stripMarkdown('## [3.0.0] - 2026-09-12\n\nThe notes.\n\n[3.0.0]: https://example.com/releases/v3.0.0'),
    '3.0.0 - 2026-09-12\n\nThe notes.'
  );
});

//The other half of that rule, and the reason it needs the definitions at all: brackets are ordinary
//characters far more often than they are a link.
test('a bare label the body never defined keeps its brackets', function(){
  assert.strictEqual(stripMarkdown('Footnote markers are written [^1].'), 'Footnote markers are written [^1].');
  assert.strictEqual(stripMarkdown('Press [Esc] to close.'), 'Press [Esc] to close.');
});

test('an autolink reads as the URL inside it', function(){
  assert.strictEqual(stripMarkdown('<https://warewoolf.org>'), 'https://warewoolf.org');
  assert.strictEqual(stripMarkdown('<brsloan@example.com>'), 'brsloan@example.com');
});

test('a bare URL is left exactly as typed', function(){
  assert.strictEqual(
    stripMarkdown('**Full Changelog**: https://github.com/o/r/compare/v2.5.0...v3.0.0'),
    'Full Changelog: https://github.com/o/r/compare/v2.5.0...v3.0.0'
  );
});

test('list markers are normalized to one bullet and the indent is kept', function(){
  assert.strictEqual(
    stripMarkdown('* One\n+ Two\n- Three'),
    '- One\n- Two\n- Three'
  );
  assert.strictEqual(
    stripMarkdown('- Top\n    - Nested'),
    '- Top\n    - Nested'
  );
});

test('a numbered list keeps its numbers', function(){
  assert.strictEqual(stripMarkdown('1. First\n2. Second'), '1. First\n2. Second');
  assert.strictEqual(stripMarkdown('1) First'), '1. First');
});

test('a task list loses its boxes and keeps its items', function(){
  assert.strictEqual(stripMarkdown('- [x] Done\n- [ ] Not done'), '- Done\n- Not done');
});

test('a quotation loses its markers and keeps its words, however deep', function(){
  assert.strictEqual(stripMarkdown('> Quoted.'), 'Quoted.');
  assert.strictEqual(stripMarkdown('> > Twice quoted.'), 'Twice quoted.');
});

//A rule says "new section", and in plain text that is a blank line - so it leaves one behind rather
//than letting the two sections it separates run together.
test('a horizontal rule becomes a blank line', function(){
  assert.strictEqual(stripMarkdown('Above\n\n---\n\nBelow'), 'Above\n\nBelow');
  assert.strictEqual(stripMarkdown('Above\n\n- - -\n\nBelow'), 'Above\n\nBelow');
  assert.strictEqual(stripMarkdown('Above\n\n***\n\nBelow'), 'Above\n\nBelow');
});

test('inline code loses its backticks and keeps every character between them', function(){
  assert.strictEqual(stripMarkdown('Press `Ctrl+Alt+R`'), 'Press Ctrl+Alt+R');
  assert.strictEqual(stripMarkdown('`` ` ``'), '`');
});

//A backtick binds tighter than anything else inline, so a code span is the one place a marker is
//just a character - which is what holding the span aside before the emphasis rules run protects.
test('markers inside a code span are characters, not markers', function(){
  assert.strictEqual(stripMarkdown('`**kwargs`'), '**kwargs');
  assert.strictEqual(stripMarkdown('`# not a heading`'), '# not a heading');
  assert.strictEqual(stripMarkdown('`[a](b)`'), '[a](b)');
});

test('a fenced code block keeps its lines and loses its fences', function(){
  assert.strictEqual(
    stripMarkdown('```js\nvar a = **b**;\n# not a heading\n```'),
    'var a = **b**;\n# not a heading'
  );
  assert.strictEqual(stripMarkdown('~~~\nplain\n~~~'), 'plain');
});

//A fence that never closes would otherwise take the rest of the notes with it into stripped text.
test('an unclosed fence leaves the rest of the notes as they are', function(){
  assert.strictEqual(stripMarkdown('```\ncode\nmore code'), 'code\nmore code');
});

test('a backslash escape leaves the character it escaped and takes itself off', function(){
  assert.strictEqual(stripMarkdown('\\*not italics\\*'), '*not italics*');
  assert.strictEqual(stripMarkdown('\\# not a heading'), '# not a heading');
  assert.strictEqual(stripMarkdown('C:\\\\Users'), 'C:\\Users');
});

test('an escaped marker is not read as a marker by the rules that follow', function(){
  assert.strictEqual(stripMarkdown('\\*a\\* and *b*'), '*a* and b');
});

test('HTML comments and tags go, and their contents stay', function(){
  assert.strictEqual(stripMarkdown('Before<!-- hidden -->After'), 'BeforeAfter');
  assert.strictEqual(stripMarkdown('<b>bold</b> words'), 'bold words');
});

test('a line break written as HTML becomes a real one', function(){
  assert.strictEqual(stripMarkdown('One<br>Two<br />Three'), 'One\nTwo\nThree');
});

test('the entities an author writes by hand are decoded, and anything else is left alone', function(){
  assert.strictEqual(stripMarkdown('a &amp; b &lt;c&gt;'), 'a & b <c>');
  assert.strictEqual(stripMarkdown('&#39;quoted&#39;'), "'quoted'");
  assert.strictEqual(stripMarkdown('&notanentity;'), '&notanentity;');
});

test('a table loses its alignment row and its outer pipes', function(){
  assert.strictEqual(
    stripMarkdown('| Key | Does |\n| --- | --- |\n| `Ctrl+N` | New chapter |'),
    'Key | Does\nCtrl+N | New chapter'
  );
});

test('runs of blank lines are collapsed and the whole thing is trimmed', function(){
  assert.strictEqual(stripMarkdown('\n\nOne\n\n\n\nTwo\n\n'), 'One\n\nTwo');
});

test('trailing whitespace, including a markdown hard break, is dropped', function(){
  assert.strictEqual(stripMarkdown('One   \nTwo'), 'One\nTwo');
});

test('empty and missing bodies come back as an empty string', function(){
  assert.strictEqual(stripMarkdown(''), '');
  assert.strictEqual(stripMarkdown(null), '');
  assert.strictEqual(stripMarkdown(undefined), '');
});

test('carriage returns do not survive into the plain text', function(){
  assert.strictEqual(stripMarkdown('## One\r\n\r\n- Two\r\n'), 'One\n\n- Two');
});

//The one thing the placeholders used to hold code spans and escapes aside must not be forgeable
//from the release notes themselves.
test('a NUL in the notes cannot stand in for a held code span', function(){
  assert.strictEqual(stripMarkdown('\u00000\u0000 and `code`'), '0 and code');
});

//A whole release body, run through end to end: nothing a reader would have seen is lost, and no
//marker reaches the screen.
test('a realistic release body comes out as readable plain text', function(){
  var body = [
    '## What\'s Changed',
    '',
    '### Added',
    '',
    '- **Jump to Reference** on `Ctrl+Alt+R`, in a novel and a screenplay alike.',
    '- Courier Prime, from [Quote-Unquote Apps](https://quoteunquoteapps.com/courierprime/), is bundled.',
    '',
    '### Fixed',
    '',
    '- Two consecutive empty lines lost their format on export.',
    '',
    '**Full Changelog**: https://github.com/brsloan/WareWoolf/compare/v2.5.0...v3.0.0'
  ].join('\n');

  assert.strictEqual(stripMarkdown(body), [
    'What\'s Changed',
    '',
    'Added',
    '',
    '- Jump to Reference on Ctrl+Alt+R, in a novel and a screenplay alike.',
    '- Courier Prime, from Quote-Unquote Apps, is bundled.',
    '',
    'Fixed',
    '',
    '- Two consecutive empty lines lost their format on export.',
    '',
    'Full Changelog: https://github.com/brsloan/WareWoolf/compare/v2.5.0...v3.0.0'
  ].join('\n'));
});
