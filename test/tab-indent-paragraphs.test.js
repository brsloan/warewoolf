require('./quill-dom-setup');

const test = require('node:test');
const assert = require('node:assert');

const { makeChapter, makeProject } = require('./helpers');
const { tabIndentParas, tabIndentParasInAllChaps, getDoNotIndentAfterDefs, getDefaultOptions } = require('../src/components/controllers/tab-indent-paragraphs');

//One argument per line. A bare string is an ordinary paragraph and '' is a blank line; head/item/
//quote wrap a line in the attributes that make it a heading, a list item or a block quotation.
function delta(){
  var ops = [];

  Array.prototype.forEach.call(arguments, function(line){
    var spec = typeof line == 'string' ? { text: line } : line;

    if(spec.text !== '')
      ops.push({ insert: spec.text });

    ops.push(spec.attributes ? { insert: '\n', attributes: spec.attributes } : { insert: '\n' });
  });

  return { ops: ops };
}

function head(text){ return { text: text, attributes: { header: 1 } }; }
function item(text){ return { text: text, attributes: { list: 'bullet' } }; }
function quote(text){ return { text: text, attributes: { blockquote: true } }; }

//The result as one string per line, which is what these tests are actually about - the attributes
//are never touched, only the tabs and the blank lines.
function lines(delt){
  var text = delt.ops.map(function(op){
    return typeof op.insert == 'string' ? op.insert : '';
  }).join('');

  var split = text.split('\n');

  //A Quill document always ends in a newline, so the split always leaves a trailing empty string
  //that is not a line of the document.
  if(split[split.length - 1] === '')
    split.pop();

  return split;
}

//Unticks the named "Do Not Indent After" boxes and leaves the rest at their defaults.
function unticking(){
  var doNotIndentAfter = {};

  Array.prototype.forEach.call(arguments, function(id){
    doNotIndentAfter[id] = false;
  });

  return { doNotIndentAfter: doNotIndentAfter };
}

//---- the defaults: every "Do Not Indent After" box ticked, tabs corrected, blank lines kept ----

test('tabIndentParas tabs a paragraph that follows another paragraph', function(){
  var result = tabIndentParas(delta('Opening paragraph.', 'Second paragraph.'));
  assert.strictEqual(result.changed, 1);
  assert.deepStrictEqual(lines(result.delta), ['Opening paragraph.', '\tSecond paragraph.']);
});

test('tabIndentParas is a no-op on a paragraph that already starts with a tab', function(){
  var result = tabIndentParas(delta('Opening paragraph.', '\tAlready tabbed.'));
  assert.strictEqual(result.changed, 0);
});

test('tabIndentParas does not indent a header line', function(){
  var result = tabIndentParas(delta(head('A Header')));
  assert.strictEqual(result.changed, 0);
});

test('tabIndentParas does not indent a list item', function(){
  var result = tabIndentParas(delta(item('Item')));
  assert.strictEqual(result.changed, 0);
});

//Regression: blockquotes get their own marker at export time (quill-utils.js and markdownFic.js
//both add one based on the blockquote attribute), so tabbing the text here would double it up.
test('tabIndentParas does not indent a blockquote', function(){
  var result = tabIndentParas(delta(quote('A quoted line.')));
  assert.strictEqual(result.changed, 0);
});

test('tabIndentParas leaves a blank line alone', function(){
  var result = tabIndentParas(delta('Para one.', ''));
  assert.strictEqual(result.changed, 0);
});

//The typographic rules the tool is named for, one per "Do Not Indent After" box: the indent
//separates a paragraph from the one above it, so a paragraph with nothing above it to be separated
//from is set flush at the margin.

test('tabIndentParas does not indent the first paragraph of a chapter', function(){
  var result = tabIndentParas(delta('Opening paragraph.'));
  assert.strictEqual(result.changed, 0);
});

test('tabIndentParas does not indent the first paragraph after a heading', function(){
  var result = tabIndentParas(delta(head('A Header'), 'Opening paragraph.'));
  assert.strictEqual(result.changed, 0);
});

test('tabIndentParas does not indent the first paragraph after a blank line', function(){
  var result = tabIndentParas(delta('Before the break.', '', 'After the break.', 'And on.'));
  assert.strictEqual(result.changed, 1);
  assert.deepStrictEqual(lines(result.delta), ['Before the break.', '', 'After the break.', '\tAnd on.']);
});

test('tabIndentParas does not indent the first paragraph after a blockquote', function(){
  var result = tabIndentParas(delta('Opening.', quote('A quoted line.'), 'Prose resumes.'));
  assert.strictEqual(result.changed, 0);
});

