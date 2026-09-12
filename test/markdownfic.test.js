const test = require('node:test');
const assert = require('node:assert');

const { convertDeltaToMDF, parseMDF } = require('../src/components/controllers/markdownFic');
const { normalizeDelta } = require('./helpers');

//The editor's delta is the source of truth and .mdfc is how a project is written to disk, so a
//delta that survives convertDeltaToMDF -> parseMDF unchanged is the property that matters most
//here. Each case asserts the intermediate .mdfc as well, so a failure says which half broke.
function assertRoundTrip(delta, expectedMdf){
  var mdf = convertDeltaToMDF(delta);
  assert.strictEqual(mdf, expectedMdf, 'delta did not serialise to the expected .mdfc');
  assert.deepStrictEqual(
    normalizeDelta(parseMDF(mdf)),
    normalizeDelta(delta),
    'delta did not survive the round trip'
  );
}

//For the cases where the writer deliberately does not preserve the delta: a space moved out from
//in front of a style marker carries no style on the way back. The .mdfc is asserted along with the
//property that still has to hold, which is that every character of the text survives.
function assertTextRoundTrip(delta, expectedMdf){
  var mdf = convertDeltaToMDF(delta);
  assert.strictEqual(mdf, expectedMdf, 'delta did not serialise to the expected .mdfc');
  assert.strictEqual(textContent(parseMDF(mdf)), textContent(delta), 'text did not survive the round trip');
}

function textContent(delta){
  return (delta.ops || []).map(function(op){
    return typeof op.insert === 'string' ? op.insert : '￼';
  }).join('');
}

test('a plain paragraph round trips', function(){
  assertRoundTrip({ ops: [ {insert: 'Hello world'}, {insert: '\n'} ] }, 'Hello world\r\n');
});

test('headings and alignment round trip', function(){
  assertRoundTrip({ ops: [
    {insert: 'Title'},   {insert: '\n', attributes: {header: 1}},
    {insert: 'Middle'},  {insert: '\n', attributes: {align: 'center'}},
    {insert: 'Right'},   {insert: '\n', attributes: {align: 'right'}}
  ]}, '# Title\r\n[>c] Middle\r\n[>r] Right\r\n');
});

//Regression: a blank line carrying an alignment attribute used to produce no marker at all, so the
//line came back left aligned and centred scene breaks drifted on every save.
test('a blank line keeps its alignment through the round trip', function(){
  assertRoundTrip({ ops: [
    {insert: 'Title'},   {insert: '\n', attributes: {align: 'center', header: 1}},
    {insert: ''},        {insert: '\n', attributes: {align: 'center'}},
    {insert: 'The End'}, {insert: '\n', attributes: {align: 'center'}}
  ]}, '[>c] # Title\r\n[>c] \r\n[>c] The End\r\n');
});

test('inline formatting round trips', function(){
  assertRoundTrip({ ops: [
    {insert: 'plain '},
    {insert: 'bold', attributes: {bold: true}},
    {insert: ' and '},
    {insert: 'italic', attributes: {italic: true}},
    {insert: '\n'}
  ]}, 'plain **bold** and *italic*\r\n');
});

test('a bullet list round trips, including an indented item', function(){
  assertRoundTrip({ ops: [
    {insert: 'one'},   {insert: '\n', attributes: {list: 'bullet'}},
    {insert: 'two'},   {insert: '\n', attributes: {list: 'bullet', indent: 1}},
    {insert: 'three'}, {insert: '\n', attributes: {list: 'bullet'}}
  ]}, '* one\r\n\t* two\r\n* three\r\n');
});

test('a nested numbered list restarts numbering at each level', function(){
  assertRoundTrip({ ops: [
    {insert: 'alpha'}, {insert: '\n', attributes: {list: 'ordered'}},
    {insert: 'sub a'}, {insert: '\n', attributes: {list: 'ordered', indent: 1}},
    {insert: 'sub b'}, {insert: '\n', attributes: {list: 'ordered', indent: 1}},
    {insert: 'beta'},  {insert: '\n', attributes: {list: 'ordered'}}
  ]}, '1. alpha\r\n\t1. sub a\r\n\t2. sub b\r\n2. beta\r\n');
});

test('a second numbered list starts again at one', function(){
  assertRoundTrip({ ops: [
    {insert: 'a'},   {insert: '\n', attributes: {list: 'ordered'}},
    {insert: 'b'},   {insert: '\n', attributes: {list: 'ordered'}},
    {insert: 'gap'}, {insert: '\n'},
    {insert: 'c'},   {insert: '\n', attributes: {list: 'ordered'}}
  ]}, '1. a\r\n2. b\r\ngap\r\n1. c\r\n');
});

