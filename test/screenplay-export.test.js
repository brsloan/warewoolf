const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

//screenplay-export.js reads `new DOMParser()` as a bare global for FDX, the same way html-import.js
//does; jsdom supplies the same API here.
global.DOMParser = new JSDOM().window.DOMParser;

const { screenplayToPrintHtml, elementsToFdx, parseFdx } = require('../src/components/controllers/screenplay-export');
const { parseFountain, serializeFountain } = require('../src/components/controllers/fountain');

//docs/screenplay-plan.md, Phase 7: the print page and Final Draft's FDX, both ways.

const SCRIPT = 'Title: Test\nCredit: written by\nAuthor: Me\nDraft date: 1/1/2026\nContact: me@example.com\n\n' +
  'INT. A - DAY\n\nA *quiet* room.\nStill quiet.\n\nBOB\n(low)\nHi & bye.\n\nJANE ^\nHello.\n\n' +
  '# Act Two\n\n[[a note]]\n\n===\n\n> THE END <\n';

//---- print ---------------------------------------------------------------------------------------

test('the print page lays the script out with the format\'s classes and leaves the writer\'s notes off', function(){
  var parsed = parseFountain(SCRIPT);
  var html = screenplayToPrintHtml(parsed.titlePage, parsed.elements);

  assert.match(html, /<title>Test<\/title>/);
  assert.match(html, /<div class="title-page">/);
  assert.match(html, /<p class="title">Test<\/p><p class="credit">written by<\/p><p class="author">Me<\/p>/);
  assert.match(html, /<div class="contact"><p>me@example.com<\/p><\/div>/);
  assert.match(html, /<div class="date"><p>1\/1\/2026<\/p><\/div>/);

  assert.match(html, /<p class="scene">INT. A - DAY<\/p>/);
  assert.match(html, /<p class="action">A <em>quiet<\/em> room.<\/p><p class="action tight">Still quiet.<\/p>/);
  assert.match(html, /<p class="character">BOB<\/p><p class="parenthetical">\(low\)<\/p><p class="dialogue">Hi &amp; bye.<\/p>/);
  assert.match(html, /<p class="character">JANE<\/p>/, 'the dual mark is not drawn');
  assert.match(html, /<div class="pagebreak"><\/div><p class="centered">THE END<\/p>/);
  assert.doesNotMatch(html, /Act Two|a note/);
  assert.match(html, /margin-left: 2\.2in/, 'cues at 3.7in from the edge with the page margin');
});

test('a script with no title page prints without one', function(){
  var html = screenplayToPrintHtml([], parseFountain('INT. A - DAY\n').elements);
  assert.doesNotMatch(html, /<div class="title-page">/);
  assert.match(html, /<title>Screenplay<\/title>/);
});

//---- FDX out -------------------------------------------------------------------------------------

test('elementsToFdx writes one typed paragraph per element, styled runs, a page start and a dual group', function(){
  var parsed = parseFountain(SCRIPT);
  var fdx = elementsToFdx(parsed.titlePage, parsed.elements);

  assert.match(fdx, /^<\?xml version="1.0"/);
  assert.match(fdx, /<Paragraph Type="Scene Heading">\s*<Text>INT. A - DAY<\/Text>/);
  assert.match(fdx, /<Text>A <\/Text>\s*<Text Style="Italic">quiet<\/Text>\s*<Text> room.<\/Text>/);
  assert.match(fdx, /<Text>Hi &amp; bye.<\/Text>/);
  assert.match(fdx, /<DualDialogue>\s*<Paragraph Type="Character">\s*<Text>BOB<\/Text>[\s\S]*?<Paragraph Type="Character">\s*<Text>JANE<\/Text>[\s\S]*?<Text>Hello.<\/Text>\s*<\/Paragraph>\s*<\/DualDialogue>/);
  assert.match(fdx, /<Paragraph Type="Action" Alignment="Center" StartsNewPage="Yes">\s*<Text>THE END<\/Text>/);
  assert.doesNotMatch(fdx, /Act Two|a note/);
  assert.match(fdx, /<TitlePage>[\s\S]*<Paragraph Alignment="Center">\s*<Text>Test<\/Text>[\s\S]*<Paragraph Alignment="Right">\s*<Text>1\/1\/2026<\/Text>/);
});

