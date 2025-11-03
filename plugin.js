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
    ttlMs: 0,
    openAfterCreate: true,
    // Advanced features
    workspaceNameTemplate: '{repo}-{change}-{patchset}', // tokens: {repo},{branch},{branchShort},{change},{patchset}
    // When looking up existing workspaces, also try these alternative name templates (lookup only, not used for creation)
    alternateNameTemplates: ['{repo}.{branchShort}'],
    // Preferred app to open if latest_app_status.uri is not provided by API
    appSlug: 'code-server',
    // Optional: wait for app readiness before opening (0 = disabled)
    waitForAppReadyMs: 0,
    waitPollIntervalMs: 1000,
    enableDryRunPreview: false,
    // When true: do not reuse existing candidates or prefix search; create exact name from template.
    // On 409 conflict: do NOT auto-suffix; instead try opening the existing workspace by that name.
    strictName: false,
  };

  // Keep a hardcoded default for alternates so server-provided empty arrays
  // don't erase sensible lookup behavior.
  const DEFAULT_ALTERNATE_NAME_TEMPLATES = ['{repo}.{branchShort}', '{repo}-{change}.{branchShort}'];

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
      const path = (location && location.pathname) || '';
      let m = path.match(/^\/c\/([^/]+)\/\+\/(\d+)(?:\/(\d+))?/);
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
    const url = `${origin}/c/${encodeURIComponent(project)}/+/${changeNum}` + (patchset ? `/${patchset}` : '');
    const branchShort = branch ? String(branch).split('/').pop() : '';
    return {repo: project, branch, branchShort, change: changeNum, patchset, url};
  }

  async function getChangeContextWithRetry(maxWaitMs = 1000, intervalMs = 100) {
    const start = Date.now();
    let ctx = getChangeContextFromPage();
    // If branch is missing, wait briefly for the change view to populate
    while (!ctx.branch && (Date.now() - start) < maxWaitMs) {
      await new Promise(r => setTimeout(r, intervalMs));
      ctx = getChangeContextFromPage();
      if (ctx.branch) break;
    }
    return ctx;
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
      rich_parameter_values: toRichParameterValues(context),
      ttl_ms: config.ttlMs,
    };
    if (picked.templateVersionId) body.template_version_id = picked.templateVersionId;
    else if (picked.templateId) body.template_id = picked.templateId;
    if (picked.templateVersionPresetId) body.template_version_preset_id = picked.templateVersionPresetId;
    return body;
  }

  function renderNameTemplate(tpl, ctx) {
    // Replace tokens, sanitize, and enforce conservative name rules compatible with Coder:
    // - Allowed chars: a-z, 0-9, dot, underscore, hyphen
    // - Lowercase
    // - No leading/trailing hyphen or dot
    // - Collapse repeats of separators
    // - Reasonable length cap (63 chars typical)
    const branchShort = (ctx.branchShort != null)
      ? String(ctx.branchShort)
      : (String(ctx.branch || '').split('/').pop() || '');

    let name = String(tpl)
      .replaceAll('{repo}', String(ctx.repo || ''))
      .replaceAll('{branch}', String(ctx.branch || ''))
      .replaceAll('{branchShort}', String(branchShort || ''))
      .replaceAll('{change}', String(ctx.change || ''))
      .replaceAll('{patchset}', String(ctx.patchset || ''))
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/\.{2,}/g, '.')
      .replace(/^[-.]+|[-.]+$/g, '');

    // If name is empty or only a separator after trimming, fall back
    if (!name || name === '-' || name === '.') {
      return 'workspace-' + Date.now();
    }

    // Ensure it starts with an alphanumeric
    if (!/^[a-z0-9]/.test(name)) {
      name = 'w-' + name.replace(/^[-.]+/, '');
    }

    // Trim again in case prefix created leading separators
    name = name.replace(/^[-.]+|[-.]+$/g, '');

    // Cap length to 63 characters (common DNS-like limits)
    if (name.length > 63) {
      name = name.slice(0, 63).replace(/[-.]+$/g, '');
    }

    // Final safety: if trimming resulted in empty, fallback
    if (!name) {
      name = 'workspace-' + Date.now();
    }
    return name;
  }

  function computeCandidateNames(ctx, cfg) {
    const picked = pickTemplateForContext(ctx);
    const tpl = picked.workspaceNameTemplate || (cfg && cfg.workspaceNameTemplate) || config.workspaceNameTemplate || '{repo}-{change}-{patchset}';
    const expectedName = renderNameTemplate(tpl, ctx);

    let altTemplates = [];
    if (cfg && Array.isArray(cfg.alternateNameTemplates) && cfg.alternateNameTemplates.length) {
      altTemplates = cfg.alternateNameTemplates;
    } else if (Array.isArray(config.alternateNameTemplates) && config.alternateNameTemplates.length) {
      altTemplates = config.alternateNameTemplates;
    } else {
      altTemplates = DEFAULT_ALTERNATE_NAME_TEMPLATES;
    }
    // Heuristic: if branch is missing/empty, include a repo-change pattern
    if (!ctx.branch) {
      altTemplates = [...altTemplates, '{repo}-{change}'];
    }
    const altNames = altTemplates.map(t => renderNameTemplate(t, ctx));
    return Array.from(new Set([expectedName, ...altNames].filter(Boolean)));
  }

  function generateUniqueName(baseName) {
    const stamp = Date.now().toString(36).slice(-4);
    // Reuse renderNameTemplate for sanitization; no tokens used here.
    return renderNameTemplate(`${baseName}-${stamp}`, {});
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
        if (res.status === 409) {
          console.warn(`[coder-workspace] POST workspace conflict (409): ${text}`);
        } else {
          console.error(`[coder-workspace] POST workspace failed: ${res.status} ${text}`);
        }
        throw new Error(`Coder API error ${res.status}: ${text}`);
      }
      return res.json();
    } catch (error) {
      const msg = (error && error.message) ? error.message : String(error || '');
      if (/\b409\b/.test(msg)) {
        console.warn(`[coder-workspace] POST workspace conflict handled:`, msg);
      } else {
        console.error(`[coder-workspace] POST workspace error:`, error);
      }
      throw error;
    }
  }

  // Strict create helper used by tests and strictName flow
  async function createWorkspaceStrict(requestBody) {
    try {
      const ws = await createWorkspace(requestBody);
      return ws;
    } catch (error) {
      const emsg = (error && error.message) ? error.message : String(error || '');
      if (/\b409\b/.test(emsg) || /already exists/i.test(emsg)) {
        // Attempt to fetch and return existing; do not auto-suffix
        try {
          const existing = await getWorkspaceByName(requestBody && requestBody.name);
          if (existing) return existing;
        } catch (_) {}
      }
      throw error;
    }
  }

  async function getWorkspaceByName(workspaceName) {
    const headers = {'Accept': 'application/json'};
    if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;
    const base = (config.serverUrl || '').replace(/\/$/, '');
    const userSeg = encodeURIComponent(config.user || 'me');
    const nameSeg = encodeURIComponent(workspaceName);
    // Per Coder API: GET-by-name is under /api/v2/users/{user}/workspace/{workspacename} (singular "workspace")
    const byNameUrl = `${base}/api/v2/users/${userSeg}/workspace/${nameSeg}`;

    try {
      const res = await fetch(byNameUrl, { method: 'GET', headers });
      if (res.status === 404) {
        // Fallback 1: use global list API with owner+name query, then filter exact match
        const ownerToken = (config.user && config.user !== 'me') ? `owner:${config.user}` : '';
        const qParts = [];
        if (ownerToken) qParts.push(ownerToken);
        qParts.push(`name:${workspaceName}`);
        const q1 = qParts.join(' ');
        const listUrl1 = `${base}/api/v2/workspaces?q=${encodeURIComponent(q1)}&limit=10`;
        try {
          const listRes1 = await fetch(listUrl1, { method: 'GET', headers });
          if (listRes1.ok) {
            const payload1 = await listRes1.json().catch(() => null);
            const items1 = payload1 && (Array.isArray(payload1.workspaces) ? payload1.workspaces : Array.isArray(payload1) ? payload1 : []);
            // Prefer exact owner match if available, else any name match
            let hit = null;
            if (Array.isArray(items1) && items1.length) {
              hit = items1.find(w => w && w.name === workspaceName && (!config.user || config.user === 'me' || w.owner_name === config.user))
                 || items1.find(w => w && w.name === workspaceName) || null;
            }
            if (hit) return hit;
          }
        } catch (e) {
          console.warn('[coder-workspace] Fallback list+filter lookup (owner+name) failed:', e);
        }

        // Fallback 2: name-only search across visible workspaces
        try {
          const q2 = `name:${workspaceName}`;
          const listUrl2 = `${base}/api/v2/workspaces?q=${encodeURIComponent(q2)}&limit=10`;
          const listRes2 = await fetch(listUrl2, { method: 'GET', headers });
          if (listRes2.ok) {
            const payload2 = await listRes2.json().catch(() => null);
            const items2 = payload2 && (Array.isArray(payload2.workspaces) ? payload2.workspaces : Array.isArray(payload2) ? payload2 : []);
            const hit2 = Array.isArray(items2) ? items2.find(w => w && w.name === workspaceName) : null;
            if (hit2) return hit2;
          }
        } catch (e) {
          console.warn('[coder-workspace] Fallback list+filter lookup (name only) failed:', e);
        }
        return null;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(`[coder-workspace] GET workspace by name failed: ${res.status} ${text}`);
        return null;
      }
      return await res.json();
    } catch (error) {
      console.warn(`[coder-workspace] GET workspace by name error for ${byNameUrl}:`, error);
      return null;
    }
  }

  // Testability: allow overriding the lookup implementation during tests
  var getWorkspaceByNameImpl = getWorkspaceByName;

  async function listWorkspaces(limit = 100) {
    const headers = {'Accept': 'application/json'};
    if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;
    const base = (config.serverUrl || '').replace(/\/$/, '');
    // Use global list endpoint with owner filter to retrieve current user's workspaces
    const ownerQ = `owner:${config.user || 'me'}`;
    const url = `${base}/api/v2/workspaces?q=${encodeURIComponent(ownerQ)}&limit=${encodeURIComponent(String(limit))}`;
    try {
      const res = await fetch(url, { method: 'GET', headers });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn(`[coder-workspace] LIST workspaces failed: ${res.status} ${text}`);
        return [];
      }
      const payload = await res.json().catch(() => null);
      const items = payload && (Array.isArray(payload.workspaces) ? payload.workspaces : Array.isArray(payload) ? payload : []);
      return Array.isArray(items) ? items : [];
    } catch (e) {
      console.warn('[coder-workspace] LIST workspaces error:', e);
      return [];
    }
  }

  async function findWorkspaceByPrefix(prefix) {
    try {
      const all = await listWorkspaces(200);
      if (!all || !all.length) return null;
      // Prefer exact match, otherwise a name that starts with `${prefix}.`
      let best = all.find(w => w && w.name === prefix);
      if (best) return best;
      best = all.find(w => w && typeof w.name === 'string' && w.name.startsWith(prefix + '.'));
      return best || null;
    } catch (_) {
      return null;
    }
  }

  function openWorkspace(workspace) {
    const appUri = workspace && workspace.latest_app_status && workspace.latest_app_status.uri;
    const baseUrl = `/@${encodeURIComponent(workspace.owner_name || '')}/${encodeURIComponent(workspace.name)}`;
    const wsUrl = appUri || resolveCoderUrl(baseUrl + (config.appSlug ? `/apps/${encodeURIComponent(config.appSlug)}/` : ''));
    window.open(wsUrl, '_blank', 'noopener');
  }

  function computeWorkspaceUrl(workspace) {
    const appUri = workspace && workspace.latest_app_status && workspace.latest_app_status.uri;
    const baseUrl = `/@${encodeURIComponent(workspace.owner_name || '')}/${encodeURIComponent(workspace.name)}`;
    return appUri || resolveCoderUrl(baseUrl + (config.appSlug ? `/apps/${encodeURIComponent(config.appSlug)}/` : ''));
  }

  async function waitForWorkspaceApp(name, timeoutMs, intervalMs, initialWs) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    let ws = initialWs || null;
    if (deadline <= Date.now()) return ws; // disabled or zero timeout
    for (;;) {
      try {
        if (!ws) ws = await getWorkspaceByNameImpl(name);
        if (ws && ws.latest_app_status && ws.latest_app_status.uri) return ws;
      } catch (_) {
        // ignore during polling
      }
      if (Date.now() >= deadline) return ws; // give up, return last seen
      await new Promise(r => setTimeout(r, Math.max(100, Number(intervalMs) || 1000)));
      ws = null; // fetch fresh next loop
    }
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
            // Wait a bit longer for branch to populate to avoid creating names without branchShort
            const ctx = await getChangeContextWithRetry(3000, 100);

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
              // If strictName is enabled, bypass reuse/prefix search and create exact name
              if (config.strictName) {
                try {
                  const ws = await createWorkspaceStrict(body);
                  const baseMeta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: ws && ws.name, workspaceOwner: ws && ws.owner_name};
                  const initialUrl = computeWorkspaceUrl(ws);
                  notify(plugin, `Coder workspace ready: ${ws.name}`);
                  saveCurrentWorkspace(initialUrl, baseMeta);
                  window.open(initialUrl, '_blank', 'noopener');
                  if (config.waitForAppReadyMs > 0 && !(ws.latest_app_status && ws.latest_app_status.uri)) {
                    notify(plugin, `Waiting for Coder workspace app to be ready…`);
                    try {
                      const ready = await waitForWorkspaceApp(ws.name, config.waitForAppReadyMs, config.waitPollIntervalMs, ws) || ws;
                      if (ready && ready.latest_app_status && ready.latest_app_status.uri) {
                        const updatedUrl = computeWorkspaceUrl(ready);
                        saveCurrentWorkspace(updatedUrl, baseMeta);
                      }
                    } catch (_) { /* ignore */ }
                  }
                  return;
                } catch (strictErr) {
                  const msg = (strictErr && strictErr.message) ? strictErr.message : String(strictErr || '');
                  if (/\b409\b/.test(msg)) {
                    notify(plugin, `Workspace already exists: ${body && body.name}`);
                    const existing = await getWorkspaceByName(body && body.name);
                    if (existing) {
                      const baseMeta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: existing && existing.name, workspaceOwner: existing && existing.owner_name};
                      const url = computeWorkspaceUrl(existing);
                      saveCurrentWorkspace(url, baseMeta);
                      window.open(url, '_blank', 'noopener');
                      return;
                    }
                    // If not visible, surface the error without creating a suffixed workspace
                    throw strictErr;
                  }
                  throw strictErr;
                }
              }

              // Attempt to re-use existing workspace with the expected and alternate names
              const candidates = computeCandidateNames(ctx, config);

              console.log('[coder-workspace] Looking up existing workspace by candidates:', candidates);
              for (const name of candidates) {
                try {
                  const existing = await getWorkspaceByName(name);
                  if (existing) {
                    // Open immediately to avoid popup blockers after async waits
                    const initialUrl = computeWorkspaceUrl(existing);
                    const baseMeta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: existing && existing.name, workspaceOwner: existing && existing.owner_name};
                    saveCurrentWorkspace(initialUrl, baseMeta);
                    notify(plugin, `Opening existing Coder workspace: ${existing.name}`);
                    window.open(initialUrl, '_blank', 'noopener');

                    // Optionally poll in the background for a better app URI and update saved URL
                    if (config.waitForAppReadyMs > 0 && !(existing.latest_app_status && existing.latest_app_status.uri)) {
                      notify(plugin, `Waiting for Coder workspace app to be ready…`);
                      try {
                        const ready = await waitForWorkspaceApp(existing.name, config.waitForAppReadyMs, config.waitPollIntervalMs, existing) || existing;
                        if (ready && ready.latest_app_status && ready.latest_app_status.uri) {
                          const updatedUrl = computeWorkspaceUrl(ready);
                          saveCurrentWorkspace(updatedUrl, baseMeta);
                        }
                      } catch (_) { /* ignore */ }
                    }
                    return;
                  }
                } catch (lookupErr) {
                  console.warn('[coder-workspace] lookup existing by name failed; will try next candidate', lookupErr);
                }
              }
              // If branch is still missing, try a prefix search to catch names like "{repo}-{change}.<branch>"
              if (!ctx.branch) {
                try {
                  const expectedName = (computeCandidateNames(ctx, config)[0]);
                  const prefMatch = await findWorkspaceByPrefix(expectedName);
                  if (prefMatch) {
                    const initialUrl = computeWorkspaceUrl(prefMatch);
                    const baseMeta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: prefMatch && prefMatch.name, workspaceOwner: prefMatch && prefMatch.owner_name};
                    saveCurrentWorkspace(initialUrl, baseMeta);
                    notify(plugin, `Opening existing Coder workspace: ${prefMatch.name}`);
                    window.open(initialUrl, '_blank', 'noopener');
                    // Background readiness wait (optional)
                    if (config.waitForAppReadyMs > 0 && !(prefMatch.latest_app_status && prefMatch.latest_app_status.uri)) {
                      notify(plugin, `Waiting for Coder workspace app to be ready…`);
                      try {
                        const ready = await waitForWorkspaceApp(prefMatch.name, config.waitForAppReadyMs, config.waitPollIntervalMs, prefMatch) || prefMatch;
                        if (ready && ready.latest_app_status && ready.latest_app_status.uri) {
                          const updatedUrl = computeWorkspaceUrl(ready);
                          saveCurrentWorkspace(updatedUrl, baseMeta);
                        }
                      } catch (_) {}
                    }
                    return;
                  }
                } catch (e) {
                  console.warn('[coder-workspace] prefix search failed; proceeding to create', e);
                }
              }

              console.log('[coder-workspace] No existing workspace found, will create new one');
            } catch (e) {
              console.warn('[coder-workspace] lookup existing by name failed; proceeding to create', e);
            }

            if (config.enableDryRunPreview) {
              const {confirmed} = await previewAndConfirm(plugin, body);
              if (!confirmed) return;
            }

            try {
              const ws = await createWorkspace(body);
              console.log(`[coder-workspace] Successfully created workspace:`, ws);
              // Open immediately to avoid popup blockers after async waits
              const baseMeta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: ws && ws.name, workspaceOwner: ws && ws.owner_name};
              const initialUrl = computeWorkspaceUrl(ws);
              notify(plugin, `Coder workspace created: ${ws.name}`);
              saveCurrentWorkspace(initialUrl, baseMeta);
              window.open(initialUrl, '_blank', 'noopener');
              // Optionally poll in background for app URI and update saved URL
              if (config.waitForAppReadyMs > 0 && !(ws.latest_app_status && ws.latest_app_status.uri)) {
                notify(plugin, `Waiting for Coder workspace app to be ready…`);
                try {
                  const ready = await waitForWorkspaceApp(ws.name, config.waitForAppReadyMs, config.waitPollIntervalMs, ws) || ws;
                  if (ready && ready.latest_app_status && ready.latest_app_status.uri) {
                    const updatedUrl = computeWorkspaceUrl(ready);
                    saveCurrentWorkspace(updatedUrl, baseMeta);
                  }
                } catch (_) { /* ignore */ }
              }
            } catch (createErr) {
              const emsg = (createErr && createErr.message) ? createErr.message : String(createErr || '');
              // Handle 409 conflict (already exists) by trying to fetch and open
              if (/\b409\b/.test(emsg) || /already exists/i.test(emsg)) {
                if (config.strictName) {
                  // In strict mode, do not auto-suffix; just try to open existing
                  const existing = await getWorkspaceByName(body && body.name);
                  if (existing) {
                    const baseMeta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: existing && existing.name, workspaceOwner: existing && existing.owner_name};
                    const initialUrl = computeWorkspaceUrl(existing);
                    saveCurrentWorkspace(initialUrl, baseMeta);
                    notify(plugin, `Opening existing Coder workspace: ${existing.name}`);
                    window.open(initialUrl, '_blank', 'noopener');
                    return;
                  }
                  throw createErr;
                }
                console.warn('[coder-workspace] Create returned 409; attempting to open existing workspace by name', body && body.name);
                const existing = await getWorkspaceByName(body && body.name);
                if (existing) {
                  // Open immediately to avoid popup blockers after async waits
                  const baseMeta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: existing && existing.name, workspaceOwner: existing && existing.owner_name};
                  const initialUrl = computeWorkspaceUrl(existing);
                  saveCurrentWorkspace(initialUrl, baseMeta);
                  notify(plugin, `Opening existing Coder workspace: ${existing.name}`);
                  window.open(initialUrl, '_blank', 'noopener');

                  if (config.waitForAppReadyMs > 0 && !(existing.latest_app_status && existing.latest_app_status.uri)) {
                    notify(plugin, `Waiting for Coder workspace app to be ready…`);
                    try {
                      const ready = await waitForWorkspaceApp(existing.name, config.waitForAppReadyMs, config.waitPollIntervalMs, existing) || existing;
                      if (ready && ready.latest_app_status && ready.latest_app_status.uri) {
                        const updatedUrl = computeWorkspaceUrl(ready);
                        saveCurrentWorkspace(updatedUrl, baseMeta);
                      }
                    } catch (_) { /* ignore */ }
                  }
                  return;
                }
                // Not visible by API: retry creation with a unique name suffix (once)
                try {
                  const unique = generateUniqueName(body && body.name ? body.name : 'workspace');
                  const retryBody = Object.assign({}, body, { name: unique });
                  console.warn('[coder-workspace] Existing not visible; retrying create with unique name', unique);
                  const ws2 = await createWorkspace(retryBody);
                  notify(plugin, `Coder workspace created: ${ws2.name}`);
                  const baseMeta2 = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: ws2 && ws2.name, workspaceOwner: ws2 && ws2.owner_name};
                  const initialUrl2 = computeWorkspaceUrl(ws2);
                  saveCurrentWorkspace(initialUrl2, baseMeta2);
                  window.open(initialUrl2, '_blank', 'noopener');
                  if (config.waitForAppReadyMs > 0 && !(ws2.latest_app_status && ws2.latest_app_status.uri)) {
                    notify(plugin, `Waiting for Coder workspace app to be ready…`);
                    try {
                      const ready2 = await waitForWorkspaceApp(ws2.name, config.waitForAppReadyMs, config.waitPollIntervalMs, ws2) || ws2;
                      if (ready2 && ready2.latest_app_status && ready2.latest_app_status.uri) {
                        const updatedUrl2 = computeWorkspaceUrl(ready2);
                        saveCurrentWorkspace(updatedUrl2, baseMeta2);
                      }
                    } catch (_) { /* ignore */ }
                  }
                  return;
                } catch (retryErr) {
                  console.warn('[coder-workspace] Retry create with unique name failed', retryErr);
                }
              }
              throw createErr;
            }
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

  // Expose a tiny test hook for unit tests (no public API impact)
  try {
    if (typeof window !== 'undefined') {
      // Allow injection override for getWorkspaceByName during tests
      var getWorkspaceByNameImpl = getWorkspaceByName;
      window.__coderWorkspaceTest__ = {
        renderNameTemplate,
        computeCandidateNames: (ctx, cfg) => computeCandidateNames(ctx, cfg || {}),
        computeWorkspaceUrl,
        waitForWorkspaceApp: (name, timeoutMs, intervalMs, initialWs) => waitForWorkspaceApp(name, timeoutMs, intervalMs, initialWs),
        generateUniqueName,
        buildCreateRequest: (ctx) => buildCreateRequest(ctx),
        createWorkspaceStrict: (body) => createWorkspaceStrict(body),
        // Expose direct lookup for unit tests
        getWorkspaceByName: (n) => getWorkspaceByName(n),
        setGetWorkspaceByName: (fn) => { getWorkspaceByNameImpl = fn || getWorkspaceByName; },
        setConfig: (patch) => { try { Object.assign(config, patch || {}); } catch(_){} },
      };
    }
  } catch (_) {}
})();
