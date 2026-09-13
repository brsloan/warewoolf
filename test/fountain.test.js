const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  parseFountain,
  serializeFountain,
  elementsToDelta,
  deltaToElements,
  tokenizeInline,
  classifyLine,
  estimatePages,
  estimatePageStarts,
  getTitlePageValues,
  setTitlePageValues,
  sanitizeTitlePage
} = require('../src/components/controllers/fountain');

//Every rule in docs/screenplay-plan.md's classifier table, one case each, on the smallest input
//that exercises it - followed by the round-trip properties that matter most: the element list is
//the editor's truth, so a list that survives serializeFountain -> parseFountain unchanged is what
//keeps a script from drifting on every save.

function types(text){
  return parseFountain(text).elements.map(function(e){ return e.type; });
}

function texts(text){
  return parseFountain(text).elements.map(function(e){ return e.text; });
}

function assertFixedPoint(text){
  var once = parseFountain(text);
  var written = serializeFountain(once.titlePage, once.elements);
  var twice = parseFountain(written);
  assert.deepStrictEqual(twice, once, 'parse -> serialize -> parse was not a fixed point for:\n' + written);
  return written;
}

//---- title page ---------------------------------------------------------------------------------

test('a title page is read off the top of the document, in order, with multi-line values', function(){
  var parsed = parseFountain('Title: Big Fish\nCredit: written by\nNotes:\t\n\tFINAL DRAFT\n\tomitted scenes\nCopyright: (c) 2003\n\nFADE IN:\n\nA RIVER.\n');

  assert.deepStrictEqual(parsed.titlePage, [
    { key: 'Title', values: ['Big Fish'] },
    { key: 'Credit', values: ['written by'] },
    { key: 'Notes', values: ['FINAL DRAFT', 'omitted scenes'] },
    { key: 'Copyright', values: ['(c) 2003'] }
  ]);
  assert.deepStrictEqual(parsed.elements.map(function(e){ return e.text; }), ['FADE IN:', 'A RIVER.']);
});

test('a script that opens with FADE IN: has no title page', function(){
  var parsed = parseFountain('FADE IN:\n\nINT. HOUSE - DAY\n');
  assert.deepStrictEqual(parsed.titlePage, []);
  assert.deepStrictEqual(parsed.elements.map(function(e){ return e.type; }), ['action', 'scene']);
});

test('the title page is written back with one-line and indented multi-line values', function(){
  var page = [{ key: 'Title', values: ['Big Fish'] }, { key: 'Notes', values: ['one', 'two'] }];
  assert.strictEqual(serializeFountain(page, []), 'Title: Big Fish\nNotes:\n\tone\n\ttwo\n');
  assert.deepStrictEqual(parseFountain(serializeFountain(page, [])).titlePage, page);
});

test('title page helpers look keys up case-insensitively and replace in place', function(){
  var page = [{ key: 'Title', values: ['A'] }, { key: 'Draft date', values: ['1/1'] }];
  assert.deepStrictEqual(getTitlePageValues(page, 'draft DATE'), ['1/1']);
  assert.deepStrictEqual(getTitlePageValues(page, 'Author'), []);

  var updated = setTitlePageValues(page, 'title', ['B']);
  assert.deepStrictEqual(updated, [{ key: 'Title', values: ['B'] }, { key: 'Draft date', values: ['1/1'] }]);
  assert.deepStrictEqual(page[0].values, ['A'], 'the original list is not edited');

  assert.deepStrictEqual(setTitlePageValues(page, 'Author', ['Me']).map(function(e){ return e.key; }), ['Title', 'Draft date', 'Author']);
  assert.deepStrictEqual(setTitlePageValues(page, 'Title', ['  ']).map(function(e){ return e.key; }), ['Draft date'], 'empty values remove the key');
});

test('sanitizeTitlePage keeps only shapes the serializer can write', function(){
  assert.deepStrictEqual(sanitizeTitlePage('nope'), []);
  assert.deepStrictEqual(sanitizeTitlePage([{ key: ' Title ', values: ['a', 3, 'b'] }, { key: '', values: [] }, { key: 'X', values: 'str' }, null]),
    [{ key: 'Title', values: ['a', 'b'] }]);
});

//---- the classifier, one rule at a time ----------------------------------------------------------

