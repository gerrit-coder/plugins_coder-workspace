# Coder Workspace Gerrit Plugin

Adds an "Open Coder Workspace" action to the Gerrit change page (revision actions).
When clicked, it opens your Coder workspace for the current change; if no workspace
exists for the repo/branch/patchset, the plugin creates one using the Coder REST API
and injects Gerrit context (repo, branch, change, patchset) into the template via
rich parameters.

## Features

- Open or create-on-demand a Coder workspace for the current change/patchset, passing repo, branch, change and patchset via rich parameters
- Reuse existing workspace when possible: before creating, the plugin tries to open a workspace that matches the expected name for the current context
- Admin-only configuration via gerrit.config (no per-user Settings menu)
- Optional per-repo/branch template mappings with glob support
- Workspace name templating using tokens: `{repo}`, `{branch}`, `{change}`, `{patchset}`
- Optional Dry-Run Preview (admin-controlled) to confirm the request URL and payload before creating
- "Open Coder Workspace" action (open or create-on-demand)
- "Delete Coder Workspace" action
- Single workspace management (no history tracking)

## Configure

Add to `gerrit.config` (example):

**Option 1: Direct Coder Connection**
```
[plugins]
  allowRemoteAdmin = true

[plugin "coder-workspace"]
  enabled = true
  serverUrl = http://localhost:3000  # Direct Coder connection
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
  # Map Gerrit fields to template parameter names (optional)
  richParams = REPO:repo,BRANCH:branch,GERRIT_CHANGE:change,GERRIT_PATCHSET:patchset,GERRIT_CHANGE_URL:url

  # Optional per-repo/branch template overrides (JSON string)
  templateMappingsJson = [
    {"repo":"my/org/*","branch":"refs/heads/main","templateVersionId":"0ba39c92-1f1b-4c32-aa3e-9925d7713eb1","templateVersionPresetId":"512a53a7-30da-446e-a1fc-713c630baff1"},
    {"repo":"another/repo","branch":"refs/heads/*","templateId":"c6d67e98-83ea-49f0-8812-e4abae2b68bc"}
  ]
```

**Option 2: Production Setup**
```
[plugins]
  allowRemoteAdmin = true

[plugin "coder-workspace"]
  enabled = true
  serverUrl = https://coder.example.com  # Production Coder instance
  apiKey = ${secret:coder/session_token}
  # ... rest of configuration same as above
```

## Getting Coder Configuration Values

To configure the plugin, you need to obtain several values from your Coder instance:

### 1. Get Your API Token

1. Log into your Coder instance
2. Go to your user settings/profile
3. Look for "API Tokens" or "Session Tokens" section
4. Generate a new token and copy it

### 2. Get Organization ID

Use the Coder API to find your organization ID:

```bash
curl -H "Coder-Session-Token: YOUR_TOKEN" \
     https://your-coder-instance.com/api/v2/organizations
```

This returns a list of organizations with their IDs:
```json
[
  {
    "id": "7c60d51f-b44e-4682-87d6-449835ea4de6",
    "name": "my-org",
    "display_name": "My Organization"
  }
]
```

### 3. Get Template Information

#### Option A: Get Template ID (uses latest version)
```bash
curl -H "Coder-Session-Token: YOUR_TOKEN" \
     https://your-coder-instance.com/api/v2/templates
```

Example responses:
```json
[
  {
    "id": "c6d67e98-83ea-49f0-8812-e4abae2b68bc",
    "name": "my-template",
    "display_name": "My Development Template"
  }
]
```

#### Option B: Get Template Version ID (for specific version)
```bash
curl -H "Coder-Session-Token: YOUR_TOKEN" \
     https://your-coder-instance.com/api/v2/templates/TEMPLATE_ID/versions
```

Example responses:
```json
[
  {
    "id": "0ba39c92-1f1b-4c32-aa3e-9925d7713eb1",
    "template_id": "c6d67e98-83ea-49f0-8812-e4abae2b68bc",
    "name": "v1.0.0",
    "created_at": "2024-01-01T00:00:00Z"
  }
]
```

