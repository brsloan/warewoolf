function getImportFilepaths(docPath){
    const options = {
      title: 'Import files...',
      defaultPath: docPath,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Text Files', extensions: ['txt'] }
      ]
    };
    var filepaths = dialog.showOpenDialogSync(options);
    if(filepaths)
      importFiles(filepaths);
  }
  