test('scene headings need a blank line before them and one of the spec prefixes', function(){
  assert.deepStrictEqual(types('INT. HOUSE - DAY\n'), ['scene']);
  assert.deepStrictEqual(types('ext. yard - night\n'), ['scene']);
  assert.deepStrictEqual(types('EST. CITY\n'), ['scene']);
  assert.deepStrictEqual(types('INT./EXT. CAR - DAY\n'), ['scene']);
  assert.deepStrictEqual(types('I/E CAR - DAY\n'), ['scene']);
  assert.deepStrictEqual(types('EXT/INT. SHACK - DAY\n'), ['scene']);
  assert.deepStrictEqual(types('Action line.\nINT. HOUSE - DAY\n'), ['action', 'action'], 'no blank line before it');
  assert.deepStrictEqual(types('INT\n'), ['action'], 'the prefix alone is not a heading');
  assert.deepStrictEqual(types('INTERIOR DESIGN\n'), ['action'], 'the prefix must be followed by . space or -');
});

test('a forced scene heading is a dot, but not two', function(){
  assert.deepStrictEqual(texts('.SNIPER SCOPE POV\n'), ['SNIPER SCOPE POV']);
  assert.deepStrictEqual(types('.SNIPER SCOPE POV\n'), ['scene']);
  assert.deepStrictEqual(types('...and then.\n'), ['action']);
});

test('scene numbers stay in the heading text', function(){
  assert.deepStrictEqual(texts('INT. HOUSE - DAY #1a#\n'), ['INT. HOUSE - DAY #1a#']);
});

test('a character cue is a capitalised line with text after it, and an extension may be any case', function(){
  assert.deepStrictEqual(types('BOB\nHello.\n'), ['character', 'dialogue']);
  assert.deepStrictEqual(types("BOB (cont'd)\nHello.\n"), ['character', 'dialogue']);
  assert.deepStrictEqual(types('BOB (V.O.)(CONT\'D)\nHello.\n'), ['character', 'dialogue']);
  assert.deepStrictEqual(types('BOB\n\nHello.\n'), ['action', 'action'], 'a cue needs a line after it');
  assert.deepStrictEqual(types('Action.\nBOB\nHello.\n'), ['action', 'action', 'action'], 'a cue needs a blank line before it');
  assert.deepStrictEqual(types('911\nHello.\n'), ['action', 'action'], 'a cue needs a letter');
  assert.deepStrictEqual(types('Bob\nHello.\n'), ['action', 'action'], 'a cue is all capitals');
});

test('a forced character cue is @, and the dual-dialogue caret is read off and flagged', function(){
  var parsed = parseFountain('@McCLANE\nYippee.\n\nBOB ^\nHi.\n');
  assert.deepStrictEqual(parsed.elements.map(function(e){ return [e.type, e.text, Boolean(e.dual)]; }), [
    ['character', 'McCLANE', false], ['dialogue', 'Yippee.', false],
    ['character', 'BOB', true], ['dialogue', 'Hi.', false]
  ]);
});

test('a dialogue group is parentheticals, dialogue and lyrics until a blank line', function(){
  assert.deepStrictEqual(types('BOB\n(quietly)\nHello.\n~la la\n(louder)\nHELLO.\n\nAction.\n'),
    ['character', 'parenthetical', 'dialogue', 'lyric', 'parenthetical', 'dialogue', 'action']);
  assert.deepStrictEqual(texts('BOB\n(quietly)\n~la la\n'), ['BOB', '(quietly)', 'la la']);
});

test('inside dialogue, force markers are spoken text', function(){
  assert.deepStrictEqual(types('BOB\n!Wow.\n.Really.\n'), ['character', 'dialogue', 'dialogue']);
  assert.deepStrictEqual(texts('BOB\n!Wow.\n'), ['BOB', '!Wow.']);
});

test('two spaces alone is a blank line inside dialogue, and a blank line outside it', function(){
  var parsed = parseFountain('BOB\nOne.\n  \nTwo.\n\n  \nAction.\n');
  assert.deepStrictEqual(parsed.elements.map(function(e){ return [e.type, e.text, Boolean(e.tight)]; }), [
    ['character', 'BOB', false], ['dialogue', 'One.', false], ['dialogue', '', true], ['dialogue', 'Two.', true], ['action', 'Action.', false]
  ]);
});