### 4. Alternative: Use Coder CLI

If you have the Coder CLI installed:

```bash
# List organizations
coder orgs list

# List templates
coder templates list

# List template versions for a specific template
coder templates versions list TEMPLATE_NAME
```

### 5. Update Your gerrit.config

Once you have these values, update your `gerrit.config`:

**For direct Coder connection:**
```ini
[plugin "coder-workspace"]
  enabled = true
  serverUrl = http://localhost:3000  # Direct Coder connection
  apiKey = ${secret:coder/session_token}  # Your API token
  organization = 7c60d51f-b44e-4682-87d6-449835ea4de6  # From step 2
  templateId = c6d67e98-83ea-49f0-8812-e4abae2b68bc  # From step 3A
  # OR use templateVersionId for specific version:
  # templateVersionId = 0ba39c92-1f1b-4c32-aa3e-9925d7713eb1  # From step 3B
```

**For production setup:**
```ini
[plugin "coder-workspace"]
  enabled = true
  serverUrl = https://your-coder-instance.com  # Production Coder connection
  apiKey = ${secret:coder/session_token}  # Your API token
  organization = 7c60d51f-b44e-4682-87d6-449835ea4de6  # From step 2
  templateId = c6d67e98-83ea-49f0-8812-e4abae2b68bc  # From step 3A
  # OR use templateVersionId for specific version:
  # templateVersionId = 0ba39c92-1f1b-4c32-aa3e-9925d7713eb1  # From step 3B
```

**Notes:**
- **Template ID**: Uses the latest version of the template
- **Template Version ID**: Uses a specific version of the template (more precise)
- **Organization**: Only needed if you're using organization-scoped workspaces
- **API Token**: Should be stored securely, preferably using Gerrit's secret management (`${secret:coder/session_token}`)

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

- On the change page, the "Open Coder Workspace" action targets the latest patchset if none is selected.
- The plugin passes repo, branch, change, patchset and change URL as rich parameters by default (configurable).

### Single Workspace Management

The plugin manages a single workspace at a time. When creating a new workspace, any existing workspace for the same context will be replaced.

### "Open Coder Workspace" action

The plugin adds one convenience action in the change page overflow menu:

- "Open Coder Workspace": Opens your Coder workspace for the current change/patchset. If no workspace exists for this context, the plugin first attempts to find an existing workspace by the expected name (based on your name template and mappings). If none exists, it is created on-demand and then opened.

This action is always available. A short toast indicates the context when opening/creating.

### "Delete Coder Workspace" action

Deletes your Coder workspace for the current context. You will be asked to confirm the deletion.

### Mock server (optional)

For local/manual testing without a real Coder instance, see `plugins/coder-workspace/mock-server.md` for a minimal mock endpoint you can run to validate requests from the plugin.

## Test Environment

For a complete test environment setup, see the `test/` directory in this repository:

```bash
cd test/
cp env.example .env
# Edit .env with your values
./run.sh
```

This will set up both Coder and the plugin with proper configuration automatically.

## Troubleshooting

### Common Issues

#### "Coder Workspace plugin is not configured (serverUrl is empty)"

This error indicates the plugin cannot read its configuration. Follow these steps:

1. **Check plugin installation:**
   ```bash
   ls -la $GERRIT_SITE/plugins/coder-workspace.jar
   ```

2. **Verify configuration endpoint:**
   Visit `http://your-gerrit-server/config/server/coder-workspace.config`

   **Expected result:** JSON response with your configuration
   **If error/empty:** Plugin isn't loaded properly

3. **Check browser console:**
   - Open developer tools (F12)
   - Look for `[coder-workspace]` debug messages
   - Check for JavaScript errors

4. **Restart Gerrit:**
   ```bash
   $GERRIT_SITE/bin/gerrit.sh restart
   ```

5. **Clear browser cache:**
   - Hard refresh: Ctrl+F5 (Windows/Linux) or Cmd+Shift+R (Mac)
   - Or clear browser cache completely

#### Plugin not appearing in change page

1. **Verify plugin is enabled:**
   ```ini
   [plugin "coder-workspace"]
     enabled = true
   ```