test('tabIndentParas does not indent the first paragraph after a list item', function(){
  var result = tabIndentParas(delta('Opening.', item('Item'), 'Prose resumes.'));
  assert.strictEqual(result.changed, 0);
});

//---- unticking a box puts those paragraphs back in the indent ----

test('unticking New Chapter indents the first paragraph of a chapter', function(){
  var result = tabIndentParas(delta('Opening paragraph.'), unticking('newChapter'));
  assert.deepStrictEqual(lines(result.delta), ['\tOpening paragraph.']);
});

test('unticking Headings indents the paragraph after a heading', function(){
  var result = tabIndentParas(delta(head('A Header'), 'Opening paragraph.'), unticking('headings'));
  assert.deepStrictEqual(lines(result.delta), ['A Header', '\tOpening paragraph.']);
});

test('unticking Blank Lines indents the paragraph after a blank line', function(){
  var result = tabIndentParas(delta('Before.', '', 'After.'), unticking('blankLines'));
  assert.deepStrictEqual(lines(result.delta), ['Before.', '', '\tAfter.']);
});

test('unticking Blockquotes indents the paragraph after a blockquote', function(){
  var result = tabIndentParas(delta('Opening.', quote('A quoted line.'), 'Prose resumes.'), unticking('blockquotes'));
  assert.deepStrictEqual(lines(result.delta), ['Opening.', 'A quoted line.', '\tProse resumes.']);
});

test('unticking Lists indents the paragraph after a list item', function(){
  var result = tabIndentParas(delta('Opening.', item('Item'), 'Prose resumes.'), unticking('lists'));
  assert.deepStrictEqual(lines(result.delta), ['Opening.', 'Item', '\tProse resumes.']);
});

//The boxes say what a paragraph may not be indented after. What a heading, a list item, a block
//quotation or a blank line does with its own line is not up for negotiation, whatever is ticked.
test('unticking every box still leaves headings, lists, quotations and blank lines un-indented', function(){
  var everyBox = getDoNotIndentAfterDefs().map(function(def){ return def.id; });
  var result = tabIndentParas(
    delta(head('A Header'), 'Opening.', item('Item'), quote('A quoted line.'), '', 'After the break.'),
    unticking.apply(null, everyBox)
  );

  assert.deepStrictEqual(lines(result.delta), ['A Header', '\tOpening.', 'Item', 'A quoted line.', '', '\tAfter the break.']);
});

//---- Correct Current Tabs ----

test('Correct Current Tabs strips the tab from a paragraph that should not be indented', function(){
  var result = tabIndentParas(delta(head('A Header'), '\tOpening paragraph.'));
  assert.strictEqual(result.changed, 1);
  assert.deepStrictEqual(lines(result.delta), ['A Header', 'Opening paragraph.']);
});

test('Correct Current Tabs strips every leading tab, not just the first', function(){
  var result = tabIndentParas(delta(head('A Header'), '\t\t\tOpening paragraph.'));
  assert.deepStrictEqual(lines(result.delta), ['A Header', 'Opening paragraph.']);
});

test('Correct Current Tabs leaves the tab on a paragraph that should be indented', function(){
  var result = tabIndentParas(delta('Opening.', '\tSecond paragraph.'));
  assert.strictEqual(result.changed, 0);
});

test('unticking Correct Current Tabs leaves a wrongly indented paragraph as it is', function(){
  var result = tabIndentParas(delta(head('A Header'), '\tOpening paragraph.'), { correctCurrentTabs: false });
  assert.strictEqual(result.changed, 0);
  assert.deepStrictEqual(lines(result.delta), ['A Header', '\tOpening paragraph.']);
});

//It corrects paragraphs, and a heading, a list item and a block quotation are not paragraphs. Their
//tabs are left to whatever put them there rather than stripped by a tool nobody asked to touch them.
test('Correct Current Tabs does not strip tabs from headings, list items or blockquotes', function(){
  var result = tabIndentParas(delta(head('\tA Header'), item('\tItem'), quote('\tA quoted line.')));
  assert.strictEqual(result.changed, 0);
  assert.deepStrictEqual(lines(result.delta), ['\tA Header', '\tItem', '\tA quoted line.']);
});

//---- Remove Blank Lines Between Paragraphs ----

function closingUp(delt){
  return tabIndentParas(delt, { removeBlankLinesBetweenParagraphs: true });
}

test('blank lines are kept unless the box is ticked', function(){
  var result = tabIndentParas(delta('Before.', '', 'After.'));
  assert.deepStrictEqual(lines(result.delta), ['Before.', '', 'After.']);
});

//The point of doing this before the indenting: with the blank line gone, the paragraph below it now
//follows a paragraph, and takes the tab that separates the two.
test('a single blank line between paragraphs is removed, and the paragraph below it is indented', function(){
  var result = closingUp(delta('Before.', '', 'After.'));
  assert.deepStrictEqual(lines(result.delta), ['Before.', '\tAfter.']);
});