test('a transition is capitals ending in TO: with blank lines on both sides, or forced with >', function(){
  assert.deepStrictEqual(types('Action.\n\nCUT TO:\n\nINT. HOUSE - DAY\n'), ['action', 'transition', 'scene']);
  assert.deepStrictEqual(types('CUT TO:\nINT. HOUSE - DAY\n'), ['character', 'dialogue'], 'with text after it, it is a cue');
  assert.deepStrictEqual(types('Action.\n\nCut to:\n'), ['action', 'action'], 'not capitals');
  assert.deepStrictEqual(types('> FADE OUT.\n'), ['transition']);
  assert.deepStrictEqual(texts('> FADE OUT.\n'), ['FADE OUT.']);
  assert.deepStrictEqual(types('FADE OUT.\n'), ['action'], 'unforced, FADE OUT. is action to the spec');
});

test('centered text, sections, synopses, lyrics, page breaks and forced action', function(){
  assert.deepStrictEqual(types('> THE END <\n'), ['centered']);
  assert.deepStrictEqual(texts('>THE END<\n'), ['THE END']);
  assert.deepStrictEqual(types('# Act One\n'), ['section']);
  assert.strictEqual(parseFountain('### Sequence\n').elements[0].depth, 3);
  assert.deepStrictEqual(texts('## Act Two\n'), ['## Act Two'], 'a section keeps its hashes, which carry its depth');
  assert.deepStrictEqual(types('= He arrives.\n'), ['synopsis']);
  assert.deepStrictEqual(texts('= He arrives.\n'), ['He arrives.']);
  assert.deepStrictEqual(types('~Row, row, row your boat\n'), ['lyric']);
  assert.deepStrictEqual(types('===\n'), ['pagebreak']);
  assert.deepStrictEqual(types('=======\n'), ['pagebreak']);
  assert.deepStrictEqual(types('!INT. NOT A HEADING\n'), ['action']);
  assert.deepStrictEqual(texts('!INT. NOT A HEADING\n'), ['INT. NOT A HEADING']);
});

test('action keeps its leading whitespace and loses trailing whitespace', function(){
  assert.deepStrictEqual(texts('    indented line   \n'), ['    indented line']);
});

test('consecutive action lines are one tight run; a blank line separates them', function(){
  var parsed = parseFountain('One.\nTwo.\n\nThree.\n');
  assert.deepStrictEqual(parsed.elements.map(function(e){ return [e.text, Boolean(e.tight)]; }),
    [['One.', false], ['Two.', true], ['Three.', false]]);
});

test('notes and boneyards, on one line and spanning lines', function(){
  assert.deepStrictEqual(types('[[a note]]\n'), ['note']);
  assert.deepStrictEqual(texts('[[a note]]\n'), ['a note']);
  assert.deepStrictEqual(types('/* cut */\n'), ['boneyard']);

  var spanning = parseFountain('[[first\nsecond\nthird]]\n\n/*\ndead one\ndead two\n*/\n\nAction.\n');
  assert.deepStrictEqual(spanning.elements.map(function(e){ return [e.type, e.text, Boolean(e.tight)]; }), [
    ['note', 'first', false], ['note', 'second', true], ['note', 'third', true],
    ['boneyard', 'dead one', true], ['boneyard', 'dead two', true],
    ['action', 'Action.', false]
  ]);
});

test('classifyLine is the same classifier the serializer asks', function(){
  assert.deepStrictEqual(classifyLine('BOB', { blankBefore: true, nextBlank: false, inDialogue: false }), { type: 'character', text: 'BOB' });
  assert.deepStrictEqual(classifyLine('BOB', { blankBefore: true, nextBlank: true, inDialogue: false }), { type: 'action', text: 'BOB' });
  assert.deepStrictEqual(classifyLine('(beat)', { blankBefore: false, nextBlank: false, inDialogue: true }), { type: 'parenthetical', text: '(beat)' });
});

//---- inline markup -------------------------------------------------------------------------------

test('inline emphasis in all four spec forms, nested', function(){
  assert.deepStrictEqual(tokenizeInline('a *b* c'), [{ text: 'a ' }, { text: 'b', attributes: { italic: true } }, { text: ' c' }]);
  assert.deepStrictEqual(tokenizeInline('**b**'), [{ text: 'b', attributes: { bold: true } }]);
  assert.deepStrictEqual(tokenizeInline('***bi***'), [{ text: 'bi', attributes: { bold: true, italic: true } }]);
  assert.deepStrictEqual(tokenizeInline('_u_'), [{ text: 'u', attributes: { underline: true } }]);
  assert.deepStrictEqual(tokenizeInline('**bold _and under_ still**'), [
    { text: 'bold ', attributes: { bold: true } },
    { text: 'and under', attributes: { bold: true, underline: true } },
    { text: ' still', attributes: { bold: true } }
  ]);
});

