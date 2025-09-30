const fs = require('fs');
const { logError } = require('./error-log');
const archiver = require('archiver');
const { sanitizeFilename } = require('./utils');


function htmlChaptersToEpub(title, author, htmlChapters, saveDir, callback){
    const uuid = crypto.randomUUID();

    const epubName = sanitizeFilename(title) + '.epub';
    const output = fs.createWriteStream(saveDir + "/" + epubName);
    const archive = archiver('zip', {
        zlib: { level: 9 }
    });

     archive.on('warning', function(err) {
      if (err.code === 'ENOENT') {
        logError(err);
      } else {
        throw err;
      }
    });

    archive.on('error', function(err) {
      callback('error');
      throw err;
    });

    archive.on('finish', function(){
      callback(epubName);
    })

    archive.pipe(output);

    archive.append(getMimetype(), { 
        name: 'mimetype',
        store: true 
    });

    archive.append(getContainerXml(), {name: 'META-INF/container.xml'});

    const contentDir = 'OEBPS/';

    archive.append(getContentOpf(title, author, htmlChapters, uuid), {name: contentDir + 'content.opf'});
    archive.append(getTocNcx(title, htmlChapters, uuid), {name: contentDir + 'toc.ncx'});
    archive.append(getTocXhtml(htmlChapters), {name: contentDir + 'toc.xhtml'});

    var pages = getChapterXhtmlPages(htmlChapters);
    pages.forEach(function(page, i){
        archive.append(page, {name: contentDir + 'chapter_' + (i + 1) + '.xhtml'});
    });

    archive.append(getCss(), {name: contentDir + 'CSS/template.css'});

    archive.finalize();


};

function getMimetype(){
    return 'application/epub+zip';
}

function getContainerXml(){
    return '<?xml version="1.0"?>' +
	'<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
	'<rootfiles>' +
	'	<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
	'</rootfiles>' +
	'</container>';
}

function getContentOpf(title, author, htmlChapters, uuid){
    var opf = '<?xml version="1.0" encoding="UTF-8" ?>' +
	'<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" unique-identifier="db-id" version="3.0">' +
	'' +
	'	<metadata>' +
	'	    <dc:title id="t1">' + title + '</dc:title>' +
	'	    <dc:creator opf:role="aut">' + author + '</dc:creator>' +
    '       <dc:identifier id="db-id">' + uuid + '</dc:identifier>' + 
	'	    <dc:language>en</dc:language>' +
	'	</metadata>';

    opf += '<manifest>' +
	'	    <item id="toc" properties="nav" href="toc.xhtml" media-type="application/xhtml+xml" />' +
	'	    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />' +
	'	    <item id="template_css" href="template.css" media-type="text/css" />';

    for(i=1;i<htmlChapters.length + 1;i++){
         opf += '<item id="chapter_' + i + '" href="chapter_' + i + '.xhtml" media-type="application/xhtml+xml" />';
    }

    opf += '</manifest>' +
	'	<spine toc="ncx">' +
	'		<itemref idref="toc" />';

    for(i=1;i<htmlChapters.length + 1;i++){
        opf += '<itemref idref="chapter_' + i + '" />';
    }

    opf += '</spine>' +
	'</package>';

 return opf;  
}

function getTocNcx(title, htmlChapters, uuid){
    var ncx = '<?xml version="1.0" encoding="UTF-8" ?>' +
	'<ncx version="2005-1" xml:lang="en" xmlns="http://www.daisy.org/z3986/2005/ncx/">' +
	'<head>' +
	'    <meta name="dtb:uid" content="' + uuid + '"/>' +
	'    <meta name="dtb:depth" content="1"/>' +
	'</head>' +
	'<docTitle>' +
	'    <text>' + title + '</text>' +
	'</docTitle>' +
	'<navMap>';

    for(i=1;i<htmlChapters.length;i++){
        ncx += '<navPoint id="chapter_' + i + '" playOrder=' + i + '>' +
	'		<navLabel><text>Chapter ' + i + '</text></navLabel>' +
	'		<content src="chapter_' + i + '.xhtml" />' +
	'	</navPoint>';
    }

    ncx += '</navMap>' +
        '</ncx>';

    return ncx;
}

function getTocXhtml(htmlChapters){
    var xhtml = '<?xml version="1.0" encoding="utf-8"?>' +
	'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
	'<head>' +
	'<title>toc.xhtml</title>' +
	'<link href="CSS/template.css" rel="stylesheet" type="text/css" />' +
	'</head>' +
	'<body>' +
	'    <nav id="toc" epub:type="toc">' +
	'        <h1 class="frontmatter">Table of Contents</h1>' +
	'        <ol class="contents">';

    for(i=1;i<htmlChapters.length;i++){
        xhtml += '<li><a href="chapter_' + i + '.xhtml">Chapter ' + i + '</a></li>'
    }

    xhtml += '</ol>' +
	'    </nav>' +
	'</body>' +
	'</html>';

    return xhtml;
}

function getChapterXhtmlPages(htmlChapters){
    var pages = [];

    htmlChapters.forEach(function(chap, i){
        pages.push('<?xml version="1.0" encoding="utf-8"?>' +
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
        '<head>' +
        '<title>chapter_' + (i + 1) + '.xhtml</title>' +
        '<link href="CSS/template.css" rel="stylesheet" type="text/css" />' +
        '</head>' +
        '<body>' +
        chap +
        '</body>' +
        '</html> ')
    });

    return pages;
}

function getCss(){
    return "      h1 {" +
      "        white-space: pre-wrap;" +
      "      }" +
      "    p {" +
      "      white-space: pre-wrap;" +
      "      margin-top: 0px;" +
      "      margin-bottom: 0px;" +
      "    }" +
      "    .center {" +
      "      text-align: center;" +
      "    }" +
      "    .right {" +
      "      text-align: right;" +
      "    }" +
      "    .justified {" +
      "      text-align: justify;" +
      "    } " +
      "    blockquote {" +
      "      white-space: pre-wrap;" +
      "    }" +
      "    .footnote {" +
      "      text-indent: 1em;" +
      "    }" +
      "    .footnote p:nth-child(1n+2) {" +
      "      text-indent: 2em;" +
      "    }" +
      "    sup {" +
      "      margin-right: 0.25em;" +
      "    }";
}

module.exports = {
    htmlChaptersToEpub
}