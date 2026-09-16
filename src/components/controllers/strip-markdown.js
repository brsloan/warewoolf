//GitHub hands a release's notes back as the markdown the author wrote them in, and About has
//nowhere to render markdown: the notes land in a <p> through innerText, so every marker used to
//arrive on screen as itself - "### Fixed", "**Blockquotes.**", "[Keep a Changelog](https://...)".
//This turns that body into the plain text the element was always going to show: the words and the
//shape of the notes are kept - a heading on its own line, one bullet per item - and only the syntax
//goes.
//
//It is a stripper, not a parser. Nothing in WareWoolf renders markdown, so there is no document
//shape to be faithful to, only a reading; where the two pull apart this keeps the writer's own
//characters rather than guessing at markup. An asterisk that opens nothing stays an asterisk.
//
//Deliberately its own module rather than a few replaces in updates.js: what counts as a marker is a
//body of rules with edges worth testing on their own (a snake_case word is not italics, a marker
//inside a code span is not a marker), and none of it has anything to do with checking for updates.

//A fence opens with three or more backticks or tildes and closes with at least as many of the same
//character. Everything between is code, which is already plain text - the one place in a release
//note where a "#" or a "*" is the author's character rather than a marker, so the lines come
//through untouched.
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

//Three or more of one character, alone on the line, optionally spaced: "---", "***", "- - -".
//Checked before the list rules, since "- - -" would otherwise read as a bullet holding "- -".
const HORIZONTAL_RULE = /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

//Trailing hashes are the closing half of a heading a writer chose to close, not text: "## Fixed ##".
const ATX_HEADING = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;

//A setext underline only means anything with a paragraph directly above it, which is why this is
//matched by looking ahead from that paragraph rather than at the line itself. A "---" with nothing
//above it has already been read as a rule by then.
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-+)[ \t]*$/;

//Quotation markers, however deep the nesting: "> > quoted". The quotation's own words stay.
const BLOCKQUOTE = /^[ \t]{0,3}(?:>[ \t]?)+/;

//"[label]: https://..." - a link definition, which is markup with no words in it at all. The
//references pointing at it are turned into their own text by stripInline below, so dropping the
//line loses nothing a reader would have seen.
const LINK_DEFINITION = /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*\S+/;

//A shortcut reference is a label standing on its own - "[3.0.0]" against a "[3.0.0]: https://..."
//somewhere below - and it is a link only because that definition exists. So the definitions are
//gathered before anything is stripped, and a bracketed label is unwrapped only where one of them
//answers it. Everything else in brackets is the author's own, and keeps its brackets.
const SHORTCUT_REFERENCE = /\[([^\]\[]+)\]/g;

const UNORDERED_ITEM = /^([ \t]*)[-*+][ \t]+(.*)$/;
const ORDERED_ITEM = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;

//A task list's box is markup for GitHub's renderer - there is no box to tick here - so it comes off
//and leaves the item's words behind the same bullet every other item gets.
const TASK_BOX = /^\[[ xX]\][ \t]+/;

//The row of dashes under a table's headings. Its cells hold no words, only alignment.
const TABLE_DELIMITER = /^[ \t]{0,3}\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/;

const TABLE_ROW = /^[ \t]{0,3}\|.*\|[ \t]*$/;

function stripMarkdown(markdown){
  if(markdown == null)
    return '';

  var lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  var definedLabels = collectLinkLabels(lines);
  var stripped = [];
  var openFence = null;

  function plain(text){
    return stripInline(text, definedLabels);
  }

  for(var i = 0; i < lines.length; i++){
    var line = lines[i];
    var fenceEdge = line.match(FENCE);

    if(openFence){
      //A closing fence is the same character, at least as many of it. Anything else inside the
      //block is code and goes through as typed.
      if(fenceEdge && fenceEdge[1][0] === openFence[0] && fenceEdge[1].length >= openFence.length)
        openFence = null;
      else
        stripped.push(line);
      continue;
    }

    if(fenceEdge){
      openFence = fenceEdge[1];
      continue;
    }

    line = line.replace(BLOCKQUOTE, '');

    if(LINK_DEFINITION.test(line))
      continue;

    if(HORIZONTAL_RULE.test(line)){
      //A rule separates what is above from what is below, and a blank line is how plain text says
      //that. Dropping it outright would run two sections together.
      stripped.push('');
      continue;
    }

    var heading = line.match(ATX_HEADING);
    if(heading){
      stripped.push(plain(heading[2] || ''));
      continue;
    }

    //The paragraph half of a setext heading: its own words, with the underline consumed behind it.
    if(line.trim() !== '' && i + 1 < lines.length && SETEXT_UNDERLINE.test(lines[i + 1])){
      stripped.push(plain(line.trim()));
      i++;
      continue;
    }

    if(line.indexOf('|') !== -1 && TABLE_DELIMITER.test(line))
      continue;

    if(TABLE_ROW.test(line)){
      stripped.push(stripTableRow(line, definedLabels));
      continue;
    }

    var unordered = line.match(UNORDERED_ITEM);
    if(unordered){
      //Normalized to one bullet character whichever of "-", "*" or "+" the author used. A bullet is
      //not a marker being stripped - it is what a list looks like in plain text, and the indent it
      //sits at is how a nested item keeps saying it is nested.
      stripped.push(unordered[1] + '- ' + plain(unordered[2].replace(TASK_BOX, '')));
      continue;
    }

    var ordered = line.match(ORDERED_ITEM);
    if(ordered){
      stripped.push(ordered[1] + ordered[2] + '. ' + plain(ordered[3]));
      continue;
    }

    stripped.push(plain(line));
  }

  return tidyBlankLines(stripped.join('\n'));
}

