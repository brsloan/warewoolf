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