//---------------------------------------------------------------------------
// space-indented list items (CommonMark-style)
//---------------------------------------------------------------------------

//How each line of a document parsed: its list level, or 'prose'. Enough to say what the indent
//rule did without asserting on whole deltas.
function levelsIn(mdf){
  return parseMDF(mdf).ops.filter(function(op){ return op.insert === '\n'; }).map(function(op){
    var a = op.attributes || {};
    return a.list ? a.list + '/' + (a.indent || 0) : 'prose';
  });
}

test('four spaces nest an item under the one above it', function(){
  assert.deepStrictEqual(levelsIn('* one\r\n    * two\r\n'), ['bullet/0', 'bullet/1']);
});

test('eight spaces nest it two levels, and deeper folds into the second', function(){
  assert.deepStrictEqual(levelsIn('* one\r\n        * two\r\n'), ['bullet/0', 'bullet/2']);
  assert.deepStrictEqual(levelsIn('* one\r\n            * two\r\n'), ['bullet/0', 'bullet/2']);
});

//A remainder of fewer than four spaces counts for nothing, so this is a sibling rather than a
//child - four spaces is one level, exactly as a tab is.
test('fewer than four spaces leaves an item at the level above', function(){
  assert.deepStrictEqual(levelsIn('* one\r\n  * two\r\n'), ['bullet/0', 'bullet/0']);
  assert.deepStrictEqual(levelsIn('* one\r\n      * two\r\n'), ['bullet/0', 'bullet/1']);
});

test('tabs and spaces count together', function(){
  assert.deepStrictEqual(levelsIn('* one\r\n\t    * two\r\n'), ['bullet/0', 'bullet/2']);
});

//The gate, and the reason it exists: fiction is full of space-indented paragraphs, and one that
//happens to open with a hyphen must not silently become a bullet.
test('a space indented marker is prose when nothing above it is a list item', function(){
  assert.deepStrictEqual(levelsIn('a paragraph of prose\r\n    - Get out, she said.\r\n'), ['prose', 'prose']);
});

test('a blank line ends the list, so what follows it is prose again', function(){
  assert.deepStrictEqual(levelsIn('* one\r\n\r\n    - Get out, she said.\r\n'), ['bullet/0', 'prose', 'prose']);
});

//Tabs and bare markers are ungated - they always were, and that has to stay true.
test('a tab indented or unindented marker is a list item wherever it appears', function(){
  assert.deepStrictEqual(levelsIn('prose\r\n\t- one\r\n'), ['prose', 'bullet/1']);
  assert.deepStrictEqual(levelsIn('prose\r\n- one\r\n'), ['prose', 'bullet/0']);
});

//The other half of the gate: prose that opens like an indented marker has to survive being written
//and read back even when it lands directly under a list item, where the gate would otherwise open.
test('space indented prose is escaped, so it stays prose next to a list item', function(){
  assertRoundTrip({ ops: [
    {insert: 'an item'}, {insert: '\n', attributes: {list: 'bullet'}},
    {insert: '    - Get out, she said.'}, {insert: '\n'}
  ]}, '* an item\r\n    \\- Get out, she said.\r\n');
});

test('a space indented list read from disk is written back with tabs', function(){
  var delta = parseMDF('* one\r\n    * two\r\n        * three\r\n');

  assert.strictEqual(convertDeltaToMDF(delta), '* one\r\n\t* two\r\n\t\t* three\r\n');
});

test('prose that opens like a list marker is escaped and comes back intact', function(){
  assertRoundTrip({ ops: [
    {insert: '- not a list, it is a dash'}, {insert: '\n'},
    {insert: '1984. A year, not a list item'}, {insert: '\n'}
  ]}, '\\- not a list, it is a dash\r\n\\1984. A year, not a list item\r\n');
});

test('a tab indented paragraph round trips', function(){
  assertRoundTrip({ ops: [ {insert: '\tIndented paragraph.'}, {insert: '\n'} ] },
    '\tIndented paragraph.\r\n');
});

//Regression: the escaping backslash written before a line-start list marker sits right after the
//paragraph's leading tabs, not at index 0 of the run - a tab-indented paragraph that merely opens
//like a list item used to come back with a literal backslash still in the text.
test('a tab indented paragraph that opens like a list marker is escaped and comes back intact', function(){
  assertRoundTrip({ ops: [ {insert: '\t- Blah'}, {insert: '\n'} ] },
    '\t\\- Blah\r\n');
});

