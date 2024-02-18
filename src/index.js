const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const { ipcMain } = require('electron')
const remoteMain = require('@electron/remote/main');
const isLinux = process.platform === "linux";
remoteMain.initialize();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      spellcheck: false,
      devTools: true
    },
    kiosk: true,
    icon: path.join(__dirname, 'assets/icon.png')
  });

  remoteMain.enable(mainWindow.webContents);

  mainWindow.maximize();

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open the DevTools.
  mainWindow.webContents.openDevTools();

  var menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu:[
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+Shift+N',
          click(item, focusWindow){
            mainWindow.webContents.send("new-project-clicked", app.getPath("documents"));
          }
        },
        {
          label: 'Open Project',
          accelerator: 'CmdOrCtrl+Shift+O',
          click(item, focusWindow){
            mainWindow.webContents.send("open-clicked", app.getPath("documents"));
          }
        },
        {type: 'separator'},
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click(item, focusWindow){
            mainWindow.webContents.send("save-clicked", app.getPath("documents"));
          }
        },
        {
          label: 'Save As',
          accelerator: 'CmdOrCtrl+Shift+S',
          click(item, focusWindow){
              mainWindow.webContents.send('save-as-clicked', app.getPath("documents"));
          }
        },
        {
          label: 'Save Copy',
          click(item, focusWindow){
            mainWindow.webContents.send('save-copy-clicked', app.getPath("documents"));
          }
        },
        {
          label: 'Backup',
          accelerator: 'CmdOrCtrl+Shift+B',
          click(item, focusWindow){
            mainWindow.webContents.send('save-backup-clicked', app.getPath("documents"));
          }
        },
        {type: 'separator'},
        {
          label: 'Import',
          accelerator: 'CmdOrCtrl+Shift+I',
          click(item, focusWindow){
              mainWindow.webContents.send('import-clicked', app.getPath("documents"));
          }
        },
        {
          label: 'Export',
          accelerator: 'CmdOrCtrl+Shift+E',
          click(item, focusWindow){
              mainWindow.webContents.send('export-clicked', app.getPath("documents"));
          }
        },
        {
          label: 'Compile',
          accelerator: 'CmdOrCtrl+Shift+C',
          click(item, focusWindow){
              mainWindow.webContents.send('compile-clicked', app.getPath("documents"));
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
              mainWindow.webContents.send('file-manager-clicked', {
                homeDir: app.getPath("home"),
                docsDir: app.getPath("documents")
              });
          },
          accelerator: 'CmdOrCtrl+Shift+F'
        },
        {type: 'separator'},
        {
          label: 'Exit',
          click() {
            //app.quit();
            mainWindow.webContents.send('exit-app-clicked', app.getPath("documents"));
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
              mainWindow.webContents.send('network-manager-clicked');
            },
            accelerator: 'CommandOrControl+W'
          }
        ]
        : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Shortcuts...',
          click(item, focusWindow){
            mainWindow.webContents.send('shortcuts-clicked');
          },
          accelerator: 'CommandOrControl+H'
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
            mainWindow.webContents.send('about-clicked', path.join(__dirname, 'licenses.txt'));
          }
        }
      ]
    }
  ]);

  Menu.setApplicationMenu(menu);
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
ipcMain.on('exit-app-confirmed', function(e){
  app.quit();
})
