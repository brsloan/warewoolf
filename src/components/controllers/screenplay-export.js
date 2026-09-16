const { getTitlePageValues, NEVER_TIGHT } = require('./fountain');

//The screenplay's other formats - docs/screenplay-plan.md, Phase 7. Pure functions over the
//element list the Fountain codec produces: a print page for the PDF, Final Draft's FDX in both
//directions, and Fade In's document in. Nothing here touches a file; export.js and import.js do
//that.

// ------------------------------------------------------------------------------------------
// Print
// ------------------------------------------------------------------------------------------

//A script page: Courier 12 on Letter, an inch and a half on the left and an inch elsewhere
//(those come from the printToPdf command's margins; the body has none), dialogue at two and a
//half inches from the edge, cues at three and seven tenths, parentheticals at three and one tenth,
//transitions flush right. A blank line between elements and none inside a dialogue group, two
//before a heading. Sections, synopses, notes and boneyards are the writer's and not the reader's,
//so they are left off the page.
const PRINT_CSS = [
  'body { font-family: "Courier Prime", "Courier New", Courier, monospace; font-size: 12pt; line-height: 1; margin: 0; color: #000; }',
  'p { margin: 1em 0 0 0; white-space: pre-wrap; }',
  'p:first-child, p.tight, p.character + p.parenthetical, p.character + p.dialogue, p.character + p.lyric,',
  'p.parenthetical + p.dialogue, p.parenthetical + p.lyric, p.dialogue + p.parenthetical, p.dialogue + p.lyric,',
  'p.lyric + p.dialogue, p.lyric + p.parenthetical { margin-top: 0; }',
  'p.scene { margin-top: 2em; text-transform: uppercase; page-break-after: avoid; }',
  'p.character { margin-left: 2.2in; text-transform: uppercase; page-break-after: avoid; }',
  'p.parenthetical { margin-left: 1.6in; margin-right: 1.9in; page-break-after: avoid; }',
  'p.dialogue { margin-left: 1in; margin-right: 1.5in; }',
  'p.lyric { margin-left: 1in; margin-right: 1.5in; font-style: italic; }',
  'p.transition { text-align: right; text-transform: uppercase; }',
  'p.centered { text-align: center; }',
  'div.pagebreak { page-break-after: always; }',
  'div.title-page { page-break-after: always; height: 8.5in; position: relative; text-align: center; }',
  'div.title-page .title { padding-top: 3in; text-transform: uppercase; }',
  'div.title-page .contact { position: absolute; left: 0; bottom: 0; text-align: left; }',
  'div.title-page .date { position: absolute; right: 0; bottom: 0; text-align: right; }'
].join('\n');

const PRINTED = ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'centered', 'lyric', 'pagebreak'];

function screenplayToPrintHtml(titlePage, elements){
  var body = titlePageHtml(titlePage || []);

  (elements || []).forEach(function(element){
    if(PRINTED.indexOf(element.type) === -1)
      return;

    if(element.type === 'pagebreak'){
      body += '<div class="pagebreak"></div>';
      return;
    }

    var classes = element.type + (element.tight ? ' tight' : '');
    body += '<p class="' + classes + '">' + runsToHtml(element) + '</p>';
  });

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
    escapeHtml(getTitlePageValues(titlePage || [], 'Title').join(' ') || 'Screenplay') +
    '</title><style>' + PRINT_CSS + '</style></head><body>' + body + '</body></html>';
}

//The title page as the format lays it out: title a third of the way down, the credit line and
//the author under it, the source under those; contact details bottom left, the draft date and
//copyright bottom right. Only the keys a page has are drawn, and a script with no title page has
//no title page.
function titlePageHtml(titlePage){
  if(titlePage.length === 0)
    return '';

  var centre = '';
  [['Title', 'title'], ['Credit', 'credit'], ['Author', 'author'], ['Authors', 'author'], ['Source', 'source']].forEach(function(pair){
    getTitlePageValues(titlePage, pair[0]).forEach(function(line){
      centre += '<p class="' + pair[1] + '">' + escapeHtml(line) + '</p>';
    });
  });

  var contact = '';
  ['Contact', 'Notes'].forEach(function(key){
    getTitlePageValues(titlePage, key).forEach(function(line){
      contact += '<p>' + escapeHtml(line) + '</p>';
    });
  });

  var date = '';
  ['Draft date', 'Copyright'].forEach(function(key){
    getTitlePageValues(titlePage, key).forEach(function(line){
      date += '<p>' + escapeHtml(line) + '</p>';
    });
  });

  return '<div class="title-page">' + centre +
    (contact ? '<div class="contact">' + contact + '</div>' : '') +
    (date ? '<div class="date">' + date + '</div>' : '') +
    '</div>';
}

