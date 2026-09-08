//EPUB -> chapters. An epub is a zip of XHTML documents plus a manifest, so this file is the manifest
//half and html-import.js is the document half: platform.importEpub hands over the archive's text
//(see the note on that command in platform.js), this works out which parts are chapters and what
//they are called, and every chapter's markup goes through convertHtmlToDelta.
//
//The one structural thing worth knowing before reading it: **the spine is not a chapter list.**
//Gutenberg's epub generator packs many chapters into one XHTML document - Moby-Dick's 141 chapters
//live in 11 documents, one of which holds 22 of them - so importing per spine item gives twelve
//150KB chapters instead of a book. The table of contents is where the real boundaries are, as
//"doc.xhtml#anchor" fragments, and they resolve: 214 of 214 across the three sample books.
//
//  Frankenstein        32 spine items    32 TOC entries
//  Wuthering Heights   37 spine items    36 TOC entries
//  Moby-Dick           12 spine items   146 TOC entries
//
//So the TOC drives the import and the spine is the fallback, which is the reverse of the obvious
//reading of "skip the table of contents and import the chapters".
const { logError } = require('./error-log');
const { convertHtmlToDelta } = require('./html-import');
const { createPlatform } = require('./platform');
const { createIpcBacking } = require('./platform-ipc');

//importEpub takes no injected config - path is a full path - so this holds its own standing
//instance, the same reason docx-import.js/file-manager.js do.
var platform = createPlatform(createIpcBacking());

const CONTAINER_PATH = 'META-INF/container.xml';

function importEpub(filepath, options, cback){
  platform.importEpub({ path: filepath }).then(function(result){
    cback(parseEpub(result.entries, options));
  }).catch(function(err){
    //A read failure is logged and reported as an empty book rather than thrown, so the rest of a
    //multi-file import keeps going - the same policy import.js applies to every other format.
    logError(err);
    cback({ metadata: { title: '', author: '' }, chapters: [] });
  });
}

//Pure function over the archive's text: no platform, no filesystem, no async. Everything the tests
//exercise goes through here.
function parseEpub(entries, options){
  var opts = options || {};
  var empty = { metadata: { title: '', author: '' }, chapters: [] };

  if(!entries)
    return empty;

  var opfPath = findOpfPath(entries);
  if(!opfPath){
    logError(new Error('epub import: no ' + CONTAINER_PATH + ' naming a package document'));
    return empty;
  }

  var opf = parseXml(entries[opfPath]);
  if(!opf){
    logError(new Error('epub import: package document ' + opfPath + ' could not be parsed'));
    return empty;
  }

  var manifest = readManifest(opf, dirnameOf(opfPath));
  var spine = readSpine(opf, manifest);
  var navItem = findNavItem(manifest);
  var navEntries = readNav(entries, opf, manifest, navItem);

  //The navigation document is often in the spine as well - WareWoolf's own exporter puts its
  //generated contents page there, and it is legal and common elsewhere - but it is navigation by
  //the manifest's own declaration, not a chapter of the manuscript. Importing a list of links to
  //the other chapters is noise in every case, so the document declared `properties="nav"` is left
  //out. A contents page written by hand into the prose is a different thing and still imports: it
  //is not what the manifest points at.
  var navPath = navItem ? navItem.href : null;

  return {
    metadata: readMetadata(opf),
    chapters: buildChapters(entries, spine, navEntries, navPath, opts)
  };
}

// --- the package ---------------------------------------------------------------------------------

function findOpfPath(entries){
  var container = parseXml(entries[CONTAINER_PATH]);
  if(!container)
    return null;

  var rootfiles = byLocalName(container, 'rootfile');
  for(let i=0;i<rootfiles.length;i++){
    var fullPath = rootfiles[i].getAttribute('full-path');
    //Resolved against the container's own directory, which is always META-INF/, so a full-path is
    //archive-relative already - but normalized through the same helper as every other href so a
    //"./OEBPS/content.opf" or a backslash cannot slip past.
    if(fullPath)
      return resolveHref('', fullPath);
  }

  return null;
}

//Elements in the XML parts are found by *local* name, never by getElementsByTagName directly. In an
//XML document that method matches the qualified name, so it finds <item> and misses <opf:item> - and
//an epub may declare the OPF namespace with a prefix, without one, or not at all, all three being
//the same book. The same is true of <dc:title>: getElementsByTagName('title') does not find it.
function readManifest(opf, opfDir){
  var manifest = {};
  var manifestEl = byLocalName(opf, 'manifest')[0];

  if(!manifestEl)
    return manifest;

  childrenByLocalName(manifestEl, 'item').forEach(function(item){
    var id = item.getAttribute('id');
    var href = item.getAttribute('href');

    if(!id || !href)
      return;

    manifest[id] = {
      href: resolveHref(opfDir, decodeHref(href)),
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || ''
    };
  });

  return manifest;
}

