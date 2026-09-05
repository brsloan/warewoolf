const { app, BrowserWindow, Menu, nativeTheme, safeStorage } = require('electron');
const path = require('path');
const { ipcMain } = require('electron');
const isLinux = process.platform === "linux";
const isMac = process.platform === "darwin";
var fileRequestedOnOpen = null;
var currentWindow = null;
//Set once the renderer has confirmed it's safe to quit (see 'exit-app-confirmed' below), so the
//'close' guard on the window lets that specific close through instead of re-intercepting it.
var closeConfirmed = false;
//True once render.js has run all the way through and registered its IPC handlers, the
//'exit-app-clicked' one below included. It does not always get there: the whole script aborts if
//anything at its top level throws, which a damaged project file used to do. The close guard checks
//this before handing a window close over to the renderer, because otherwise it would block every X,
//Alt+F4 and Cmd+Q waiting for a confirmation nothing was left alive to send - a window only the
//task manager could shut. Deliberately a readiness flag rather than a timeout on the reply: a
//renderer part-way through a long synchronous save or export can be slow to answer, and forcing
//that window closed would destroy the very work the guard exists to protect.
var rendererReady = false;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
  process.exit(0);
}

//Detect file to be opened on non-mac
if(!isMac){
  //File passed as argument but index differs in development vs production environments.
  //Scan from that index rather than reading a fixed slot, since an extra flag ahead of the
  //file path (e.g. a Chromium/Electron switch) would otherwise shift it out of place.
  var argStartIndex = app.isPackaged ? 1 : 2;
  var relativePath = process.argv.slice(argStartIndex).find((arg) => !arg.startsWith('-'));
  if(relativePath)
    fileRequestedOnOpen = path.resolve(relativePath);
}
//Detect file to be open on mac. Registered once here (not per-window) so listeners don't
//pile up across repeated createWindow() calls (e.g. dock re-activate on macOS), which used
//to leak destroyed windows and could throw when sending to an already-closed webContents.
app.on('open-file', (event, fPath) => {
  event.preventDefault();
  if(currentWindow && !currentWindow.isDestroyed()){
    currentWindow.webContents.send('file-opened-from-outside-warewoolf', fPath);
  }
  else{
    fileRequestedOnOpen = fPath;
  }
});

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: false,
      devTools: !app.isPackaged
    },
    kiosk: isLinux,
    fullscreen: true,
    icon: path.join(__dirname, 'assets/icon.png')
  });

  //mainWindow.maximize();

  currentWindow = mainWindow;
  //A window built after a previous one was closed (the dock re-activate path on macOS) starts out
  //guarded again rather than inheriting the last window's confirmation, and waits for its own
  //renderer to report in.
  closeConfirmed = false;
  rendererReady = false;
  mainWindow.on('closed', () => {
    if(currentWindow === mainWindow)
      currentWindow = null;
  });

  //Route every way of closing the window (titlebar X, Alt+F4, Cmd+Q, Cmd+W) through the same
  //unsaved-changes check the File > Exit menu item already uses, instead of only the menu item
  //being guarded while every other path quits unchecked.
  mainWindow.on('close', (event) => {
    if(closeConfirmed)
      return;

    //No renderer to ask, so there is no unsaved work it could be protecting and no confirmation
    //ever coming. Let the close through rather than trapping the window.
    if(!rendererReady)
      return;

    event.preventDefault();
    mainWindow.webContents.send('exit-app-clicked');
  });

  //A renderer that dies after it reported in leaves nothing to answer the prompt either.
  mainWindow.webContents.on('render-process-gone', () => {
    rendererReady = false;
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  //Nothing in the renderer opens a new window or navigates away today - the one <a> tag in the
  //About popup does not even set an href - but nodeIntegration is on for this window, so a
  //navigation or new-window request succeeding here would run with full Node access rather than
  //being sandboxed the way a browser tab would be. Deny both outright rather than leaving that
  //open for whatever a future feature (or a bug in a dependency parsing an imported .docx/.epub)
  //might one day attempt.
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Open the DevTools, except in a packaged build - devTools:false above already disables the
  // capability there, but calling this unconditionally regardless muddies what that flag is for.
  if(!app.isPackaged)
    mainWindow.webContents.openDevTools();

  var menu = Menu.buildFromTemplate([
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu:[
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+Shift+N',
          click(item, focusWindow){
            mainWindow.webContents.send("new-project-clicked");
          }
        },
        {
          label: 'Open Project',
          accelerator: 'CmdOrCtrl+Shift+O',
          click(item, focusWindow){
            mainWindow.webContents.send("open-clicked");
          }
        },
        {type: 'separator'},
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click(item, focusWindow){
            mainWindow.webContents.send("save-clicked");
          }
        },
        {
          label: 'Save As',
          accelerator: 'CmdOrCtrl+Shift+S',
          click(item, focusWindow){
              mainWindow.webContents.send('save-as-clicked');
          }
        },
        {
          label: 'Save Copy',
          click(item, focusWindow){
            mainWindow.webContents.send('save-copy-clicked');
          }
        },
        {
          label: 'Backup',
          accelerator: 'CmdOrCtrl+Shift+B',
          click(item, focusWindow){
            mainWindow.webContents.send('save-backup-clicked');
          }
        },
        {type: 'separator'},
        {
          label: 'Import',
          accelerator: 'CmdOrCtrl+Shift+I',
          click(item, focusWindow){
              mainWindow.webContents.send('import-clicked');
          }
        },
        {
          label: 'Export',
          accelerator: 'CmdOrCtrl+Shift+E',
          click(item, focusWindow){
              mainWindow.webContents.send('export-clicked');
          }
        },
        {
          label: 'Compile',
          accelerator: 'CmdOrCtrl+Shift+C',
          click(item, focusWindow){
              mainWindow.webContents.send('compile-clicked');
          }
        },
        { type: 'separator' },
        {
          label: 'Send via Email',
          click(item, focusWindow){
            mainWindow.webContents.send('send-via-email-clicked');
          },
          accelerator: 'CommandOrControl+Alt+E'
        },
        {type: 'separator'},
        {
          label: 'Properties',
          accelerator: 'CmdOrCtrl+P',
          click(item, focusWindow){
            mainWindow.webContents.send('properties-clicked');
          }
        },
        {
          label: 'Settings',
          click(item, focusWindow){
            mainWindow.webContents.send('settings-clicked');
          }
        },
        {type: 'separator'},
        {
          label: 'File Manager',
          click(item, focusWindow){
              mainWindow.webContents.send('file-manager-clicked');
          },
          accelerator: 'CmdOrCtrl+Shift+F'
        },
        {type: 'separator'},
        {
          label: 'Exit',
          click() {
            //app.quit();
            mainWindow.webContents.send('exit-app-clicked');
          },
          accelerator: 'CmdOrCtrl+Shift+X'
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CommandOrControl+Z',
          role: 'undo',
        },
        {
          label: 'Redo',
          accelerator: 'Shift+CommandOrControl+Z',
          role: 'redo',
        },
        { type: 'separator' },
        {
          label: 'Cut',
          accelerator: 'CommandOrControl+X',
          role: 'cut',
        },
        {
          label: 'Copy',
          accelerator: 'CommandOrControl+C',
          role: 'copy',
        },
        {
          label: 'Paste',
          accelerator: 'CommandOrControl+V',
          role: 'paste',
        },
        {
          label: 'Select All',
          accelerator: 'CommandOrControl+A',
          role: 'selectall',
        },
        { type: 'separator' },
        {
          label: 'Add New Chapter',
          click(item, focusWindow){
            mainWindow.webContents.send('add-chapter-clicked');
          },
          accelerator: 'CommandOrControl+N',
        },
        {
          label: 'Delete Chapter',
          click(item, focusWindow){
            mainWindow.webContents.send('delete-chapter-clicked');
          },
          accelerator: 'CommandOrControl+Shift+D',
        },
        {
          label: 'Restore Deleted Chapter',
          click(item, focusWindow){
            mainWindow.webContents.send('restore-chapter-clicked');
          },
          accelerator: 'CommandOrControl+Shift+R',
        },
        {
          label: 'Split Chapter',
          click(item, focusWindow){
            mainWindow.webContents.send('split-chapter-clicked');
          },
          accelerator: 'CommandOrControl+\\',
        }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Word Count',
          accelerator: 'CommandOrControl+8',
          click(item, focusWindow){
            mainWindow.webContents.send('word-count-clicked');
          }
        },
        {
          label: 'Find/Replace',
          accelerator: 'CommandOrControl+F',
          click(item, focusWindow){
            mainWindow.webContents.send('find-replace-clicked');
          }
        },
        {
          label: 'Spell Check',
          accelerator: 'CommandOrControl+7',
          click(item, focusWindow){
            mainWindow.webContents.send('spellcheck-clicked');
          }
        },
        { type: 'separator' },
        {
          label: 'Outliner',
          click(item, focusWindow){
            mainWindow.webContents.send('outliner-clicked');
          },
          accelerator: 'CommandOrControl+O',
        },
        {
          label: 'Corkboard',
          click(item, focusWindow){
            mainWindow.webContents.send('corkboard-clicked');
          }
        },
        { type: 'separator' },
        {
          label: 'Renumber Chapters',
          click(item, focusWindow){
            mainWindow.webContents.send('renumber-chapters-clicked');
          }
        },
        {
          label: 'Convert First Lines To Titles',
          click(item, focusWindow){
            mainWindow.webContents.send('convert-first-lines-clicked');
          }
        },
        {
          label: 'Convert Marked Italics',
          click(item, focusWindow){
            mainWindow.webContents.send('convert-italics-clicked');
          }
        },
        {
          label: 'Convert Marked Tabs',
          click(item, focusWindow){
            mainWindow.webContents.send('convert-tabs-clicked');
          }
        },
        { type: 'separator' },
        {
          label: 'Break Headings Into Chapters',
          click(item, focusWindow){
            mainWindow.webContents.send('headings-to-chaps-clicked');
          }
        },
        {
          label: 'Indent All Paragraphs',
          click(item, focusWindow){
            mainWindow.webContents.send('indent-all-clicked');
          }
        },
        {
          label: 'Center All Headings',
          click(item, focusWindow){
            mainWindow.webContents.send('center-all-heads-clicked');
          }
        },
        ...(isLinux ? [
          { type: 'separator' },
          {
            label: 'Wi-Fi Manager',
            click(item, focusWindow){
              mainWindow.webContents.send('wifi-manager-clicked');
            },
            accelerator: 'CommandOrControl+W'
          }
        ]
        : [])
      ]
    },
    ...(!isLinux ? [
      {
        label: 'View',
        submenu: [
          {
            role: 'togglefullscreen'
          }
        ]
      }
    ] : []),
    {
      label: 'Help',
      submenu: [
        {
          label: 'Shortcuts...',
          click(item, focusWindow){
            mainWindow.webContents.send('shortcuts-clicked', isMac);
          },
          accelerator: isMac ? 'CommandOrControl+Shift+h' : 'CommandOrControl+h'
        },
        {
          label: 'Open Help Document',
          click(item, focusWindow){
            mainWindow.webContents.send('help-doc-clicked');
          }
        },
        {
          label: 'View Error Log',
          click(item, focusWindow){
            mainWindow.webContents.send('view-error-log-clicked');
          }
        },
        { type: 'separator' },
        {
          label: 'About',
          click(item, focusWindow){
            mainWindow.webContents.send('about-clicked', app.getVersion());
          }
        }
      ]
    }
  ]);

  Menu.setApplicationMenu(menu);
};