//---- FDX in --------------------------------------------------------------------------------------

test('parseFdx reads the paragraphs back as elements, and a round trip through FDX keeps the script', function(){
  var parsed = parseFountain(SCRIPT);
  var back = parseFdx(elementsToFdx(parsed.titlePage, parsed.elements));

  //What FDX cannot carry - the section and the note - is gone; everything else is as it was.
  var expected = parsed.elements.filter(function(e){ return e.type !== 'section' && e.type !== 'note'; });
  assert.deepStrictEqual(back.elements.map(function(e){ return [e.type, e.text, Boolean(e.dual)]; }),
    expected.map(function(e){ return [e.type, e.text, Boolean(e.dual)]; }));
  assert.deepStrictEqual(back.elements[1].runs, expected[1].runs, 'inline styles survive');

  assert.deepStrictEqual(back.titlePage, [
    { key: 'Title', values: ['Test'] },
    { key: 'Credit', values: ['written by'] },
    { key: 'Author', values: ['Me'] },
    { key: 'Notes', values: ['me@example.com', '1/1/2026'] }
  ]);

  //And on out to Fountain, which is where an imported script ends up.
  assert.match(serializeFountain(back.titlePage, back.elements), /^Title: Test\nCredit: written by\nAuthor: Me\n/);
});

test('parseFdx maps Final Draft\'s other types to action, reads centred action as centered, and refuses what is not FDX', function(){
  var fdx = '<?xml version="1.0"?><FinalDraft DocumentType="Script"><Content>' +
    '<Paragraph Type="General"><Text Style="Bold">FADE IN</Text></Paragraph>' +
    '<Paragraph Type="Shot"><Text>ANGLE ON</Text></Paragraph>' +
    '<Paragraph Type="Action" Alignment="Center"><Text>THE END</Text></Paragraph>' +
    '<Paragraph Type="Action"><Text>two</Text><Text>\nlines</Text></Paragraph>' +
    '</Content></FinalDraft>';
  var parsed = parseFdx(fdx);

  assert.deepStrictEqual(parsed.elements.map(function(e){ return [e.type, e.text]; }),
    [['action', 'FADE IN'], ['scene', 'ANGLE ON'], ['centered', 'THE END'], ['action', 'two lines']]);
  assert.deepStrictEqual(parsed.elements[0].runs, [{ text: 'FADE IN', attributes: { bold: true } }]);
  assert.deepStrictEqual(parsed.titlePage, []);

  assert.throws(function(){ parseFdx('<html><body>no</body></html>'); }, /Final Draft/);
});

const BIG_FISH_FDX = path.join(__dirname, '..', 'screenplay', 'Big-Fish.fdx');

test('Big Fish: the FDX reads to the same counts the oracle test pins for the Fountain', { skip: !fs.existsSync(BIG_FISH_FDX) && 'screenplay/Big-Fish.fdx is not present' }, function(){
  var parsed = parseFdx(fs.readFileSync(BIG_FISH_FDX, 'utf8'));
  var counts = {};
  parsed.elements.forEach(function(e){ counts[e.type] = (counts[e.type] || 0) + 1; });

  assert.strictEqual(counts.scene, 202);
  assert.strictEqual(counts.character, 768);
  assert.strictEqual(counts.parenthetical, 97);
  assert.strictEqual(counts.transition, 36);
  //813 Dialogue paragraphs plus 2 General ones read as action, alongside the 850 Action.
  assert.strictEqual(counts.dialogue, 813);
  assert.strictEqual(counts.action, 852);
  assert.strictEqual(parsed.titlePage[0].key, 'Title');
  assert.strictEqual(parsed.titlePage[0].values[0], 'Big Fish');

  //Out to Fountain and back in: the same elements, less what Fountain has no way to write. Final
  //Draft keeps empty action paragraphs, which the serializer drops, and it lets a speech stand
  //with no cue over it, which Fountain reads as action - or, empty, as the blank line it is.
  var fountain = serializeFountain(parsed.titlePage, parsed.elements);
  var again = parseFountain(fountain);
  var expected = [];
  var inGroup = false;
  parsed.elements.forEach(function(e){
    var speech = e.type === 'dialogue' || e.type === 'parenthetical' || e.type === 'lyric';
    if(e.type === 'action' && e.text.trim() === '')
      return;
    if(speech && !inGroup){
      if(e.text.trim() !== '')
        expected.push('action');
      return;
    }
    expected.push(e.type);
    inGroup = e.type === 'character' || (inGroup && speech);
  });
  assert.deepStrictEqual(again.elements.map(function(e){ return e.type; }), expected);
});

