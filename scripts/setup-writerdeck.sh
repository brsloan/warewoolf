#!/usr/bin/env bash
#
# setup-writerdeck.sh - turn a fresh Raspberry Pi OS Lite (or Debian) install
# into a writerDeck that boots straight into WareWoolf, with no desktop behind it.
#
# The recipe is the one on the wiki page "Using WareWoolf For A WriterDeck":
#
#     Raspberry Pi OS Lite + Xorg + Matchbox + WareWoolf
#
# Run it as the ordinary user who will be writing (not as root), on a machine
# that already has a working internet connection and a way to run sudo:
#
#     bash setup-writerdeck.sh
#
# What it does, in order:
#
#   1. Checks it is on a 64-bit Debian-family system with no desktop installed.
#   2. Installs Xorg, the Matchbox window manager, and xset (apt-get).
#   3. Installs WareWoolf from a .deb - the one you pass with --deb, or the
#      latest release downloaded from GitHub for this machine's architecture.
#   4. Makes the machine log this user in automatically on the first console
#      (what "Console Autologin" in raspi-config does).
#   5. Writes ~/.xinitrc so that X starts Matchbox and then WareWoolf, and
#      exits when WareWoolf does (optionally powering the machine off).
#   6. Adds a block to ~/.bash_profile that runs startx on the first console,
#      so booting lands in WareWoolf. Over SSH nothing changes.
#   7. Reports on NetworkManager, which WareWoolf's Wi-Fi Manager needs, and
#      switches to it if you asked with --network-manager.
#
# Every file it touches is backed up beside itself first (~/.xinitrc.bak-DATE),
# and the block it adds to ~/.bash_profile sits between marker comments so the
# script can be run again safely and the block can be removed by hand.
#
# Run with --dry-run from any machine to see exactly what it would do.
#
# Options:
#   --deb PATH            Install this .deb instead of downloading one.
#   --version X.Y.Z       Download this release instead of the latest.
#   --poweroff-on-exit    Shut the machine down when WareWoolf is closed,
#                         instead of dropping to a console.
#   --keep-cursor         Leave the mouse pointer visible.
#   --network-manager     Install and switch to NetworkManager so the Wi-Fi
#                         Manager works (Raspberry Pi OS Bookworm and newer
#                         already use it; see the notes in step 7).
#   --no-autologin        Skip step 4. You will log in by hand on each boot.
#   --reboot              Reboot when finished.
#   --dry-run             Print what would be done; change nothing.
#   --force               Carry on even if a desktop appears to be installed.
#   -h, --help            Show this help.

set -euo pipefail

REPO="brsloan/warewoolf"
USER="${USER:-$(id -un)}"

DEB_PATH=""
VERSION=""
POWEROFF_ON_EXIT=false
KEEP_CURSOR=false
NETWORK_MANAGER=false
AUTOLOGIN=true
REBOOT=false
DRY_RUN=false
FORCE=false

usage(){
  # The comment block at the top of this file, up to the first blank line.
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --deb) DEB_PATH="${2:-}"; shift 2;;
    --deb=*) DEB_PATH="${1#*=}"; shift;;
    --version) VERSION="${2:-}"; shift 2;;
    --version=*) VERSION="${1#*=}"; shift;;
    --poweroff-on-exit) POWEROFF_ON_EXIT=true; shift;;
    --keep-cursor) KEEP_CURSOR=true; shift;;
    --network-manager) NETWORK_MANAGER=true; shift;;
    --no-autologin) AUTOLOGIN=false; shift;;
    --reboot) REBOOT=true; shift;;
    --dry-run) DRY_RUN=true; shift;;
    --force) FORCE=true; shift;;
    -h|--help) usage; exit 0;;
    *) printf 'Unknown option: %s\n\n' "$1" >&2; usage >&2; exit 2;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