//The text a parse produces, for the cases below where the .mdfc side is the interesting half and a
//full round trip would say less than the characters themselves do.
function textOf(mdf){
  return parseMDF(mdf).ops.map(function(op){ return op.insert; }).join('');
}

//The other half of the rule above, and the direction a wrong implementation breaks in: a backslash
//introduces a list-marker escape only when nothing but tabs precedes it. Anywhere else it is an
//ordinary character - the writer never puts one there, so consuming it would swallow a backslash
//somebody typed on purpose.
test('a backslash mid-line is not read as a list marker escape', function(){
  assert.strictEqual(textOf('a dash \\- stays a dash\r\n'), 'a dash \\- stays a dash\n');
});

test('tabs preceded by any other character are not a line start either', function(){
  assert.strictEqual(textOf('a\t\\- not a list\r\n'), 'a\t\\- not a list\n');
});

test('a list marker escape is still read after several leading tabs', function(){
  assert.strictEqual(textOf('\t\t\t\\- deeply indented dash\r\n'), '\t\t\t- deeply indented dash\n');
});

//"#", ">" and "[>" are block markers, read by ^-anchored regexes in parseLine, so they are only
//escaped where one could actually be read. escapeAnyMarkers used to escape all three everywhere,
//which put a backslash in the file for every "File > Dictionaries" and every "C#" a writer typed.

test('a block marker character mid-sentence is written unescaped and stays prose', function(){
  assertRoundTrip({ ops: [
    {insert: 'Use File > Dictionaries for that.'}, {insert: '\n'},
    {insert: 'The C# language, and the # sign.'}, {insert: '\n'},
    {insert: 'An [>c] marker mid-sentence.'}, {insert: '\n'}
  ]}, 'Use File > Dictionaries for that.\r\nThe C# language, and the # sign.\r\nAn [>c] marker mid-sentence.\r\n');
});

//The other half: at the position parseLine reads them from, the escape is load-bearing - without it
//each of these paragraphs would come back as a quotation, a heading or a centered line.
test('prose that opens with a block marker is escaped and comes back as prose', function(){
  assertRoundTrip({ ops: [
    {insert: '> not a quotation'}, {insert: '\n'},
    {insert: '# not a heading'},   {insert: '\n'},
    {insert: '[>c] not centered'}, {insert: '\n'}
  ]}, '\\> not a quotation\r\n\\# not a heading\r\n\\[>c] not centered\r\n');
});

//Only the marker's opening character needs the backslash - parseLine recognises a marker by it, so
//the rest of the run is left as typed.
test('only the first character of a repeated block marker is escaped', function(){
  assertRoundTrip({ ops: [
    {insert: '## not a heading either'}, {insert: '\n'},
    {insert: '>> not a quotation either'}, {insert: '\n'}
  ]}, '\\## not a heading either\r\n\\>> not a quotation either\r\n');
});

//parseLine strips the alignment and footnote-body markers before it looks for a list, blockquote or
//heading, so text sitting behind either of those is still at the position one would be read from.
test('prose behind an alignment or footnote body marker is still escaped', function(){
  assertRoundTrip({ ops: [
    {insert: '# not a heading'}, {insert: '\n', attributes: {align: 'center'}},
    {insert: '# not a heading'}, {insert: '\n', attributes: {footnoteBody: '1'}}
  ]}, '[>c] \\# not a heading\r\n[^1]: \\# not a heading\r\n');
});

//A line that carries a block marker of its own needs no escape behind it: parseLine has consumed
//that marker by then, and returns early for a list item or a quotation.
test('text behind a block marker of the line\'s own is not escaped', function(){
  assertRoundTrip({ ops: [
    {insert: '# hash in a heading'},    {insert: '\n', attributes: {header: 1}},
    {insert: '> arrow in a quotation'}, {insert: '\n', attributes: {blockquote: true}},
    {insert: '- dash in an item'},      {insert: '\n', attributes: {list: 'bullet'}}
  ]}, '# # hash in a heading\r\n> > arrow in a quotation\r\n* - dash in an item\r\n');
});

//A style marker moves the text off the position a block marker is read from, so it needs no escape
//there either.
test('a styled opening run is not escaped', function(){
  assertRoundTrip({ ops: [
    {insert: '> bold, not a quotation', attributes: {bold: true}}, {insert: '\n'}
  ]}, '**> bold, not a quotation**\r\n');
});