//---- Fade In in ----------------------------------------------------------------------------------

const { parseFadeIn } = require('../src/components/controllers/screenplay-export');

const FADEIN = '<?xml version="1.0" encoding="UTF-8"?>\n<document type="Open Screenplay Format document" version="50">\n' +
  '<paragraphs>\n' +
  '<para><style basestyle="Normal Text"/><text font="Courier" size="12" bold="1">FADE IN</text></para>\n' +
  '<para number="1"><style basestyle="Scene Heading"/><text>INT. A - DAY</text></para>\n' +
  '<para><style basestyle="Action"/><text>A </text><text italic="1">quiet</text><text> room.</text></para>\n' +
  '<para><style basestyle="Character" dualdialogue="1"/><text>BOB</text></para>\n' +
  '<para><style basestyle="Parenthetical"/><text>(low)</text></para>\n' +
  '<para><style basestyle="Dialogue"/><text>Hi &amp; bye.</text></para>\n' +
  '<para><style basestyle="Character"/><text>JANE</text></para>\n' +
  '<para><style basestyle="Singing"/><text>La la</text></para>\n' +
  '<para><style basestyle="Shot"/><text>CLOSE ON the door.</text></para>\n' +
  '<para><style basestyle="My Own Style"/><text>Whatever this is.</text></para>\n' +
  '<para><style basestyle="Transition"/><text>CUT TO:</text></para>\n' +
  '<para><style basestyle="Action" align="center" pagebreakbefore="1"/><text underline="1">THE END</text></para>\n' +
  '</paragraphs>\n' +
  '<titlepage>\n' +
  '<para><style basestyle="Normal Text" align="center"/><text font="Capitals" size="36"></text></para>\n' +
  '<para><style basestyle="Normal Text" align="center"/><text font="Capitals" size="36">Test</text></para>\n' +
  '<para><style basestyle="Normal Text" align="center"/><text>written by</text></para>\n' +
  '<para><style basestyle="Normal Text" align="center"/><text>Me</text></para>\n' +
  '<para><style basestyle="Normal Text" align="center"/><text>based on nothing</text></para>\n' +
  '<para><style basestyle="Normal Text" align="right"/><text>FIRST DRAFT</text></para>\n' +
  '<para><style basestyle="Normal Text"/><text>Copyright © 2026 Me</text></para>\n' +
  '</titlepage>\n' +
  '</document>\n';

test('parseFadeIn reads the paragraphs as elements by their style, with runs, a centred end, a page break and a dual pair', function(){
  var parsed = parseFadeIn(FADEIN);

  assert.deepStrictEqual(parsed.elements.map(function(e){ return [e.type, e.text, Boolean(e.dual)]; }), [
    ['action', 'FADE IN', false],
    ['scene', 'INT. A - DAY', false],
    ['action', 'A quiet room.', false],
    ['character', 'BOB', false],
    ['parenthetical', '(low)', false],
    ['dialogue', 'Hi & bye.', false],
    ['character', 'JANE', true],
    ['lyric', 'La la', false],
    ['scene', 'CLOSE ON the door.', false],
    ['action', 'Whatever this is.', false],
    ['transition', 'CUT TO:', false],
    ['pagebreak', '', false],
    ['centered', 'THE END', false]
  ]);
  assert.deepStrictEqual(parsed.elements[0].runs, [{ text: 'FADE IN', attributes: { bold: true } }]);
  assert.deepStrictEqual(parsed.elements[2].runs, [{ text: 'A ' }, { text: 'quiet', attributes: { italic: true } }, { text: ' room.' }]);
  assert.deepStrictEqual(parsed.elements[12].runs, [{ text: 'THE END', attributes: { underline: true } }]);

  assert.deepStrictEqual(parsed.titlePage, [
    { key: 'Title', values: ['Test'] },
    { key: 'Credit', values: ['written by'] },
    { key: 'Author', values: ['Me'] },
    { key: 'Source', values: ['based on nothing'] },
    { key: 'Copyright', values: ['Copyright © 2026 Me'] },
    { key: 'Notes', values: ['FIRST DRAFT'] }
  ]);

  //And on out to Fountain, which is where an imported script ends up: the dual mark lands on the
  //second speaker, and the page break and the centred line are spelled as Fountain spells them.
  var fountain = serializeFountain(parsed.titlePage, parsed.elements);
  assert.match(fountain, /^Title: Test\nCredit: written by\nAuthor: Me\nSource: based on nothing\nCopyright: Copyright © 2026 Me\n/);
  assert.match(fountain, /\nBOB\n\(low\)\nHi & bye\.\n\nJANE \^\n~La la\n/);
  assert.match(fountain, /\n===\n\n> _THE END_ <\n/);
});

