//HTML -> Quill delta. Pure string/DOM work with `DOMParser` as its only global, the same shape
//docx-import.js's docxToDelta has and for the same reason: nothing here needs the OS, so nothing
//here crosses the platform contract. The epub importer reads an archive natively and then hands
//each chapter's XHTML to this file, so everything below has to work on a document fragment as
//happily as on a whole page.
//
//What it is *not* built on: Quill's own clipboard (`dangerouslyPasteHTML`). Its matchStyles
//(modules/clipboard.js) guards on `node.style.fontStyle` - the inline style *attribute* - before it
//ever consults the computed style, so a document that marks italics with a class (a Google Docs
//export, or Project Gutenberg's own .right/.poem/.letter2 blocks) loses every one of them. It also
//needs a live Quill in the DOM and real layout (matchSpacing reads offsetHeight/offsetTop), neither
//of which an importer has. getComputedStyle against a hidden iframe was the other candidate and is
//rejected because jsdom's cascade is only partial - font-style inherits through it, text-align set
//on a <div> does not reach a child <p> - so the importer would behave one way in the app and
//another way under the test suite. Hence the small explicit resolver in collectStyleRules below.
const { logError } = require('./error-log');

//Everything Quill is configured to hold (render.js's `formats` list) that HTML can express. There is
//no link, image, code-block, color or size format, so anything carrying one of those arrives as
//plain text and the markup around it is dropped.
const ITALIC_TAGS = { I: true, EM: true, CITE: true, VAR: true, DFN: true, ADDRESS: true };
const BOLD_TAGS = { B: true, STRONG: true };
const UNDERLINE_TAGS = { U: true, INS: true };
const STRIKE_TAGS = { S: true, STRIKE: true, DEL: true };

//Dropped whole, subtree and all. Images are in here rather than being turned into a placeholder:
//the format cannot hold one, and a line of alt text where a picture was is worse than nothing in a
//manuscript. <head>'s children are listed too, so this works on a fragment that was never wrapped
//in a <body>.
const DROPPED_TAGS = {
  SCRIPT: true, STYLE: true, HEAD: true, TITLE: true, LINK: true, META: true, BASE: true,
  IMG: true, PICTURE: true, SOURCE: true, SVG: true, MATH: true, CANVAS: true, MAP: true, AREA: true,
  VIDEO: true, AUDIO: true, TRACK: true, IFRAME: true, OBJECT: true, EMBED: true, PARAM: true,
  NOSCRIPT: true, TEMPLATE: true,
  FORM: true, INPUT: true, BUTTON: true, SELECT: true, OPTION: true, TEXTAREA: true
};

//Tags that end the line they are in. `display: block`/`list-item` from the stylesheet adds to this
//at resolve time - a <span class="xhtml_center"> with `display: block` is a paragraph, and Gutenberg
//writes exactly that.
const BLOCK_TAGS = {
  P: true, DIV: true, H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
  BLOCKQUOTE: true, LI: true, UL: true, OL: true, DL: true, DT: true, DD: true, PRE: true,
  SECTION: true, ARTICLE: true, HEADER: true, FOOTER: true, ASIDE: true, NAV: true, MAIN: true,
  FIGURE: true, FIGCAPTION: true, CENTER: true, ADDRESS: true, FIELDSET: true, DETAILS: true,
  SUMMARY: true, HGROUP: true, CAPTION: true
};

//The only declarations that can change the output. Everything else in a stylesheet - margins,
//fonts, colors, page breaks - has nowhere to go in a delta, so it is never parsed.
const READ_PROPERTIES = {
  'font-style': true, 'font-weight': true, 'text-decoration': true, 'text-decoration-line': true,
  'text-align': true, 'white-space': true, 'display': true
};

const ALIGNMENTS = { left: true, right: true, center: true, justify: true };

//Project Gutenberg wraps its licence header and footer in these, and marks the boundary in the text
//as well for files old enough to predate the elements. Both are only consulted when the caller asks
//for boilerplate stripping - this is the one format-specific hack in the importer, and it earns its
//place because a Gutenberg download is the most likely thing a writer has to hand.
const PG_BOILERPLATE_SELECTOR = '#pg-header, #pg-footer, .pg-boilerplate, .pgheader';
const PG_START_MARKER = /^\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK\b/i;
const PG_END_MARKER = /^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK\b/i;

//A scene break has no format of its own here, so an <hr> becomes the manuscript convention for one.
//Not emitted when the caller is splitting chapters at rules - the break has become the chapter
//boundary at that point, and every chapter would otherwise open with a stray marker.
const SCENE_BREAK = '* * *';