//Regression: the escape used to be gated on the run's index, so a paragraph whose first run was
//empty - which parseDelta does produce - had its marker written unescaped and came back a
//quotation. The gate is on what has actually been written to the line instead.
test('an empty opening run does not move the text off the line start', function(){
  assertRoundTrip({ ops: [
    {insert: ''}, {insert: '> not a quotation'}, {insert: '\n'}
  ]}, '\\> not a quotation\r\n');
});

//The reader is narrowed to match: an escape means something only where the marker would have, so a
//backslash in the middle of a sentence is a backslash. Files written before the escaping was
//narrowed show that backslash where they used to hide it, which is the accepted cost of "a \> b"
//meaning what it says.
test('a block marker escape mid-sentence is a literal backslash', function(){
  assert.strictEqual(textOf('Use File \\> Dictionaries.\r\n'), 'Use File \\> Dictionaries.\n');
  assert.strictEqual(textOf('The C\\# language.\r\n'), 'The C\\# language.\n');
  assert.strictEqual(textOf('An \\[>c] marker.\r\n'), 'An \\[>c] marker.\n');
});

//Indent puts a backslash at a list marker's position, but not at a heading's or a quotation's -
//HEADER_MARKER and BLOCKQUOTE_MARKER tolerate no indent, so there is no marker there to escape.
test('a block marker escape after indent is a literal backslash, though a list escape is not', function(){
  assert.strictEqual(textOf('\t\\> not an escape\r\n'), '\t\\> not an escape\n');
  assert.strictEqual(textOf('\t\\- an escaped list marker\r\n'), '\t- an escaped list marker\n');
});

//Inline escapes are unaffected: tokenizeInline reads those markers anywhere, so it honours an
//escape for one anywhere.
test('an inline style or footnote escape is still read anywhere in the line', function(){
  assert.strictEqual(textOf('not \\*italics\\* here\r\n'), 'not *italics* here\n');
  assert.strictEqual(textOf('not a footnote \\[^1] here\r\n'), 'not a footnote [^1] here\n');
});

//Position is not the whole of it: two of the three markers are narrower than the character they
//open with. HEADER_MARKER needs one to four "#" and a space, ALIGN_MARKER one of four letters and
//"] ", so prose that merely starts with the character is not a marker and needs no escape. Only
//BLOCKQUOTE_MARKER takes any leading ">" at all, which is why that one is always escaped.
test('an opening block marker character that could not be read as a marker is left unescaped', function(){
  assertRoundTrip({ ops: [
    {insert: '#hashtag, with no space'},   {insert: '\n'},
    {insert: '##### five is too many'},    {insert: '\n'},
    {insert: '[>x] is not an alignment'},  {insert: '\n'},
    {insert: '[>c]with no space either'},  {insert: '\n'}
  ]}, '#hashtag, with no space\r\n##### five is too many\r\n[>x] is not an alignment\r\n[>c]with no space either\r\n');
});

//A backslash is the escape character, so one the writer typed has to be doubled wherever
//consumeEscape would otherwise read it as an escape and take it off - which is what silently
//happened to a paragraph opening "\#". ESCAPABLE_ANYWHERE's own "\\" pattern hands it back.
test('a writer\'s backslash where an escape would be read is doubled and comes back whole', function(){
  assertRoundTrip({ ops: [
    {insert: '\\# not a heading'},   {insert: '\n'},
    {insert: '\\> not a quotation'}, {insert: '\n'},
    {insert: '\\- not a list item'}, {insert: '\n'},
    {insert: '\\*not italics*'},     {insert: '\n'}
  ]}, '\\\\# not a heading\r\n\\\\> not a quotation\r\n\\\\- not a list item\r\n\\\\\\*not italics\\*\r\n');
});

//Everywhere else it is left exactly as typed, which is the same narrowing the block markers got:
//a backslash that no escape could be read from is one character in the editor and one on disk.
test('a backslash no escape could be read from is written as itself', function(){
  assertRoundTrip({ ops: [
    {insert: 'a \\ b, and C:\\Users\\me'}, {insert: '\n'}
  ]}, 'a \\ b, and C:\\Users\\me\r\n');
});

//A backslash at the very end of a run is judged on what follows it on the line. A style marker is
//something consumeEscape reads a backslash off; a line ending is not, so the last run of a line
//with no style left to close needs nothing.
test('a backslash against a style marker is doubled, and one ending the line is not', function(){
  assertRoundTrip({ ops: [
    {insert: 'ends in a backslash \\'}, {insert: 'underlined', attributes: {underline: true}}, {insert: '\n'},
    {insert: 'and this one ends the line \\'}, {insert: '\n'}
  ]}, 'ends in a backslash \\\\__underlined__\r\nand this one ends the line \\\r\n');
});

