// @license
// Copyright (C) 2025
// SPDX-License-Identifier: Apache-2.0

(function () {
  const PLUGIN_NAME = 'coder-workspace';
  const OPEN_LAST_ACTION_LABEL = 'Open Coder Workspace';
  const DELETE_ACTION_LABEL = 'Delete Coder Workspace';
  // Only keep global "Open Last" action
  // Settings are configured server-side in gerrit.config; no user-visible Settings menu.

  // Minimal config: server base URL and template id or version id.
  let config = {
    serverUrl: '', // e.g. https://coder.example.com
    apiKey: '', // API key (Coder-Session-Token)
    organization: '', // optional org id, if used
    user: 'me', // 'me' to use current user
    templateId: '',
    templateVersionId: '',
    templateVersionPresetId: '',
    // Optional per-repo/branch mappings. First match wins.
    // Example entry: { repo: 'my/repo', branch: 'refs/heads/main', templateVersionId: 'uuid', templateVersionPresetId: 'uuid', richParams: [{name:'KEY', from:'repo'}] }
    templateMappings: [],
    richParams: [
      {name: 'REPO', from: 'repo'},
      {name: 'BRANCH', from: 'branch'},
      {name: 'GERRIT_CHANGE', from: 'change'},
      {name: 'GERRIT_PATCHSET', from: 'patchset'},
      {name: 'GERRIT_CHANGE_URL', from: 'url'},
    ],
    autostart: true,
    automaticUpdates: 'always',
    ttlMs: 0,
    openAfterCreate: true,
    // Advanced features
    workspaceNameTemplate: '{repo}-{change}-{patchset}', // tokens: {repo},{branch},{change},{patchset}
    enableDryRunPreview: false,
  };

  const STORAGE_CURRENT_WORKSPACE_KEY = 'gerrit-coder-workspace-current';
  const STORAGE_CURRENT_META_KEY = 'gerrit-coder-workspace-current-meta';

  function resolveCoderUrl(path) {
    return (config.serverUrl || '').replace(/\/$/, '') + path;
  }

  function toRichParameterValues(context) {
    return (context._richParamsOverride || config.richParams || []).map(p => ({
      name: p.name,
      value: String(context[p.from] ?? ''),
    }));
  }

  function getChangeContextFromPage() {
    const grApp = document.querySelector('gr-app');
    // Try to pick info off the change view; fallback to URL
    let project = '';
    let branch = '';
    let changeNum = '';
    let patchset = '';

    const changeEl = grApp && grApp.shadowRoot && grApp.shadowRoot.querySelector('gr-change-view');
    const change = changeEl && changeEl.change;
    const currentRevision = changeEl && changeEl.currentRevision;
    if (change) {
      project = change.project || '';
      branch = change.branch || '';
      changeNum = change._number || change.number || '';
      if (change.revisions && currentRevision && change.revisions[currentRevision]) {
        const rev = change.revisions[currentRevision];
        patchset = (rev && rev._number) || '';
      }
      // Default to latest patchset if not present or falsy
      if (!patchset && change.revisions) {
        try {
          const nums = Object.values(change.revisions)
            .map(r => r && r._number)
            .filter(n => typeof n === 'number');
          if (nums.length) patchset = String(Math.max.apply(null, nums));
        } catch (_) {}
      }
    }
    if (!project || !changeNum) {
      // URL: /c/<project>/+/<change>/<patchset>
      const m = location.pathname.match(/\/c\/(.+?)\/+\/(\d+)(?:\/(\d+))?/);
      if (m) {
        project = decodeURIComponent(m[1]);
        changeNum = m[2] || '';
        patchset = patchset || (m[3] || '');
      }
    }

    // Debug logging to help diagnose context extraction issues
    console.log('[coder-workspace] Change context extracted:', {
      repo: project,
      branch: branch,
      change: changeNum,
      patchset: patchset,
      url: location.href
    });

    const origin = window.location.origin;
    const url = `${origin}/c/${encodeURIComponent(project)}/+/${changeNum}/${patchset}`;
    return {repo: project, branch, change: changeNum, patchset, url};
  }

  function matchGlob(pattern, value) {
    if (!pattern || pattern === '*') return true;
    // Escape regex special chars except *
    const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return re.test(value || '');
  }

  function pickTemplateForContext(ctx) {
    const mappings = Array.isArray(config.templateMappings) ? config.templateMappings : [];
    for (const m of mappings) {
      const repoOk = matchGlob(m.repo || '*', ctx.repo);
      const branchOk = matchGlob(m.branch || '*', ctx.branch);
      if (repoOk && branchOk) {
        return {
          templateId: m.templateId || '',
          templateVersionId: m.templateVersionId || '',
          templateVersionPresetId: m.templateVersionPresetId || '',
          workspaceNameTemplate: m.workspaceNameTemplate || '',
          richParams: m.richParams,
        };
      }
    }
    return {
      templateId: config.templateId || '',
      templateVersionId: config.templateVersionId || '',
      templateVersionPresetId: config.templateVersionPresetId || '',
    };
  }

  function buildCreateRequest(context) {
    // Resolve mapping and override rich params if provided
    const picked = pickTemplateForContext(context);
    if (picked.richParams && picked.richParams.length) {
      context._richParamsOverride = picked.richParams;
    }
    const name = renderNameTemplate((picked.workspaceNameTemplate || config.workspaceNameTemplate || '{repo}-{change}-{patchset}'), context);
    const body = {
      name,
      automatic_updates: config.automaticUpdates,
      autostart_schedule: config.autostart ? 'now' : undefined,
      rich_parameter_values: toRichParameterValues(context),
      ttl_ms: config.ttlMs,
    };
    if (picked.templateVersionId) body.template_version_id = picked.templateVersionId;
    else if (picked.templateId) body.template_id = picked.templateId;
    if (picked.templateVersionPresetId) body.template_version_preset_id = picked.templateVersionPresetId;
    return body;
  }

  function renderNameTemplate(tpl, ctx) {
    const name = String(tpl)
      .replaceAll('{repo}', String(ctx.repo || ''))
      .replaceAll('{branch}', String(ctx.branch || ''))
      .replaceAll('{change}', String(ctx.change || ''))
      .replaceAll('{patchset}', String(ctx.patchset || ''))
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')  // Remove leading/trailing dashes
      .replace(/-{2,}/g, '-');   // Collapse multiple dashes to single dash

    // Ensure name is not empty and meets minimum requirements
    if (!name || name === '-') {
      // Fallback to a timestamp-based name if all context values are empty
      return 'workspace-' + Date.now();
    }

    return name;
  }

  async function createWorkspace(requestBody) {
    const headers = {'Content-Type': 'application/json', 'Accept': 'application/json'};
    if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;

    let url;
    if (config.organization) {
      url = resolveCoderUrl(`/api/v2/organizations/${encodeURIComponent(config.organization)}/members/${encodeURIComponent(config.user || 'me')}/workspaces`);
    } else {
      url = resolveCoderUrl(`/api/v2/users/${encodeURIComponent(config.user || 'me')}/workspaces`);
    }

    try {
      const res = await fetch(url, {method: 'POST', headers, body: JSON.stringify(requestBody)});
      if (!res.ok) {
        const text = await res.text();
        console.error(`[coder-workspace] POST workspace failed: ${res.status} ${text}`);
        throw new Error(`Coder API error ${res.status}: ${text}`);
      }
      return res.json();
    } catch (error) {
      console.error(`[coder-workspace] POST workspace error:`, error);
      throw error;
    }
  }

  async function getWorkspaceByName(workspaceName) {
    const headers = {'Accept': 'application/json'};
    if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;
    const base = (config.serverUrl || '').replace(/\/$/, '');
    const userSeg = encodeURIComponent(config.user || 'me');
    const nameSeg = encodeURIComponent(workspaceName);
    const url = config.organization
      ? `${base}/api/v2/organizations/${encodeURIComponent(config.organization)}/members/${userSeg}/workspaces/${nameSeg}`
      : `${base}/api/v2/users/${userSeg}/workspaces/${nameSeg}`;

    try {
      const res = await fetch(url, { method: 'GET', headers });
      if (res.status === 404) return null;
      if (!res.ok) {
        const text = await res.text();
        console.warn(`[coder-workspace] GET workspace failed: ${res.status} ${text}`);
        throw new Error(`Coder API error ${res.status}: ${text}`);
      }
      return res.json();
    } catch (error) {
      console.warn(`[coder-workspace] GET workspace error:`, error);
      // Return null to allow fallback to create new workspace
      return null;
    }
  }

  function openWorkspace(workspace) {
    const appUri = workspace && workspace.latest_app_status && workspace.latest_app_status.uri;
    const wsUrl = appUri || resolveCoderUrl(`/@${encodeURIComponent(workspace.owner_name || '')}/${encodeURIComponent(workspace.name)}`);
    window.open(wsUrl, '_blank', 'noopener');
  }

  function computeWorkspaceUrl(workspace) {
    const appUri = workspace && workspace.latest_app_status && workspace.latest_app_status.uri;
    return appUri || resolveCoderUrl(`/@${encodeURIComponent(workspace.owner_name || '')}/${encodeURIComponent(workspace.name)}`);
  }

  function saveCurrentWorkspace(url, meta) {
    try {
      localStorage.setItem(STORAGE_CURRENT_WORKSPACE_KEY, url || '');
      localStorage.setItem(STORAGE_CURRENT_META_KEY, JSON.stringify(meta || {}));
    } catch (_) {}
  }

  function loadCurrentWorkspace() {
    try { return localStorage.getItem(STORAGE_CURRENT_WORKSPACE_KEY) || ''; } catch (_) { return ''; }
  }

  function loadCurrentMeta() {
    try { return JSON.parse(localStorage.getItem(STORAGE_CURRENT_META_KEY) || '{}'); } catch (_) { return {}; }
  }

  function clearCurrentWorkspace() {
    try {
      localStorage.removeItem(STORAGE_CURRENT_WORKSPACE_KEY);
      localStorage.removeItem(STORAGE_CURRENT_META_KEY);
    } catch (_) {}
  }
  async function deleteWorkspaceByName(workspaceName) {
    const headers = {'Accept': 'application/json'};
    if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;
    const base = (config.serverUrl || '').replace(/\/$/, '');
    const userSeg = encodeURIComponent(config.user || 'me');
    const nameSeg = encodeURIComponent(workspaceName);
    const url = config.organization
      ? `${base}/api/v2/organizations/${encodeURIComponent(config.organization)}/members/${userSeg}/workspaces/${nameSeg}`
      : `${base}/api/v2/users/${userSeg}/workspaces/${nameSeg}`;

    try {
      const res = await fetch(url, { method: 'DELETE', headers });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[coder-workspace] DELETE workspace failed: ${res.status} ${text}`);
        throw new Error(`Coder API error ${res.status}: ${text}`);
      }
    } catch (error) {
      console.error(`[coder-workspace] DELETE workspace error:`, error);
      throw error;
    }
  }


  function notify(plugin, message) {
    // Basic toast: fall back to alert if plugin API not available
    try {
      const el = document.createElement('gr-alert');
      el.text = message;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 5000);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(message);
    }
  }



  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // Configuration is loaded from server (/config/server/coder-workspace.config)

  function installPlugin(plugin) {
    console.log('[coder-workspace] Plugin installation starting...');
    // Fetch server-side configuration defined in gerrit.config
    if (plugin.restApi) {
      plugin
        .restApi()
        .get('/config/server/coder-workspace.config')
        .then((serverCfg) => {
          if (serverCfg && typeof serverCfg === 'object') {
            config = Object.assign({}, config, serverCfg);
            console.log('[coder-workspace] Server config applied');
          }
        })
        .catch((err) => {
          console.warn('[coder-workspace] Failed to load server config', err);
        });
    }

    let actionsInstalled = false;
    const installActions = () => {
      if (actionsInstalled) return true;
      try {
        const changeActions = plugin.changeActions();
        if (!changeActions) return false;

        // Per request, remove explicit "Create Coder Workspace" action from the dropdown.

        // Open last actions (initialized once)
        var openLastKey = changeActions.add('revision', OPEN_LAST_ACTION_LABEL);
        changeActions.setActionOverflow('revision', openLastKey, true);
        // Then Open (9998)
        if (changeActions.setActionPriority) changeActions.setActionPriority('revision', openLastKey, 9998);
        changeActions.setTitle(openLastKey, 'Open your Coder workspace, creating one if necessary');
        changeActions.addTapListener(openLastKey, async () => {
          try {
            const ctx = getChangeContextFromPage();

            // Validate that we have minimum required context
            if (!ctx.repo || !ctx.change) {
              notify(plugin, 'Unable to determine change context. Please ensure you are on a valid change page.');
              console.error('[coder-workspace] Invalid context:', ctx);
              return;
            }

            const currentUrl = loadCurrentWorkspace();
            const currentMeta = loadCurrentMeta();

            // Check if we have a current workspace and it matches the current context
            if (currentUrl && currentMeta &&
                currentMeta.repo === ctx.repo &&
                currentMeta.branch === ctx.branch &&
                currentMeta.change === ctx.change &&
                currentMeta.patchset === ctx.patchset) {
              notify(plugin, `Opening Coder workspace for ${ctx.repo} @ ${ctx.branch}`);
              window.open(currentUrl, '_blank', 'noopener');
              return;
            }

            // No matching workspace: try to find existing or create new one
            if (!config.serverUrl) {
              notify(plugin, 'Coder Workspace plugin is not configured (serverUrl is empty). Please ask an administrator to set [plugin "coder-workspace"] in gerrit.config.');
              return;
            }

            const body = buildCreateRequest(ctx);
            try {
              // Attempt to re-use existing workspace with the expected name
              const expectedName = body && body.name ? body.name : renderNameTemplate((pickTemplateForContext(ctx).workspaceNameTemplate || config.workspaceNameTemplate || '{repo}-{change}-{patchset}'), ctx);
              console.log(`[coder-workspace] Looking for existing workspace: ${expectedName}`);
              const existing = await getWorkspaceByName(expectedName);
              if (existing) {
                const existingUrl = computeWorkspaceUrl(existing);
                const existingMeta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: existing && existing.name, workspaceOwner: existing && existing.owner_name};
                saveCurrentWorkspace(existingUrl, existingMeta);
                notify(plugin, `Opening existing Coder workspace: ${existing.name}`);
                window.open(existingUrl, '_blank', 'noopener');
                return;
              }
              console.log(`[coder-workspace] No existing workspace found, will create new one`);
            } catch (e) {
              // Non-fatal: we will proceed to create
              console.warn('[coder-workspace] lookup existing by name failed; proceeding to create', e);
            }

            if (config.enableDryRunPreview) {
              const {confirmed} = await previewAndConfirm(plugin, body);
              if (!confirmed) return;
            }

            const ws = await createWorkspace(body);
            console.log(`[coder-workspace] Successfully created workspace:`, ws);
            notify(plugin, `Coder workspace created: ${ws.name}`);
            const createdUrl = computeWorkspaceUrl(ws);
            const createdMeta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: ws && ws.name, workspaceOwner: ws && ws.owner_name};
            saveCurrentWorkspace(createdUrl, createdMeta);
            window.open(createdUrl, '_blank', 'noopener');
          } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            notify(plugin, 'Failed to open/create Coder workspace: ' + msg);
            console.error('[coder-workspace] open/create failed', e);
          }
        });

        // Delete Coder Workspace action
        const deleteKey = changeActions.add('revision', DELETE_ACTION_LABEL);
        changeActions.setActionOverflow('revision', deleteKey, true);
        // Finally Delete (9999)
        if (changeActions.setActionPriority) changeActions.setActionPriority('revision', deleteKey, 9999);
        changeActions.setTitle(deleteKey, 'Delete your Coder workspace for current context');
        changeActions.addTapListener(deleteKey, async () => {
          try {
            if (!config.serverUrl) {
              notify(plugin, 'Coder Workspace plugin is not configured (serverUrl is empty).');
              return;
            }

            const ctx = getChangeContextFromPage();
            const currentMeta = loadCurrentMeta();

            // Check if current workspace matches the current context
            if (!currentMeta ||
                currentMeta.repo !== ctx.repo ||
                currentMeta.branch !== ctx.branch ||
                currentMeta.change !== ctx.change ||
                currentMeta.patchset !== ctx.patchset) {
              notify(plugin, 'No workspace found for current context. Create/open one first.');
              return;
            }

            const name = currentMeta.workspaceName;
            if (!name) {
              notify(plugin, 'No workspace found to delete. Create/open one first.');
              return;
            }

            // Confirm deletion
            const ok = window.confirm(`Delete Coder workspace "${name}" for ${ctx.repo} @ ${ctx.branch}?`);
            if (!ok) return;

            await deleteWorkspaceByName(name);
            notify(plugin, 'Coder workspace deleted');
            clearCurrentWorkspace();
          } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            notify(plugin, 'Failed to delete Coder workspace: ' + msg);
            console.error('[coder-workspace] delete failed', e);
          }
        });

        // Context-specific "Open Last" actions removed per request

        actionsInstalled = true;
        return true;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[coder-workspace] Failed to install actions (retry later)', e);
        return false;
      }
    };

    // Defer installing actions until revision actions are shown so the API is ready
    try {
      plugin.on('show-revision-actions', () => {
        installActions();
      });
    } catch (e) {
      // ignore
    }
    // Fallback retry loop for robustness
    let tries = 0;
    const t = setInterval(() => {
      if (installActions()) { clearInterval(t); }
      if (++tries > 20) clearInterval(t);
    }, 300);

    // No Settings actions; configuration is server-managed.

    // Note: Open Last actions are configured in installActions() once.
  }

  async function previewAndConfirm(plugin, requestBody) {
    const base = (config.serverUrl || '').replace(/\/$/, '');
    const path = config.organization
      ? `/api/v2/organizations/${encodeURIComponent(config.organization)}/members/${encodeURIComponent(config.user || 'me')}/workspaces`
      : `/api/v2/users/${encodeURIComponent(config.user || 'me')}/workspaces`;
    const url = base + path;
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify({ url, body: requestBody }, null, 2);
    const wrapper = document.createElement('div');
    const style = document.createElement('style');
    style.textContent = `pre{white-space:pre-wrap;max-height:360px;overflow:auto;border:1px solid var(--border-color, #ddd);padding:8px}`;
    wrapper.appendChild(style);
    const title = document.createElement('div');
    title.textContent = 'Preview Coder Request';
    title.style.marginBottom = '8px';
    wrapper.appendChild(title);
    wrapper.appendChild(pre);
    const buttons = document.createElement('div');
    buttons.style.marginTop = '8px';
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';
    const cancel = document.createElement('gr-button');
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('gr-button');
    confirm.textContent = 'Create';
    confirm.setAttribute('primary', '');
    buttons.appendChild(cancel);
    buttons.appendChild(confirm);
    wrapper.appendChild(buttons);
    const host = await plugin.popup('div', {});
    host.shadowRoot ? host.shadowRoot.appendChild(wrapper) : host.appendChild(wrapper);
    return new Promise(resolve => {
      const onDone = (confirmed) => { try { host.remove(); } catch(_){} resolve({confirmed}); };
      cancel.addEventListener('click', () => onDone(false));
      confirm.addEventListener('click', () => onDone(true));
    });
  }

  function setMappingsError(shadowRoot, message) {
    const err = shadowRoot.getElementById('mappingsError');
    if (err) err.textContent = message || '';
  }

  function validateMappingsSchema(value) {
    if (!Array.isArray(value)) return {valid: false, error: 'Mappings must be an array'};
    const allowedKeys = new Set(['repo','branch','templateId','templateVersionId','templateVersionPresetId','workspaceNameTemplate','richParams']);
    const allowedFrom = new Set(['repo','branch','change','patchset','url']);
    for (let i = 0; i < value.length; i++) {
      const m = value[i];
      if (typeof m !== 'object' || m == null) return {valid:false, error:`Entry #${i+1} must be an object`};
      for (const k of Object.keys(m)) {
        if (!allowedKeys.has(k)) return {valid:false, error:`Entry #${i+1} contains unknown key '${k}'`};
      }
      if (!m.templateVersionId && !m.templateId) {
        // Not strictly required, but recommended
        // return {valid:false, error:`Entry #${i+1} should specify templateVersionId or templateId`};
      }
      if (m.richParams) {
        if (!Array.isArray(m.richParams)) return {valid:false, error:`Entry #${i+1} richParams must be an array`};
        for (let j = 0; j < m.richParams.length; j++) {
          const rp = m.richParams[j];
          if (typeof rp !== 'object' || rp == null) return {valid:false, error:`Entry #${i+1} richParams[#${j+1}] must be an object`};
          if (!rp.name) return {valid:false, error:`Entry #${i+1} richParams[#${j+1}] missing 'name'`};
          if (!rp.from || !allowedFrom.has(rp.from)) return {valid:false, error:`Entry #${i+1} richParams[#${j+1}] invalid 'from' (allowed: repo,branch,change,patchset,url)`};
        }
      }
    }
    return {valid:true};
  }

  console.log('[coder-workspace] Plugin loaded, registering with Gerrit...');
  if (window && window.Gerrit && window.Gerrit.install) {
    console.log('[coder-workspace] Gerrit.install available, installing immediately');
    window.Gerrit.install(installPlugin);
  } else {
    console.log('[coder-workspace] Waiting for WebComponentsReady event...');
    window.addEventListener('WebComponentsReady', () => {
      console.log('[coder-workspace] WebComponentsReady fired, installing plugin');
      window.Gerrit.install(installPlugin);
    });
  }
})();
