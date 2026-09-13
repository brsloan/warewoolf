//The application menu, as a template for Electron's Menu.buildFromTemplate - built here rather
//than in index.js so it can be built without Electron, tested, and rebuilt whenever what it is for
//changes. Every item sends a channel to the renderer through `send`, which is where the work is.
//
//`mode` is what the renderer told the host through the setMenuMode command (platform.js):
//`project` is 'novel' | 'screenplay', `document` is 'prose' | 'screenplay' - the document in the
//editor, which in a screenplay project can be a prose Reference note. What the menus offer a
//screenplay is docs/screenplay-plan.md's "What the menus offer", and comes in two kinds, told apart
//by what they are about: the chapter tools want a prose *document* in the editor, and the
//manuscript-wide conversions want a novel *project*. Those items are disabled rather than removed,
//so a writer can still see the tool is there and that it is not for this. Word Count reads Page
//Count for a screenplay project, since that is what it shows for a script (wordcount_display.js).
//
//render.js keeps the same two lists with a message each, for a command that reaches it anyway (a
//shortcut, an accelerator on a menu built before the mode arrived); app-menu.test.js holds the
//two sets of lists to each other.
const NOVEL_PROJECT_ONLY = [
  'compile-clicked',
  'renumber-chapters-clicked',
  'convert-first-lines-clicked',
  'convert-italics-clicked',
  'convert-tabs-clicked',
  'tab-indent-paragraphs-clicked',
  'center-all-heads-clicked'
];

//Delete Chapter and Restore Deleted Chapter are not here: on a script they work on the scene the
//selection covers, and on a trashed block they bring it back (render.js's cutScenes and
//mergeIntoScript - docs/screenplay-plan.md, "One script").
const PROSE_DOCUMENT_ONLY = [
  'split-chapter-clicked',
  'headings-to-chaps-clicked'
];