say(){  printf '\n==> %s\n' "$*"; }
note(){ printf '    %s\n' "$*"; }
warn(){ printf '    WARNING: %s\n' "$*" >&2; }
die(){  printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# A check that stops the script for real, but only warns in --dry-run so the
# plan can be read on any machine.
require(){
  if "$DRY_RUN"; then warn "$*"; else die "$*"; fi
}

# Run a command, or print it in --dry-run.
run(){
  if "$DRY_RUN"; then
    printf '    $ %s\n' "$*"
  else
    "$@"
  fi
}

# Write stdin to a file owned by this user, backing up any different existing
# copy first. In --dry-run, print what the file would contain.
write_user_file(){
  local target="$1"
  local content
  content="$(cat)"
  if "$DRY_RUN"; then
    printf '    would write %s:\n' "$target"
    printf '%s\n' "$content" | sed 's/^/    | /'
    return
  fi
  if [ -f "$target" ] && [ "$(cat "$target")" = "$content" ]; then
    note "$target is already as it should be."
    return
  fi
  if [ -f "$target" ]; then
    local backup="$target.bak-$(date +%Y%m%d-%H%M%S)"
    cp -p "$target" "$backup"
    note "Backed up the old $target to $backup"
  fi
  printf '%s\n' "$content" > "$target"
  note "Wrote $target"
}

# Write stdin to a root-owned file, through sudo.
write_root_file(){
  local target="$1"
  local content
  content="$(cat)"
  if "$DRY_RUN"; then
    printf '    would write %s (as root):\n' "$target"
    printf '%s\n' "$content" | sed 's/^/    | /'
    return
  fi
  printf '%s\n' "$content" | sudo tee "$target" > /dev/null
  note "Wrote $target"
}

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------

say "1. Checking this machine"

if "$DRY_RUN"; then note "Dry run: nothing will be changed."; fi

[ "$(uname -s 2>/dev/null)" = "Linux" ] || require "This script is for Linux. You are on $(uname -s 2>/dev/null || echo 'an unknown system')."
command -v apt-get > /dev/null 2>&1 || require "apt-get was not found. This script is for Debian-family systems such as Raspberry Pi OS."
[ "$(id -u)" != "0" ] || require "Run this as the user who will be writing, not as root. It uses sudo where it needs to."
command -v sudo > /dev/null 2>&1 || require "sudo was not found. Install it, or add this user to the sudo group."

case "$(uname -m)" in
  aarch64|arm64) DEB_ARCH="arm64";;
  x86_64|amd64)  DEB_ARCH="amd64";;
  armv7l|armv6l)
    DEB_ARCH=""
    if [ -z "$DEB_PATH" ]; then
      require "This is a 32-bit ARM system, which current WareWoolf releases no longer support. v2.3.1 was the last release with an armv7l build: download it from https://github.com/$REPO/releases/tag/v2.3.1 and pass it with --deb."
    fi;;
  *) DEB_ARCH=""; [ -n "$DEB_PATH" ] || require "Unrecognised architecture '$(uname -m)'. Pass a .deb with --deb.";;
esac

if [ -n "$DEB_PATH" ] && [ ! -f "$DEB_PATH" ]; then
  require "--deb: $DEB_PATH is not a file."
fi

if [ -n "$DEB_PATH" ] && [ -n "$VERSION" ]; then
  die "--deb and --version cannot be used together."
fi

# A desktop already installed means a display manager owns the screen, and the
# console-autologin approach below would fight it. Stop unless told otherwise.
has_desktop=false
if command -v systemctl > /dev/null 2>&1; then
  if [ "$(systemctl get-default 2>/dev/null || true)" = "graphical.target" ]; then has_desktop=true; fi
  for dm in lightdm gdm gdm3 sddm; do
    if systemctl is-enabled "$dm" > /dev/null 2>&1; then has_desktop=true; fi
  done
fi
if "$has_desktop" && ! "$FORCE"; then
  require "A desktop or display manager seems to be installed. This script is meant for Raspberry Pi OS *Lite* (no desktop). Re-run with --force if you know what you are doing."
fi

if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  note "System: ${PRETTY_NAME:-unknown} ($(uname -m))"
fi
note "User: $USER  Home: $HOME"

# ---------------------------------------------------------------------------
# 2. Xorg + Matchbox
# ---------------------------------------------------------------------------

say "2. Installing Xorg, the Matchbox window manager, and xset"
note "This is the slow step on a Pi: a no-desktop OS has almost none of the dependencies yet."
run sudo apt-get update
run sudo apt-get install -y xorg matchbox-window-manager x11-xserver-utils curl ca-certificates

# ---------------------------------------------------------------------------
# 3. WareWoolf
# ---------------------------------------------------------------------------