//`order` is the reading order; `excluded` is what the spine deliberately kept out of it. The two are
//reported separately because the table of contents may still name an excluded document, and an
//explicit "this is not part of the reading order" has to beat the fallback below that picks up
//documents the spine merely forgot.
function readSpine(opf, manifest){
  var spine = { order: [], excluded: {} };
  var spineEl = byLocalName(opf, 'spine')[0];

  if(!spineEl)
    return spine;

  childrenByLocalName(spineEl, 'itemref').forEach(function(ref){
    var item = manifest[ref.getAttribute('idref')];
    if(!item)
      return;

    //linear="no" marks something outside the reading order - a cover wrapper, a pop-up note - which
    //is not a chapter of the book.
    if(ref.getAttribute('linear') === 'no')
      spine.excluded[item.href] = true;
    else
      spine.order.push(item.href);
  });

  return spine;
}

function readMetadata(opf){
  return {
    title: firstMetadataValue(opf, 'title'),
    author: firstMetadataValue(opf, 'creator')
  };
}

//dc:title / dc:creator, by local name so a differently-prefixed or unprefixed document reads the
//same. Restricted to the <metadata> block so a <title> elsewhere in the package cannot win.
function firstMetadataValue(opf, localName){
  var metadataEl = byLocalName(opf, 'metadata')[0];
  var found = byLocalName(metadataEl || opf, localName)[0];

  return found ? collapseSpace(found.textContent || '') : '';
}

// --- the table of contents ------------------------------------------------------------------------

//An EPUB 3 book carries a nav document, an EPUB 2 one carries toc.ncx, and a book built for both
//carries each. The nav document is preferred where present and the ncx is the fallback, which is the
//order the spec puts them in - all three sample books have both and they agree.
function readNav(entries, opf, manifest, navItem){
  if(navItem && entries[navItem.href]){
    var fromNav = readNavDocument(entries[navItem.href], navItem.href);
    if(fromNav.length > 0)
      return fromNav;
  }

  var ncxHref = findNcxHref(opf, manifest);
  if(ncxHref && entries[ncxHref])
    return readNcx(entries[ncxHref], ncxHref);

  return [];
}

function findNavItem(manifest){
  var found = null;

  Object.keys(manifest).forEach(function(id){
    //`properties` is a space-separated token list, so "nav" has to be matched as a whole token -
    //"navigation" or "page-nav" are different things.
    if(!found && manifest[id].properties.split(/\s+/).indexOf('nav') > -1)
      found = manifest[id];
  });

  return found;
}

function findNcxHref(opf, manifest){
  var spineEl = byLocalName(opf, 'spine')[0];
  var tocId = spineEl ? spineEl.getAttribute('toc') : null;

  if(tocId && manifest[tocId])
    return manifest[tocId].href;

  //A spine with no toc attribute still usually has the ncx in the manifest under its media type.
  var found = null;
  Object.keys(manifest).forEach(function(id){
    if(!found && manifest[id].mediaType === 'application/x-dtbncx+xml')
      found = manifest[id].href;
  });

  return found;
}

function readNavDocument(xhtml, navHref){
  var doc = parseHtml(xhtml);
  if(!doc)
    return [];

  //epub:type="toc" is the real table of contents; a nav document also holds landmarks and a page
  //list, which are not chapter lists. The attribute is read by name rather than by selector because
  //a namespaced attribute is not addressable with querySelector in every DOM implementation.
  var tocNav = findTocNav(doc) || doc.getElementsByTagName('nav')[0];
  if(!tocNav)
    return [];

  return anchorsToEntries(tocNav.getElementsByTagName('a'), dirnameOf(navHref), function(anchor){
    return collapseSpace(anchor.textContent || '');
  });
}

function findTocNav(doc){
  var navs = doc.getElementsByTagName('nav');

  for(let i=0;i<navs.length;i++){
    var type = navs[i].getAttribute('epub:type') || navs[i].getAttribute('type');
    if(type && type.split(/\s+/).indexOf('toc') > -1)
      return navs[i];
  }

  return null;
}