test('parseMDF reads an escaped backslash as one backslash', function(){
  assert.strictEqual(textOf('\\\\# not a heading\r\n'), '\\# not a heading\n');
  assert.strictEqual(textOf('a \\\\ b\r\n'), 'a \\ b\n');
});

//An escape covers one character. It used to cover a whole two-character marker, which made "\**"
//mean two different things: an escaped "**", and an escaped "*" with a style marker behind it. The
//writer produced both spellings and the reader could only pick one, so a writer's own asterisk at
//the edge of a styled span came back doubled with the span's marker eaten.
test('an asterisk beside a style marker keeps its place on both sides', function(){
  assertRoundTrip({ ops: [
    {insert: 'see note*', attributes: {italic: true}}, {insert: '\n'}
  ]}, '*see note\\**\r\n');

  assertRoundTrip({ ops: [
    {insert: 'end', attributes: {italic: true}}, {insert: '*'}, {insert: 'start', attributes: {italic: true}},
    {insert: '\n'}
  ]}, '*end*\\**start*\r\n');
});

test('a literal two character marker is written as two escapes', function(){
  assertRoundTrip({ ops: [
    {insert: 'a **pair**, __one__ and ~~another~~'}, {insert: '\n'}
  ]}, 'a \\*\\*pair\\*\\*, \\_\\_one\\_\\_ and \\~\\~another\\~\\~\r\n');
});

//"_" and "~" are markers only in pairs, so one is escaped where the line would put it beside
//another - and left alone everywhere else, which is what keeps "snake_case" spelled as itself even
//inside an underlined run.
test('a lone underscore or tilde is escaped only where it would pair with a marker', function(){
  assertRoundTrip({ ops: [
    {insert: 'file_'}, {insert: 'name', attributes: {underline: true}}, {insert: '\n'}
  ]}, 'file\\___name__\r\n');

  assertRoundTrip({ ops: [
    {insert: '_', attributes: {underline: true}}, {insert: '\n'}
  ]}, '__\\___\r\n');

  assertRoundTrip({ ops: [
    {insert: 'snake_case', attributes: {underline: true}}, {insert: '\n'}
  ]}, '__snake_case__\r\n');

  assertRoundTrip({ ops: [
    {insert: 'the snake_case variable, approx~1900'}, {insert: '\n'}
  ]}, 'the snake_case variable, approx~1900\r\n');
});

//A marker does not have to sit inside one run - parseLine reads the assembled line - so the escape
//has to be decided against this run's text plus what follows it. Each case below is two runs that
//spell a marker between them though neither is one on its own. A delta straight from the editor
//merges runs that carry the same styles, but an imported or programmatically built one need not,
//and "1." followed by " item" was coming back a numbered list with its first characters eaten.
test('a marker completed across a run boundary is still escaped', function(){
  assertRoundTrip({ ops: [
    {insert: '1.'}, {insert: ' item'}, {insert: '\n'}
  ]}, '\\1. item\r\n');

  assertRoundTrip({ ops: [
    {insert: '[>c]'}, {insert: ' centered?'}, {insert: '\n'}
  ]}, '\\[>c] centered?\r\n');

  assertRoundTrip({ ops: [
    {insert: '##'}, {insert: ' heading?'}, {insert: '\n'}
  ]}, '\\## heading?\r\n');

  assertRoundTrip({ ops: [
    {insert: '~'}, {insert: '~tilde'}, {insert: '\n'}
  ]}, '\\~\\~tilde\r\n');

  assertRoundTrip({ ops: [
    {insert: 'a'}, {insert: '_'}, {insert: '_b'}, {insert: '\n'}
  ]}, 'a\\_\\_b\r\n');
});

//The backslash pass reads across the boundary for the same reason: the longest escapable sequence
//is three characters, so a backslash near the end of a run can be sitting in front of a marker the
//next run finishes, and it has to be doubled there too or the reader eats it.
test('a backslash in front of a marker completed by the next run is doubled', function(){
  assertRoundTrip({ ops: [
    {insert: '\\1'}, {insert: '. item'}, {insert: '\n'}
  ]}, '\\\\1. item\r\n');

  assertRoundTrip({ ops: [
    {insert: '\\'}, {insert: '- item'}, {insert: '\n'}
  ]}, '\\\\- item\r\n');
});

