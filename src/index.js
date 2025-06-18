const { app, BrowserWindow, Menu, nativeTheme } = require('electron');
const path = require('path');
const { ipcMain } = require('electron');
const isLinux = process.platform === "linux";
const isMac = process.platform === "darwin";
var fileRequestedOnOpen = null;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

app.on('open-file', (event, fPath) => {
  event.preventDefault();
  fileRequestedOnOpen = fPath;
});

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: false,
      devTools: true
    },
    kiosk: isLinux,
    fullscreen: true,
    icon: path.join(__dirname, 'assets/icon.png')
  });

  //mainWindow.maximize();

  app.on('open-file', (event, fPath) => {
    event.preventDefault();
    mainWindow.webContents.send('file-opened-from-outside-warewoolf', fPath);
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open the DevTools.
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
  app.quit();
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

ipcMain.on('show-menu', function(e){
  app.applicationMenu.popup({
    x: 0,
    y: 0
  });
});