test('an unmatched marker is text, and a backslash escapes one', function(){
  assert.deepStrictEqual(tokenizeInline('5 * 3'), [{ text: '5 * 3' }]);
  assert.deepStrictEqual(tokenizeInline('snake_case'), [{ text: 'snake_case' }]);
  assert.deepStrictEqual(tokenizeInline('***open'), [{ text: '***open' }]);
  assert.deepStrictEqual(tokenizeInline('a \\*b\\* c'), [{ text: 'a *b* c' }]);
  assert.deepStrictEqual(tokenizeInline('C:\\\\Users'), [{ text: 'C:\\Users' }]);
  assert.deepStrictEqual(tokenizeInline('C:\\Users'), [{ text: 'C:\\Users' }], 'a backslash before anything else is a backslash');
  assert.deepStrictEqual(tokenizeInline('*it* and 2 * 3'), [{ text: 'it', attributes: { italic: true } }, { text: ' and 2 * 3' }]);
});

//---- delta ---------------------------------------------------------------------------------------

test('elements become one line each, action with no element attribute', function(){
  var elements = parseFountain('INT. A - DAY\n\nBOB ^\n(low)\n*Hi* there.\n\nDone.\nTight.\n').elements;
  assert.deepStrictEqual(elementsToDelta(elements), { ops: [
    { insert: 'INT. A - DAY' }, { insert: '\n', attributes: { element: 'scene' } },
    { insert: 'BOB' }, { insert: '\n', attributes: { element: 'character', dual: true } },
    { insert: '(low)' }, { insert: '\n', attributes: { element: 'parenthetical' } },
    { insert: 'Hi', attributes: { italic: true } }, { insert: ' there.' }, { insert: '\n', attributes: { element: 'dialogue' } },
    { insert: 'Done.' }, { insert: '\n' },
    { insert: 'Tight.' }, { insert: '\n', attributes: { tight: true } }
  ] });
  assert.deepStrictEqual(deltaToElements(elementsToDelta(elements)), elements);
});

test('an empty script is an empty editor and back', function(){
  assert.deepStrictEqual(elementsToDelta([]), { ops: [{ insert: '\n' }] });
  assert.deepStrictEqual(deltaToElements({ ops: [{ insert: '\n' }] }), []);
  assert.deepStrictEqual(deltaToElements(null), []);
  assert.strictEqual(serializeFountain([], []), '');
  assert.deepStrictEqual(parseFountain(''), { titlePage: [], elements: [] });
});

test('block attributes from a prose chapter are ignored and an embed is dropped', function(){
  var elements = deltaToElements({ ops: [
    { insert: 'Heading' }, { insert: '\n', attributes: { header: 1, element: 'nonsense' } },
    { insert: 'see' }, { insert: { footnote: { n: '1' } } }, { insert: ' this' }, { insert: '\n', attributes: { strike: true, tight: true } }
  ] });
  assert.deepStrictEqual(elements, [
    { type: 'action', text: 'Heading', runs: [{ text: 'Heading' }] },
    { type: 'action', text: 'see this', runs: [{ text: 'see' }, { text: ' this' }], tight: true }
  ]);
});

//---- serializer ----------------------------------------------------------------------------------

test('blank lines go between elements and nowhere inside a dialogue group', function(){
  var written = serializeFountain([], parseFountain('INT. A - DAY\n\nBOB\n(low)\nHi.\n\nCUT TO:\n\nEXT. B - NIGHT\n').elements);
  assert.strictEqual(written, 'INT. A - DAY\n\nBOB\n(low)\nHi.\n\nCUT TO:\n\nEXT. B - NIGHT\n');
});