say "3. Installing WareWoolf"

if [ -z "$DEB_PATH" ]; then
  if [ -n "$VERSION" ]; then
    api="https://api.github.com/repos/$REPO/releases/tags/v${VERSION#v}"
  else
    api="https://api.github.com/repos/$REPO/releases/latest"
  fi
  note "Looking up the ${VERSION:+v${VERSION#v} }release for $DEB_ARCH at $api"
  if "$DRY_RUN"; then
    DEB_PATH="/tmp/warewoolf_${DEB_ARCH}.deb"
    note "would download the *_${DEB_ARCH}.deb asset of that release to $DEB_PATH"
  else
    release_json="$(curl -fsSL "$api")" || die "Could not reach GitHub. Is the network up? (You can also download the .deb elsewhere and pass it with --deb.)"
    deb_url="$(printf '%s\n' "$release_json" \
      | grep -o '"browser_download_url": *"[^"]*_'"$DEB_ARCH"'\.deb"' \
      | head -n 1 \
      | sed 's/.*"\(https[^"]*\)"/\1/')"
    [ -n "$deb_url" ] || die "That release has no _${DEB_ARCH}.deb asset."
    DEB_PATH="/tmp/$(basename "$deb_url")"
    note "Downloading $deb_url"
    curl -fL --progress-bar -o "$DEB_PATH" "$deb_url"
    chmod 644 "$DEB_PATH"
  fi
fi

