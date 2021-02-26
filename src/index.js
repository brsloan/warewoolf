const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const { ipcMain } = require('electron')


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true
    }
  });

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
          accelerator: 'CmdOrCtrl+O',
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
        {type: 'separator'},
        {
          label: 'Properties',
          accelerator: 'CmdOrCtrl+P',
          click(item, focusWindow){
            mainWindow.webContents.send('properties-clicked');
          }
        },
        {type: 'separator'},
        {
          label: 'Exit',
          click() {
            app.quit();
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
        }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Word Count',
          click(item, focusWindow){
            mainWindow.webContents.send('word-count-clicked');
          }
        },
        {
          label: 'Search/Replace',
          click(item, focusWindow){
            mainWindow.webContents.send('search-replace-clicked');
          }
        },
        {
          label: 'Spell Check',
          click(item, focusWindow){
            mainWindow.webContents.send('spell-check-clicked');
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