//navPoints nest, and a nested one is still a chapter here - flattening in document order is what
//getElementsByTagName already gives, and it is the order a reader walks the book in. Splitting only
//at depth 1 is a plausible option to offer later; nothing is lost by flattening now, since a writer
//can merge chapters far more easily than find a boundary that was never made.
function readNcx(xml, ncxHref){
  var doc = parseXml(xml);
  if(!doc)
    return [];

  var navPoints = byLocalName(doc, 'navPoint');
  var entries = [];
  var ncxDir = dirnameOf(ncxHref);

  navPoints.forEach(function(navPoint){
    //Direct children only. A navPoint's own content and label come before its nested navPoints in
    //document order, so a descendant search happens to work today - but it works by accident of the
    //element ordering, and would hand a parent its first child's label the moment that changed.
    var content = childrenByLocalName(navPoint, 'content')[0];
    if(!content)
      return;

    var entry = hrefToEntry(content.getAttribute('src'), ncxDir);
    if(!entry)
      return;

    var navLabel = childrenByLocalName(navPoint, 'navLabel')[0];
    var label = navLabel ? childrenByLocalName(navLabel, 'text')[0] : null;

    entry.label = label ? collapseSpace(label.textContent || '') : '';
    entries.push(entry);
  });

  return entries;
}

function anchorsToEntries(anchors, baseDir, labelOf){
  var entries = [];

  for(let i=0;i<anchors.length;i++){
    var entry = hrefToEntry(anchors[i].getAttribute('href'), baseDir);
    if(!entry)
      continue;

    entry.label = labelOf(anchors[i]);
    entries.push(entry);
  }

  return entries;
}

function hrefToEntry(href, baseDir){
  if(!href)
    return null;

  //An href that is only a fragment points inside the document that named it, which for a nav
  //document is the nav document itself - never a chapter, so it is dropped rather than resolved.
  if(href.charAt(0) === '#')
    return null;

  var hash = href.indexOf('#');

  return {
    path: resolveHref(baseDir, decodeHref(hash < 0 ? href : href.slice(0, hash))),
    fragment: hash < 0 ? null : decodeHref(href.slice(hash + 1))
  };
}

// --- chapters -------------------------------------------------------------------------------------

function buildChapters(entries, spine, navEntries, navPath, opts){
  //Every document the book actually reads through, in reading order, whether or not the table of
  //contents mentions it. A TOC that names a document the spine left out is followed in the order the
  //TOC gives - the best available answer for a book whose spine is incomplete. A document the spine
  //*deliberately* excluded is not picked back up that way: linear="no" is a statement about the
  //reading order, and a table of contents entry pointing into a pop-up note does not overrule it.
  var documents = spine.order.slice();
  navEntries.forEach(function(entry){
    if(documents.indexOf(entry.path) < 0 && !spine.excluded[entry.path])
      documents.push(entry.path);
  });

  var chapters = [];

  documents.forEach(function(path){
    if(entries[path] == null || path === navPath)
      return;

    var forDocument = navEntries.filter(function(entry){
      return entry.path === path;
    });

    convertDocument(entries, path, forDocument, opts).forEach(function(chapter){
      chapters.push(chapter);
    });
  });

  return chapters;
}

function convertDocument(entries, path, navForDocument, opts){
  //Only the anchored entries can split anything. An entry naming the whole document contributes its
  //label but no boundary, which is the ordinary one-chapter-per-file case.
  var ids = navForDocument.filter(function(entry){
    return entry.fragment;
  }).map(function(entry){
    return entry.fragment;
  });

  var deltas = convertHtmlToDelta(entries[path], {
    splitChapters: { atIds: ids },
    extraCss: linkedStylesheets(entries, path),
    //An epub keeps its Gutenberg licence header and footer in documents of their own, which the
    //table of contents does not name - so with the option on they trim to nothing and drop out as
    //textless, and with it off they arrive as two untitled chapters the writer can delete.
    stripBoilerplate: opts.stripBoilerplate === true
  });

  var labels = {};
  navForDocument.forEach(function(entry){
    if(entry.fragment)
      labels[entry.fragment] = entry.label;
  });

  //The label for the document as a whole - an entry with no fragment - names its first chapter,
  //which for the ordinary one-chapter-per-file book is the only one.
  var wholeDocumentLabel = '';
  navForDocument.forEach(function(entry){
    if(!entry.fragment && !wholeDocumentLabel)
      wholeDocumentLabel = entry.label;
  });

  return deltas.filter(function(delta){
    //A cover wrapper is one <img> and nothing else; it is in the spine of all three sample books and
    //in the table of contents of none, and it converts to a chapter with no text in it.
    return hasText(delta);
  }).map(function(delta, i){
    //splitId is html-import.js reporting which named id this delta began at, rather than this file
    //counting deltas and hoping the arithmetic holds - a document with front matter ahead of its
    //first anchor returns one more delta than it has entries.
    var label = delta.splitId ? labels[delta.splitId] : (i === 0 ? wholeDocumentLabel : '');

    return {
      title: label || '',
      delta: { ops: delta.ops }
    };
  });
}