test('parseFadeIn reads the format\'s public spellings of the same marks, and refuses what is not a Fade In document', function(){
  var parsed = parseFadeIn('<document type="Open Screenplay Format document" version="21"><paragraphs>' +
    '<para><style baseStyleName="Action"/><text>One.</text></para>' +
    '<para dualDialogue="1"><style baseStyleName="Character"/><text>A</text></para>' +
    '<para><style baseStyleName="Dialogue"/><text>Hi.</text></para>' +
    '<para dualDialogue="1"><style baseStyleName="Character"/><text>B</text></para>' +
    '<para><style baseStyleName="Dialogue"/><text>Ho.</text></para>' +
    '<para><style baseStyleName="Scene Heading" pageBreakBefore="1"/><text>INT. B - NIGHT</text></para>' +
    '</paragraphs></document>');

  assert.deepStrictEqual(parsed.elements.map(function(e){ return [e.type, Boolean(e.dual)]; }), [
    ['action', false], ['character', false], ['dialogue', false], ['character', true], ['dialogue', false],
    ['pagebreak', false], ['scene', false]
  ]);
  assert.deepStrictEqual(parsed.titlePage, []);

  assert.throws(function(){ parseFadeIn('<FinalDraft><Content/></FinalDraft>'); }, /Fade In/);
  assert.throws(function(){ parseFadeIn('<document type="something else"/>'); }, /Fade In/);
});

//A .fadein saved from Fade In itself, opened the way the app's platform command opens one
//(platform-node.js's importEpub): unzipper reading one entry's bytes, extracting nothing.
async function readFadeInArchive(filepath){
  var unzipper = require('unzipper');
  var directory = await unzipper.Open.file(filepath);
  var entry = directory.files.find(function(file){ return file.path === 'document.xml'; });
  return (await entry.buffer()).toString('utf8');
}

const DUAL_FADEIN = path.join(__dirname, '..', 'screenplay', 'dual.fadein');

