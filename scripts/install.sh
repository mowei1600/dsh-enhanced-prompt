#!/usr/bin/env sh
# Install dsh-enhanced-prompt from GitHub (clone + local installer).
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/install.sh | sh
#
# Overrides: DSH_PROFILE=desktop DSH_REPO=owner/repo DSH_REF=main sh install.sh
set -eu

PROFILE="${DSH_PROFILE:-desktop}"
REPO="${DSH_REPO:-mowei1600/dsh-enhanced-prompt}"
REF="${DSH_REF:-main}"

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js >= 18 is required" >&2; exit 1; }

DEST="$(mktemp -d)"
cleanup() { rm -rf "$DEST"; }
trap cleanup EXIT INT TERM

echo "cloning $REPO ($REF) -> $DEST"
git clone --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$DEST/repo"

echo "installing into profile '$PROFILE'"
node "$DEST/repo/bin/install.mjs" install --profile "$PROFILE"

echo
echo "Installed. Refresh the DSH window (Ctrl+R) to load the composer button."
echo "Verify with /enhance status in a chat, and check the Host log for [enhanced-prompt] lines."
