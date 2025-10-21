// @license
// Copyright (C) 2025
// SPDX-License-Identifier: Apache-2.0

(function () {
  const PLUGIN_NAME = 'coder-workspace';
  const ACTION_LABEL = 'Create Coder Workspace';
  const OPEN_LAST_ACTION_LABEL = 'Open Last Coder Workspace';
  const OPEN_LAST_CONTEXT_ACTION_LABEL = 'Open Last Coder Workspace (This Repo/Branch)';
  const OPEN_LAST_CHANGE_ACTION_LABEL = 'Open Last Coder Workspace (This Change/Patchset)';
  const SETTINGS_ACTION_LABEL = 'Coder Settings';

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
    historyLimit: 10,
  };

  const STORAGE_KEY = 'gerrit-coder-workspace-config';
  const STORAGE_LAST_KEY = 'gerrit-coder-workspace-last-url';
  const STORAGE_LAST_CTX_PREFIX = 'gerrit-coder-workspace-last-url-ctx::';
  const STORAGE_LAST_CTX_META_PREFIX = 'gerrit-coder-workspace-last-meta-ctx::';
  const STORAGE_LAST_META_KEY = 'gerrit-coder-workspace-last-meta';
  const STORAGE_LAST_CHANGE_PREFIX = 'gerrit-coder-workspace-last-url-change::';
  // History lists (most-recent-first)
  const STORAGE_LAST_LIST = 'gerrit-coder-workspace-last-list';
  const STORAGE_LAST_CTX_LIST_PREFIX = 'gerrit-coder-workspace-last-list-ctx::';
  const STORAGE_LAST_CHANGE_LIST_PREFIX = 'gerrit-coder-workspace-last-list-change::';

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
    return String(tpl)
      .replaceAll('{repo}', String(ctx.repo || ''))
      .replaceAll('{branch}', String(ctx.branch || ''))
      .replaceAll('{change}', String(ctx.change || ''))
      .replaceAll('{patchset}', String(ctx.patchset || ''))
      .replace(/[^A-Za-z0-9._-]+/g, '-');
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
    const res = await fetch(url, {method: 'POST', headers, body: JSON.stringify(requestBody)});
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Coder API error ${res.status}: ${text}`);
    }
    return res.json();
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

  function saveLastWorkspaceUrl(url, meta) {
    try { localStorage.setItem(STORAGE_LAST_KEY, url || ''); } catch (_) {}
    pushHistoryItem(STORAGE_LAST_LIST, {url, meta: meta || loadLastMeta(), ts: Date.now()});
  }

  function loadLastWorkspaceUrl() {
    try { return localStorage.getItem(STORAGE_LAST_KEY) || ''; } catch (_) { return ''; }
  }

  function contextKey(ctx) {
    return `${ctx.repo}||${ctx.branch}`;
  }

  function changeKey(ctx) {
    return `${ctx.repo}||${ctx.branch}||${ctx.change}||${ctx.patchset}`;
  }

  function saveLastWorkspaceUrlForContext(ctx, url, meta) {
    try {
      const key = STORAGE_LAST_CTX_PREFIX + encodeURIComponent(contextKey(ctx));
      localStorage.setItem(key, url || '');
    } catch (_) {}
    const listKey = STORAGE_LAST_CTX_LIST_PREFIX + encodeURIComponent(contextKey(ctx));
    pushHistoryItem(listKey, {url, meta: meta || {repo: ctx.repo, branch: ctx.branch}, ts: Date.now()});
  }

  function loadLastWorkspaceUrlForContext(ctx) {
    try {
      const key = STORAGE_LAST_CTX_PREFIX + encodeURIComponent(contextKey(ctx));
      return localStorage.getItem(key) || '';
    } catch (_) { return ''; }
  }

  function saveLastMeta(meta) {
    try { localStorage.setItem(STORAGE_LAST_META_KEY, JSON.stringify(meta || {})); } catch (_) {}
  }
  function loadLastMeta() {
    try { return JSON.parse(localStorage.getItem(STORAGE_LAST_META_KEY) || '{}'); } catch (_) { return {}; }
  }
  function saveLastMetaForContext(ctx, meta) {
    try {
      const key = STORAGE_LAST_CTX_META_PREFIX + encodeURIComponent(contextKey(ctx));
      localStorage.setItem(key, JSON.stringify(meta || {}));
    } catch (_) {}
  }
  function loadLastMetaForContext(ctx) {
    try {
      const key = STORAGE_LAST_CTX_META_PREFIX + encodeURIComponent(contextKey(ctx));
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch (_) { return {}; }
  }
  function saveLastWorkspaceUrlForChange(ctx, url, meta) {
    try {
      const key = STORAGE_LAST_CHANGE_PREFIX + encodeURIComponent(changeKey(ctx));
      localStorage.setItem(key, url || '');
    } catch (_) {}
    const listKey = STORAGE_LAST_CHANGE_LIST_PREFIX + encodeURIComponent(changeKey(ctx));
    pushHistoryItem(listKey, {url, meta: meta || {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset}, ts: Date.now()});
  }
  function loadLastWorkspaceUrlForChange(ctx) {
    try {
      const key = STORAGE_LAST_CHANGE_PREFIX + encodeURIComponent(changeKey(ctx));
      return localStorage.getItem(key) || '';
    } catch (_) { return ''; }
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

  // History helpers
  function loadHistory(listKey) {
    try { return JSON.parse(localStorage.getItem(listKey) || '[]'); } catch (_) { return []; }
  }
  function saveHistory(listKey, arr) {
    try { localStorage.setItem(listKey, JSON.stringify(arr || [])); } catch (_) {}
  }
  function pushHistoryItem(listKey, item) {
    try {
      const limit = Math.max(1, Number(config.historyLimit || 10));
      const arr = loadHistory(listKey);
      if (arr.length === 0 || (arr[0] && arr[0].url !== item.url)) arr.unshift(item);
      while (arr.length > limit) arr.pop();
      saveHistory(listKey, arr);
    } catch (_) {}
  }

  class CoderWorkspaceSettings extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({mode: 'open'});
    }
    connectedCallback() {
      const current = loadConfig();
      const style = `
        :host { display:block; padding:16px; max-width:720px; }
        h2 { margin:0 0 12px 0; font-size:16px; }
        .row { display:flex; gap:12px; }
        label { display:block; font-size:12px; color: var(--gray-700, #555); }
        input, textarea { width:100%; box-sizing:border-box; }
        textarea { min-height:120px; font-family: monospace; }
        .actions { margin-top:12px; display:flex; gap:8px; justify-content:space-between; align-items:center; }
        .grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
        .left-actions { display:flex; gap:8px; align-items:center; }
        .right-actions { display:flex; gap:8px; align-items:center; }
        .hint { font-size:12px; color: var(--gray-700, #555); }
      `;
      const mappingsJson = JSON.stringify(current.templateMappings || [], null, 2);
      this.shadowRoot.innerHTML = `
        <style>${style}</style>
        <h2>Coder Workspace Settings</h2>
        <div class="grid">
          <div>
            <label>Coder Server URL</label>
            <input id="serverUrl" type="text" value="${escapeHtml(current.serverUrl || '')}" placeholder="https://coder.example.com" />
          </div>
          <div>
            <label>API Key (Coder-Session-Token)</label>
            <input id="apiKey" type="password" value="${escapeHtml(current.apiKey || '')}" />
          </div>
          <div>
            <label>Organization ID (optional)</label>
            <input id="organization" type="text" value="${escapeHtml(current.organization || '')}" />
          </div>
          <div>
            <label>User (default: me)</label>
            <input id="user" type="text" value="${escapeHtml(current.user || 'me')}" />
          </div>
          <div>
            <label>Template ID (fallback)</label>
            <input id="templateId" type="text" value="${escapeHtml(current.templateId || '')}" />
          </div>
          <div>
            <label>Template Version ID (preferred)</label>
            <input id="templateVersionId" type="text" value="${escapeHtml(current.templateVersionId || '')}" />
          </div>
          <div>
            <label>Template Version Preset ID</label>
            <input id="templateVersionPresetId" type="text" value="${escapeHtml(current.templateVersionPresetId || '')}" />
          </div>
          <div>
            <label>Workspace Name Template (tokens: {repo},{branch},{change},{patchset})</label>
            <input id="workspaceNameTemplate" type="text" value="${escapeHtml(current.workspaceNameTemplate || '{repo}-{change}-{patchset}')}" />
          </div>
          <div>
            <label>Automatic Updates</label>
            <input id="automaticUpdates" type="text" value="${escapeHtml(current.automaticUpdates || 'always')}" />
          </div>
          <div>
            <label>Autostart (now)</label>
            <input id="autostart" type="checkbox" ${current.autostart ? 'checked' : ''} />
          </div>
          <div>
            <label>Open After Create</label>
            <input id="openAfterCreate" type="checkbox" ${current.openAfterCreate !== false ? 'checked' : ''} />
          </div>
          <div>
            <label>TTL (ms)</label>
            <input id="ttlMs" type="number" value="${Number(current.ttlMs || 0)}" />
          </div>
          <div>
            <label>History Retention (items per scope)</label>
            <input id="historyLimit" type="number" value="${Number(current.historyLimit || 10)}" />
          </div>
          <div>
            <label>Enable Dry-Run Preview (confirm request before creating)</label>
            <input id="enableDryRunPreview" type="checkbox" ${current.enableDryRunPreview ? 'checked' : ''} />
          </div>
        </div>
        <div style="margin-top:12px">
          <label>Template Mappings (JSON array). Keys: repo, branch, templateId|templateVersionId, templateVersionPresetId, richParams</label>
          <textarea id="templateMappings">${escapeHtml(mappingsJson)}</textarea>
          <div id="mappingsError" class="hint" style="color: var(--error-text-color, #c00);"></div>
        </div>
        <div class="actions">
          <div class="left-actions">
            <gr-button id="test" role="button">Test Connection</gr-button>
            <span id="testResult" class="hint"></span>
          </div>
          <div class="right-actions">
            <gr-button id="history" role="button">Manage History</gr-button>
            <gr-button id="cancel" role="button">Cancel</gr-button>
            <gr-button id="save" primary role="button">Save</gr-button>
          </div>
        </div>
      `;
      this.shadowRoot.getElementById('cancel').addEventListener('click', () => this.close());
      this.shadowRoot.getElementById('save').addEventListener('click', () => this.save());
      this.shadowRoot.getElementById('test').addEventListener('click', () => this.testConnection());
      this.shadowRoot.getElementById('templateMappings').addEventListener('input', () => this.liveValidate());
      this.shadowRoot.getElementById('history').addEventListener('click', () => this.openHistory());
    }
    readValues() {
      const $ = id => this.shadowRoot.getElementById(id);
      const next = {
        serverUrl: $('serverUrl').value.trim(),
        apiKey: $('apiKey').value,
        organization: $('organization').value.trim(),
        user: $('user').value.trim() || 'me',
        templateId: $('templateId').value.trim(),
        templateVersionId: $('templateVersionId').value.trim(),
        templateVersionPresetId: $('templateVersionPresetId').value.trim(),
        workspaceNameTemplate: $('workspaceNameTemplate').value.trim() || '{repo}-{change}-{patchset}',
        automaticUpdates: $('automaticUpdates').value.trim() || 'always',
        autostart: $('autostart').checked,
        openAfterCreate: $('openAfterCreate').checked,
        ttlMs: Number($('ttlMs').value) || 0,
        enableDryRunPreview: $('enableDryRunPreview').checked,
        historyLimit: Math.max(1, Number($('historyLimit').value) || 10),
      };
      try {
        const mappingsText = this.shadowRoot.getElementById('templateMappings').value;
        const parsed = JSON.parse(mappingsText || '[]');
        const v = validateMappingsSchema(parsed);
        if (!v.valid) {
          setMappingsError(this.shadowRoot, v.error);
          throw new Error(v.error);
        }
        next.templateMappings = parsed;
      } catch (e) {
        throw new Error('Invalid Template Mappings JSON: ' + (e.message || String(e)));
      }
      return next;
    }
    save() {
      try {
        const next = this.readValues();
        saveConfig(next);
        this.dispatchEvent(new CustomEvent('coder-settings-saved', {bubbles: true, composed: true, detail: next}));
        this.close();
      } catch (e) {
        // Simple inline error display
        notify(null, e.message || String(e));
      }
    }
    liveValidate() {
      const textarea = this.shadowRoot.getElementById('templateMappings');
      const text = textarea.value;
      try {
        const parsed = JSON.parse(text || '[]');
        const v = validateMappingsSchema(parsed);
        setMappingsError(this.shadowRoot, v.valid ? '' : v.error);
      } catch (e) {
        setMappingsError(this.shadowRoot, 'JSON parse error: ' + (e.message || String(e)));
      }
    }
    async testConnection() {
      const $ = id => this.shadowRoot.getElementById(id);
      const status = $('testResult');
      status.textContent = 'Testing...';
      try {
        const cfg = this.readValues();
        const headers = { 'Accept': 'application/json' };
        if (cfg.apiKey) headers['Coder-Session-Token'] = cfg.apiKey;
        const base = (cfg.serverUrl || '').replace(/\/$/, '');
        const url = cfg.organization
          ? `${base}/api/v2/organizations/${encodeURIComponent(cfg.organization)}/members/${encodeURIComponent(cfg.user || 'me')}/workspaces?limit=1`
          : `${base}/api/v2/workspaces?limit=1`;
        const res = await fetch(url, { method: 'GET', headers });
        status.textContent = res.ok ? 'OK' : `Failed (${res.status})`;
      } catch (e) {
        status.textContent = 'Error: ' + (e.message || String(e));
      }
    }
    close() {
      // plugin.popup host will handle removal; best-effort clean-up
      this.remove();
    }
    async openHistory() {
      const ctx = getChangeContextFromPage();
      const sections = [
        {label:'Global', listKey: STORAGE_LAST_LIST},
        {label:'Current Repo/Branch', listKey: STORAGE_LAST_CTX_LIST_PREFIX + encodeURIComponent(contextKey(ctx))},
        {label:'Current Change/Patchset', listKey: STORAGE_LAST_CHANGE_LIST_PREFIX + encodeURIComponent(changeKey(ctx))},
      ];
      const backdrop = document.createElement('div');
      Object.assign(backdrop.style, {position:'fixed',inset:'0',background:'rgba(0,0,0,0.3)',zIndex:1000});
      const panel = document.createElement('div');
      Object.assign(panel.style, {position:'fixed',left:'10%',right:'10%',top:'10%',bottom:'10%',background:'#fff',border:'1px solid #ddd',padding:'12px',zIndex:1001,overflow:'auto'});
      const title = document.createElement('h2');
      title.textContent = 'Coder Workspace History';
      const topBar = document.createElement('div');
      topBar.style.display = 'flex';
      topBar.style.gap = '8px';
      topBar.style.alignItems = 'center';
      topBar.style.margin = '8px 0';
      const limitLabel = document.createElement('span');
      limitLabel.textContent = 'Retention limit:';
      const limitInput = document.createElement('input');
      limitInput.type = 'number';
      limitInput.value = String(Number(config.historyLimit || 10));
      limitInput.style.width = '80px';
      const applyBtn = document.createElement('gr-button');
      applyBtn.textContent = 'Apply';
      const closeBtn = document.createElement('gr-button');
      closeBtn.textContent = 'Close';
      topBar.appendChild(limitLabel);
      topBar.appendChild(limitInput);
      topBar.appendChild(applyBtn);
      topBar.appendChild(closeBtn);

      const container = document.createElement('div');
      function render() {
        container.innerHTML = '';
        for (const sec of sections) {
          const secEl = document.createElement('div');
          const h3 = document.createElement('h3');
          h3.textContent = sec.label;
          const actions = document.createElement('div');
          actions.style.display = 'flex';
          actions.style.gap = '8px';
          actions.style.alignItems = 'center';
          actions.style.margin = '4px 0';
          const clearBtn = document.createElement('gr-button');
          clearBtn.textContent = 'Clear';
          clearBtn.addEventListener('click', () => { saveHistory(sec.listKey, []); render(); });
          actions.appendChild(clearBtn);
          const ul = document.createElement('ul');
          ul.style.maxHeight = '200px';
          ul.style.overflow = 'auto';
          ul.style.paddingLeft = '18px';
          const history = loadHistory(sec.listKey);
          for (const item of history) {
            const li = document.createElement('li');
            li.style.fontFamily = 'monospace';
            const when = new Date(item.ts || Date.now()).toLocaleString();
            const m = item.meta || {};
            li.textContent = `[${when}] ${m.repo || '?'} @ ${m.branch || '?'} ${m.change?('change '+m.change):''} ${m.patchset?('ps '+m.patchset):''} => ${item.url}`;
            ul.appendChild(li);
          }
          secEl.appendChild(h3);
          secEl.appendChild(actions);
          secEl.appendChild(ul);
          container.appendChild(secEl);
        }
      }
      render();

      applyBtn.addEventListener('click', () => {
        const v = Number(limitInput.value);
        if (Number.isFinite(v) && v > 0) {
          saveConfig({historyLimit: v});
          // prune existing lists shown
          const limit = Math.max(1, v);
          for (const sec of sections) {
            const arr = loadHistory(sec.listKey);
            if (arr.length > limit) saveHistory(sec.listKey, arr.slice(0, limit));
          }
          notify(null, 'Updated history retention');
          render();
        }
      });
      closeBtn.addEventListener('click', () => { try { panel.remove(); } catch(_){} try { backdrop.remove(); } catch(_){} });

      panel.appendChild(title);
      panel.appendChild(topBar);
      panel.appendChild(container);
      document.body.appendChild(backdrop);
      document.body.appendChild(panel);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign({}, config, JSON.parse(raw));
    } catch (_) {}
    return {...config};
  }

  function saveConfig(next) {
    const merged = Object.assign({}, config, next || {});
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (_) {}
    config = merged;
  }

  function installPlugin(plugin) {
    // Try to merge server-provided plugin config (if any). We don't rely on a
    // stable API for plugin config, so this is best-effort only.
    config = loadConfig();
    (plugin.restApi && plugin.restApi().get('/config/server/info').then(serverInfo => {
      const p = serverInfo && serverInfo.plugin && serverInfo.plugin['coder-workspace'];
      if (p) saveConfig(Object.assign({}, config, p));
    }).catch(() => {}));

    const changeActions = plugin.changeActions();
  const key = changeActions.add('revision', ACTION_LABEL);
    changeActions.setActionOverflow('revision', key, true);
    if (changeActions.setIcon) changeActions.setIcon(key, 'rocket_launch');
    changeActions.setTitle(key, 'Create a Coder workspace for this change/patchset');

    changeActions.addTapListener(key, async () => {
      try {
        const ctx = getChangeContextFromPage();
        const body = buildCreateRequest(ctx);
        if (config.enableDryRunPreview) {
          const {confirmed} = await previewAndConfirm(plugin, body);
          if (!confirmed) return;
        }
  const ws = await createWorkspace(body);
        notify(plugin, 'Coder workspace created');
        const lastUrl = computeWorkspaceUrl(ws);
        const meta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset};
  saveLastWorkspaceUrl(lastUrl, meta);
  saveLastWorkspaceUrlForContext(ctx, lastUrl, meta);
  saveLastWorkspaceUrlForChange(ctx, lastUrl, meta);
        saveLastMeta(meta);
        saveLastMetaForContext(ctx, meta);
        if (openLastKey) try { changeActions.setEnabled(openLastKey, true); } catch(_){}
        if (openLastContextKey) try { changeActions.setEnabled(openLastContextKey, true); } catch(_){}
        if (openLastChangeKey) try { changeActions.setEnabled(openLastChangeKey, true); } catch(_){}
        if (config.openAfterCreate) openWorkspace(ws);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        notify(plugin, 'Failed to create Coder workspace: ' + msg);
        // eslint-disable-next-line no-console
        console.error('[coder-workspace] create failed', e);
      }
    });

    // Settings action
    const settingsKey = changeActions.add('revision', SETTINGS_ACTION_LABEL);
    changeActions.setActionOverflow('revision', settingsKey, true);
    changeActions.setTitle(settingsKey, 'Configure Coder server and template mappings');
    changeActions.addTapListener(settingsKey, async () => {
      if (!customElements.get('coder-workspace-settings')) {
        customElements.define('coder-workspace-settings', CoderWorkspaceSettings);
      }
      const el = await plugin.popup('coder-workspace-settings', {});
      el.addEventListener('coder-settings-saved', (e) => {
        // Already saved via saveConfig called in element; reload from storage for safety
        config = loadConfig();
      });
    });

    // Open last workspace (global) action
    const openLastUrl = loadLastWorkspaceUrl();
    var openLastKey = changeActions.add('revision', OPEN_LAST_ACTION_LABEL);
    changeActions.setActionOverflow('revision', openLastKey, true);
    changeActions.setTitle(openLastKey, 'Open previously created Coder workspace in a new tab');
    try { changeActions.setEnabled(openLastKey, !!openLastUrl); } catch(_){}
    changeActions.addTapListener(openLastKey, () => {
      const url = loadLastWorkspaceUrl();
      if (!url) { notify(plugin, 'No recent Coder workspace link found'); return; }
      const meta = loadLastMeta();
      if (meta && (meta.repo || meta.branch)) {
        notify(plugin, `Opening last Coder workspace for ${meta.repo || '?'} @ ${meta.branch || '?'}`);
      }
      window.open(url, '_blank', 'noopener');
    });

    // Open last workspace (this repo/branch) action
    const currentCtx = getChangeContextFromPage();
    const openLastCtxUrl = loadLastWorkspaceUrlForContext(currentCtx);
    var openLastContextKey = changeActions.add('revision', OPEN_LAST_CONTEXT_ACTION_LABEL);
    changeActions.setActionOverflow('revision', openLastContextKey, true);
    changeActions.setTitle(openLastContextKey, 'Open last Coder workspace for this repository and branch');
    try { changeActions.setEnabled(openLastContextKey, !!openLastCtxUrl); } catch(_){}
    changeActions.addTapListener(openLastContextKey, () => {
      const ctx = getChangeContextFromPage();
      const url = loadLastWorkspaceUrlForContext(ctx);
      if (!url) { notify(plugin, 'No Coder workspace link found for this repo/branch'); return; }
      notify(plugin, `Opening last Coder workspace for ${ctx.repo} @ ${ctx.branch}`);
      window.open(url, '_blank', 'noopener');
    });

    // Open last workspace (this change/patchset) action
    const openLastChangeUrl = loadLastWorkspaceUrlForChange(currentCtx);
    var openLastChangeKey = changeActions.add('revision', OPEN_LAST_CHANGE_ACTION_LABEL);
    changeActions.setActionOverflow('revision', openLastChangeKey, true);
    changeActions.setTitle(openLastChangeKey, 'Open last Coder workspace for this change and patchset');
    try { changeActions.setEnabled(openLastChangeKey, !!openLastChangeUrl); } catch(_){}
    changeActions.addTapListener(openLastChangeKey, () => {
      const ctx = getChangeContextFromPage();
      const url = loadLastWorkspaceUrlForChange(ctx);
      if (!url) { notify(plugin, 'No Coder workspace link found for this change/patchset'); return; }
      notify(plugin, `Opening last Coder workspace for change ${ctx.change} patchset ${ctx.patchset}`);
      window.open(url, '_blank', 'noopener');
    });
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

  if (window && window.Gerrit && window.Gerrit.install) {
    window.Gerrit.install(installPlugin, PLUGIN_NAME);
  } else {
    window.addEventListener('WebComponentsReady', () => {
      window.Gerrit.install(installPlugin, PLUGIN_NAME);
    });
  }
})();
