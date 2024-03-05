const https = require('https');

function getUpdates(thisAppVersion, callback){
    fetchLatestReleaseDataTest(function(latest){
        if(isUpdateAvailable(latest.tag, thisAppVersion)){
            latest.downloadInfo = extractUpdateDownloadInfo(latest);
            callback(latest);
        }
        else
            callback(null);
    });
}

function fetchLatestReleaseData(callback){

    const options = {
        hostname: 'api.github.com',
        path: '/repos/brsloan/warewoolf/releases/latest',
        method: 'GET',
        headers: {
            'User-Agent': 'warewoolf' 
        }
    };
    
    https.request(options, function(res){
        let data = '';
    
        res.on('data', function(chunk){
            data += chunk;
        });
    
        res.on('end', function(){
            var packagedData = packageReleaseData(JSON.parse(data));
            callback(packagedData);
        });
    
    
    }).on('error', function(err){
        logError(err);
    }).end();

}

function fetchLatestReleaseDataTest(callback){
    var testData = {
        "tag": "v1.0.1",
        "prerelease": false,
        "description": "2024-03-03: We have reached version 1.0.0! All the basic features I had originally envisioned are now implemented and working. I use it daily for my own novel writing. Features added/changed since last release:\r\n* Built-in Wi-Fi Manager (on Linux) for use as writerDeck\r\n* Import .docx files\r\n* Footnote support (import and export/compile)\r\n* Auto-save at set intervals (if desired)\r\n* Auto-backup with single zip file on close\r\n* Email zipped project file\r\n* Built-in File Manager now can unzip zip files\r\n* Dark Mode support/options\r\n* Markdown improvements\r\n* Docx export drastically improved, with automatic cover page generation, page number headers in Standard Manuscript Format, etc. Can now export ready-to-submit manuscript documents\r\n* Retains more settings user sets for email attachments, etc.\r\n* Replaced native file dialogs with custom in-app for better keyboard-only workflow\r\n* Bug fixes\r\n* 70% less ugly",
        "date": "2024-03-04T04:45:26Z",
        "binaries": [
            {
                "name": "warewoolf_1.0.0_amd64.deb",
                "url": "https://github.com/brsloan/warewoolf/releases/download/v1.0.0/warewoolf_1.0.0_amd64.deb"
            },
            {
                "name": "warewoolf_1.0.0_arm64.deb",
                "url": "https://github.com/brsloan/warewoolf/releases/download/v1.0.0/warewoolf_1.0.0_arm64.deb"
            },
            {
                "name": "warewoolf_1.0.0_Windows_x64.zip",
                "url": "https://github.com/brsloan/warewoolf/releases/download/v1.0.0/warewoolf_1.0.0_Windows_x64.zip"
            }
        ]
    }

    callback(testData);
}

function packageReleaseData(releaseData){
    var packagedData = {
        tag: releaseData.tag_name,
        prerelease: releaseData.prerelease,
        description: releaseData.body,
        date: releaseData.published_at,
        binaries: []
    };

    releaseData.assets.forEach(asset => {
        packagedData.binaries.push({
            name: asset.name,
            url: asset.browser_download_url
        })
    });

    return packagedData;
}

function extractUpdateDownloadInfo(releaseData){
    
    var binUrl = '';
    var binType = 'unsupported';

    if(process.arch == 'arm64')
        binType = 'arm64';
    else if(process.arch == 'x64'){
        if(process.platform == 'linux')
            binType = 'amd64';
        else if(process.platform == 'win32')
            binType = 'Windows_x64';
    }

    return releaseData.binaries.find(function(bin){
        return bin.name.includes(binType);
    })
}

function isUpdateAvailable(latestTag, thisAppVersion = '1.0.0'){
    var avail = false;

    if(latestTag.replace('v','') != thisAppVersion){
        var thisDigits = thisAppVersion.replace('v','').split('.').map(function(str){
            return parseInt(str);
        });

        var latestDigits = latestTag.replace('v','').split('.').map(function(str){
            return parseInt(str);
        });

        if(latestDigits[0] > thisDigits[0])
            avail = true;
        else if(latestDigits[0] == thisDigits[0]){
            if(latestDigits[1] > thisDigits[1])
                avail = true;
            else if(latestDigits[1] == thisDigits[1]){
                if(latestDigits[2] > thisDigits[2])
                    avail = true;
            }
        }
    }

    return avail;
}

function downloadUpdate(downloadInfo){
    var filePath = sysDirectories.docs + '/' + downloadInfo.name;
    console.log('commence downloading at: ' + downloadInfo.url + ' to ' + filePath);
    
    const file = fs.createWriteStream(filePath);

    file.on('finish', function(){
        console.log("finished download");
    });

    downloadRequest(file, filePath, downloadInfo.url);
}

function downloadRequest(file, filePath, url){
    const request = https.get(url, response => {
        if(response.statusCode !== 200 && response.statusCode !== 302){
            fs.unlink(filePath, () => {
                console.log('Download failed: ' + response.statusCode);
            });
            return;
        }

        if(response.statusCode == 302){
            downloadRequest(file, filePath, response.headers.location);
        }
        else{
            response.pipe(file);
        }
    });

    request.on('error', function(err){
        fs.unlink(filePath, function(){
            console.log(err);
        })
    });

    file.on('error', function(err){
        fs.unlink(filePath, function(){
            console.log(err);
        })
    });


    request.end();
}