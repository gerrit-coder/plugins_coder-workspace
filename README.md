# Coder Workspace Gerrit Plugin

Adds an "Open Coder Workspace" action to the Gerrit change page (revision actions).
When clicked, it opens your Coder workspace for the current change; if no workspace
exists for the repo/branch/patchset, the plugin creates one using the Coder REST API
and injects Gerrit context (repo, branch, change, patchset) into the template via
rich parameters.

## Compatibility

This plugin is compatible with Gerrit 3.4.1 and later versions. The plugin includes
automatic retry logic to handle Gerrit 3.4.1's change actions API initialization timing.
If you encounter errors about `addActionButton` being undefined, see the
[Troubleshooting](#troubleshooting) section below for details.

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
- Exact-name creation mode via `strictName` (enforce precise names from `workspaceNameTemplate`, no suffixing)
- Cross-browser authentication helpers to avoid login redirects when Coder and Gerrit are in different browsers
- Automatically passes git repository URLs and change refs as rich parameters, enabling workspace templates to clone the repository and cherry-pick the latest patchset

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
  openAfterCreate = true
  enableDryRunPreview = false
  ttlMs = 0
  # Enable/disable repository cloning for Gerrit changes (default: true)
  # When enabled, git-related rich parameters (GERRIT_GIT_SSH_URL, GERRIT_CHANGE_REF)
  # are passed to the workspace template, enabling automatic repository cloning.
  enableCloneRepository = true
  # Enforce exact-name creation (optional)
  workspaceNameTemplate = "{repo}-{change}"
  strictName = true
  # Map Gerrit fields to template parameter names (optional)
  richParams = REPO:repo,BRANCH:branch,GERRIT_CHANGE:change,GERRIT_PATCHSET:patchset,GERRIT_CHANGE_URL:url

  # Optional per-repo/branch template overrides (JSON string)
  templateMappingsJson = [
    {"repo":"my/org/*","branch":"refs/heads/main","templateVersionId":"0ba39c92-1f1b-4c32-aa3e-9925d7713eb1","templateVersionPresetId":"512a53a7-30da-446e-a1fc-713c630baff1"},
    {"repo":"another/repo","branch":"refs/heads/*","templateId":"c6d67e98-83ea-49f0-8812-e4abae2b68bc"}
  ]

  # Cross-browser authentication (optional)
  # Retries API requests with the API key as a query parameter on 401/network errors
  retryAuthWithQueryParam = true
  # Name of the query parameter for the token if retried
  apiKeyQueryParamName = coder_session_token
  # Append token to app deeplink URL when opening (use only in trusted environments)
  appendTokenToAppUrl = false
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
- TTL, open-after-create
- Workspace Name Template (tokens: {repo},{branch},{branchShort},{change},{patchset})
- Template Mappings (JSON) via `templateMappingsJson`
- Rich parameter mapping via `richParams`
- Exact-name behavior via `strictName`
- Repository cloning: `enableCloneRepository` (enable/disable git-related rich parameters)
- Cross-browser auth helpers: `retryAuthWithQueryParam`, `apiKeyQueryParamName`, `appendTokenToAppUrl`

#### Alternate name lookup and app deeplinks

Two optional settings help the plugin find existing workspaces and open a specific app without rebuilding the UI bundle:

- `alternateNameTemplates` or `alternateNameTemplatesJson`
   - Lookup-only name templates the plugin will try before creating a workspace.
   - Supports tokens like `{repo}`, `{branch}`, `{branchShort}`, `{change}`, `{patchset}`.
   - You can set either a comma-separated list or a JSON array. JSON takes precedence if both are provided.
   - Examples:
      ```ini
      [plugin "coder-workspace"]
         # CSV
         alternateNameTemplates = {repo}.{branchShort}, {repo}-{branch}

         # or JSON
         alternateNameTemplatesJson = ["{repo}.{branchShort}", "{repo}-{branch}"]
      ```

- `appSlug`
   - Preferred app to open when Coder's API does not return `latest_app_status.uri`.
   - The plugin will open `/@<owner>/<workspace>/apps/<appSlug>/`.
   - Example:
      ```ini
      [plugin "coder-workspace"]
         appSlug = code-server
      ```

- `waitForAppReadyMs` and `waitPollIntervalMs`
   - Optional readiness polling before opening the workspace. If `waitForAppReadyMs > 0`, the plugin will poll the workspace by name until `latest_app_status.uri` is available or the timeout elapses. `waitPollIntervalMs` controls the polling interval (default 1000ms).
   - Example:
      ```ini
      [plugin "coder-workspace"]
         waitForAppReadyMs = 35000
         waitPollIntervalMs = 1000
      ```

Notes:
- If neither alternateNameTemplates nor alternateNameTemplatesJson is set, the plugin defaults to `[{repo}.{branchShort}]` for lookup.
- These settings are returned by `/config/server/coder-workspace.config`; you can tweak them at runtime without rebuilding the web bundle.
- If `strictName = true`, alternate name templates are ignored during creation and initial lookup; the plugin creates or opens exactly the primary name from `workspaceNameTemplate`.

### Exact-name mode (strictName)

`strictName` enforces that the workspace name matches your `workspaceNameTemplate` exactly (no auto-suffixing, no reuse via alternates):

- Default is `strictName = false` (flexible mode):
   - Tries to find an existing workspace by primary name and any `alternateNameTemplates`.
   - If none found, attempts creation; on HTTP 409 conflict (name already taken but not visible), the plugin may retry with a unique suffix to ensure the user gets a workspace.

- With `strictName = true` (exact-name mode):
   - The plugin bypasses alternate lookups and prefix searches and attempts to create exactly the primary name.

Recommended when you expect deterministic names derived from review context (for example, `{repo}-{change}`):

```ini
[plugin "coder-workspace"]
   workspaceNameTemplate = "{repo}-{change}"
   # Optionally remove alternates (or keep only the same primary form)
   # alternateNameTemplates = {repo}-{change}
   strictName = true
```

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
- The plugin also passes git repository URLs and change refs for automatic repository cloning and cherry-picking when `enableCloneRepository = true` (default, see [Git Repository Cloning](#git-repository-cloning) below).

### Single Workspace Management

The plugin manages a single workspace at a time. When creating a new workspace, any existing workspace for the same context will be replaced.

### "Open Coder Workspace" action

The plugin adds one convenience action in the change page overflow menu:

- "Open Coder Workspace": Opens your Coder workspace for the current change/patchset. If no workspace exists for this context, the plugin first attempts to find an existing workspace by the expected name (based on your name template and mappings). If none exists, it is created on-demand and then opened.

This action is always available. A short toast indicates the context when opening/creating.

### "Delete Coder Workspace" action

Deletes your Coder workspace for the current context. You will be asked to confirm the deletion.

## Troubleshooting

### Common Issues

#### "Coder Workspace plugin is not configured (serverUrl is empty)"

```bash
ls -la $GERRIT_SITE/plugins/coder-workspace.jar
```

Visit `http://your-gerrit-server/config/server/coder-workspace.config`

**Expected result:** JSON response with your configuration, for example:

```json
{
  "enabled": true,
  "serverUrl": "http://localhost:3000",
  "organization": "7c60d51f-b44e-4682-87d6-449835ea4de6",
  "user": "me",
  "templateId": "c6d67e98-83ea-49f0-8812-e4abae2b68bc",
  "workspaceNameTemplate": "{repo}-{change}",
  "strictName": true,
  "richParams": {
    "REPO": "repo",
    "BRANCH": "branch",
    "GERRIT_CHANGE": "change",
    "GERRIT_PATCHSET": "patchset",
    "GERRIT_CHANGE_URL": "url"
  }
}
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

#### Cross-browser login redirect (Coder and Gerrit in different browsers)

If Gerrit is opened in a browser that isn’t logged into Coder, API calls may return 401 and app deeplinks may redirect to login.

Mitigations supported by the plugin:

1. API requests
   - The plugin sends your API key in the `Coder-Session-Token` header by default.
   - If `retryAuthWithQueryParam = true`, it will automatically retry failed requests by appending the token as a query parameter (name controlled by `apiKeyQueryParamName`, default `coder_session_token`).

2. App deeplinks
   - If `appendTokenToAppUrl = true`, the plugin appends the token to the app URL so opening from a non-authenticated browser works without a redirect.

Security note: Only enable `appendTokenToAppUrl` in trusted environments, since tokens in URLs can appear in history and server logs. Disable it once you’re logged into Coder in the same browser.

#### Exact name not created (strictName)

If you expect an exact name (for example, `gerrit-coder-1`) but see a suffixed name or a reuse:
1. Remove or minimize `alternateNameTemplates` to avoid lookups that match other names; with `strictName` they are ignored for creation, but keeping them minimal reduces confusion.
2. If a 409 conflict occurs and the existing workspace is not visible to you, the plugin will not auto-suffix in `strictName` mode; resolve visibility/ownership or disable `strictName` temporarily to allow a unique name.

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

### Workspace lookup and app deeplinking

If the plugin doesn’t find your existing workspace or opens a non-app page:

- Workspace lookup uses a primary name (from your `workspaceNameTemplate` or mapping) and also tries any templates in `alternateNameTemplates` / `alternateNameTemplatesJson`. Configure these to match your organization’s existing workspace naming (for example `{repo}.{branchShort}`).
- If `strictName` is enabled, the plugin skips alternates and enforces the exact primary name; on 409 it opens the existing workspace by that name if visible.
- App deeplinking uses `latest_app_status.uri` when provided by the Coder API. If it’s missing, the plugin falls back to opening `/@<owner>/<workspace>/apps/<appSlug>/`. Set `appSlug` (for example `code-server`) to control which app is opened by default.
- You can verify both settings at `/config/server/coder-workspace.config`.

Opening behavior:
- By default, the plugin opens a single final URL. If `waitForAppReadyMs > 0`, it waits for the app URI to become available and then opens.
- If your browser blocks opening a new tab after the wait, set `navigateInSameTabOnBlock = true` to fall back to navigating in the same tab automatically.

Tip: After changing these values in `gerrit.config`, restart Gerrit and hard-refresh your browser to ensure the updated configuration is picked up.

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

## Git Repository Cloning

The plugin automatically provides git repository URLs and change refs as rich parameters, enabling your Coder workspace template to automatically clone the Gerrit repository and cherry-pick the latest patchset when the workspace is created.

**Note:** Repository cloning can be enabled or disabled via the `enableCloneRepository` configuration option. When set to `false`, git-related rich parameters (`GERRIT_GIT_SSH_URL` and `GERRIT_CHANGE_REF`) are not included in the workspace creation request. The default is `true` (enabled).

### Rich Parameters for Git Operations

The following rich parameters are automatically included when `enableCloneRepository = true` (in addition to the standard ones):

- `GERRIT_GIT_SSH_URL`: SSH URL for the git repository (e.g., `ssh://gerrit.example.com:29418/my/project`)
- `GERRIT_CHANGE_REF`: Git ref for the patchset (e.g., `refs/changes/74/67374/2`)
- `GERRIT_CHANGE`: Numeric change identifier
- `GERRIT_PATCHSET`: Patchset number
- `REPO`: Suggested directory name for the checkout

### Using the Startup Script

A sample startup script is provided at `plugins/coder-workspace/scripts/clone-and-cherrypick.sh`. You can use this script in your Coder template's startup script to automatically clone the repository and cherry-pick the patchset using SSH.

**Note:** The plugin only supports SSH cloning. Ensure SSH keys are configured in your workspace for Gerrit access.

### Accessing Rich Parameters in Terraform Templates

When building Terraform-based Coder templates, rich parameters are exposed via `data "coder_parameter"` data sources (not standard Terraform variables). Define one data source per parameter and pass the resulting values into your agent/container environment:

```hcl
data "coder_parameter" "gerrit_git_ssh_url" {
  name    = "GERRIT_GIT_SSH_URL"
  type    = "string"
  default = ""
}

# Repeat for GERRIT_CHANGE_REF, GERRIT_CHANGE, GERRIT_PATCHSET, REPO...

resource "coder_agent" "main" {
  # ...
  env = {
    GERRIT_GIT_SSH_URL  = data.coder_parameter.gerrit_git_ssh_url.value
    GERRIT_CHANGE_REF   = data.coder_parameter.gerrit_change_ref.value
    GERRIT_CHANGE       = data.coder_parameter.gerrit_change.value
    GERRIT_PATCHSET     = data.coder_parameter.gerrit_patchset.value
    REPO                = data.coder_parameter.repo.value
  }
}
```

Coder populates these data sources automatically when the workspace is created from a Gerrit change through the plugin.

**Example Coder Template Startup Script:**

```bash
#!/bin/bash
# In your Coder template, add this to the startup script

# The script uses environment variables passed as rich parameters
# Make sure your template exposes these as environment variables:
# - GERRIT_GIT_SSH_URL
# - GERRIT_CHANGE_REF
# - REPO (optional, used as directory name)

# Download and execute the clone script
curl -fsSL https://raw.githubusercontent.com/your-org/gerrit/plugins/coder-workspace/scripts/clone-and-cherrypick.sh | bash

# Or copy the script into your template and execute it:
# /path/to/clone-and-cherrypick.sh
```

**Alternative: Direct Git Commands in Template**

You can also use the rich parameters directly in your Coder template:

```bash
#!/bin/bash
# Disable coder askpass helper and prefer SSH cloning
git config --global credential.helper ""
unset GIT_ASKPASS || true
export GIT_ASKPASS=""

# Prefer SSH URL when available
GIT_URL="${GERRIT_GIT_SSH_URL}"
if [ -z "$GIT_URL" ]; then
  echo "Missing Gerrit git URL"
  exit 1
fi

# Construct change ref when only change + patchset are provided
if [ -z "$GERRIT_CHANGE_REF" ] && [ -n "$GERRIT_CHANGE" ] && [ -n "$GERRIT_PATCHSET" ]; then
  if [ ${#GERRIT_CHANGE} -ge 2 ]; then
    LAST_TWO="${GERRIT_CHANGE: -2}"
  else
    LAST_TWO=$(printf "%02d" "$GERRIT_CHANGE")
  fi
  GERRIT_CHANGE_REF="refs/changes/${LAST_TWO}/${GERRIT_CHANGE}/${GERRIT_PATCHSET}"
fi

if [ -z "$GERRIT_CHANGE_REF" ]; then
  echo "Missing GERRIT_CHANGE_REF"
  exit 1
fi

# Clone the repository
git clone "$GIT_URL" "${REPO:-gerrit-repo}"

# Navigate to the repository
cd "${REPO:-gerrit-repo}"

# Fetch and cherry-pick the patchset
git fetch origin "${GERRIT_CHANGE_REF}"
git cherry-pick FETCH_HEAD
```

### Enabling or Disabling Repository Cloning

To disable automatic repository cloning, set `enableCloneRepository = false` in your configuration:

```ini
[plugin "coder-workspace"]
  # Disable repository cloning (git-related parameters will not be included)
  enableCloneRepository = false
```

When disabled, the `GERRIT_GIT_SSH_URL` and `GERRIT_CHANGE_REF` parameters are filtered out from the rich parameters list, preventing workspace templates from automatically cloning the repository.

### Customizing Rich Parameters

If you want to customize which git-related parameters are passed, you can override the `richParams` configuration:

```ini
[plugin "coder-workspace"]
  # Only include git SSH URL and change ref
  richParams = REPO:repo,GERRIT_CHANGE:change,GERRIT_PATCHSET:patchset,GERRIT_GIT_SSH_URL:gitSshUrl,GERRIT_CHANGE_REF:changeRef
```

**Note:** If `enableCloneRepository = false`, git-related parameters will be filtered out even if they are explicitly included in `richParams`.

### Troubleshooting Git Operations

- **SSH Authentication**: Ensure SSH keys are configured in the workspace (`~/.ssh/id_rsa` or similar)
- **SSH Host Keys**: The first clone may prompt to accept the Gerrit host key. Configure known_hosts in your template if needed
- **Cherry-pick Conflicts**: If cherry-pick fails due to conflicts, the repository will be left in a cherry-pick state. Resolve conflicts manually and run `git cherry-pick --continue`
- **Missing Parameters**:
  - Verify that `GERRIT_CHANGE_REF` is set correctly. The ref format is `refs/changes/X/Y/Z` where X is the last 2 digits of the change number, Y is the full change number, and Z is the patchset number.
  - If only `GERRIT_CHANGE` and `GERRIT_PATCHSET` are provided, construct the ref in your script (see examples above).

## Tests

### Run JavaScript tests (Jest)

The plugin includes a Jest-based test suite for the web UI logic under `plugins/coder-workspace/test`.

Prerequisites:
- Node.js 18+ and npm

### Setup

1. **Copy environment template:**
   ```bash
   cd plugins/coder-workspace/test
   cp env.example .env
   ```

2. **Configure `.env` file:**

   The `env.example` file supports both mock and real API testing scenarios:

   **For Mock Testing (default, no external services required):**
   ```bash
   TEST_MODE="mock"
   GERRIT_URL="http://127.0.0.1:8080"
   CODER_URL="http://127.0.0.1:3000"
   ```

   **For Real API Testing (connects to deployed servers):**
   ```bash
   TEST_MODE="real"
   GERRIT_URL="https://gerrit.yourcompany.com"
   CODER_URL="https://coder.yourcompany.com"
   CODER_SESSION_TOKEN="your-coder-session-token"
   CODER_ORGANIZATION="your-organization-id"  # Optional
   PLUGIN_CODER_SERVER_URL="https://coder.yourcompany.com"
   PLUGIN_CODER_API_KEY="your-coder-session-token"
   PLUGIN_TEMPLATE_ID="your-template-id"
   ```

   See `plugins/coder-workspace/test/env.example` for all available configuration options and examples.

### Run Tests

```bash
# From the Gerrit repo root
cd plugins/coder-workspace/test
npm install

# Run all tests
npm test

# Useful subsets
npm run test:unit          # Core JS unit tests
npm run test:integration   # Coder API integration tests (mocked by default)
npm run test:e2e           # End-to-end UI flow tests (jsdom)
npm run test:config        # Configuration validation tests

# Coverage report
npm run test:coverage
```

### Test Modes

- **Mock Mode** (default): All API calls are mocked. No external services required. Fast and suitable for CI/CD.
- **Real Mode**: Connects to actual Gerrit and Coder servers via REST API. Requires valid credentials and network access.

**Note:** The test suite references `test/env.example` (from the parent `test/` directory) for compatibility with the full test environment setup. The plugin-specific `env.example` provides additional configuration for plugin-specific testing scenarios.

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