//A style marker cannot be escaped - the asterisk really is the marker - so where one would land at
//a list marker's position with a space behind it, the space moves in front of it instead. Without
//this the paragraph came back a bullet, having lost its italics and its space with it.
test('an italic run opening with a space does not become a bullet', function(){
  assertTextRoundTrip({ ops: [
    {insert: ' whispered the man', attributes: {italic: true}}, {insert: '\n'}
  ]}, ' *whispered the man*\r\n');

  assertRoundTrip({ ops: [
    {insert: ' '}, {insert: 'whispered the man', attributes: {italic: true}}, {insert: '\n'}
  ]}, ' *whispered the man*\r\n');
});

//The same at the head of an indented paragraph, where LIST_MARKER reads its marker after the tab.
test('an italic run opening with a space is safe behind indent too', function(){
  assertTextRoundTrip({ ops: [
    {insert: '\t'}, {insert: ' whispered the man', attributes: {italic: true}}, {insert: '\n'}
  ]}, '\t *whispered the man*\r\n');
});

//A run that is nothing but a space keeps the space and loses only a style flag it had no way of
//showing - it used to be written "* *", which came back an empty bullet.
test('an italic run that is only a space keeps the space', function(){
  assertTextRoundTrip({ ops: [
    {insert: ' ', attributes: {italic: true}}, {insert: '\n'}
  ]}, ' \r\n');
});

//The other half: a space inside a style span is not at either edge, so it stays where it is and the
//span is never broken into two.
test('a space inside a styled span does not move', function(){
  assertRoundTrip({ ops: [
    {insert: 'bold and ', attributes: {bold: true}},
    {insert: 'underlined', attributes: {bold: true, underline: true}},
    {insert: ' within', attributes: {bold: true}},
    {insert: '\n'}
  ]}, '**bold and __underlined__ within**\r\n');
});

test('a blockquote round trips', function(){
  assertRoundTrip({ ops: [
    {insert: 'Quoted line.'}, {insert: '\n', attributes: {blockquote: true}}
  ]}, '> Quoted line.\r\n');
});

//Regression: BLOCKQUOTE_MARKER required at least one character after "> ", so the optional space
//backtracked into the capture and a blank quoted line came back as a line containing one literal
//space instead of staying blank.
test('a blank blockquote line round trips without picking up a stray space', function(){
  assertRoundTrip({ ops: [
    {insert: ''}, {insert: '\n', attributes: {blockquote: true}}
  ]}, '> \r\n');
});

//Regression: getLineMarker wrote the alignment marker and then overwrote it with the block marker,
//so a centered quote or list item - which Quill holds happily, since align is a class on the block
//rather than a blot of its own - was written to disk as an ordinary quote or item and came back
//left-aligned. The alignment marker now leads, the way it always has in front of a heading.
test('a centered blockquote keeps its alignment through a round trip', function(){
  assertRoundTrip({ ops: [
    {insert: 'An epigraph.'}, {insert: '\n', attributes: {align: 'center', blockquote: true}}
  ]}, '[>c] > An epigraph.\r\n');
});

test('a right aligned and a justified blockquote keep their alignment too', function(){
  assertRoundTrip({ ops: [
    {insert: 'Attribution.'}, {insert: '\n', attributes: {align: 'right', blockquote: true}}
  ]}, '[>r] > Attribution.\r\n');

  assertRoundTrip({ ops: [
    {insert: 'A wide quote.'}, {insert: '\n', attributes: {align: 'justify', blockquote: true}}
  ]}, '[>j] > A wide quote.\r\n');
});

test('a blank blockquote line keeps its alignment', function(){
  assertRoundTrip({ ops: [
    {insert: '\n', attributes: {align: 'center', blockquote: true}}
  ]}, '[>c] > \r\n');
});

test('a centered list item keeps its alignment through a round trip', function(){
  assertRoundTrip({ ops: [
    {insert: 'A bullet.'}, {insert: '\n', attributes: {align: 'center', list: 'bullet'}}
  ]}, '[>c] * A bullet.\r\n');

  assertRoundTrip({ ops: [
    {insert: 'A number.'}, {insert: '\n', attributes: {align: 'center', list: 'ordered'}}
  ]}, '[>c] 1. A number.\r\n');
});

//The alignment marker leads the line, so the item's nesting indent sits between it and the list
//marker rather than at the very start of the line.
test('a nested list item carries its alignment in front of its indent', function(){
  assertRoundTrip({ ops: [
    {insert: 'Nested.'}, {insert: '\n', attributes: {align: 'center', list: 'bullet', indent: 1}}
  ]}, '[>c] \t* Nested.\r\n');

  assertRoundTrip({ ops: [
    {insert: 'Deeper.'}, {insert: '\n', attributes: {align: 'right', list: 'ordered', indent: 2}}
  ]}, '[>r] \t\t1. Deeper.\r\n');
});