test('cues, headings and transitions are written as typed, forced where the case would not read back', function(){
  var elements = [
    { type: 'scene', text: 'int. house - day #1a#' },
    { type: 'character', text: 'McCLANE' },
    { type: 'dialogue', text: 'Hi.' },
    { type: 'transition', text: 'cut to:' }
  ];
  assert.strictEqual(serializeFountain([], elements), 'int. house - day #1a#\n\n@McCLANE\nHi.\n\n> cut to:\n');
  assert.deepStrictEqual(parseFountain(serializeFountain([], elements)).elements.map(function(e){ return [e.type, e.text]; }),
    [['scene', 'int. house - day #1a#'], ['character', 'McCLANE'], ['dialogue', 'Hi.'], ['transition', 'cut to:']]);
});

test('a line that would read back as something else is forced', function(){
  assert.strictEqual(serializeFountain([], [{ type: 'scene', text: 'SNIPER SCOPE POV' }]), '.SNIPER SCOPE POV\n');
  assert.strictEqual(serializeFountain([], [{ type: 'character', text: '911' }, { type: 'dialogue', text: 'Help.' }]), '@911\nHelp.\n');
  assert.strictEqual(serializeFountain([], [{ type: 'character', text: 'BOB' }]), '@BOB\n', 'a cue with nothing after it would read as action');
  assert.strictEqual(serializeFountain([], [{ type: 'transition', text: 'FADE OUT.' }]), '> FADE OUT.\n');
  assert.strictEqual(serializeFountain([], [{ type: 'action', text: 'Note: he lies.' }]), '!Note: he lies.\n', 'an opening line shaped like a title page key');
  assert.strictEqual(serializeFountain([], [{ type: 'action', text: 'FADE IN:' }]), 'FADE IN:\n', 'but capitals are never a key');
  assert.strictEqual(serializeFountain([], [{ type: 'action', text: 'INT. NOT A HEADING' }]), '!INT. NOT A HEADING\n');
  assert.strictEqual(serializeFountain([], [{ type: 'action', text: 'SHOUTING' }, { type: 'action', text: 'follows', tight: true }]), '!SHOUTING\nfollows\n', 'a capitalised action line with text after it would be a cue');
  assert.strictEqual(serializeFountain([], [{ type: 'action', text: 'SHOUTING' }, { type: 'action', text: 'follows' }]), 'SHOUTING\n\nfollows\n', 'with a blank line after it, it is already action');
  assert.strictEqual(serializeFountain([], [{ type: 'action', text: '!Wow.' }]), '!!Wow.\n');
  assert.strictEqual(serializeFountain([], [{ type: 'action', text: '.Wow.' }]), '!.Wow.\n');
  assert.strictEqual(serializeFountain([], [{ type: 'action', text: '= not a synopsis' }]), '!= not a synopsis\n');
  assert.strictEqual(serializeFountain([], [{ type: 'parenthetical', text: 'beat' }]), '(beat)\n');
});

test('a dual cue, an empty dialogue line, and the other single-line forms', function(){
  var elements = [
    { type: 'character', text: 'BOB', dual: true }, { type: 'dialogue', text: 'One.' }, { type: 'dialogue', text: '', tight: true }, { type: 'dialogue', text: 'Two.', tight: true },
    { type: 'centered', text: 'THE END' }, { type: 'section', text: '## Act', depth: 2 }, { type: 'section', text: 'Act', depth: 3 },
    { type: 'synopsis', text: 'He goes.' }, { type: 'lyric', text: 'la' }, { type: 'pagebreak', text: '' }, { type: 'note', text: 'n' }, { type: 'boneyard', text: 'b' }
  ];
  assert.strictEqual(serializeFountain([], elements),
    'BOB ^\nOne.\n  \nTwo.\n\n> THE END <\n\n## Act\n\n### Act\n\n= He goes.\n\n~la\n\n===\n\n[[n]]\n\n/* b */\n');
});

test('spanning notes and boneyards are written with one opener and one closer', function(){
  var elements = [
    { type: 'note', text: 'first' }, { type: 'note', text: 'second', tight: true },
    { type: 'boneyard', text: 'one' }, { type: 'boneyard', text: 'two', tight: true }
  ];
  assert.strictEqual(serializeFountain([], elements), '[[first\nsecond]]\n\n/* one\ntwo */\n');
  assert.deepStrictEqual(parseFountain(serializeFountain([], elements)).elements.map(function(e){ return [e.type, e.text, Boolean(e.tight)]; }),
    [['note', 'first', false], ['note', 'second', true], ['boneyard', 'one', false], ['boneyard', 'two', true]]);
});

