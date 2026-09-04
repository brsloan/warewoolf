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

test('a blockquote round trips', function(){
  assertRoundTrip({ ops: [
    {insert: 'Quoted line.'}, {insert: '\n', attributes: {blockquote: true}}
  ]}, '> Quoted line.\r\n');
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
