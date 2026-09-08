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
//docs/footnotes-plan.md). A literal "[^" a writer actually types as prose still has to come back
//escaped - it is not a marker, and tokenizeInline only recognises the unescaped form.
test('a literal "[^" typed as prose round trips escaped, distinct from a real marker', function(){
  assertRoundTrip({ ops: [
    {insert: 'a literal [^ in prose, and a real'}, {insert: {footnote: {n: '2'}}}, {insert: ' marker'},
    {insert: '\n'}
  ]}, 'a literal \\[^ in prose, and a real[^2] marker\r\n');
});

//A footnote reference keeps whatever inline style was active around it.
test('a footnote reference inside a bold run keeps the style on either side', function(){
  assertRoundTrip({ ops: [
    {insert: 'bold note', attributes: {bold: true}}, {insert: {footnote: {n: '1'}}, attributes: {bold: true}},
    {insert: ' still bold', attributes: {bold: true}},
    {insert: '\n'}
  ]}, '**bold note[^1] still bold**\r\n');
});
