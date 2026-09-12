const { getTitlePageValues } = require('./fountain');

//The screenplay's other formats - docs/screenplay-plan.md, Phase 7. Three pure functions over the
//element list the Fountain codec produces: a print page for the PDF, and Final Draft's FDX in both
//directions. Nothing here touches a file; export.js and import.js do that.

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

//A Final Draft title page is free text, not keys. The first line with anything on it is the
//title; a line reading "by" or "written by" is the credit and the line after it the author;
//everything else goes to Notes, which is where nothing is lost.
function parseFdxTitlePage(root){
  var page = childNamed(root, 'TitlePage');
  var content = page ? childNamed(page, 'Content') : null;
  if(!content)
    return [];

  var lines = Array.from(content.children).filter(function(node){ return node.nodeName === 'Paragraph'; }).map(function(node){
    return Array.from(node.children).filter(function(c){ return c.nodeName === 'Text'; }).map(function(c){ return c.textContent; }).join('').trim();
  }).filter(function(line){ return line !== ''; });

  var titlePage = [];
  var notes = [];
  var expectAuthor = false;

  lines.forEach(function(line){
    if(titlePage.length === 0){
      titlePage.push({ key: 'Title', values: [line] });
      return;
    }
    if(/^(written\s+)?by$/i.test(line)){
      titlePage.push({ key: 'Credit', values: [line] });
      expectAuthor = true;
      return;
    }
    if(expectAuthor){
      titlePage.push({ key: 'Author', values: [line] });
      expectAuthor = false;
      return;
    }
    notes.push(line);
  });

  if(notes.length > 0)
    titlePage.push({ key: 'Notes', values: notes });

  return titlePage;
}

function childNamed(node, name){
  return Array.from(node.children).find(function(child){ return child.nodeName === name; }) || null;
}

module.exports = {
  screenplayToPrintHtml,
  elementsToFdx,
  parseFdx
};