test('parseMDF reads a blank blockquote line whether or not the marker keeps its trailing space', function(){
  var expected = { ops: [ {insert: '\n', attributes: {blockquote: true}} ] };

  assert.deepStrictEqual(normalizeDelta(parseMDF('>\n')), normalizeDelta(expected));
  assert.deepStrictEqual(normalizeDelta(parseMDF('> \n')), normalizeDelta(expected));
});

test('parseMDF reads list markers written with any bullet character', function(){
  ['-', '*', '+'].forEach(function(marker){
    var delta = parseMDF(marker + ' item\n');
    assert.deepStrictEqual(normalizeDelta(delta), {
      ops: [ {insert: 'item'}, {insert: '\n', attributes: {list: 'bullet'}} ]
    });
  });
});

test('parseMDF is not confused by quotes or apostrophes in the text', function(){
  var delta = parseMDF('She said "no" and didn\'t move.\n');
  assert.deepStrictEqual(normalizeDelta(delta), {
    ops: [ {insert: 'She said "no" and didn\'t move.'}, {insert: '\n'} ]
  });
});

//Regression: consecutive blank paragraphs used to collapse into a single blank line on reload,
//because the old blank-line regex matched a whole run of newlines at once no matter how many
//blank paragraphs it spanned.
test('several consecutive blank paragraphs all survive the round trip', function(){
  assertRoundTrip({ ops: [
    {insert: 'A'},   {insert: '\n'},
    {insert: ''},    {insert: '\n'},
    {insert: ''},    {insert: '\n'},
    {insert: ''},    {insert: '\n'},
    {insert: 'B'},   {insert: '\n'}
  ]}, 'A\r\n\r\n\r\n\r\nB\r\n');
});

//Regression: a line of prose that happened to start with "{" used to crash parseMDF, because the
//old implementation built a JSON string as it went and used "does this line start with {" as its
//only signal for "has this line already been converted".
test('a line starting with a curly brace does not crash the parser', function(){
  assertRoundTrip({ ops: [ {insert: '{some text}'}, {insert: '\n'} ] }, '{some text}\r\n');
});

//Regression: centered and right-aligned headings round-tripped, but a justified heading did not -
//there was no parser support for the "[>j] #" combination that convertDeltaToMDF itself produces,
//so the "# " came back as literal text and the heading attribute was lost.
test('a justified heading round trips', function(){
  assertRoundTrip({ ops: [
    {insert: 'Title'}, {insert: '\n', attributes: {align: 'justify', header: 1}}
  ]}, '[>j] # Title\r\n');
});

//Regression: a style span that contains a differently-styled span in its *middle* (not the whole
//span) used to lose its own attribute from the text on either side of the inner span, because each
//style was applied as its own whole-line replace pass and a later pass could match markers that had
//been embedded inside an earlier pass's already-built output.
test('a style nested in the middle of another style does not clobber it', function(){
  assertRoundTrip({ ops: [
    {insert: 'bold and ', attributes: {bold: true}},
    {insert: 'underlined', attributes: {bold: true, underline: true}},
    {insert: ' within', attributes: {bold: true}},
    {insert: '\n'}
  ]}, '**bold and __underlined__ within**\r\n');
});

//---------------------------------------------------------------------------
// footnotes
//---------------------------------------------------------------------------

test('a footnote marker and its body round trip', function(){
  assertRoundTrip({ ops: [
    {insert: 'See note'}, {insert: {footnote: {n: '1'}}}, {insert: ' here.'}, {insert: '\n'},
    {insert: 'The note.'}, {insert: '\n', attributes: {footnoteBody: '1'}}
  ]}, 'See note[^1] here.\r\n[^1]: The note.\r\n');
});

//The multi-paragraph convention documented in the Help doc: the same marker at the start of every
//paragraph belonging to the note, rather than Markdown's own tab-indented continuation.
//footnoteBodyCont marks the paragraphs of a note after its first, which is what decides whether a
//paragraph prints the note's number (see blots/footnotes.js). It is deliberately absent from the
//.mdfc, which already says the same thing by repeating "[^1]: " on every paragraph of the note -
//so it survives the round trip by being derived on the way back in, not by being written out.
test('a multi-paragraph footnote round trips, its continuation mark derived rather than stored', function(){
  assertRoundTrip({ ops: [
    {insert: 'Reference'}, {insert: {footnote: {n: '1'}}}, {insert: '\n'},
    {insert: 'First paragraph.'}, {insert: '\n', attributes: {footnoteBody: '1'}},
    {insert: 'Second paragraph.'}, {insert: '\n', attributes: {footnoteBody: '1', footnoteBodyCont: true}}
  ]}, 'Reference[^1]\r\n[^1]: First paragraph.\r\n[^1]: Second paragraph.\r\n');
});

