// @license
// Copyright (C) 2025
// SPDX-License-Identifier: Apache-2.0

// Gerrit frontend plugin to add a "Create Coder Workspace" button to the change page.
// It calls the Coder REST API to create a workspace and passes repo, branch, change
// number and patchset as parameters via template variables.

(function () {
  // Types are not available in plugin runtime. Keep code vanilla JS-compatible.
  const PLUGIN_NAME = 'coder-workspace';
  const ACTION_LABEL = 'Create Coder Workspace';

  // Minimal config: server base URL and template id or template version id.
  // You can configure these in gerrit.config under [plugin "coder-workspace"].
  // If both templateId and templateVersionId are provided, templateVersionId wins.
  let config = {
    serverUrl: '', // e.g. https://coder.example.com
    apiKey: '', // If empty, we try to open a window to Coder without calling API
    organization: '', // optional, use org-scoped API if set
    user: 'me', // optional; 'me' to use current user when using user-scoped API
    templateId: '',
    templateVersionId: '',
    templateVersionPresetId: '',
    richParams: [
      // Map Gerrit change context into template parameters.
      // Each item: {name: 'PARAM_NAME', from: 'repo|branch|change|patchset|url'}
      // Defaults below are common names, adjust in server config if desired.
      {name: 'REPO', from: 'repo'},
      {name: 'BRANCH', from: 'branch'},
      {name: 'GERRIT_CHANGE', from: 'change'},
      {name: 'GERRIT_PATCHSET', from: 'patchset'},
      {name: 'GERRIT_CHANGE_URL', from: 'url'},
    ],
    autostart: true,
    automaticUpdates: 'always',
    ttlMs: 0,
    openAfterCreate: true, // open workspace in a new tab after creation
  };

  function resolveCoderUrl(path) {
    return (config.serverUrl || '').replace(/\/$/, '') + path;
  }

  function toRichParameterValues(context) {
    return (config.richParams || []).map(p => ({
      name: p.name,
      value: String(context[p.from] ?? ''),
    }));
  }

  function getChangeContext(change, revision) {
    const project = change?.project || '';
    const branch = change?.branch || '';
    const changeNum = change?._number || change?.number || '';
    const patchset = revision?._number || revision?._number || revision?.number || '';
    const origin = window?.location?.origin ?? '';
    const url = `${origin}/c/${encodeURIComponent(project)}/+/${changeNum}/${patchset}`;
    return {
      repo: project,
      branch,
      change: changeNum,
      patchset,
      url,
    };
  }

  function buildCreateRequest(context) {
    const body = {
      name: `${context.repo}-${context.change}-${context.patchset}`,
      automatic_updates: config.automaticUpdates,
      autostart_schedule: config.autostart ? 'now' : undefined,
      rich_parameter_values: toRichParameterValues(context),
      ttl_ms: config.ttlMs,
    };
    if (config.templateVersionId) body.template_version_id = config.templateVersionId;
    else body.template_id = config.templateId;
    if (config.templateVersionPresetId) body.template_version_preset_id = config.templateVersionPresetId;
    return body;
  }

  async function createWorkspace(requestBody) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;

    let url;
    if (config.organization) {
      url = resolveCoderUrl(`/api/v2/organizations/${encodeURIComponent(config.organization)}/members/${encodeURIComponent(config.user || 'me')}/workspaces`);
    } else {
      url = resolveCoderUrl(`/api/v2/users/${encodeURIComponent(config.user || 'me')}/workspaces`);
    }
    const res = await fetch(url, {method: 'POST', headers, body: JSON.stringify(requestBody)});
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Coder API error ${res.status}: ${text}`);
    }
    return res.json();
  }

  function openWorkspace(workspace) {
    // Try to open default app URL if present, else workspace page.
    const apps = workspace?.latest_app_status?.uri ? [workspace.latest_app_status.uri] : [];
    const wsUrl = apps[0] || resolveCoderUrl(`/@${encodeURIComponent(workspace.owner_name || '')}/${encodeURIComponent(workspace.name)}`);
    window.open(wsUrl, '_blank', 'noopener');
  }

  function showToast(plugin, message, opts = {}) {
    try {
      plugin.restApi().setInProjectLookup(false);
    } catch (_) {}
    plugin.popup('gr-alert', {text: message, ...opts});
  }

  function installPlugin(plugin) {
    // Load server-side config for this plugin if provided
    plugin.restApi().get(`/config/server/info`).then(serverInfo => {
      // Allow admin to configure plugin via gerrit.config: plugin.coder-workspace.*
      const p = (serverInfo?.plugin || {})['coder-workspace'];
      if (p) {
        config = {...config, ...p};
      }
    }).catch(() => {});

    const changeActions = plugin.changeActions();
    const key = changeActions.add('revision', ACTION_LABEL);
    changeActions.setActionOverflow('revision', key, true);
    changeActions.setIcon?.(key, 'rocket_launch');
    changeActions.setTitle(key, 'Create a Coder workspace for this change/patchset');

    // When user taps the action
    changeActions.addTapListener(key, async () => {
      try {
        const change = await plugin.changeView().getChange();
        const revision = await plugin.changeView().getRevision();
        const ctx = getChangeContext(change, revision);
        const body = buildCreateRequest(ctx);
        const ws = await createWorkspace(body);
        showToast(plugin, 'Coder workspace created');
        if (config.openAfterCreate) openWorkspace(ws);
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        showToast(plugin, `Failed to create Coder workspace: ${err}`);
        // Also log to console for debugging
        // eslint-disable-next-line no-console
        console.error('[coder-workspace] create failed', e);
      }
    });
  }

  if (window?.Gerrit?.install) {
    window.Gerrit.install(installPlugin, PLUGIN_NAME);
  } else {
    // Older fallback
    window.addEventListener('WebComponentsReady', () => {
      window.Gerrit.install(installPlugin, PLUGIN_NAME);
    });
  }
})();