test('empty action lines are dropped rather than written', function(){
  var elements = deltaToElements({ ops: [{ insert: 'One.\n\n\nTwo.\n' }] });
  assert.strictEqual(serializeFountain([], elements), 'One.\n\nTwo.\n');
});

test('inline markup is written back, and marker characters in text are escaped', function(){
  var elements = [{ type: 'action', text: 'x', runs: [
    { text: 'a ' }, { text: 'b', attributes: { bold: true, italic: true } }, { text: ' ' }, { text: 'c', attributes: { underline: true } }, { text: ' 2*3 snake_case C:\\dir' }
  ] }];
  var written = serializeFountain([], elements);
  assert.strictEqual(written, 'a ***b*** _c_ 2\\*3 snake\\_case C:\\\\dir\n');
  assert.deepStrictEqual(parseFountain(written).elements[0].runs, elements[0].runs);
});

test('parse -> serialize -> parse is a fixed point on a script exercising every element', function(){
  var script = 'Title: Test\nAuthor: Me\n\n' +
    'FADE IN:\n\n' +
    '# Act One\n\n= Setup.\n\n' +
    'INT. HOUSE - DAY #1#\n\n' +
    'A room.\nStill the room.\n\n' +
    '[[note here]]\n\n' +
    'BOB (V.O.)\n(quietly)\nHello *there*.\n  \nStill talking.\n~and singing\n\n' +
    'JANE ^\nHi.\n\n' +
    '> THE END <\n\n' +
    '/* old scene\ngone */\n\n' +
    '===\n\n' +
    '!INT. NOT A HEADING\n\n' +
    'CUT TO:\n\n' +
    '.FORCED HEADING\n\n' +
    '@McCLANE\nYippee.\n';
  var written = assertFixedPoint(script);
  assert.strictEqual(written, script.replace('[[note here]]', '[[note here]]'), 'this script is already in canonical form');
});

test('escaping: every marker character in every position survives a round trip', function(){
  var texts = ['*', '**', '***', '_', '\\', '*a*', 'a*', '*a', '_a_', '\\*', '!', '.', '@', '>', '<', '=', '#', '~', '[[x]]', '/* x */', '(x)', '  x'];
  texts.forEach(function(text){
    ['action', 'dialogue', 'scene', 'character', 'transition', 'centered', 'lyric', 'synopsis'].forEach(function(type){
      var elements = type === 'dialogue'
        ? [{ type: 'character', text: 'BOB' }, { type: 'dialogue', text: text }]
        : [{ type: type, text: text }];
      var back = parseFountain(serializeFountain([], elements)).elements;
      var expectedText = text;
      //The four documented losses. A dialogue line wrapped in parentheses is a parenthetical to
      //the reader and one opening with "~" is a lyric, a heading that is only dots is an ellipsis,
      //and a transition ending in "<" is centered text: Fountain has no way to write any of them.
      if((type === 'dialogue' && (text === '(x)' || text === '~')) || (type === 'scene' && text === '.') || (type === 'transition' && text === '<'))
        return;
      //Leading whitespace on anything but action is not the element's - the spec ignores it.
      if(type !== 'action' && text === '  x')
        expectedText = 'x';
      assert.deepStrictEqual(back.map(function(e){ return [e.type, e.text]; }), elements.map(function(e){ return [e.type, e.type === type ? expectedText : e.text]; }),
        'for ' + type + ' text ' + JSON.stringify(text) + ' written as ' + JSON.stringify(serializeFountain([], elements)));
    });
  });
});

//---- page estimate -------------------------------------------------------------------------------

test('the page estimate counts wrapped lines and blank lines between elements', function(){
  assert.deepStrictEqual(estimatePages([]), { pages: 0, exact: 0, eighths: '0' });

  //One heading, one line of action, a cue and a line of dialogue: 1 + (1+1) + (1+1) + 1 = 6 lines.
  var estimate = estimatePages(parseFountain('INT. A - DAY\n\nAction.\n\nBOB\nHi.\n').elements);
  assert.strictEqual(estimate.pages, 1);
  assert.ok(Math.abs(estimate.exact - 6 / 55) < 1e-9);

  var long = estimatePages([{ type: 'action', text: 'x'.repeat(61 * 55) }]);
  assert.strictEqual(long.pages, 1);
  assert.strictEqual(long.eighths, '1');

  var breaks = estimatePages([{ type: 'action', text: 'a' }, { type: 'pagebreak', text: '' }, { type: 'action', text: 'b' }]);
  assert.strictEqual(breaks.pages, 2);
});