//Gathered ahead of the stripping because a shortcut reference is answered by a definition that may
//sit anywhere in the body, including below the line using it - which is where a changelog pasted
//into a release keeps the whole set of them.
function collectLinkLabels(lines){
  var labels = Object.create(null);

  lines.forEach(function(line){
    var definition = line.match(LINK_DEFINITION);

    if(definition)
      labels[normalizeLabel(definition[1])] = true;
  });

  return labels;
}

//Markdown matches a label to its definition case-insensitively, and treats any run of whitespace in
//one as a single space.
function normalizeLabel(label){
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function stripTableRow(line, definedLabels){
  var cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');

  return cells.map(function(cell){
    return stripInline(cell.trim(), definedLabels);
  }).join(' | ');
}

//What innerText makes of a run of blank lines is a run of empty rows, so the gap a markdown author
//left between sections is worth keeping at one line and no more.
function tidyBlankLines(text){
  return text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

//Set aside by the two rules below and put back verbatim at the end. A placeholder has to be
//something no release note can contain, which is why it is built out of NULs - and why any NUL
//already in the text is dropped before the first one is handed out.
const PLACEHOLDER = /\u0000(\d+)\u0000/g;

function stripInline(text, definedLabels){
  if(text === '')
    return '';

  var held = [];

  function hold(value){
    return '\u0000' + (held.push(value) - 1) + '\u0000';
  }

  var out = String(text).replace(/\u0000/g, '');

  //Code spans first, and held rather than merely unwrapped: a backtick binds tighter than anything
  //else inline, so "`**kwargs`" is a literal `**kwargs` and its asterisks must not reach the
  //emphasis rules below. The fence may be any number of backticks; the closing one matches it.
  out = out.replace(/(`+)([\s\S]*?)\1/g, function(match, ticks, code){
    //CommonMark strips one space at each end of a span padded that way, which is how a span
    //holding a backtick of its own is written: "`` ` ``".
    return hold(code.replace(/^ ([\s\S]*) $/, '$1'));
  });

  //A backslash escape is the author saying "the next character is not a marker", so that character
  //is held out of reach of every rule that would otherwise read it as one.
  out = out.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, function(match, escaped){
    return hold(escaped);
  });

  out = out.replace(/<!--[\s\S]*?-->/g, '');

  //A hard line break written as HTML, which release notes do use. It has to become a real newline
  //before the tag sweep below throws it away as one more tag.
  out = out.replace(/<br\s*\/?>/gi, '\n');

  //Alt text is what an image says in a medium that cannot show it; the URL is the fallback when the
  //author wrote no alt text, since something is better than a gap where a picture was.
  out = out.replace(/!\[([^\]]*)\]\([ \t]*<?([^)<>\s]*)>?[^)]*\)/g, function(match, alt, url){
    return alt || url;
  });

  //An inline link reads as its own text. A link with no text at all - "[](https://...)" - falls
  //back to the URL rather than vanishing.
  out = out.replace(/\[([^\]]*)\]\([ \t]*<?([^)<>\s]*)>?[^)]*\)/g, function(match, label, url){
    return label || url;
  });

  //"[text][label]" and "[text][]", whose definition line has already been dropped above.
  out = out.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1');

  //A bare label, unwrapped only where the body really did define it - see SHORTCUT_REFERENCE.
  if(definedLabels)
    out = out.replace(SHORTCUT_REFERENCE, function(match, label){
      return definedLabels[normalizeLabel(label)] ? label : match;
    });

  //An autolink is a URL wearing angle brackets. Its text is the URL.
  out = out.replace(/<([a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]+)>/g, '$1');
  out = out.replace(/<([^>\s@]+@[^>\s@]+\.[^>\s@]+)>/g, '$1');

  //Whatever HTML is left is markup for a renderer that is not here. Its contents stay.
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, '');

  out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1');

  //Longest run first, so "***both***" is not read as bold with a stray asterisk on each side.
  out = out.replace(/(\*{1,3})(?=\S)([\s\S]*?\S)\1/g, '$2');

  //Underscores are the same markers with one extra condition: a word may contain them. CommonMark
  //will not open emphasis inside a word for exactly that reason, and neither does this - so
  //"snake_case_name" and "warewoolf_3.0.0_Windows_x64.exe" keep every underscore, while
  //"_emphasis_" at a word boundary loses its pair. "__init__" loses its pair too, and should: it
  //opens at a word boundary, so GitHub renders it bold and the reader there saw "init".
  out = out.replace(/(^|[^\w\u0000])(_{1,3})(?=\S)([\s\S]*?\S)\2(?!\w)/g, '$1$3');

  out = decodeEntities(out);

  return out.replace(PLACEHOLDER, function(match, index){
    return held[Number(index)];
  });
}

//Only the handful an author actually writes by hand, plus numeric references. Anything else stays
//as typed: "&foo;" in a release note is far likelier to be the author's own text than an entity
//WareWoolf has failed to recognise.
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…'
};

function decodeEntities(text){
  return text.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]+);/g, function(match, body){
    if(body[0] === '#'){
      var code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);

      if(isNaN(code) || code < 1 || code > 0x10FFFF)
        return match;

      try {
        return String.fromCodePoint(code);
      }
      catch(err){
        return match;
      }
    }

    var named = NAMED_ENTITIES[body.toLowerCase()];

    return named === undefined ? match : named;
  });
}

module.exports = { stripMarkdown };