function convertHtmlToDelta(html, options){
  var opts = withDefaults(options);
  var doc = parseHtml(html);

  if(!doc || !doc.body)
    return [{ ops: [] }];

  if(opts.stripBoilerplate)
    removeAll(doc, PG_BOILERPLATE_SELECTOR);

  var styleIndex = collectStyleRules(doc, opts.extraCss);

  //Gutenberg's stylesheet opens with `body { text-align: justify }`, which taken literally puts an
  //align attribute on every paragraph of a book where nothing was deliberately aligned at all. So
  //the document's own baseline is read first and only blocks that *differ* from it are marked.
  var bodyAlign = readAlign(doc.body, styleIndex) || readAlign(doc.documentElement, styleIndex) || null;

  var context = {
    styleIndex: styleIndex,
    bodyAlign: bodyAlign,
    options: opts
  };

  var sink = createSink();
  sink.splitHeadingLevel = opts.splitChapters.headingLevel;
  sink.splitIds = opts.splitChapters.atIds;

  walkChildren(doc.body, sink, context, {}, bodyAlign, false);
  flush(sink, sink.blockAttrs, false);

  var ops = opts.stripBoilerplate ? trimToGutenbergMarkers(sink.ops) : sink.ops;
  //Recorded against the pre-trim ops, so they move with it.
  var splitPoints = adjustSplitPoints(sink.splitPoints, sink.ops, ops);

  return splitOps(ops, splitPoints);
}

//The two ways of splitting are independent of each other, and neither happens unless it is asked
//for: a headingLevel of null means "do not split at headings", which is what a bare call gets, and
//what the epub importer wants when it is already splitting by table-of-contents entry. A single
//`split` flag gating both was the obvious shape and the wrong one - it makes "split at horizontal
//rules" silently do nothing whenever the heading box happens to be unticked.
function withDefaults(options){
  var opts = options || {};
  var split = opts.splitChapters || {};
  var level = parseInt(split.headingLevel, 10);

  return {
    splitChapters: {
      headingLevel: isNaN(level) ? null : Math.min(4, Math.max(1, level)),
      atRules: split.atRules === true,
      atIds: idSet(split.atIds)
    },
    //Stylesheets the document links to rather than carrying inline. An epub chapter is written
    //`<link href="0.css" rel="stylesheet"/>` and has no <style> block at all - every chapter of
    //every sample book is - so without this an epub resolves no class-driven styling whatsoever,
    //which is the exact failure the resolver above exists to prevent, arriving through the back
    //door. Collected ahead of the document's own <style> blocks, because a linked sheet sits
    //earlier in <head> and source order is what stands in for specificity here.
    extraCss: Array.isArray(opts.extraCss) ? opts.extraCss : [],
    stripBoilerplate: opts.stripBoilerplate === true
  };
}

//Splitting in front of the element carrying a given id, which is how an epub's table of contents
//names a chapter that shares a document with others ("chapter_3.xhtml#pgepubid00116"). Null unless
//asked for, so it costs nothing on the paths that do not use it.
function idSet(ids){
  if(!Array.isArray(ids) || ids.length === 0)
    return null;

  var set = {};
  ids.forEach(function(id){
    if(typeof id === 'string' && id !== '')
      set[id] = true;
  });

  return Object.keys(set).length > 0 ? set : null;
}

//Always parsed as text/html, never application/xhtml+xml, even for the .xhtml an epub is made of:
//the HTML parser never rejects a document, and a book that is one unescaped ampersand away from
//being well-formed XML is still a book the writer wants imported.
function parseHtml(html){
  if(typeof html !== 'string')
    return null;

  try{
    return new DOMParser().parseFromString(html, 'text/html');
  }
  catch(err){
    logError(err);
    return null;
  }
}

function removeAll(doc, selector){
  var found;

  try{
    found = doc.querySelectorAll(selector);
  }
  catch(err){
    return;
  }

  for(let i=0;i<found.length;i++){
    if(found[i].parentNode)
      found[i].parentNode.removeChild(found[i]);
  }
}

// --- style resolution ---------------------------------------------------------------------------

//The whole answer to "some mark italics with <i> and others with styles". Every <style> block in the
//document becomes a list of { selector, declarations }, resolved per element with the DOM's own
//el.matches() in source order and then overlaid with the element's own style attribute.
//
//Specificity is deliberately not implemented - source order only. A stylesheet that overrides a
//later rule with a higher-specificity earlier one loses, which within these seven properties means
//an occasional wrong italic. That is a fair trade against carrying a CSS engine, and it is the same
//call the docx importer makes when it reads w:i off a run without resolving the style hierarchy.
function collectStyleRules(doc, extraCss){
  var rules = [];
  var styleTags = doc.getElementsByTagName('style');
  //A scratch element to validate each selector against once, so a malformed one is dropped here
  //rather than throwing inside el.matches() for every element in the document.
  var probe = doc.createElement('div');

  //Linked sheets first, then the document's own - the order they would cascade in, given that
  //source order is what stands in for specificity here.
  var sheets = (extraCss || []).slice();
  for(let i=0;i<styleTags.length;i++)
    sheets.push(styleTags[i].textContent || '');

  for(let i=0;i<sheets.length;i++){
    var css = flattenAtRules(stripCssComments(sheets[i]));
    var pattern = /([^{}]+)\{([^{}]*)\}/g;
    var match;

    while((match = pattern.exec(css)) !== null){
      var declarations = parseDeclarations(match[2]);

      if(Object.keys(declarations).length === 0)
        continue;

      //A selector list is split into one rule per selector rather than being handed to matches()
      //whole, so each one can be indexed by what it ends in - see indexRules below.
      splitSelectorList(match[1].trim()).forEach(function(selector){
        try{
          probe.matches(selector);
        }
        catch(err){
          return;
        }

        rules.push({
          selector: selector,
          declarations: declarations,
          order: rules.length,
          key: indexKeyFor(rightmostCompound(selector))
        });
      });
    }
  }

  return indexRules(rules);
}