test('the page starts name the element that begins each page after the first', function(){
  assert.deepStrictEqual(estimatePageStarts([]), []);

  //Forty one-line actions: the first takes line 0, each after it a blank and a line, so the n-th
  //starts on line 2n, and the first to start on the second page (line 55 or later) is the 28th.
  var actions = [];
  for(var i = 0; i < 40; i++)
    actions.push({ type: 'action', text: 'x' });
  assert.deepStrictEqual(estimatePageStarts(actions), [{ index: 28, page: 2 }]);

  //A forced break: the element after it starts the next page.
  var breaks = [{ type: 'action', text: 'a' }, { type: 'pagebreak', text: '' }, { type: 'action', text: 'b' }];
  assert.deepStrictEqual(estimatePageStarts(breaks), [{ index: 2, page: 2 }]);

  //The count runs over the page inside the second element (lines 54 to 56): the mark goes on the
  //element after it, the first that begins on the new page.
  var straddle = [{ type: 'action', text: 'x'.repeat(61 * 53) }, { type: 'action', text: 'y'.repeat(61 * 3) }, { type: 'action', text: 'z' }];
  assert.deepStrictEqual(estimatePageStarts(straddle), [{ index: 2, page: 2 }]);

  //A note takes no lines and never begins a page; the element after it does.
  var noted = [{ type: 'action', text: 'x'.repeat(61 * 54) }, { type: 'note', text: 'later' }, { type: 'action', text: 'y' }];
  assert.deepStrictEqual(estimatePageStarts(noted), [{ index: 2, page: 2 }]);
});

test('a heading, a cue or a parenthetical is never left at the foot of a page: the page turns before it', function(){
  //Forty one-line actions again, so the 27th starts on line 54, the last of page one, and what
  //follows it on line 55 or 56 begins page two.
  function script(){
    var actions = [];
    for(var i = 0; i < 40; i++)
      actions.push({ type: 'action', text: 'x' });
    return actions;
  }

  //A cue on the last line with its speech over the page: the cue begins the page instead.
  var cue = script();
  cue[27] = { type: 'character', text: 'BOB' };
  cue[28] = { type: 'dialogue', text: 'Hi.' };
  assert.deepStrictEqual(estimatePageStarts(cue), [{ index: 27, page: 2 }]);

  //A heading on the last line with its action over the page.
  var heading = script();
  heading[27] = { type: 'scene', text: 'INT. HOUSE - DAY' };
  assert.deepStrictEqual(estimatePageStarts(heading), [{ index: 27, page: 2 }]);

  //A two-line cue and a parenthetical, with the speech over the page: the whole run moves, and
  //the cue begins the page.
  var chain = script();
  chain[26] = { type: 'character', text: 'x'.repeat(39) };
  chain[27] = { type: 'parenthetical', text: '(low)' };
  chain[28] = { type: 'dialogue', text: 'Hi.' };
  assert.deepStrictEqual(estimatePageStarts(chain), [{ index: 26, page: 2 }]);

  //A run longer than a page cannot move over whole, so the turn falls where the count puts it.
  var long = [{ type: 'character', text: 'BOB' }, { type: 'parenthetical', text: 'x'.repeat(25 * 54) }, { type: 'dialogue', text: 'y' }];
  assert.deepStrictEqual(estimatePageStarts(long), [{ index: 2, page: 2 }]);
});

//---- Big Fish ------------------------------------------------------------------------------------

//John August's Big Fish, in the Fountain and FDX forms he publishes with the format. Not ours to
//commit (screenplay/ is gitignored), so this runs when the folder is present and is skipped when
//it is not. The FDX types every paragraph, which makes it an oracle for the classifier - see
//docs/screenplay-plan.md, "The codec".
const BIG_FISH = path.join(__dirname, '..', 'screenplay', 'Big-Fish.fountain');
const BIG_FISH_FDX = path.join(__dirname, '..', 'screenplay', 'Big-Fish.fdx');