//An epub links its stylesheets rather than inlining them, so the rules that decide which words are
//italic live in a different archive entry from the words. Without this every class-driven style in
//the book resolves to nothing - see the extraCss note in html-import.js.
function linkedStylesheets(entries, documentPath){
  var doc = parseHtml(headOf(entries[documentPath]));
  if(!doc)
    return [];

  var baseDir = dirnameOf(documentPath);
  var links = doc.getElementsByTagName('link');
  var sheets = [];

  for(let i=0;i<links.length;i++){
    var rel = (links[i].getAttribute('rel') || '').toLowerCase();
    var href = links[i].getAttribute('href');

    if(!href || rel.split(/\s+/).indexOf('stylesheet') < 0)
      continue;

    var css = entries[resolveHref(baseDir, decodeHref(href))];
    if(css != null)
      sheets.push(css);
  }

  return sheets;
}

//A <link> only ever lives in the head, and parsing the whole document again just to read three of
//them costs more than everything else this file does put together - 566ms against 7ms across
//Moby-Dick's thirteen documents, which was half the import. So only the head is handed to the
//parser. A document with no </head> at all is passed through whole, since then there is no slice to
//take and it is small enough not to matter.
function headOf(text){
  if(typeof text !== 'string')
    return text;

  var end = /<\/head\s*>/i.exec(text);
  return end ? text.slice(0, end.index + end[0].length) : text;
}

function hasText(delta){
  return delta.ops.some(function(op){
    return typeof op.insert === 'string' && op.insert.trim() !== '';
  });
}

// --- paths and parsing ------------------------------------------------------------------------------

//Every href in an epub resolves against the file that names it, not against the archive root: the
//OPF lives in OEBPS/ so its hrefs need that prefix, and the ncx's hrefs resolve relative to the ncx.
//Getting this wrong is the most common epub reader bug and costs nothing to get right.
function resolveHref(baseDir, href){
  var parts = String(baseDir + href).replaceAll('\\', '/').split('/');
  var resolved = [];

  parts.forEach(function(part){
    if(part === '' || part === '.')
      return;
    if(part === '..')
      resolved.pop();
    else
      resolved.push(part);
  });

  return resolved.join('/');
}

//Archive paths are stored raw; hrefs are URLs, so a space is "%20" and a fragment id can be escaped
//too. A malformed escape is left as written rather than throwing the whole book away.
function decodeHref(href){
  try{
    return decodeURIComponent(href);
  }
  catch(err){
    return href;
  }
}

function dirnameOf(path){
  var slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash + 1);
}

function collapseSpace(text){
  return String(text).replace(/\s+/g, ' ').trim();
}

//The OPF and the ncx are XML and are parsed as XML - an HTML parser rearranges unknown elements
//(<metadata> and <manifest> are not HTML, and the parser will happily hoist their contents out of a
//<head> it has invented). The nav document and the chapters are XHTML and are parsed as HTML by
//html-import.js's own reasoning: the HTML parser never rejects a document, and a book one unescaped
//ampersand away from being well-formed is still a book the writer wants imported.
function parseXml(text){
  if(typeof text !== 'string')
    return null;

  try{
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
  }
  catch(err){
    logError(err);
    return null;
  }
}

function parseHtml(text){
  if(typeof text !== 'string')
    return null;

  try{
    return new DOMParser().parseFromString(text, 'text/html');
  }
  catch(err){
    logError(err);
    return null;
  }
}

//nodeName carries whatever prefix the document used ("dc:title", "opf:item", "title"), and
//localName is not populated by every parser for every node type, so the suffix is taken by hand.
function localNameOf(node){
  var name = node.localName || node.nodeName || '';
  var colon = name.indexOf(':');
  return (colon < 0 ? name : name.slice(colon + 1)).toLowerCase();
}

function byLocalName(scope, name){
  if(!scope)
    return [];

  var wanted = name.toLowerCase();
  var all = scope.getElementsByTagName('*');
  var found = [];

  for(let i=0;i<all.length;i++){
    if(localNameOf(all[i]) === wanted)
      found.push(all[i]);
  }

  return found;
}

function childrenByLocalName(el, name){
  var wanted = name.toLowerCase();
  var found = [];

  if(!el)
    return found;

  for(let i=0;i<el.childNodes.length;i++){
    var child = el.childNodes[i];
    if(child.nodeType === 1 && localNameOf(child) === wanted)
      found.push(child);
  }

  return found;
}

module.exports = {
  importEpub,
  parseEpub
};