//Testing every rule against every element is O(rules x elements), and a document where the styling
//is entirely class-driven has a lot of both: a 300-rule, 24,000-element export - the shape Google
//Docs produces for a novel - took 8.3 seconds that way. Each rule is instead filed under whatever
//its *rightmost* compound selector requires an element to have, so an element only ever tests the
//handful of rules that could possibly match it. Same answers, same order, ~90x less work.
function indexRules(rules){
  var index = { byId: {}, byClass: {}, byTag: {}, other: [] };

  rules.forEach(function(rule){
    if(!rule.key){
      //A universal, attribute-only or pseudo-only selector has nothing to file it under, so it is
      //tested against everything - which is correct, and there are never many of them.
      index.other.push(rule);
      return;
    }

    var bucket = rule.key.type === 'id' ? index.byId
      : rule.key.type === 'class' ? index.byClass
      : index.byTag;

    if(!bucket[rule.key.value])
      bucket[rule.key.value] = [];
    bucket[rule.key.value].push(rule);
  });

  return index;
}

//Commas, and the combinators below, only separate when they are not inside a bracket, a paren or a
//string - `:not(a, b)` and `[title="x y"]` are each one selector.
function splitSelectorList(selector){
  var selectors = [];
  var current = '';

  scanSelector(selector, function(character, isTopLevel){
    if(character === ',' && isTopLevel){
      selectors.push(current.trim());
      current = '';
      return;
    }
    current += character;
  });

  selectors.push(current.trim());

  return selectors.filter(function(one){
    return one !== '';
  });
}

//The part of a selector that describes the element it actually selects: everything after the last
//top-level combinator. `div.chapter > p.first` selects on `p.first`.
function rightmostCompound(selector){
  var start = 0;
  var position = 0;

  scanSelector(selector, function(character, isTopLevel){
    if(isTopLevel && (character === ' ' || character === '>' || character === '+'
      || character === '~' || character === '\t' || character === '\n'))
      start = position + 1;
    position++;
  });

  return selector.slice(start);
}

function scanSelector(selector, callback){
  var depth = 0;
  var quote = null;

  for(let i=0;i<selector.length;i++){
    var character = selector[i];

    if(quote){
      if(character === quote && selector[i - 1] !== '\\')
        quote = null;
      callback(character, false);
      continue;
    }

    if(character === '"' || character === '\''){
      quote = character;
      callback(character, false);
      continue;
    }

    if(character === '(' || character === '[')
      depth++;
    else if(character === ')' || character === ']')
      depth--;

    callback(character, depth === 0);
  }
}

//An id is the most selective thing a compound can require, then a class, then a tag. Anything else
//- `*`, `[lang]`, `:first-child` - has no key and is tested against every element.
//
//The parenthesised and bracketed parts are dropped first: what is inside them is a condition on the
//element, not something the element must *have*. Reading them would file `p:not(.a, .b)` under class
//"a" - a class the elements it selects are guaranteed not to carry - and the rule would never be
//tested against anything.
function indexKeyFor(rawCompound){
  var compound = bareCompound(rawCompound);
  var id = /#([\w-]+)/.exec(compound);
  if(id)
    return { type: 'id', value: id[1] };

  var className = /\.([\w-]+)/.exec(compound);
  if(className)
    return { type: 'class', value: className[1] };

  var tag = /^([a-zA-Z][\w-]*)/.exec(compound);
  if(tag)
    return { type: 'tag', value: tag[1].toUpperCase() };

  return null;
}

function bareCompound(compound){
  var bare = '';

  scanSelector(compound, function(character, isTopLevel){
    //")" and "]" arrive flagged top-level, since the depth is decremented before the callback runs.
    if(isTopLevel && character !== ')' && character !== ']')
      bare += character;
  });

  return bare;
}

function candidateRules(el, index){
  var candidates = index.other;
  var tag = el.tagName ? el.tagName.toUpperCase() : '';

  if(index.byTag[tag])
    candidates = candidates.concat(index.byTag[tag]);

  if(el.id && index.byId[el.id])
    candidates = candidates.concat(index.byId[el.id]);

  var classes = el.classList || [];
  for(let i=0;i<classes.length;i++){
    if(index.byClass[classes[i]])
      candidates = candidates.concat(index.byClass[classes[i]]);
  }

  //Source order is what stands in for specificity here, so the buckets have to be put back in it.
  if(candidates.length > 1)
    candidates = candidates.slice().sort(function(a, b){ return a.order - b.order; });

  return candidates;
}