//Regression: two separate notes are not one multi-paragraph note. Reading the second one's body as
//a continuation would leave it with no number in front of it - which is what the stylesheet used to
//do to every note after the first, since a sibling combinator cannot tell the two apart.
test('two consecutive single-paragraph notes are not read as one continued note', function(){
  assertRoundTrip({ ops: [
    {insert: 'One'}, {insert: {footnote: {n: '1'}}},
    {insert: ' two'}, {insert: {footnote: {n: '2'}}}, {insert: '\n'},
    {insert: 'First note.'}, {insert: '\n', attributes: {footnoteBody: '1'}},
    {insert: 'Second note.'}, {insert: '\n', attributes: {footnoteBody: '2'}}
  ]}, 'One[^1] two[^2]\r\n[^1]: First note.\r\n[^2]: Second note.\r\n');
});

//A footnote body that is also a list item: alignment > footnote > list/blockquote/header, per
//markdownFic.js's own comment on parseLine and getLineMarker.
test('a footnote body that is also a list item round trips', function(){
  assertRoundTrip({ ops: [
    {insert: 'Reference'}, {insert: {footnote: {n: '1'}}}, {insert: '\n'},
    {insert: 'a note that is also a bullet'}, {insert: '\n', attributes: {footnoteBody: '1', list: 'bullet'}}
  ]}, 'Reference[^1]\r\n[^1]: * a note that is also a bullet\r\n');
});

//A centered footnote body: alignment is the outermost marker and combines with everything after it,
//the same way it already does with list/blockquote/header.
test('a centered footnote body round trips', function(){
  assertRoundTrip({ ops: [
    {insert: 'Reference'}, {insert: {footnote: {n: '1'}}}, {insert: '\n'},
    {insert: 'a centered note'}, {insert: '\n', attributes: {footnoteBody: '1', align: 'center'}}
  ]}, 'Reference[^1]\r\n[>c] [^1]: a centered note\r\n');
});

//A blank footnote body paragraph (a writer left it empty, or it is mid-edit) keeps its marker
//rather than losing it - the (.*) in FOOTNOTE_BODY_MARKER exists for exactly this, matching how
//every other block marker in this file handles a blank line.
test('a blank footnote body paragraph keeps its marker', function(){
  assertRoundTrip({ ops: [
    {insert: 'Reference'}, {insert: {footnote: {n: '1'}}}, {insert: '\n'},
    {insert: ''}, {insert: '\n', attributes: {footnoteBody: '1'}}
  ]}, 'Reference[^1]\r\n[^1]: \r\n');
});

//Regression: escapeAnyMarkers used to escape every "[^" unconditionally, including a real marker's
//own rendering, which is what corrupted every footnote WareWoolf ever wrote (see the top of
//docs/footnotes-plan.md).
//
//A reference is "[^", digits and "]", and nothing less, so that is the only shape needing an escape
//when a writer types it as prose. A bare "[^" is not a marker in any position - tokenizeInline hands
//the bracket straight to the buffer - and escaping it wrote a backslash into the file for nothing.
test('a literal footnote reference typed as prose round trips escaped, distinct from a real marker', function(){
  assertRoundTrip({ ops: [
    {insert: 'a literal [^2] in prose, and a real'}, {insert: {footnote: {n: '2'}}}, {insert: ' marker'},
    {insert: '\n'}
  ]}, 'a literal \\[^2] in prose, and a real[^2] marker\r\n');
});

test('a "[^" that could never be read as a reference is written unescaped', function(){
  assertRoundTrip({ ops: [
    {insert: 'a literal [^ in prose, and a [^note] beside it'}, {insert: '\n'}
  ]}, 'a literal [^ in prose, and a [^note] beside it\r\n');
});

//A footnote reference keeps whatever inline style was active around it.
test('a footnote reference inside a bold run keeps the style on either side', function(){
  assertRoundTrip({ ops: [
    {insert: 'bold note', attributes: {bold: true}}, {insert: {footnote: {n: '1'}}, attributes: {bold: true}},
    {insert: ' still bold', attributes: {bold: true}},
    {insert: '\n'}
  ]}, '**bold note[^1] still bold**\r\n');
});