test('a double blank line is condensed to a single one, and the paragraph below it stays flush', function(){
  var result = closingUp(delta('Before.', '', '', 'After.'));
  assert.deepStrictEqual(lines(result.delta), ['Before.', '', 'After.']);
});

test('a longer run of blank lines also condenses to a single one', function(){
  var result = closingUp(delta('Before.', '', '', '', '', 'After.'));
  assert.deepStrictEqual(lines(result.delta), ['Before.', '', 'After.']);
});

//Only a gap between two paragraphs is blog styling. The rest is layout, and closing it up would
//rearrange the chapter rather than restyle its paragraphs.
test('the blank line under a heading is left alone', function(){
  var result = closingUp(delta(head('A Header'), '', 'Opening paragraph.'));
  assert.deepStrictEqual(lines(result.delta), ['A Header', '', 'Opening paragraph.']);
});

test('the blank lines around a block quotation and a list are left alone', function(){
  var result = closingUp(delta('Before.', '', quote('A quoted line.'), '', item('Item'), '', 'After.'));
  assert.deepStrictEqual(lines(result.delta), ['Before.', '', 'A quoted line.', '', 'Item', '', 'After.']);
});

test('a blank line at the top or the bottom of a chapter is left alone', function(){
  var result = closingUp(delta('', 'Before.', 'After.', ''));
  assert.deepStrictEqual(lines(result.delta), ['', 'Before.', '\tAfter.', '']);
});

test('closing up a blog-styled chapter leaves book-style paragraphs behind', function(){
  var result = closingUp(delta(head('Chapter One'), '', 'The first.', '', 'The second.', '', 'The third.'));
  assert.deepStrictEqual(lines(result.delta), ['Chapter One', '', 'The first.', '\tThe second.', '\tThe third.']);
});

//---- defaults and options plumbing ----

test('getDefaultOptions has every rule on and blank-line removal off, matching the popup', function(){
  var defaults = getDefaultOptions();

  getDoNotIndentAfterDefs().forEach(function(def){
    assert.strictEqual(defaults.doNotIndentAfter[def.id], true, def.id + ' should default to on');
  });

  assert.strictEqual(defaults.correctCurrentTabs, true);
  assert.strictEqual(defaults.removeBlankLinesBetweenParagraphs, false);
});

//A key left out of the options object must fall back to its default rather than to false, or a
//partial options object would quietly switch rules off.
test('an options object missing a key falls back to the default for it', function(){
  var result = tabIndentParas(delta(head('A Header'), 'Opening paragraph.'), { doNotIndentAfter: { lists: false } });
  assert.strictEqual(result.changed, 0, 'Headings was not named, so it should still be on');
});

//---- project-wide ----

test('tabIndentParasInAllChaps only marks chapters that actually changed', async function(){
  var needsIndent = makeChapter(delta('Opening paragraph.', 'Second paragraph.'));
  var alreadyIndented = makeChapter(delta('Opening paragraph.', '\tAlready tabbed.'));

  var project = makeProject([needsIndent, alreadyIndented]);

  await tabIndentParasInAllChaps(project);

  assert.strictEqual(needsIndent.hasUnsavedChanges, true);
  assert.notStrictEqual(alreadyIndented.hasUnsavedChanges, true);
});

//Regression: same missing project-level flag as centerAllHeadingsInAllChaps.
test('tabIndentParasInAllChaps sets project.hasUnsavedChanges when a chapter changes', async function(){
  var project = makeProject([makeChapter(delta('Opening paragraph.', 'Second paragraph.'))]);

  await tabIndentParasInAllChaps(project);

  assert.strictEqual(project.hasUnsavedChanges, true);
});

test('tabIndentParasInAllChaps leaves project.hasUnsavedChanges alone when nothing changes', async function(){
  var project = makeProject([makeChapter(delta('Opening paragraph.', '\tAlready tabbed.'))]);

  await tabIndentParasInAllChaps(project);

  assert.notStrictEqual(project.hasUnsavedChanges, true);
});

test('tabIndentParasInAllChaps passes the popup options through to every chapter', async function(){
  var first = makeChapter(delta(head('One'), 'Opening paragraph.'));
  var second = makeChapter(delta(head('Two'), 'Opening paragraph.'));

  var project = makeProject([first, second]);

  await tabIndentParasInAllChaps(project, unticking('headings'));

  assert.deepStrictEqual(lines(first.contents), ['One', '\tOpening paragraph.']);
  assert.deepStrictEqual(lines(second.contents), ['Two', '\tOpening paragraph.']);
});