2. **Check plugin list:**
   Visit `http://your-gerrit-server/plugins/`
   Look for `coder-workspace` in the list

3. **Check Gerrit logs:**
   ```bash
   tail -f $GERRIT_SITE/logs/error_log
   ```

#### "Failed to open/create Coder workspace" errors

1. **Verify Coder server connectivity:**
   ```bash
   curl -H "Coder-Session-Token: YOUR_TOKEN" \
        https://your-coder-instance.com/api/v2/templates
   ```

2. **Check API token validity:**
   - Ensure token hasn't expired
   - Verify token has necessary permissions

3. **Verify template ID:**
   - Check template exists in Coder
   - Ensure template ID is correct

4. **Check organization ID:**
   - Verify organization exists
   - Ensure user has access to organization

#### Configuration not loading

1. **Check gerrit.config syntax:**
   - No extra spaces or characters
   - Proper section headers
   - Valid JSON in `templateMappingsJson`

2. **Verify secret management:**
   ```ini
   apiKey = ${secret:coder/session_token}
   ```
   Ensure the secret is properly configured in Gerrit's secret management.

3. **Test configuration endpoint:**
   ```bash
   curl http://your-gerrit-server/config/server/coder-workspace.config
   ```

### Debug Steps

#### Enable debug logging

Add to your `gerrit.config`:
```ini
[log4j]
  log4j.logger.com.gerritforge.gerrit.plugins.coderworkspace = DEBUG
```

#### Check browser console

When clicking "Open Coder Workspace":
1. Open browser developer tools (F12)
2. Go to Console tab
3. Look for messages starting with `[coder-workspace]`
4. Check Network tab for API requests

#### Verify Coder API access

Test your Coder API configuration:
```bash
# Test basic connectivity
curl -H "Coder-Session-Token: YOUR_TOKEN" \
     https://your-coder-instance.com/api/v2/templates

# Test workspace creation (dry run)
curl -X POST \
     -H "Coder-Session-Token: YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"test-workspace","template_id":"YOUR_TEMPLATE_ID"}' \
     https://your-coder-instance.com/api/v2/users/me/workspaces
```

### Browser Development Setup

#### Disabling CORS for Development

When developing with the coder-workspace plugin, you may encounter CORS (Cross-Origin Resource Sharing) issues. To disable CORS for development purposes, launch Chrome or Edge with the `--disable-web-security` flag:

**Chrome:**
```bash
# Windows
chrome.exe --user-data-dir="C:/temp/chrome_dev" --disable-web-security --disable-features=VizDisplayCompositor

# macOS
open -n -a /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --args --user-data-dir="/tmp/chrome_dev" --disable-web-security

# Linux
google-chrome --user-data-dir="/tmp/chrome_dev" --disable-web-security
```

**Microsoft Edge:**
```bash
# Windows
msedge.exe --user-data-dir="C:/temp/edge_dev" --disable-web-security --disable-features=VizDisplayCompositor

# macOS
open -n -a /Applications/Microsoft\ Edge.app/Contents/MacOS/Microsoft\ Edge --args --user-data-dir="/tmp/edge_dev" --disable-web-security

# Linux
microsoft-edge --user-data-dir="/tmp/edge_dev" --disable-web-security
```

**⚠️ Important Security Note:**
- Only use these flags for development purposes
- Never use `--disable-web-security` for regular browsing
- The `--user-data-dir` flag creates a separate profile to avoid affecting your main browser data
- Close all browser windows before launching with these flags

### Getting Help

If you continue to have issues:

1. **Check Gerrit logs** for any plugin-related errors
2. **Verify Coder instance** is accessible and API is working
3. **Test with minimal configuration** first, then add complexity
4. **Check browser console** for JavaScript errors
5. **Ensure all required fields** are properly configured
6. **Use the test environment** in `test/` directory to validate your setup

For additional support, include:
- Gerrit version
- Plugin version
- Coder version
- Error messages from logs
- Browser console output

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
  - Open a change page and look for "Open Coder Workspace" in the three-dot overflow menu