# apt-get (rather than dpkg -i) so the .deb's dependencies are pulled in with it.
# The path must contain a slash for apt to treat it as a file, not a package name.
case "$DEB_PATH" in
  /*) ;;
  *) DEB_PATH="./$DEB_PATH";;
esac
run sudo apt-get install -y "$DEB_PATH"

if ! "$DRY_RUN"; then
  command -v warewoolf > /dev/null 2>&1 || die "WareWoolf installed but 'warewoolf' is not on the PATH. Something went wrong with the package."
  note "WareWoolf is at $(command -v warewoolf)"
fi

# ---------------------------------------------------------------------------
# 4. Console autologin
# ---------------------------------------------------------------------------

say "4. Logging $USER in automatically on the first console"

if ! "$AUTOLOGIN"; then
  note "Skipped (--no-autologin). You will type your username and password at each boot."
elif command -v raspi-config > /dev/null 2>&1; then
  # B2 = "Console Autologin", the same thing as the systemd override below plus
  # whatever else the Pi maintainers decide belongs with it.
  run sudo raspi-config nonint do_boot_behaviour B2
else
  run sudo systemctl set-default multi-user.target
  run sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
  write_root_file /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $USER --noclear %I \$TERM
EOF
fi

# ---------------------------------------------------------------------------
# 5. ~/.xinitrc
# ---------------------------------------------------------------------------

say "5. Writing ~/.xinitrc (what X runs: Matchbox, then WareWoolf)"

if "$POWEROFF_ON_EXIT"; then
  exit_line="systemctl poweroff"
  note "The machine will power off when WareWoolf is closed (--poweroff-on-exit)."
else
  exit_line="# systemctl poweroff   # uncomment to power off when WareWoolf is closed"
  note "Closing WareWoolf will drop to a console. Type startx to reopen it."
fi

write_user_file "$HOME/.xinitrc" <<EOF
#!/bin/sh
# Written by WareWoolf's setup-writerdeck.sh on $(date +%Y-%m-%d).
# X runs this once per startx. When the last line finishes, X exits.

# Keep the screen from blanking or sleeping while you sit and think.
if command -v xset > /dev/null 2>&1; then
  xset s off
  xset s noblank
  xset -dpms
fi

# A window manager, so WareWoolf's window gets focus and the keyboard.
matchbox-window-manager &
wm_pid=\$!

# WareWoolf, full screen, until you exit it (File > Exit, or Ctrl+Shift+X).
warewoolf

# Then take the window manager down with it, so X exits instead of
# leaving an empty black screen.
kill "\$wm_pid"
$exit_line
EOF

# ---------------------------------------------------------------------------
# 6. ~/.bash_profile
# ---------------------------------------------------------------------------

say "6. Starting X (and so WareWoolf) at login on the first console"

if "$KEEP_CURSOR"; then
  startx_cmd="startx"
else
  startx_cmd="startx -- -nocursor"
  note "The mouse pointer will be hidden (no --keep-cursor)."
fi

profile="$HOME/.bash_profile"
begin_marker="# >>> warewoolf writerdeck >>>"
end_marker="# <<< warewoolf writerdeck <<<"

block="$begin_marker
# Added by WareWoolf's setup-writerdeck.sh on $(date +%Y-%m-%d).
# On the first console only (not over SSH, not on tty2+), start X, which
# runs ~/.xinitrc, which runs WareWoolf. When WareWoolf closes you land
# back here at a shell prompt.
if [ -z \"\$DISPLAY\" ] && [ \"\$(tty)\" = /dev/tty1 ]; then
    $startx_cmd
    echo
    echo \"WareWoolf has closed. Type startx to open it again,\"
    echo \"sudo poweroff to shut the machine down, or exit to log out.\"
fi
$end_marker"

# Keep everything outside the markers; replace or append the block.
existing=""
if [ -f "$profile" ]; then
  # The markers contain nothing sed treats specially in a basic regex.
  existing="$(sed "/^$begin_marker\$/,/^$end_marker\$/d" "$profile")"
fi
if [ -n "$existing" ]; then
  new_profile="$existing
$block"
else
  new_profile="$block"
fi
printf '%s\n' "$new_profile" | write_user_file "$profile"

# ---------------------------------------------------------------------------
# 7. NetworkManager, for the Wi-Fi Manager
# ---------------------------------------------------------------------------

say "7. Checking NetworkManager (WareWoolf's Wi-Fi Manager talks to it through nmcli)"

nm_active=false
if command -v systemctl > /dev/null 2>&1 && systemctl is-active --quiet NetworkManager 2>/dev/null; then
  nm_active=true
fi

if "$nm_active"; then
  note "NetworkManager is already running. The Wi-Fi Manager will work."
elif "$NETWORK_MANAGER"; then
  warn "Switching network stacks. If you are connected over SSH this may drop the connection,"
  warn "and Wi-Fi credentials may need entering again - in WareWoolf's Wi-Fi Manager, after the reboot."
  run sudo apt-get install -y network-manager
  if command -v raspi-config > /dev/null 2>&1; then
    # Older raspi-config has no NetworkManager option; newer ones do (do_netconf 2).
    run sudo apt-get install -y --only-upgrade raspi-config
    if "$DRY_RUN"; then
      run sudo raspi-config nonint do_netconf 2
    elif ! sudo raspi-config nonint do_netconf 2; then
      warn "raspi-config could not switch to NetworkManager; enabling it directly."
      run sudo systemctl disable --now dhcpcd || true
      run sudo systemctl enable --now NetworkManager
    fi
  else
    run sudo systemctl enable --now NetworkManager
  fi
else
  warn "NetworkManager is not running, so the Wi-Fi Manager inside WareWoolf will not work."
  warn "Raspberry Pi OS Bookworm (2023) and newer use NetworkManager already; Bullseye does not."
  warn "Re-run this script with --network-manager to install it and switch, or do it in"
  warn "raspi-config: Advanced Options > Network Config > NetworkManager."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

say "Finished"
cat <<EOF
    On the next boot this machine will log in as $USER and open WareWoolf.

    Files changed:
      ~/.xinitrc         Matchbox + WareWoolf (old copy backed up beside it, if any)
      ~/.bash_profile    startx on tty1, between "$begin_marker" markers
      $( "$AUTOLOGIN" && printf '%s' "console autologin  (raspi-config, or /etc/systemd/system/getty@tty1.service.d/autologin.conf)" )

    Getting to a terminal later:
      - Close WareWoolf (Ctrl+Shift+X). $( "$POWEROFF_ON_EXIT" && printf '%s' "The machine will power off." || printf '%s' "You land at a shell prompt." )
      - Or press Ctrl+Alt+F2 for a second console at any time (Ctrl+Alt+F1 to go back).
      - Or SSH in from another computer.

    To undo: delete the marker block from ~/.bash_profile, remove ~/.xinitrc,
    and set "Console" (not autologin) under raspi-config > System Options > Boot.
EOF

if "$REBOOT"; then
  say "Rebooting"
  run sudo reboot
else
  printf '\n    Reboot to try it:  sudo reboot\n\n'
fi
