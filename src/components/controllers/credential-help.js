//Plain wording for what is actually protecting a saved email password, so the dialogs don't imply
//a guarantee the machine can't make. The key file case is deliberately blunt: on a machine with no
//keystore, nothing WareWoolf can do unattended hides the password from someone already able to read
//the writer's own files.
const BACKEND_NOTES = {
  safeStorage: "Saved password is protected by this computer's system keystore, tied to your login.",
  passphrase: "Saved password is protected by your passphrase. WareWoolf asks for it once per session, and cannot recover it if you forget it.",
  keyfile: "No system keystore here, so the saved password is protected by a key file in WareWoolf's settings folder. That keeps a copied settings file or backup useless, but not anyone who can already read your files on this computer — tick the passphrase box for that."
};

//Whatever protects a saved password, an app password limits what a leaked one is worth: most
//providers scope them to sending mail and let you revoke a single one without changing your
//account password.
const APP_PASSWORD_HINT = "Use an app password from your email provider here, not your main account password. It can be revoked on its own if it ever leaks.";

function describeCredentialBackend(backend){
  return BACKEND_NOTES[backend] || '';
}

module.exports = { describeCredentialBackend, APP_PASSWORD_HINT };