//options: { isMac, isLinux, appName, appVersion, send, mode }. `send(channel, ...args)` is what a
//click does. `mode` defaults to a novel showing prose - the menu every project had before there
//were screenplays.
function buildMenuTemplate(options){
  var isMac = !!options.isMac;
  var isLinux = !!options.isLinux;
  var send = options.send;
  var mode = options.mode || {};
  var screenplayProject = mode.project === 'screenplay';
  var screenplayDocument = mode.document === 'screenplay';

  function item(label, channel, extra){
    var entry = Object.assign({ label: label }, extra || {});
    entry.click = function(){ send(channel); };
    if(NOVEL_PROJECT_ONLY.indexOf(channel) !== -1 && screenplayProject)
      entry.enabled = false;
    else if(PROSE_DOCUMENT_ONLY.indexOf(channel) !== -1 && screenplayDocument)
      entry.enabled = false;
    return entry;
  }

  var separator = { type: 'separator' };

  return [
    ...(isMac
      ? [{
          label: options.appName,
          submenu: [
            { role: 'about' },
            separator,
            { role: 'services' },
            separator,
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            separator,
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        item('New Project', 'new-project-clicked', { accelerator: 'CmdOrCtrl+Shift+N' }),
        item('Open Project', 'open-clicked', { accelerator: 'CmdOrCtrl+Shift+O' }),
        separator,
        item('Save', 'save-clicked', { accelerator: 'CmdOrCtrl+S' }),
        item('Save As', 'save-as-clicked', { accelerator: 'CmdOrCtrl+Shift+S' }),
        item('Save Copy', 'save-copy-clicked'),
        //No accelerator: Ctrl/Cmd+Shift+B is the editor's Bullets/Numbered List shortcut, and a
        //menu accelerator is handled natively before the page ever sees the keydown - so for as
        //long as Backup claimed it, the bullets shortcut the Shortcuts popup documents could not
        //fire. Backup stays reachable from this menu, where it is not competing for a key a writer
        //presses mid-sentence.
        item('Backup', 'save-backup-clicked'),
        separator,
        item('Import', 'import-clicked', { accelerator: 'CmdOrCtrl+Shift+I' }),
        item('Export', 'export-clicked', { accelerator: 'CmdOrCtrl+Shift+E' }),
        item('Compile', 'compile-clicked', { accelerator: 'CmdOrCtrl+Shift+C' }),
        separator,
        item('Send via Email', 'send-via-email-clicked', { accelerator: 'CommandOrControl+Alt+E' }),
        separator,
        item('Properties', 'properties-clicked', { accelerator: 'CmdOrCtrl+P' }),
        item('Settings', 'settings-clicked'),
        //No accelerator: this is a dialog opened rarely and does not need to spend a chord - see
        //the note on Backup above.
        item('Dictionaries', 'dictionaries-clicked'),
        separator,
        item('File Manager', 'file-manager-clicked', { accelerator: 'CmdOrCtrl+Shift+F' }),
        ...(isLinux ? [
          separator,
          //A writerDeck item, not a desktop one, which is why it is gated the same way the Wi-Fi
          //Manager is: on a Pi that boots straight into WareWoolf with no desktop behind it, this
          //menu is the whole machine's interface, and there is no panel, launcher or terminal to
          //reach a reboot from. On a machine that has all three it would only be a worse copy of
          //them.
          //
          //No accelerator, deliberately, and for a stronger version of the reason Backup and
          //Dictionaries do without one: every other item on this menu can be undone or answered,
          //and a chord that takes the machine down cannot.
          item('Reboot', 'reboot-clicked')
        ] : []),
        separator,
        item('Exit', 'exit-app-clicked', { accelerator: 'CmdOrCtrl+Shift+X' })
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CommandOrControl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CommandOrControl+Z', role: 'redo' },
        separator,
        { label: 'Cut', accelerator: 'CommandOrControl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CommandOrControl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CommandOrControl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CommandOrControl+A', role: 'selectall' },
        separator,
        item('Add New Chapter', 'add-chapter-clicked', { accelerator: 'CommandOrControl+N' }),
        item('Delete Chapter', 'delete-chapter-clicked', { accelerator: 'CommandOrControl+Shift+D' }),
        item('Restore Deleted Chapter', 'restore-chapter-clicked', { accelerator: 'CommandOrControl+Shift+R' }),
        item('Split Chapter', 'split-chapter-clicked', { accelerator: 'CommandOrControl+\\' })
      ]
    },
    {
      label: 'Tools',
      submenu: [
        item(screenplayProject ? 'Page Count' : 'Word Count', 'word-count-clicked', { accelerator: 'CommandOrControl+8' }),
        item('Find/Replace', 'find-replace-clicked', { accelerator: 'CommandOrControl+F' }),
        item('Spell Check', 'spellcheck-clicked', { accelerator: 'CommandOrControl+7' }),
        separator,
        item('Outliner', 'outliner-clicked', { accelerator: 'CommandOrControl+O' }),
        item('Corkboard', 'corkboard-clicked'),
        //Absent from a novel's menu rather than greyed out in it, the way the writerDeck items
        //below are: the other screenplay differences are one menu offering the same tool in a
        //different shape (Page Count, the Outliner by scene), and this is a tool a novel has no
        //version of at all. A novel has no cues and no headings to collect names from, so there is
        //nothing there for the item to be disabled *about*. render.js refuses the channel too, for
        //an accelerator on a menu built before the project changed.
        ...(screenplayProject ? [
          item('Characters/Locations', 'screenplay-names-clicked')
        ] : []),
        separator,
        item('Renumber Chapters', 'renumber-chapters-clicked'),
        item('Convert First Lines To Titles', 'convert-first-lines-clicked'),
        item('Convert Marked Italics', 'convert-italics-clicked'),
        item('Convert Marked Tabs', 'convert-tabs-clicked'),
        item('Convert Straight Quotes Etc.', 'convert-substitutions-clicked'),
        separator,
        item('Break Headings Into Chapters', 'headings-to-chaps-clicked'),
        item('Tab-Indent Paragraphs', 'tab-indent-paragraphs-clicked'),
        item('Center All Headings', 'center-all-heads-clicked'),
        ...(isLinux ? [
          separator,
          item('Wi-Fi Manager', 'wifi-manager-clicked', { accelerator: 'CommandOrControl+W' })
        ] : [])
      ]
    },
    ...(!isLinux ? [
      {
        label: 'View',
        submenu: [
          { role: 'togglefullscreen' }
        ]
      }
    ] : []),
    {
      label: 'Help',
      submenu: [
        {
          label: 'Shortcuts...',
          accelerator: isMac ? 'CommandOrControl+Shift+h' : 'CommandOrControl+h',
          click: function(){ send('shortcuts-clicked', isMac); }
        },
        item('Open Help Document', 'help-doc-clicked'),
        item('View Error Log', 'view-error-log-clicked'),
        separator,
        {
          label: 'About',
          click: function(){ send('about-clicked', options.appVersion); }
        }
      ]
    }
  ];
}

module.exports = {
  buildMenuTemplate,
  NOVEL_PROJECT_ONLY,
  PROSE_DOCUMENT_ONLY
};