const assignActiveAndCreateWindow = () => {
  //Have to assign this after ready to avoid error when opened too quickly via dock on macOS
  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  createWindow();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', assignActiveAndCreateWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
ipcMain.on('exit-app-confirmed', function(e){
  closeConfirmed = true;
  app.quit();
});

//Sent by render.js as the last thing it does, once every handler is registered.
ipcMain.on('renderer-ready', function(e){
  rendererReady = true;
});

ipcMain.on('get-directories', function(e){
  e.returnValue = {
    userData: app.getPath('userData').replaceAll('\\', '/'),
    home: app.getPath('home').replaceAll('\\', '/'),
    temp: app.getPath('temp').replaceAll('\\', '/'),
    docs: app.getPath('documents').replaceAll('\\', '/'),
    app: __dirname.replaceAll('\\', '/'),
    downloads: app.getPath('downloads').replaceAll('\\', '/')
  }
});

ipcMain.on('get-file-requested-on-open', function(e){
  e.returnValue = fileRequestedOnOpen;
});

ipcMain.on('set-dark-mode', function(e, darkMode){
  if(darkMode == 'system'){
    nativeTheme.themeSource = 'system';
  }
  else if(darkMode == 'dark'){
    nativeTheme.themeSource = 'dark';
  }
  else if(darkMode == 'light') {
    nativeTheme.themeSource = 'light';
  }
});

//safeStorage only reaches a real OS keystore when Chromium found one at startup. On Linux with no
//keyring installed — a stripped down Raspberry Pi OS Lite, say — it quietly falls back to a
//hardcoded key, which protects nothing. Report that case as unavailable so the credential store
//falls back to its own per-install key file instead of trusting a keystore that isn't there.
function isSecureStorageAvailable(){
  try{
    if(!safeStorage.isEncryptionAvailable())
      return false;
    if(process.platform !== 'linux')
      return true;
    //getSelectedStorageBackend arrived in Electron 25. Without it there is no way to tell a real
    //keyring from the fallback, so don't claim the storage is secure.
    if(typeof safeStorage.getSelectedStorageBackend !== 'function')
      return false;

    var backend = safeStorage.getSelectedStorageBackend();

    return backend !== 'basic_text' && backend !== 'unknown';
  }
  catch(err){
    return false;
  }
}

ipcMain.on('secure-storage-available', function(e){
  e.returnValue = isSecureStorageAvailable();
});

ipcMain.on('secure-storage-encrypt', function(e, text){
  try{
    e.returnValue = isSecureStorageAvailable() ? safeStorage.encryptString(text).toString('base64') : null;
  }
  catch(err){
    e.returnValue = null;
  }
});

ipcMain.on('secure-storage-decrypt', function(e, content){
  try{
    e.returnValue = isSecureStorageAvailable() ? safeStorage.decryptString(Buffer.from(content, 'base64')) : null;
  }
  catch(err){
    e.returnValue = null;
  }
});

ipcMain.on('show-menu', function(e){
  app.applicationMenu.popup({
    x: 0,
    y: 0
  });
});