test('Big Fish: element counts against the FDX, explained where they differ', { skip: !fs.existsSync(BIG_FISH) && 'screenplay/Big-Fish.fountain is not present' }, function(){
  var parsed = parseFountain(fs.readFileSync(BIG_FISH, 'utf8'));
  var counts = {};
  parsed.elements.forEach(function(e){ counts[e.type] = (counts[e.type] || 0) + 1; });

  //The FDX has 202 scene headings. Ten of them ("A RIVER.", "VARIOUS SHOTS", "YOUNG EDWARD") have
  //no INT/EXT prefix and are not forced in the Fountain, so Fountain reads them as action - a
  //reader of the .fountain sees the same. Two more are "EXT/INT.", which this codec accepts.
  assert.strictEqual(counts.scene, 192);
  assert.strictEqual(counts.character, 768, 'matches the FDX exactly');
  assert.strictEqual(counts.parenthetical, 97, 'matches the FDX exactly');
  //813 in the FDX: two dialogue paragraphs there are typed General.
  assert.strictEqual(counts.dialogue, 811);
  //36 in the FDX: "bACK TO:" is mixed case and "CUT TO BLACK." is not forced, so both are action
  //to the spec. "**FADE IN:**" is bold action in both.
  assert.strictEqual(counts.transition, 34);
  assert.strictEqual(counts.centered, 2);
  assert.strictEqual(counts.pagebreak, 1);
  assert.strictEqual(parsed.elements.length, 2767);
  assert.strictEqual(parsed.elements.filter(function(e){ return e.tight; }).length, 12);

  assert.deepStrictEqual(parsed.titlePage[0], { key: 'Title', values: ['Big Fish'] });
  assert.deepStrictEqual(getTitlePageValues(parsed.titlePage, 'notes'), ['FINAL PRODUCTION DRAFT', 'includes post-production dialogue', 'and omitted scenes']);
});

test('Big Fish: the FDX oracle agrees on the cue and parenthetical sequence', { skip: !fs.existsSync(BIG_FISH_FDX) && 'screenplay/Big-Fish.fdx is not present' }, function(){
  var fdx = fs.readFileSync(BIG_FISH_FDX, 'utf8');
  var fdxTypes = [];
  //Paragraphs only: the file's ElementSettings carry a Type attribute of the same names.
  var paragraph = /<Paragraph\b[^>]*\bType="([^"]+)"/g;
  var match;
  while((match = paragraph.exec(fdx)))
    fdxTypes.push(match[1]);

  assert.strictEqual(fdxTypes.filter(function(t){ return t === 'Character'; }).length, 768);
  assert.strictEqual(fdxTypes.filter(function(t){ return t === 'Parenthetical'; }).length, 97);
  assert.strictEqual(fdxTypes.filter(function(t){ return t === 'Scene Heading'; }).length, 202);
  assert.strictEqual(fdxTypes.filter(function(t){ return t === 'Transition'; }).length, 36);
  assert.strictEqual(fdxTypes.filter(function(t){ return t === 'Dialogue'; }).length, 813);
});

test('Big Fish: parse -> serialize -> parse is a fixed point, and the estimate is near the PDF', { skip: !fs.existsSync(BIG_FISH) && 'screenplay/Big-Fish.fountain is not present' }, function(){
  var text = fs.readFileSync(BIG_FISH, 'utf8');
  var written = assertFixedPoint(text);

  //What differs from the file as published: whitespace the spec ignores (trailing spaces, a tab
  //after "Notes:", a four-character page break written as three, no newline at the end of the
  //file); the closing "THE END", which the file marks "_**...**_" and this writes "**_..._**" -
  //the same two styles with the markers in this codec's fixed order; and six lines of song lyrics
  //whose italics open on one line and close on a later one. Emphasis does not span lines, so each
  //of those lines carries one unmatched asterisk, which is text and is written escaped.
  var strip = function(s){
    return s.replace(/\r\n?/g, '\n').replace(/[^\S\n]+$/gm, '').replace(/^====$/m, '===').replace(/\n+$/, '')
      .replace(/\\\*/g, '*').replace('_**THE END**_', '**_THE END_**');
  };
  assert.strictEqual(strip(written), strip(text));
  assert.strictEqual((written.match(/\\\*/g) || []).length, 6);

  var parsed = parseFountain(text);
  assert.deepStrictEqual(deltaToElements(elementsToDelta(parsed.elements)), parsed.elements);

  //The published PDF is 122 pages including its title page.
  var estimate = estimatePages(parsed.elements);
  assert.ok(estimate.pages >= 115 && estimate.pages <= 125, 'estimated ' + estimate.pages);
});