function runsToHtml(element){
  var runs = element.runs || [{ text: element.text || '' }];
  var html = '';

  runs.forEach(function(run){
    if(typeof run.text !== 'string' || run.text === '')
      return;

    var text = escapeHtml(run.text);
    var styles = run.attributes || {};
    if(styles.underline) text = '<u>' + text + '</u>';
    if(styles.italic) text = '<em>' + text + '</em>';
    if(styles.bold) text = '<strong>' + text + '</strong>';
    html += text;
  });

  //An empty paragraph collapses to nothing; a space keeps its line.
  return html === '' ? ' ' : html;
}

function escapeHtml(text){
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ------------------------------------------------------------------------------------------
// FDX
// ------------------------------------------------------------------------------------------

//Final Draft's paragraph types, and ours. What FDX has no type for (sections, synopses, notes,
//boneyards) is left out of a script written for it, and what we have no type for comes in as
//action - which is what Fountain does with it too.
const FDX_TYPE = {
  scene: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  parenthetical: 'Parenthetical',
  dialogue: 'Dialogue',
  transition: 'Transition',
  centered: 'Action',
  lyric: 'Dialogue'
};

const ELEMENT_FOR_FDX = {
  'Scene Heading': 'scene',
  'Action': 'action',
  'Character': 'character',
  'Parenthetical': 'parenthetical',
  'Dialogue': 'dialogue',
  'Transition': 'transition',
  'General': 'action',
  'Shot': 'scene',
  'Cast List': 'action',
  'Lyrics': 'lyric'
};

//The script as FDX. A page break becomes the next paragraph's StartsNewPage; centered text is an
//action paragraph aligned centre, which is how Final Draft writes "THE END"; the dual mark
//becomes a DualDialogue group around the cue and its speech, which is the one place FDX wraps
//paragraphs in anything.
function elementsToFdx(titlePage, elements){
  elements = elements || [];
  var out = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n' +
    '<FinalDraft DocumentType="Script" Template="No" Version="1">\n\n  <Content>\n';
  var groups = dualGroups(elements);
  var startsNewPage = false;

  elements.forEach(function(element, i){
    if(element.type === 'pagebreak'){
      startsNewPage = true;
      return;
    }

    var type = FDX_TYPE[element.type];
    if(!type)
      return;

    if(groups.starts[i])
      out += '    <DualDialogue>\n';

    var attributes = ' Type="' + type + '"';
    if(element.type === 'centered')
      attributes += ' Alignment="Center"';
    if(startsNewPage){
      attributes += ' StartsNewPage="Yes"';
      startsNewPage = false;
    }

    out += '    <Paragraph' + attributes + '>\n';
    (element.runs || [{ text: element.text || '' }]).forEach(function(run){
      if(typeof run.text !== 'string')
        return;
      var style = fdxStyle(run.attributes);
      out += '      <Text' + (style ? ' Style="' + style + '"' : '') + '>' + escapeXml(run.text) + '</Text>\n';
    });
    out += '    </Paragraph>\n';

    if(groups.ends[i])
      out += '    </DualDialogue>\n';
  });

  out += '  </Content>\n' + titlePageFdx(titlePage || []) + '</FinalDraft>\n';
  return out;
}

//Fountain marks the *second* speaker of a dual-dialogue pair with the caret, so a group runs from
//the cue before a marked cue to the end of the marked cue's own speech. Worked out ahead of the
//walk above, as the indices a group opens and closes at.
function dualGroups(elements){
  var starts = {};
  var ends = {};

  elements.forEach(function(element, i){
    if(element.type !== 'character' || !element.dual)
      return;

    var start = -1;
    for(let n = i - 1; n >= 0; n--){
      if(elements[n].type === 'character'){
        start = n;
        break;
      }
    }
    if(start === -1)
      return;

    var end = i;
    while(elements[end + 1] && GROUP_SPEECH.indexOf(elements[end + 1].type) !== -1)
      end++;

    starts[start] = true;
    ends[end] = true;
  });

  return { starts: starts, ends: ends };
}

const GROUP_SPEECH = ['dialogue', 'parenthetical', 'lyric'];

function fdxStyle(attributes){
  if(!attributes)
    return '';
  var styles = [];
  if(attributes.bold) styles.push('Bold');
  if(attributes.italic) styles.push('Italic');
  if(attributes.underline) styles.push('Underline');
  return styles.join('+');
}

function titlePageFdx(titlePage){
  if(titlePage.length === 0)
    return '';

  var out = '  <TitlePage>\n    <Content>\n';
  var line = function(text, alignment){
    out += '      <Paragraph Alignment="' + alignment + '">\n        <Text>' + escapeXml(text) + '</Text>\n      </Paragraph>\n';
  };

  [['Title'], ['Credit'], ['Author', 'Authors'], ['Source']].forEach(function(keys){
    keys.forEach(function(key){
      getTitlePageValues(titlePage, key).forEach(function(text){ line(text, 'Center'); });
    });
  });
  ['Contact', 'Notes', 'Draft date', 'Copyright'].forEach(function(key){
    getTitlePageValues(titlePage, key).forEach(function(text){ line(text, key === 'Draft date' || key === 'Copyright' ? 'Right' : 'Left'); });
  });

  return out + '    </Content>\n  </TitlePage>\n';
}

function escapeXml(text){
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

//FDX in. `DOMParser` is the renderer's own (and jsdom's, in a test), the same way html-import.js
//reads it. Only the script's own Content is read - the TitlePage has one of its own, which is
//read separately below - and every Paragraph in it becomes an element by its Type, with a
//StartsNewPage becoming a page break before it and a DualDialogue group marking its first cue.
function parseFdx(xml){
  var doc = new DOMParser().parseFromString(xml, 'application/xml');
  var root = doc.documentElement;
  if(!root || root.nodeName !== 'FinalDraft')
    throw new Error('Not a Final Draft (.fdx) file.');

  var content = childNamed(root, 'Content');
  var elements = [];

  if(content){
    Array.from(content.children).forEach(function(node){
      if(node.nodeName === 'Paragraph')
        pushParagraph(elements, node, false);
      else if(node.nodeName === 'DualDialogue'){
        //Fountain marks the second speaker of the pair, so the group's second cue gets the flag.
        var cues = 0;
        Array.from(node.children).forEach(function(inner){
          if(inner.nodeName !== 'Paragraph')
            return;
          var isCue = inner.getAttribute('Type') === 'Character';
          if(isCue)
            cues++;
          pushParagraph(elements, inner, isCue && cues === 2);
        });
      }
    });
  }

  return { titlePage: parseFdxTitlePage(root), elements: elements };
}

function pushParagraph(elements, node, dual){
  var fdxType = node.getAttribute('Type') || 'Action';
  var type = ELEMENT_FOR_FDX[fdxType] || 'action';
  if(type === 'action' && node.getAttribute('Alignment') === 'Center')
    type = 'centered';

  if(node.getAttribute('StartsNewPage') === 'Yes' && elements.length > 0)
    elements.push({ type: 'pagebreak', text: '', runs: [] });

  var runs = [];
  Array.from(node.children).forEach(function(child){
    if(child.nodeName !== 'Text')
      return;
    var text = child.textContent.replace(/\r\n|\r|\n/g, ' ');
    if(text === '')
      return;
    var run = { text: text };
    var style = child.getAttribute('Style') || '';
    var attributes = {};
    if(/Bold/.test(style)) attributes.bold = true;
    if(/Italic/.test(style)) attributes.italic = true;
    if(/Underline/.test(style)) attributes.underline = true;
    if(Object.keys(attributes).length > 0)
      run.attributes = attributes;
    runs.push(run);
  });

  var element = { type: type, text: runs.map(function(r){ return r.text; }).join(''), runs: runs };
  if(type === 'character' && dual)
    element.dual = true;
  elements.push(element);
}

//A Final Draft title page is free text, not keys: its paragraphs' lines, read by titlePageFromLines.
function parseFdxTitlePage(root){
  var page = childNamed(root, 'TitlePage');
  var content = page ? childNamed(page, 'Content') : null;
  if(!content)
    return [];

  return titlePageFromLines(paragraphLines(content, 'Paragraph', 'Text'));
}

//The non-empty lines of a run of paragraphs, as { text, key }, for a title page that is laid out
//rather than keyed. FDX spells the two nodes Paragraph/Text; Fade In spells them para/text. A
//soft return inside a paragraph is a line of its own. `keyOf(paragraph)` names the Fountain key a
//paragraph is known to hold, or null when only its text can say.
function paragraphLines(container, paragraphName, textName, keyOf){
  var lines = [];
  Array.from(container.children).forEach(function(node){
    if(node.nodeName !== paragraphName)
      return;
    var key = keyOf ? keyOf(node) : null;
    var text = Array.from(node.children).filter(function(c){ return c.nodeName === textName; }).map(function(c){ return c.textContent; }).join('');
    text.split(/\r\n|\r|\n/).forEach(function(line){
      line = line.trim();
      if(line !== '')
        lines.push({ text: line, key: key });
    });
  });
  return lines;
}

//Keys from a laid-out title page. A line that arrives with a key goes under it. For the rest: the
//first line with anything on it is the title; a line reading "by" or "written by" is the credit
//and the line after it the author; a line beginning "based on" is the source and one beginning
//"copyright" or "©" the copyright; everything else goes to Notes, which is where nothing is lost.
function titlePageFromLines(lines){
  var titlePage = [];
  var notes = [];
  var expectAuthor = false;

  var add = function(key, line){
    var entry = titlePage.find(function(e){ return e.key === key; });
    if(entry)
      entry.values.push(line);
    else
      titlePage.push({ key: key, values: [line] });
  };

  lines.forEach(function(line){
    if(line.key){
      add(line.key, line.text);
      expectAuthor = false;
      return;
    }
    if(titlePage.length === 0){
      add('Title', line.text);
      return;
    }
    if(/^(written\s+)?by$/i.test(line.text)){
      add('Credit', line.text);
      expectAuthor = true;
      return;
    }
    if(expectAuthor){
      add('Author', line.text);
      expectAuthor = false;
      return;
    }
    if(/^based\s+on\b/i.test(line.text)){
      add('Source', line.text);
      return;
    }
    if(/^(copyright\b|©|\(c\)\s)/i.test(line.text)){
      add('Copyright', line.text);
      return;
    }
    notes.push(line.text);
  });

  if(notes.length > 0)
    titlePage.push({ key: 'Notes', values: notes });

  return titlePage;
}

function childNamed(node, name){
  return Array.from(node.children).find(function(child){ return child.nodeName === name; }) || null;
}

// ------------------------------------------------------------------------------------------
// Fade In
// ------------------------------------------------------------------------------------------

//Fade In in. A .fadein is a zip around one document.xml in Open Screenplay Format - import.js
//opens the zip and hands the XML here. The document is a <paragraphs> list of <para>, each with a
//<style basestyle="..."/> naming its element style and <text> runs that carry bold, italic and
//underline as "1", and then a <titlepage> of the same shape. The style names are Final Draft's,
//near enough, so the FDX table reads them, with Fade In's own two added: Normal Text is its
//General, Singing its Lyrics. A style Fade In has and we do not (a writer's custom element) comes
//in as action, and a centred one as centered, as with FDX.
//
//A page break and the dual-dialogue mark are attributes of the paragraph's style (screenplay/
//dual.fadein: pagebreakbefore="1" on the paragraph that starts the new page, dualdialogue="1" on
//the first cue of the pair), read by name on the para or its style so the format's public
//spellings (pageBreakBefore, dualDialogue) read too. Fountain marks the second cue of a pair, so
//a marked cue opens a pair and the next cue closes it, whether or not that one is marked as well.
//
//A soft return inside a paragraph is a literal newline in its text, and becomes a `tight` line of
//the same type, which is how the editor spells one (Shift+Enter); in an element that cannot be
//continued that way the lines are joined with a space.
//
//Fade In's own title page names what its paragraphs hold (bookmark="Title" and so on), so those
//go straight to their keys; a title page pasted in as free text (Big Fish's) is read by its lines.
const ELEMENT_FOR_FADEIN = Object.assign({}, ELEMENT_FOR_FDX, { 'Normal Text': 'action', 'Singing': 'lyric' });

const TITLE_KEY_FOR_BOOKMARK = { title: 'Title', author: 'Author', authors: 'Authors', credit: 'Credit', source: 'Source',
  copyright: 'Copyright', draft: 'Draft date', 'draft date': 'Draft date', contact: 'Contact', notes: 'Notes' };

function parseFadeIn(xml){
  var doc = new DOMParser().parseFromString(xml, 'application/xml');
  var root = doc.documentElement;
  if(!root || root.nodeName !== 'document' || !/open screenplay format/i.test(root.getAttribute('type') || ''))
    throw new Error('Not a Fade In (.fadein) document.');

  var paragraphs = childNamed(root, 'paragraphs');
  var elements = [];
  var firstOfPair = false;

  if(paragraphs){
    Array.from(paragraphs.children).forEach(function(para){
      if(para.nodeName !== 'para')
        return;

      var style = childNamed(para, 'style');
      if(hasFlag(para, style, /^pagebreak(before)?$/i) && elements.length > 0)
        elements.push({ type: 'pagebreak', text: '', runs: [] });

      var lines = fadeInParagraph(para, style);
      var element = lines[0];
      if(element.type === 'character'){
        if(firstOfPair){
          element.dual = true;
          firstOfPair = false;
        }
        else if(hasFlag(para, style, /^dual(dialogue)?$/i))
          firstOfPair = true;
      }
      lines.forEach(function(line){ elements.push(line); });
    });
  }

  var titlePage = childNamed(root, 'titlepage');
  return {
    titlePage: titlePage ? titlePageFromLines(paragraphLines(titlePage, 'para', 'text', fadeInTitleKey)) : [],
    elements: elements
  };
}

function fadeInTitleKey(para){
  return TITLE_KEY_FOR_BOOKMARK[(para.getAttribute('bookmark') || '').trim().toLowerCase()] || null;
}

//One paragraph as its elements: one, or one per soft-returned line with `tight` on each after
//the first.
function fadeInParagraph(para, style){
  var base = style ? (style.getAttribute('basestyle') || style.getAttribute('baseStyleName') || '') : '';
  var type = ELEMENT_FOR_FADEIN[base] || 'action';
  var align = (style && style.getAttribute('align')) || para.getAttribute('align') || '';
  if(type === 'action' && /^cent/i.test(align))
    type = 'centered';

  var joinLines = NEVER_TIGHT.indexOf(type) !== -1;
  var lines = [[]];
  Array.from(para.children).forEach(function(child){
    if(child.nodeName !== 'text')
      return;
    var attributes = {};
    ['bold', 'italic', 'underline'].forEach(function(name){
      if(isOn(child.getAttribute(name)))
        attributes[name] = true;
    });
    var text = child.textContent;
    if(joinLines)
      text = text.replace(/\r\n|\r|\n/g, ' ');
    text.split(/\r\n|\r|\n/).forEach(function(segment, i){
      if(i > 0)
        lines.push([]);
      if(segment === '')
        return;
      var run = { text: segment };
      if(Object.keys(attributes).length > 0)
        run.attributes = attributes;
      lines[lines.length - 1].push(run);
    });
  });

  return lines.map(function(runs, i){
    var element = { type: type, text: runs.map(function(r){ return r.text; }).join(''), runs: runs };
    if(i > 0)
      element.tight = true;
    return element;
  });
}

//Whether the paragraph or its style carries a switched-on attribute whose name matches.
function hasFlag(para, style, namePattern){
  return [para, style].some(function(node){
    return node && Array.from(node.attributes).some(function(attribute){
      return namePattern.test(attribute.name) && isOn(attribute.value);
    });
  });
}

function isOn(value){
  return /^(1|true|yes)$/i.test(value || '');
}

module.exports = {
  screenplayToPrintHtml,
  elementsToFdx,
  parseFdx,
  parseFadeIn
};
