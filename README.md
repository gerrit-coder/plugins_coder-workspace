# Coder Workspace Gerrit Plugin

Adds a "Create Coder Workspace" action to the Gerrit change page (revision actions).
When clicked, it creates a Coder workspace using the Coder REST API and injects
Gerrit context such as repo, branch, change number and patchset into the template
via rich parameters.

## Features

- Create a Coder workspace from the current change/patchset, passing repo, branch, change and patchset via rich parameters
- Admin-only configuration via gerrit.config (no per-user Settings menu)
- Optional per-repo/branch template mappings with glob support
- Workspace name templating using tokens: `{repo}`, `{branch}`, `{change}`, `{patchset}`
- Optional Dry-Run Preview (admin-controlled) to confirm the request URL and payload before creating
- "Open Coder Workspace" action (open or create-on-demand)
- "Delete Coder Workspace" action
- Bounded history with retention limit per scope (admin-controlled)

## Configure

Add to `gerrit.config` (example):

```
[plugin "coder-workspace"]
  serverUrl = https://coder.example.com
  apiKey = ${secret:coder/session_token}
  # Use either templateId or templateVersionId
  templateId = c6d67e98-83ea-49f0-8812-e4abae2b68bc
  # templateVersionId = 0ba39c92-1f1b-4c32-aa3e-9925d7713eb1
  organization = 7c60d51f-b44e-4682-87d6-449835ea4de6
  user = me
  autostart = true
  automaticUpdates = always
  openAfterCreate = true
  enableDryRunPreview = false
  ttlMs = 0
  historyLimit = 10
  # Map Gerrit fields to template parameter names (optional)
  richParams = REPO:repo,BRANCH:branch,GERRIT_CHANGE:change,GERRIT_PATCHSET:patchset,GERRIT_CHANGE_URL:url

  # Optional per-repo/branch template overrides (JSON string)
  templateMappingsJson = [
    {"repo":"my/org/*","branch":"refs/heads/main","templateVersionId":"0ba39c92-1f1b-4c32-aa3e-9925d7713eb1","templateVersionPresetId":"512a53a7-30da-446e-a1fc-713c630baff1"},
    {"repo":"another/repo","branch":"refs/heads/*","templateId":"c6d67e98-83ea-49f0-8812-e4abae2b68bc"}
  ]
```

## Configuration source

This plugin reads its configuration from Gerrit's `gerrit.config` under `[plugin "coder-workspace"]`.
There is no per-user Settings menu in the UI.

You can configure:
- Coder Server URL, API Key (Coder-Session-Token), Organization, User
- Default Template ID or Template Version ID (+ optional Preset ID)
- Automatic updates, autostart, TTL, open-after-create
- Workspace Name Template (tokens: {repo},{branch},{change},{patchset})
- Template Mappings (JSON) via `templateMappingsJson`
- Rich parameter mapping via `richParams`

### Template Mappings JSON format

An array of objects. First match wins. `repo` and `branch` accept `*` wildcards.

```
[
  {
    "repo": "my/org/*",
    "branch": "refs/heads/main",
    "templateVersionId": "0ba39c92-1f1b-4c32-aa3e-9925d7713eb1",
    "templateVersionPresetId": "512a53a7-30da-446e-a1fc-713c630baff1",
    "workspaceNameTemplate": "{repo}-{change}-{patchset}",
    "richParams": [
      {"name": "REPO", "from": "repo"},
      {"name": "BRANCH", "from": "branch"},
      {"name": "GERRIT_CHANGE", "from": "change"},
      {"name": "GERRIT_PATCHSET", "from": "patchset"},
      {"name": "GERRIT_CHANGE_URL", "from": "url"}
    ]
  },
  {
    "repo": "another/repo",
    "branch": "refs/heads/*",
    "templateId": "c6d67e98-83ea-49f0-8812-e4abae2b68bc"
  }
]
```

If a mapping provides `richParams`, it overrides the default parameter mapping for that repo/branch match only.

### Notes on defaults

- On the change page, the "Create Coder Workspace" action defaults to the latest patchset if none is selected.
- The plugin passes repo, branch, change, patchset and change URL as rich parameters by default (configurable).

### History

The plugin records the last created workspace links in your browser (localStorage) to enable quick "Open Last" actions. Retention can be tuned via `historyLimit` in `gerrit.config`.

### "Open Coder Workspace" action

The plugin adds one convenience action in the change page overflow menu:

- "Open Coder Workspace": Opens your Coder workspace if one exists, otherwise creates it using the current change context (repo/branch/change/patchset) and then opens it.

This action is always available. A short toast indicates the context when opening/creating.

### "Delete Coder Workspace" action

Deletes your Coder workspace and clears the saved link in the browser. You will be asked to confirm the deletion.

### Mock server (optional)

For local/manual testing without a real Coder instance, see `plugins/coder-workspace/mock-server.md` for a minimal mock endpoint you can run to validate requests from the plugin.

## Get the Gerrit source

This plugin lives inside the Gerrit monorepo. If you don’t have the source yet:

```bash
git clone https://gerrit.googlesource.com/gerrit
cd gerrit
```

## Install Bazel on Ubuntu

This repo pins Bazel to `7.6.1` via the top-level `.bazelversion` file. The easiest way to match that on Ubuntu is Bazelisk.

Bazelisk auto-downloads the correct Bazel version based on `.bazelversion`.

```bash
sudo mkdir -p /usr/local/bin
curl -L https://github.com/bazelbuild/bazelisk/releases/latest/download/bazelisk-linux-amd64 -o /tmp/bazelisk
sudo install /tmp/bazelisk /usr/local/bin/bazel

# Verify (should report 7.6.1 because of .bazelversion)
bazel version
```

## Initialize Gerrit submodules

This plugin is built from the Gerrit source tree, which uses git submodules for some dependencies (e.g., `modules/jgit`, `modules/java-prettify`). If these submodules are not initialized, you may see errors such as:

> No MODULE.bazel, REPO.bazel, or WORKSPACE file found in modules/jgit

From the Gerrit repo root, initialize submodules:

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

Optional: If you encountered fetch/toolchain hiccups previously, clear external repos before rebuilding:

```bash
bazel clean --expunge_external
```

## Build

From the Gerrit repo root:

```bash
bazel build plugins/coder-workspace:coder-workspace
```

Deploy the resulting jar to `$GERRIT_SITE/plugins/` and restart Gerrit.

## Deploy & Enable

1. **Copy the JAR** to your Gerrit site's plugins directory:
   ```bash
   cp bazel-bin/plugins/coder-workspace/coder-workspace.jar $GERRIT_SITE/plugins/
   ```

2. **Enable the plugin** in `$GERRIT_SITE/etc/gerrit.config`:
   ```ini
   [plugins]
     allowRemoteAdmin = true

   [plugin "coder-workspace"]
     enabled = true
   ```

3. **Restart Gerrit**:
   ```bash
   $GERRIT_SITE/bin/gerrit.sh restart
   ```

4. **Clear browser cache** and reload:
   - **Chrome/Edge**: Press `Ctrl+Shift+Delete`, select "Cached images and files", click "Clear data"
   - **Firefox**: Press `Ctrl+Shift+Delete`, select "Cache", click "Clear Now"
   - **Or do a hard refresh**: Press `Ctrl+F5` (Windows/Linux) or `Cmd+Shift+R` (Mac)

5. **Verify** the plugin loaded:
   - Check browser console for `[coder-workspace]` debug logs when loading a change page
   - Visit `http://your-gerrit-server/plugins/` to see if `coder-workspace` is listed
  - Open a change page and look for "Create Coder Workspace" in the three-dot overflow menu