test('a script saved by Fade In spells the dual mark on the first cue and the page break on the paragraph after it', { skip: !fs.existsSync(DUAL_FADEIN) && 'screenplay/dual.fadein is not present' }, async function(){
  var parsed = parseFadeIn(await readFadeInArchive(DUAL_FADEIN));

  assert.deepStrictEqual(parsed.elements.map(function(e){ return [e.type, e.text, Boolean(e.dual)]; }), [
    ['action', 'FADE IN:', false],
    ['scene', 'int. house - day', false],
    ['action', 'Blah blah', false],
    ['transition', 'CUT TO:', false],
    ['scene', 'INT. Castle - day', false],
    ['action', 'Two women talk.', false],
    ['character', 'jane', false],
    ['dialogue', 'What were you--', false],
    ['character', 'emily', true],
    ['dialogue', 'I didn\'t--', false],
    ['action', 'They talk over each other.', false],
    ['action', 'It\'s a long conversation...', false],
    ['pagebreak', '', false],
    ['scene', 'Ext. castle - night', false],
    ['action', 'Blah', false]
  ]);
  //Fade In's template title page names what each paragraph holds, and soft-returns inside one.
  assert.deepStrictEqual(parsed.titlePage, [
    { key: 'Title', values: ['TITLE'] },
    { key: 'Credit', values: ['Written by'] },
    { key: 'Author', values: ['Author\'s Name'] },
    { key: 'Copyright', values: ['Copyright (c) 2026'] },
    { key: 'Draft date', values: ['Draft', 'information'] },
    { key: 'Contact', values: ['Contact', 'information'] }
  ]);

  var fountain = serializeFountain(parsed.titlePage, parsed.elements);
  assert.match(fountain, /^Title: TITLE\nCredit: Written by\nAuthor: Author's Name\nCopyright: Copyright \(c\) 2026\nDraft date:\n\tDraft\n\tinformation\nContact:\n\tContact\n\tinformation\n\n/);
  assert.match(fountain, /\n@emily \^\nI didn't--\n[\s\S]*\n===\n\nExt\. castle - night\n/);
});

test('parseFadeIn reads a soft return inside a paragraph as a tight line, or joins it where the element cannot continue', function(){
  var parsed = parseFadeIn('<document type="Open Screenplay Format document" version="50"><paragraphs>' +
    '<para><style basestyle="Scene Heading"/><text>INT. A -\nDAY</text></para>' +
    '<para><style basestyle="Character"/><text>BOB</text></para>' +
    '<para><style basestyle="Dialogue"/><text>One </text><text bold="1">two\nthree</text><text> four.</text></para>' +
    '<para><style basestyle="Action"/><text>Then.</text></para>' +
    '</paragraphs></document>');

  assert.deepStrictEqual(parsed.elements.map(function(e){ return [e.type, e.text, Boolean(e.tight)]; }), [
    ['scene', 'INT. A - DAY', false],
    ['character', 'BOB', false],
    ['dialogue', 'One two', false],
    ['dialogue', 'three four.', true],
    ['action', 'Then.', false]
  ]);
  assert.deepStrictEqual(parsed.elements[2].runs, [{ text: 'One ' }, { text: 'two', attributes: { bold: true } }]);
  assert.deepStrictEqual(parsed.elements[3].runs, [{ text: 'three', attributes: { bold: true } }, { text: ' four.' }]);
  assert.match(serializeFountain([], parsed.elements), /\nBOB\nOne \*\*two\*\*\n\*\*three\*\* four\.\n\nThen\.\n/);
});

const BIG_FISH_FADEIN = path.join(__dirname, '..', 'screenplay', 'Big-Fish.fadein');

test('Big Fish: the Fade In document reads to the same counts as the FDX, and its title page to keys', { skip: !fs.existsSync(BIG_FISH_FADEIN) && 'screenplay/Big-Fish.fadein is not present' }, async function(){
  var parsed = parseFadeIn(await readFadeInArchive(BIG_FISH_FADEIN));
  var counts = {};
  parsed.elements.forEach(function(e){ counts[e.type] = (counts[e.type] || 0) + 1; });

  assert.strictEqual(counts.scene, 202);
  assert.strictEqual(counts.character, 768);
  assert.strictEqual(counts.parenthetical, 97);
  assert.strictEqual(counts.transition, 36);
  assert.strictEqual(counts.dialogue, 813);
  //The FDX's 852: Fade In's Action paragraphs plus its two Normal Text ones (the opening FADE IN
  //and an empty line), less the centred BIG FISH, which reads as centered alongside THE END.
  assert.strictEqual(counts.action, 852);
  assert.strictEqual(counts.centered, 2);
  assert.strictEqual(counts.pagebreak, undefined);

  assert.deepStrictEqual(parsed.titlePage.slice(0, 5), [
    { key: 'Title', values: ['Big Fish'] },
    { key: 'Credit', values: ['written by'] },
    { key: 'Author', values: ['John August'] },
    { key: 'Source', values: ['based on the novel by Daniel Wallace'] },
    { key: 'Copyright', values: ['Copyright © 2003 Columbia Pictures'] }
  ]);
  assert.strictEqual(parsed.titlePage[5].key, 'Notes');
});