function stripCssComments(css){
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

//Unwraps the at-rules whose contents are ordinary rules (@media, @supports, @layer) so what is
//inside them is seen, and drops the ones whose contents must never be applied - @font-face, @page,
//@keyframes, and a print-only @media, which describes a printed page rather than the document.
function flattenAtRules(css){
  var out = '';
  var i = 0;

  while(i < css.length){
    var at = css.indexOf('@', i);

    if(at < 0){
      out += css.slice(i);
      break;
    }

    out += css.slice(i, at);

    var brace = css.indexOf('{', at);
    var semicolon = css.indexOf(';', at);

    //A statement at-rule (@import, @charset, @namespace) ends at its semicolon and has no block.
    if(brace < 0 || (semicolon > -1 && semicolon < brace)){
      i = semicolon < 0 ? css.length : semicolon + 1;
      continue;
    }

    var prelude = css.slice(at, brace).toLowerCase();
    var end = indexOfMatchingBrace(css, brace);
    var conditional = /^@(?:media|supports|layer|scope)\b/.test(prelude);
    var printOnly = /\bprint\b/.test(prelude) && !/\bscreen\b/.test(prelude);

    if(conditional && !printOnly)
      out += flattenAtRules(css.slice(brace + 1, end));

    i = end + 1;
  }

  return out;
}

function indexOfMatchingBrace(css, openIndex){
  var depth = 0;

  for(let i=openIndex;i<css.length;i++){
    if(css[i] === '{')
      depth++;
    else if(css[i] === '}'){
      depth--;
      if(depth === 0)
        return i;
    }
  }

  return css.length;
}

function parseDeclarations(str){
  var declarations = {};

  str.split(';').forEach(function(declaration){
    var colon = declaration.indexOf(':');
    if(colon < 0)
      return;

    var property = declaration.slice(0, colon).trim().toLowerCase();
    if(!READ_PROPERTIES[property])
      return;

    //!important carries no meaning without specificity to override, so it is only stripped.
    var value = declaration.slice(colon + 1).replace(/!\s*important/i, '').trim().toLowerCase();
    if(value !== '')
      declarations[property] = value;
  });

  return declarations;
}

function resolveStyles(el, index){
  var resolved = {};
  var rules = candidateRules(el, index);

  for(let i=0;i<rules.length;i++){
    var matches = false;

    try{
      matches = el.matches(rules[i].selector);
    }
    catch(err){
      matches = false;
    }

    if(matches)
      assign(resolved, rules[i].declarations);
  }

  var inline = el.getAttribute ? el.getAttribute('style') : null;
  if(inline)
    assign(resolved, parseDeclarations(inline));

  return resolved;
}

function readAlign(el, styleIndex){
  if(!el)
    return null;

  var align = resolveStyles(el, styleIndex)['text-align'];
  return ALIGNMENTS[align] ? align : null;
}

// --- the delta sink -----------------------------------------------------------------------------

//`pending` holds the inline ops of the line being built; `ops` is everything already closed. Every
//newline is pushed as an op of its own rather than being appended to a text op, which is what makes
//splitOps below able to cut at a line boundary without reparsing anything.
function createSink(){
  return {
    ops: [],
    pending: [],
    blockAttrs: {},
    //Set by a text node inside `white-space: pre`, so flush knows not to trim the line's edges.
    rawPending: false,
    //HTML drops one newline directly after <pre>; this carries that from the element to the first
    //text node inside it, wherever that turns out to be.
    stripLeadingNewline: false,
    //Null unless the caller asked for a heading split, which is what stops flush recording one.
    splitHeadingLevel: null,
    //Null unless the caller named element ids to split in front of.
    splitIds: null,
    //{ index, id } rather than a bare index: a chapter that began at a named id has to say which
    //one, so the epub importer can pair it back up with the table-of-contents entry that named it.
    //id is null for a heading or horizontal-rule split.
    splitPoints: []
  };
}

//Index 0 is recorded like any other. It produces no delta of its own - splitOps only cuts where the
//boundary is past the content it has accumulated - but it still carries the id, which is how the
//*first* chapter of a document gets paired with the table-of-contents entry that named it. Skipping
//it, as an earlier version did on the grounds that nothing is split there, silently lost that one.
function recordSplit(sink, id){
  var last = sink.splitPoints[sink.splitPoints.length - 1];

  //A named id sitting on (or just inside) a heading records both a heading split and an id split at
  //the same place. One boundary, and the id is the more informative of the two.
  if(last && last.index === sink.ops.length){
    if(id != null)
      last.id = id;
    return;
  }

  sink.splitPoints.push({ index: sink.ops.length, id: id == null ? null : id });
}

function pushText(sink, text, inline, raw){
  if(text === '')
    return;

  var op = { insert: text };
  var keys = Object.keys(inline);

  if(keys.length > 0)
    op.attributes = assign({}, inline);

  sink.pending.push(op);

  if(raw)
    sink.rawPending = true;
}

//`force` emits the line even with nothing pending, which is what a <br> against an empty line means:
//a deliberately blank paragraph. Without it two consecutive <br>s would collapse into one break.
function flush(sink, blockAttrs, force){
  if(!sink.rawPending)
    trimLineEdges(sink);

  sink.rawPending = false;

  if(sink.pending.length === 0 && !force)
    return;

  var attributes = blockAttrs && Object.keys(blockAttrs).length > 0 ? assign({}, blockAttrs) : null;

  //Recorded before the line's own ops are pushed, so the split lands in front of the heading rather
  //than behind it.
  if(attributes && attributes.header === sink.splitHeadingLevel)
    recordSplit(sink, null);

  for(let i=0;i<sink.pending.length;i++)
    sink.ops.push(sink.pending[i]);

  var newline = { insert: '\n' };
  if(attributes)
    newline.attributes = attributes;
  sink.ops.push(newline);

  sink.pending = [];
}

//HTML drops the whitespace at either edge of a block, so `<p>\n  text\n</p>` is "text" and not
//" text ". Missing this puts a stray space on both ends of every paragraph of a Gutenberg book,
//which writes its prose one wrapped line per source line. Only the plain space is trimmed - a
//non-breaking space is content the writer typed.
//Both edges are walked inward rather than trimmed once, because the whitespace at a block's edge is
//not always the same op as the text it sits against. `<p>\n  <a> Text </a>\n</p>` puts the closing
//newline in a text node of its own, so trimming only the last op trims *that* one to nothing and
//leaves the real last op's trailing space behind - which is how every entry of Moby-Dick's contents
//page came in as "ETYMOLOGY. " with a space on the end.
function trimLineEdges(sink){
  var pending = sink.pending;

  while(pending.length > 0){
    pending[0].insert = pending[0].insert.replace(/^ +/, '');
    if(pending[0].insert !== '')
      break;
    pending.shift();
  }

  while(pending.length > 0){
    var last = pending[pending.length - 1];
    last.insert = last.insert.replace(/ +$/, '');
    if(last.insert !== '')
      break;
    pending.pop();
  }

  //An op left empty in the middle of a line carries nothing and would only survive as a zero-length
  //insert for coalesce to merge away later.
  sink.pending = pending.filter(function(op){
    return op.insert !== '';
  });
}

// --- the walk -----------------------------------------------------------------------------------

function walkChildren(node, sink, context, inline, align, pre){
  var children = node.childNodes;

  for(let i=0;i<children.length;i++)
    walk(children[i], sink, context, inline, align, pre);
}

function walk(node, sink, context, inline, align, pre){
  if(node.nodeType === 3){
    walkText(node, sink, inline, pre);
    return;
  }

  if(node.nodeType !== 1)
    return;

  var tag = node.tagName ? node.tagName.toUpperCase() : '';

  if(DROPPED_TAGS[tag])
    return;

  var styles = resolveStyles(node, context.styleIndex);

  if(styles.display === 'none')
    return;

  //An epub's table of contents names a chapter by the id of the element it starts at, and several
  //chapters routinely share one document. Splitting is done here, positionally, rather than by
  //carving up the DOM: the anchor is sometimes the chapter's own top-level block (Moby-Dick) and
  //sometimes a heading buried inside a wrapper that holds several chapters at once (Frankenstein's
  //title page has two entries inside one <div>), and "everything from this element to the next one"
  //is the same rule in both cases only when it is expressed against the output rather than the tree.
  if(sink.splitIds && node.id && sink.splitIds[node.id]){
    flush(sink, sink.blockAttrs, false);
    recordSplit(sink, node.id);
  }

  if(tag === 'BR'){
    flush(sink, sink.blockAttrs, true);
    return;
  }

  if(tag === 'HR'){
    walkRule(sink, context);
    return;
  }

  var nextInline = inlineAttributesFor(tag, styles, inline);
  var nextAlign = ALIGNMENTS[styles['text-align']] ? styles['text-align'] : align;
  var nextPre = pre || tag === 'PRE' || /^pre/.test(styles['white-space'] || '');

  if(tag === 'TABLE'){
    walkTable(node, sink, context, nextInline, nextAlign, nextPre);
    return;
  }

  var isBlock = BLOCK_TAGS[tag] || styles.display === 'block' || styles.display === 'list-item';

  if(!isBlock){
    walkChildren(node, sink, context, nextInline, nextAlign, nextPre);
    return;
  }

  //The line already in progress belongs to whatever block encloses this one, so it is closed with
  //*that* block's attributes before this element takes over. `<div>loose text<p>para</p></div>`
  //would otherwise hand "loose text" the paragraph's attributes rather than the div's.
  flush(sink, sink.blockAttrs, false);

  var enclosing = sink.blockAttrs;
  sink.blockAttrs = blockAttributesFor(node, tag, styles, align, context);

  //HTML drops a single newline immediately after <pre>, and Gutenberg's poem blocks rely on it.
  if(tag === 'PRE')
    sink.stripLeadingNewline = true;

  walkChildren(node, sink, context, nextInline, nextAlign, nextPre);

  flush(sink, sink.blockAttrs, false);
  sink.blockAttrs = enclosing;
  sink.stripLeadingNewline = false;
}

function walkText(node, sink, inline, pre){
  var text = node.data == null ? '' : node.data;

  if(pre){
    if(sink.stripLeadingNewline){
      text = text.replace(/^\r?\n/, '');
      sink.stripLeadingNewline = false;
    }

    //Every newline is a block boundary in this format - there is no soft break - so a <pre> of
    //fifty lines becomes fifty paragraphs rather than one op carrying its own newlines.
    var lines = text.replace(/\r\n?/g, '\n').split('\n');

    for(let i=0;i<lines.length;i++){
      pushText(sink, lines[i], inline, true);
      if(i < lines.length - 1)
        flush(sink, sink.blockAttrs, true);
    }

    return;
  }

  //\s is deliberately not used: it matches U+00A0, and a non-breaking space is content rather than
  //layout whitespace.
  var collapsed = text.replace(/[\t\n\r\f\v]/g, ' ').replace(/ {2,}/g, ' ');

  //Whitespace between two block elements - the newline in `</p>\n<p>` - is layout, not a word gap.
  if(collapsed.trim() === '' && sink.pending.length === 0)
    return;

  pushText(sink, collapsed, inline, false);
}

function walkRule(sink, context){
  flush(sink, sink.blockAttrs, false);

  if(context.options.splitChapters.atRules){
    recordSplit(sink, null);
    return;
  }

  pushText(sink, SCENE_BREAK, {}, false);
  flush(sink, { align: 'center' }, false);
}

function inlineAttributesFor(tag, styles, inline){
  var next = assign({}, inline);
  var fontStyle = styles['font-style'];
  var fontWeight = styles['font-weight'];
  //text-decoration is shorthand; either spelling can carry the line.
  var decoration = (styles['text-decoration'] || '') + ' ' + (styles['text-decoration-line'] || '');

  if(ITALIC_TAGS[tag] || fontStyle === 'italic' || fontStyle === 'oblique')
    next.italic = true;
  else if(fontStyle === 'normal')
    delete next.italic;

  if(BOLD_TAGS[tag] || /^(?:bold|bolder|[6-9]00)$/.test(fontWeight || ''))
    next.bold = true;
  else if(fontWeight === 'normal' || fontWeight === 'lighter' || /^[1-4]00$/.test(fontWeight || ''))
    delete next.bold;

  //An <a>'s own underline is browser chrome rather than the writer's emphasis - Gutenberg's
  //stylesheet carries `a { text-decoration: underline }`, and honouring it underlines every link in
  //the book. A <u> nested inside an anchor still counts.
  if(UNDERLINE_TAGS[tag] || (tag !== 'A' && /underline/.test(decoration)))
    next.underline = true;
  if(STRIKE_TAGS[tag] || (tag !== 'A' && /line-through/.test(decoration)))
    next.strike = true;

  if(/\bnone\b/.test(decoration) && !UNDERLINE_TAGS[tag] && !STRIKE_TAGS[tag]){
    delete next.underline;
    delete next.strike;
  }

  return next;
}

function blockAttributesFor(el, tag, styles, inheritedAlign, context){
  var attributes = {};
  var heading = /^H([1-6])$/.exec(tag);

  //The format tops out at four heading levels (see mdfc-to-html.js), so h5/h6 clamp rather than
  //arriving as a level nothing downstream can write.
  if(heading)
    attributes.header = Math.min(4, parseInt(heading[1], 10));

  if(tag === 'BLOCKQUOTE')
    attributes.blockquote = true;

  if(tag === 'LI'){
    attributes.list = listTypeFor(el);
    var indent = listDepthFor(el);
    if(indent > 0)
      attributes.indent = Math.min(3, indent);
  }

  var align = ALIGNMENTS[styles['text-align']] ? styles['text-align'] : inheritedAlign;

  if(align && align !== context.bodyAlign && ALIGNMENTS[align])
    attributes.align = align;

  return attributes;
}

function listTypeFor(el){
  var node = el.parentNode;

  while(node && node.nodeType === 1){
    var tag = node.tagName ? node.tagName.toUpperCase() : '';
    if(tag === 'OL')
      return 'ordered';
    if(tag === 'UL' || tag === 'MENU')
      return 'bullet';
    node = node.parentNode;
  }

  //A stray <li> the parser never gave a list to still reads as a list item.
  return 'bullet';
}

function listDepthFor(el){
  var depth = -1;
  var node = el.parentNode;

  while(node && node.nodeType === 1){
    var tag = node.tagName ? node.tagName.toUpperCase() : '';
    if(tag === 'UL' || tag === 'OL' || tag === 'MENU')
      depth++;
    node = node.parentNode;
  }

  return depth < 0 ? 0 : depth;
}

// --- tables -------------------------------------------------------------------------------------

//There is no table format, and inventing one is not the job - but silently flattening a table loses
//which words shared a row. Tables in fiction are almost always *layout* tables rather than data
//ones (of the three sample books, one's table is a two-column contents list and the other's is the
//Etymology column list; neither has a header row), so each row becomes one line of markdown pipe
//syntax and the writer reformats from there. No header separator row is emitted: guessing which row
//of a layout table is a heading is wrong more often than not, and a writer who wants one can add it.
function walkTable(table, sink, context, inline, align, pre){
  flush(sink, sink.blockAttrs, false);

  var enclosing = sink.blockAttrs;
  var rowAttrs = {};
  var styles = resolveStyles(table, context.styleIndex);
  var tableAlign = ALIGNMENTS[styles['text-align']] ? styles['text-align'] : align;

  if(tableAlign && tableAlign !== context.bodyAlign)
    rowAttrs.align = tableAlign;

  var caption = firstCaption(table);
  if(caption){
    sink.blockAttrs = rowAttrs;
    walkChildren(caption, sink, context, inline, tableAlign, pre);
    flush(sink, sink.blockAttrs, false);
  }

  var rows = collectRows(table);
  var columns = 0;

  rows.forEach(function(row){
    columns = Math.max(columns, row.length);
  });

  rows.forEach(function(cells){
    //A single-column table is a layout device with nothing to align - pipes around every cell would
    //be pure noise, so its cells come through as ordinary paragraphs. Gutenberg's contents list is
    //exactly this shape.
    if(columns <= 1){
      cells.forEach(function(cell){
        sink.blockAttrs = rowAttrs;
        walkChildren(cell, sink, context, inline, tableAlign, pre);
        flush(sink, sink.blockAttrs, false);
      });
      return;
    }

    pushText(sink, '|', {}, false);

    for(let i=0;i<columns;i++){
      var cellOps = i < cells.length ? inlineOpsFor(cells[i], context, inline, tableAlign, pre) : [];

      pushText(sink, ' ', {}, false);
      cellOps.forEach(function(op){
        sink.pending.push(op);
      });
      pushText(sink, ' |', {}, false);
    }

    //Trimming the row's edges would eat the opening and closing pipe's padding, so the row is
    //emitted raw.
    sink.rawPending = true;
    flush(sink, rowAttrs, false);
  });

  sink.blockAttrs = enclosing;
}

function firstCaption(table){
  for(let i=0;i<table.childNodes.length;i++){
    var child = table.childNodes[i];
    if(child.nodeType === 1 && child.tagName && child.tagName.toUpperCase() === 'CAPTION')
      return child;
  }
  return null;
}

//Rows belonging to a nested table are left to that table's own conversion, so the collection stops
//descending wherever it meets one.
function collectRows(table){
  var rows = [];

  (function descend(node){
    for(let i=0;i<node.childNodes.length;i++){
      var child = node.childNodes[i];
      if(child.nodeType !== 1)
        continue;

      var tag = child.tagName ? child.tagName.toUpperCase() : '';

      if(tag === 'TABLE')
        continue;
      if(tag === 'TR')
        rows.push(collectCells(child));
      else
        descend(child);
    }
  })(table);

  return rows;
}

function collectCells(row){
  var cells = [];

  for(let i=0;i<row.childNodes.length;i++){
    var child = row.childNodes[i];
    if(child.nodeType !== 1)
      continue;

    var tag = child.tagName ? child.tagName.toUpperCase() : '';
    if(tag === 'TD' || tag === 'TH')
      cells.push(child);
  }

  return cells;
}

//A cell's content as inline ops only. It goes through the same walk - so a <i> or a styled <span>
//inside a cell keeps its formatting - and whatever block structure the cell had collapses to single
//spaces, since the row it belongs to is one line.
function inlineOpsFor(cell, context, inline, align, pre){
  var sub = createSink();

  walkChildren(cell, sub, context, inline, align, pre);
  flush(sub, sub.blockAttrs, false);

  var ops = [];

  sub.ops.forEach(function(op){
    if(op.insert === '\n'){
      if(ops.length > 0)
        ops.push({ insert: ' ' });
      return;
    }
    ops.push(op);
  });

  //A pipe inside a cell would read as a cell boundary, so it is escaped the way markdown escapes it.
  ops.forEach(function(op){
    op.insert = op.insert.replace(/\|/g, '\\|');
  });

  return trimOps(ops);
}

function trimOps(ops){
  if(ops.length === 0)
    return ops;

  ops[0].insert = ops[0].insert.replace(/^ +/, '');
  ops[ops.length - 1].insert = ops[ops.length - 1].insert.replace(/ +$/, '');

  return ops.filter(function(op){
    return op.insert !== '';
  });
}

// --- boilerplate and splitting ------------------------------------------------------------------

//For files old enough to predate Gutenberg's #pg-header/#pg-footer elements, the licence boundary is
//only in the text. Everything up to and including the START line, and from the END line on, is
//dropped. Either marker missing just means that end is left alone.
function trimToGutenbergMarkers(ops){
  var start = 0;
  var end = ops.length;

  forEachLine(ops, function(line){
    if(PG_START_MARKER.test(line.text))
      start = line.endIndex + 1;
    else if(PG_END_MARKER.test(line.text) && line.startIndex >= start && end === ops.length)
      end = line.startIndex;
  });

  return start === 0 && end === ops.length ? ops : ops.slice(start, end);
}

function forEachLine(ops, callback){
  var startIndex = 0;
  var text = '';

  for(let i=0;i<ops.length;i++){
    if(ops[i].insert === '\n'){
      callback({ startIndex: startIndex, endIndex: i, text: text.trim() });
      startIndex = i + 1;
      text = '';
    }
    else if(typeof ops[i].insert === 'string')
      text += ops[i].insert;
  }

  if(startIndex < ops.length)
    callback({ startIndex: startIndex, endIndex: ops.length - 1, text: text.trim() });
}

//Split points were recorded as indices into the untrimmed ops, so trimming the boilerplate off the
//front moves every one of them.
function adjustSplitPoints(splitPoints, originalOps, trimmedOps){
  if(originalOps === trimmedOps)
    return splitPoints;
  if(trimmedOps.length === 0)
    return [];

  var offset = originalOps.indexOf(trimmedOps[0]);
  if(offset < 0)
    offset = originalOps.length - trimmedOps.length;

  return splitPoints
    .map(function(point){ return { index: point.index - offset, id: point.id }; })
    //>= 0, not > 0: a boundary that lands exactly on the start of the trimmed range still names the
    //chapter that begins there, even though it cuts nothing.
    .filter(function(point){ return point.index >= 0 && point.index < trimmedOps.length; });
}

//`splitId` is present only on a delta that actually began at one of the ids the caller named, so
//every other caller keeps getting a plain { ops } back and nothing downstream has to know this
//exists. It is what lets the epub importer pair a chapter with the table-of-contents entry that
//named it, without having to count deltas and hope the arithmetic lines up - a document with front
//matter ahead of its first anchor returns one more delta than it has entries.
function makeDelta(ops, splitId){
  var delta = { ops: ops };

  if(splitId != null)
    delta.splitId = splitId;

  return delta;
}

function splitOps(ops, splitPoints){
  var deltas = [];
  var start = 0;
  var startedAt = null;

  splitPoints.forEach(function(point){
    if(point.index > start)
      deltas.push(makeDelta(ops.slice(start, point.index), startedAt));
    start = point.index;
    startedAt = point.id;
  });

  deltas.push(makeDelta(ops.slice(start), startedAt));

  //An empty leading fragment (a heading as the very first line) would arrive as a chapter with no
  //content at all, which is not a chapter. Callers are promised at least one delta back, even for
  //a document that turned out to hold no text.
  var kept = deltas.filter(function(delta){
    return delta.ops.length > 0;
  });

  if(kept.length === 0)
    kept.push(makeDelta([], null));

  kept.forEach(function(delta){
    delta.ops = coalesce(delta.ops);
  });

  return kept;
}

//Every newline is its own op while the delta is being built, because that is what lets the boilerplate
//trim and the chapter split cut at a line boundary without reparsing. That invariant has done its job
//by the time a delta is returned, and leaving it in place would hand the editor a table row as a dozen
//one-character ops. Runs of text sharing the same attributes are merged back together here - never
//across a newline, so a line still ends in exactly one op carrying the block's attributes.
function coalesce(ops){
  var merged = [];

  for(let i=0;i<ops.length;i++){
    var op = ops[i];
    var previous = merged[merged.length - 1];

    if(previous
      && typeof previous.insert === 'string' && typeof op.insert === 'string'
      && previous.insert.indexOf('\n') < 0 && op.insert.indexOf('\n') < 0
      && sameAttributes(previous.attributes, op.attributes)){
      previous.insert += op.insert;
      continue;
    }

    merged.push(op);
  }

  return merged;
}

function sameAttributes(a, b){
  var aKeys = a ? Object.keys(a) : [];
  var bKeys = b ? Object.keys(b) : [];

  if(aKeys.length !== bKeys.length)
    return false;

  return aKeys.every(function(key){
    return a[key] === b[key];
  });
}

function assign(target, source){
  Object.keys(source).forEach(function(key){
    target[key] = source[key];
  });
  return target;
}

module.exports = {
  convertHtmlToDelta
};
