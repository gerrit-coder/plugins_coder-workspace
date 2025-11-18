#!/bin/bash
# Startup script for Coder workspace to clone Gerrit repository and cherry-pick patchset
# This script uses rich parameters passed from the coder-workspace plugin:
# - GERRIT_GIT_HTTP_URL: HTTP URL for the git repository
# - GERRIT_GIT_SSH_URL: SSH URL for the git repository (alternative)
# - GERRIT_CHANGE_REF: Git ref for the patchset (e.g., refs/changes/74/67374/2)
# - REPO: Repository name (used as directory name)
# - GERRIT_CHANGE: Change number
# - GERRIT_PATCHSET: Patchset number

set -e

# Default directory name (use REPO if available, otherwise use a default)
REPO_DIR="${REPO:-gerrit-repo}"
if [ -z "$REPO_DIR" ]; then
  REPO_DIR="gerrit-repo"
fi

# Prefer SSH URL when available (avoids HTTP auth prompts), fall back to HTTP
if [ -n "$GERRIT_GIT_SSH_URL" ]; then
  echo "Using SSH URL for cloning (no HTTP auth required)"
  GIT_URL="$GERRIT_GIT_SSH_URL"
else
  GIT_URL="$GERRIT_GIT_HTTP_URL"
  echo "Using HTTP URL for cloning"
fi

if [ -z "$GIT_URL" ]; then
  echo "Error: Neither GERRIT_GIT_HTTP_URL nor GERRIT_GIT_SSH_URL is set"
  exit 1
fi

# Construct change ref when change + patchset are available but change ref is not
if [ -z "$GERRIT_CHANGE_REF" ] && [ -n "$GERRIT_CHANGE" ] && [ -n "$GERRIT_PATCHSET" ]; then
  CHANGE_NUM="$GERRIT_CHANGE"
  PATCHSET="$GERRIT_PATCHSET"
  if [ ${#CHANGE_NUM} -ge 2 ]; then
    LAST_TWO="${CHANGE_NUM: -2}"
  else
    LAST_TWO="$(printf "%02d" "$CHANGE_NUM")"
  fi
  GERRIT_CHANGE_REF="refs/changes/${LAST_TWO}/${CHANGE_NUM}/${PATCHSET}"
  echo "Constructed GERRIT_CHANGE_REF: $GERRIT_CHANGE_REF"
fi

if [ -z "$GERRIT_CHANGE_REF" ]; then
  echo "Error: GERRIT_CHANGE_REF is not set (and could not be constructed)"
  exit 1
fi

# Disable helper/askpass that may prompt for Coder credentials when cloning HTTP URLs
git config --global credential.helper ""
unset GIT_ASKPASS || true
export GIT_ASKPASS=""

# Check if repository already exists
if [ -d "$REPO_DIR" ] && [ -d "$REPO_DIR/.git" ]; then
  echo "Repository $REPO_DIR already exists. Updating..."
  cd "$REPO_DIR"
  git fetch origin "$GERRIT_CHANGE_REF"
  git cherry-pick FETCH_HEAD || {
    echo "Cherry-pick failed. You may need to resolve conflicts manually."
    echo "Repository is in cherry-pick state. Run 'git status' to see details."
    exit 1
  }
  echo "Successfully cherry-picked patchset $GERRIT_CHANGE_REF"
else
  echo "Cloning repository from $GIT_URL..."
  git clone "$GIT_URL" "$REPO_DIR" || {
    echo "Error: Failed to clone repository"
    echo "If cloning via HTTP, ensure credentials (e.g., ~/.netrc) are configured."
    exit 1
  }

  cd "$REPO_DIR"

  echo "Fetching patchset $GERRIT_CHANGE_REF..."
  git fetch origin "$GERRIT_CHANGE_REF" || {
    echo "Error: Failed to fetch patchset $GERRIT_CHANGE_REF"
    exit 1
  }

  echo "Cherry-picking patchset $GERRIT_CHANGE_REF..."
  git cherry-pick FETCH_HEAD || {
    echo "Cherry-pick failed. You may need to resolve conflicts manually."
    echo "Repository is in cherry-pick state. Run 'git status' to see details."
    exit 1
  }

  echo "Successfully cloned repository and cherry-picked patchset $GERRIT_CHANGE_REF"
fi

echo "Repository is ready at: $(pwd)"
echo "Current commit: $(git rev-parse HEAD)"
echo "Change: ${GERRIT_CHANGE:-unknown}, Patchset: ${GERRIT_PATCHSET:-unknown}"

