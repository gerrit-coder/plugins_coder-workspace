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
      {name: 'GERRIT_GIT_SSH_URL', from: 'gitSshUrl'},
      {name: 'GERRIT_CHANGE_REF', from: 'changeRef'},
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

    // Auth/cross-origin helpers
    // If API returns 401 requiring cookie or query param, retry request by appending the API key as a query parameter.
    retryAuthWithQueryParam: true,
    // Query parameter name to use for API key when retrying (server logs mention coder_session_token)
    apiKeyQueryParamName: 'coder_session_token',
    // Optionally append the API key to the app URL when opening (only if you trust the environment)
    appendTokenToAppUrl: false,

    // Some browsers block window.open() if not invoked immediately in a user gesture.
    // When true, we open a placeholder tab right away on click and later redirect it
    // to the final URL once known, avoiding popup blockers.
    // If a popup is blocked when trying to open a new tab after async work,
    // optionally navigate in the same tab as a fallback.
    navigateInSameTabOnBlock: true,
  };

  // Keep a hardcoded default for alternates so server-provided empty arrays
  // don't erase sensible lookup behavior.
  const DEFAULT_ALTERNATE_NAME_TEMPLATES = ['{repo}.{branchShort}', '{repo}-{change}.{branchShort}'];

  const STORAGE_CURRENT_WORKSPACE_KEY = 'gerrit-coder-workspace-current';
  const STORAGE_CURRENT_META_KEY = 'gerrit-coder-workspace-current-meta';

  function withAuthUrl(url) {
    try {
      if (!config || !config.apiKey || !config.retryAuthWithQueryParam) return url;
      const u = new URL(url, resolveCoderUrl('/'));
      const qp = String(config.apiKeyQueryParamName || 'coder_session_token');
      if (!u.searchParams.has(qp)) u.searchParams.set(qp, config.apiKey);
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  async function fetchWithAuth(url, options) {
    const opts = Object.assign({ method: 'GET' }, options || {});
    const headers = Object.assign({}, opts.headers || {});
    // If using API key auth, always prefer header and explicitly OMIT cookies to avoid CSRF
    if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;
    headers['Accept'] = headers['Accept'] || 'application/json';
    opts.headers = headers;
    // Credentials handling:
    // - When apiKey is present, force omit cookies so server doesn't see both cookie and header (avoids CSRF 400)
    // - When no apiKey, allow cookies so a logged-in session can be used
    if (!('credentials' in opts)) {
      opts.credentials = config.apiKey ? 'omit' : 'include';
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      // Network/preflight errors won't give us a 401 to inspect; try query-param retry if enabled
      if (config.apiKey && config.retryAuthWithQueryParam) {
        const retryUrl = withAuthUrl(url);
        try { return await fetch(retryUrl, Object.assign({}, opts, { headers, credentials: 'omit' })); } catch (e2) { throw e2; }
      }
      throw e;
    }
    if (res && res.status === 401 && config.apiKey && config.retryAuthWithQueryParam) {
      const retryUrl = withAuthUrl(url);
      if (retryUrl !== url) {
        return await fetch(retryUrl, Object.assign({}, opts, { headers, credentials: 'omit' }));
      }
    }
    // Handle CSRF 400 specifically when both cookie and header may have been detected by server
    if (res && res.status === 400) {
      try {
        const text = await res.clone().text();
        if (/CSRF error encountered/i.test(text) && config.apiKey) {
          // Retry without header but using query param, still omitting cookies
          const retryHeaders = Object.assign({}, headers);
          delete retryHeaders['Coder-Session-Token'];
          const retryUrl = withAuthUrl(url);
          return await fetch(retryUrl, Object.assign({}, opts, { headers: retryHeaders, credentials: 'omit' }));
        }
      } catch (_) {}
    }
    return res;
  }

  function resolveCoderUrl(path) {
    return (config.serverUrl || '').replace(/\/$/, '') + path;
  }

  function toRichParameterValues(context) {
    return (context._richParamsOverride || config.richParams || []).map(p => ({
      name: p.name,
      value: String(context[p.from] ?? ''),
    }));
  }

  async function getChangeContextFromPage() {
    const grApp = document.querySelector('gr-app');
    // Try to pick info off the change view; fallback to URL
    let project = '';
    let branch = '';
    let changeNum = '';
    let patchset = '';

    const changeEl = grApp && grApp.shadowRoot && grApp.shadowRoot.querySelector('gr-change-view');
    const change =
      (changeEl && (changeEl.change || changeEl._change)) ||
      (changeEl && changeEl.viewState && changeEl.viewState.change);
    const currentRevision = changeEl && changeEl.currentRevision;
    if (change) {
      project = change.project || '';
      branch = change.branch || '';
      changeNum = String(change._number || change.number || '');
      if (change.revisions && currentRevision && change.revisions[currentRevision]) {
        const rev = change.revisions[currentRevision];
        patchset = String((rev && rev._number) || '');
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

    // Additional fallbacks if Polymer hasn't populated `change` yet
    if (changeEl) {
      if (!branch && changeEl.viewState && changeEl.viewState.change) {
        branch = changeEl.viewState.change.branch || branch;
      }
      if (!patchset) {
        // Try patchRange first (most reliable for current view) - check both patchRange and _patchRange
        if (changeEl.patchRange && changeEl.patchRange.patchNum) {
          patchset = String(changeEl.patchRange.patchNum);
        } else if (changeEl._patchRange && changeEl._patchRange.patchNum) {
          patchset = String(changeEl._patchRange.patchNum);
        }
        // Try latestPatchNum properties
        else if (changeEl.latestPatchNum || changeEl._latestPatchNum) {
          patchset = String(changeEl.latestPatchNum || changeEl._latestPatchNum || '');
        }
        // Try _allPatchSets to get the latest patchset number
        else if (changeEl._allPatchSets && Array.isArray(changeEl._allPatchSets) && changeEl._allPatchSets.length > 0) {
          try {
            const patchNums = changeEl._allPatchSets
              .map(ps => ps && (ps.number || ps._number))
              .filter(n => typeof n === 'number');
            if (patchNums.length) patchset = String(Math.max.apply(null, patchNums));
          } catch (_) {}
        }
        // Try _currentRevision for patchset number
        else if (changeEl._currentRevision) {
          const currRev = changeEl._currentRevision;
          if (currRev._number) patchset = String(currRev._number);
          else if (currRev.number) patchset = String(currRev.number);
        }
        // Try currentRevision as patchset number (if it's a number, not a commit hash)
        else if (currentRevision && typeof currentRevision === 'number') {
          patchset = String(currentRevision);
        }
        // Try to get from viewState
        else if (changeEl.viewState && changeEl.viewState.change) {
          const viewChange = changeEl.viewState.change;
          if (viewChange.revisions) {
            try {
              const nums = Object.values(viewChange.revisions)
                .map(r => r && r._number)
                .filter(n => typeof n === 'number');
              if (nums.length) patchset = String(Math.max.apply(null, nums));
            } catch (_) {}
          }
        }
      }
    }
    // Always try to extract from URL as a fallback
    const path = (location && location.pathname) || '';
    let m = path.match(/^\/c\/([^/]+)\/\+\/(\d+)(?:\/(\d+))?/);
    if (m) {
      if (!project) project = decodeURIComponent(m[1]);
      if (!changeNum) changeNum = String(m[2] || '');
      // Use URL patchset if we don't have one yet
      if (!patchset && m[3]) patchset = String(m[3]);
    }

    // Ensure changeNum is always a string (convert number to string if needed)
    changeNum = changeNum ? String(changeNum) : '';

    // Ensure patchset is always a string
    patchset = patchset ? String(patchset) : '';

    // Final fallback: if we have a change number but no patchset, default to 1
    // (every change has at least patchset 1)
    // Only do this as a last resort - the retry logic should wait for the real value
    // Check explicitly: changeNum must be non-empty string, patchset must be empty string
    if (changeNum && changeNum.length > 0 && (!patchset || patchset.length === 0)) {
      patchset = '1';
      console.warn('[coder-workspace] No patchset found after all extraction attempts, defaulting to patchset 1 for change', changeNum);
    }

    // Debug logging to help diagnose context extraction issues
    const debugInfo = {
      repo: project,
      branch: branch,
      change: changeNum,
      patchset: patchset,
      url: location.href
    };
    // Add detailed debug info if patchset is missing
    if (!patchset && changeEl) {
      try {
        debugInfo.debug = {
          hasChangeEl: !!changeEl,
          patchRange: changeEl.patchRange ? {patchNum: changeEl.patchRange.patchNum} : null,
          _patchRange: changeEl._patchRange ? {patchNum: changeEl._patchRange.patchNum} : null,
          latestPatchNum: changeEl.latestPatchNum,
          _latestPatchNum: changeEl._latestPatchNum,
          currentRevision: currentRevision,
          _currentRevision: changeEl._currentRevision ? {_number: changeEl._currentRevision._number, number: changeEl._currentRevision.number} : null,
          _allPatchSets: changeEl._allPatchSets ? changeEl._allPatchSets.length : null,
          changeRevisions: change && change.revisions ? Object.keys(change.revisions).length : null
        };
      } catch (e) {
        debugInfo.debugError = String(e);
      }
    }
    console.log('[coder-workspace] Change context extracted:', debugInfo);

    const origin = window.location.origin;
    const url = `${origin}/c/${encodeURIComponent(project)}/+/${changeNum}` + (patchset ? `/${patchset}` : '');
    const branchShort = branch ? String(branch).split('/').pop() : '';

    // Construct SSH URL for git repository (default port 29418)
    let sshUrl = '';
    try {
      const urlObj = new URL(origin);
      const hostname = urlObj.hostname;
      // Default SSH port for Gerrit is 29418
      sshUrl = `ssh://${hostname}:29418/${project}`;
    } catch (_) {
      // Fallback if URL parsing fails
      sshUrl = `ssh://${origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '')}:29418/${project}`;
    }

    // Construct change ref: refs/changes/X/Y/Z where X=last 2 digits, Y=full change number, Z=patchset
    let changeRef = '';
    if (changeNum && patchset) {
      const changeNumStr = String(changeNum);
      const lastTwoDigits = changeNumStr.length >= 2 ? changeNumStr.slice(-2) : changeNumStr.padStart(2, '0');
      changeRef = `refs/changes/${lastTwoDigits}/${changeNumStr}/${patchset}`;
    }

    return {
      repo: project,
      branch,
      branchShort,
      change: String(changeNum || ''),
      patchset: String(patchset || ''),
      url,
      gitSshUrl: sshUrl,
      changeRef: changeRef
    };
  }

  async function getChangeContextWithRetry(maxWaitMs = 5000, intervalMs = 100) {
    const start = Date.now();
    let ctx = await getChangeContextFromPage();
    let attempts = 0;
    const maxAttempts = Math.floor(maxWaitMs / intervalMs);

    // Wait for both branch and patchset to be populated
    // Give the UI time to fully load the change data
    while ((!ctx.branch || !ctx.patchset) && (Date.now() - start) < maxWaitMs && attempts < maxAttempts) {
      attempts++;
      await new Promise(r => setTimeout(r, intervalMs));
      ctx = await getChangeContextFromPage();
      // If we have both branch and patchset, we're done
      if (ctx.branch && ctx.patchset) break;
    }

    // Log if we still don't have patchset after retries
    if (!ctx.patchset && ctx.change) {
      console.warn('[coder-workspace] Patchset still not found after', attempts, 'attempts, will default to 1');
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
    const name = renderNameTemplate(
      picked.workspaceNameTemplate || config.workspaceNameTemplate || '{repo}-{change}-{patchset}',
      context
    );
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
      url = resolveCoderUrl(`/api/v2/organizations/${encodeURIComponent(config.organization)}/members/me/workspaces`);
    } else {
      url = resolveCoderUrl(`/api/v2/users/me/workspaces`);
    }

    try {
      const res = await fetchWithAuth(url, {method: 'POST', headers, body: JSON.stringify(requestBody)});
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
    const userSeg = 'me';
    const nameSeg = encodeURIComponent(workspaceName);

    // Try multiple API shapes for robustness and org support
    const candidates = [];
    // Per Coder API docs, the supported by-name endpoint is singular:
    // GET /api/v2/users/{user}/workspace/{workspacename}
    candidates.push(`${base}/api/v2/users/${userSeg}/workspace/${nameSeg}`);

    try {
      // Try each endpoint variant until one succeeds or all 404
      let lastStatus = 0;
      for (const url of candidates) {
        try {
          const r = await fetchWithAuth(url, { method: 'GET', headers });
          lastStatus = r.status;
          if (r.status === 404) {
            continue; // try next variant
          }
          if (!r.ok) {
            const text = await r.text().catch(() => '');
            console.warn(`[coder-workspace] GET workspace by name failed: ${r.status} ${text} at ${url}`);
            continue;
          }
          return await r.json();
        } catch (e) {
          console.warn(`[coder-workspace] GET workspace by name error at ${url}:`, e);
        }
      }
      if (lastStatus === 404) {
        // Fallback 1: use list API(s) with owner+name query, then filter exact match
        const ownerToken = '';
        const qParts = [];
        if (ownerToken) qParts.push(ownerToken);
        qParts.push(`name:${workspaceName}`);
        const q1 = qParts.join(' ');
        const listCandidates1 = [];
        // Organization-scoped list routes may not exist on all installs; prefer global list first
        listCandidates1.push(`${base}/api/v2/workspaces?q=${encodeURIComponent(q1)}&limit=10`);
        if (config.organization) listCandidates1.push(`${base}/api/v2/organizations/${encodeURIComponent(config.organization)}/workspaces?q=${encodeURIComponent(q1)}&limit=10`);
        for (const listUrl1 of listCandidates1) {
          try {
            const listRes1 = await fetchWithAuth(listUrl1, { method: 'GET', headers });
            if (listRes1.ok) {
              const payload1 = await listRes1.json().catch(() => null);
              const items1 = payload1 && (Array.isArray(payload1.workspaces) ? payload1.workspaces : Array.isArray(payload1) ? payload1 : []);
              // Prefer exact owner match if available, else any name match
              let hit = null;
              if (Array.isArray(items1) && items1.length) {
                hit = items1.find(w => w && w.name === workspaceName)
                   || items1.find(w => w && w.name === workspaceName) || null;
              }
              if (hit) return hit;
            }
          } catch (e) {
            console.warn('[coder-workspace] Fallback list+filter lookup (owner+name) failed:', e);
          }
        }

        // Fallback 2: name-only search across visible workspaces (org then global)
        const q2 = `name:${workspaceName}`;
        const listCandidates2 = [];
        listCandidates2.push(`${base}/api/v2/workspaces?q=${encodeURIComponent(q2)}&limit=10`);
        if (config.organization) listCandidates2.push(`${base}/api/v2/organizations/${encodeURIComponent(config.organization)}/workspaces?q=${encodeURIComponent(q2)}&limit=10`);
        for (const listUrl2 of listCandidates2) {
          try {
            const listRes2 = await fetchWithAuth(listUrl2, { method: 'GET', headers });
            if (listRes2.ok) {
              const payload2 = await listRes2.json().catch(() => null);
              const items2 = payload2 && (Array.isArray(payload2.workspaces) ? payload2.workspaces : Array.isArray(payload2) ? payload2 : []);
              const hit2 = Array.isArray(items2) ? items2.find(w => w && w.name === workspaceName) : null;
              if (hit2) return hit2;
            }
          } catch (e) {
            console.warn('[coder-workspace] Fallback list+filter lookup (name only) failed:', e);
          }
        }
        return null;
      }
      // If we ended with a non-404 error and none succeeded, give up gracefully
      return null;
    } catch (error) {
      console.warn(`[coder-workspace] GET workspace by name unexpected error:`, error);
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
    const ownerQ = 'owner:me';
    const candidates = [];
    if (config.organization) candidates.push(`${base}/api/v2/organizations/${encodeURIComponent(config.organization)}/workspaces?q=${encodeURIComponent(ownerQ)}&limit=${encodeURIComponent(String(limit))}`);
    candidates.push(`${base}/api/v2/workspaces?q=${encodeURIComponent(ownerQ)}&limit=${encodeURIComponent(String(limit))}`);
    for (const url of candidates) {
      try {
        const res = await fetchWithAuth(url, { method: 'GET', headers });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.warn(`[coder-workspace] LIST workspaces failed: ${res.status} ${text}`);
          continue;
        }
        const payload = await res.json().catch(() => null);
        const items = payload && (Array.isArray(payload.workspaces) ? payload.workspaces : Array.isArray(payload) ? payload : []);
        if (Array.isArray(items)) return items;
      } catch (e) {
        console.warn('[coder-workspace] LIST workspaces error:', e);
      }
    }
    return [];
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
    const final = config.appendTokenToAppUrl ? withAuthUrl(wsUrl) : wsUrl;
    console.log('[coder-workspace] Opening workspace URL:', final);
    window.open(final, '_blank', 'noopener');
  }

  function computeWorkspaceUrl(workspace) {
    const appUri = workspace && workspace.latest_app_status && workspace.latest_app_status.uri;
    const baseUrl = `/@${encodeURIComponent(workspace.owner_name || '')}/${encodeURIComponent(workspace.name)}`;
    return appUri || resolveCoderUrl(baseUrl + (config.appSlug ? `/apps/${encodeURIComponent(config.appSlug)}/` : ''));
  }

  // Navigate by opening the final URL only when ready (no placeholder tab)
  function openFinalUrl(url) {
    const final = config.appendTokenToAppUrl ? withAuthUrl(url) : url;
    console.log('[coder-workspace] Navigating to URL:', final);
    try {
      const w = window.open(final, '_blank', 'noopener');
      if (w && !w.closed) return true;
    } catch (_) {
      // ignore and attempt fallback
    }
    // If blocked or null/undefined, fall back to same-tab navigation if enabled
    if (config.navigateInSameTabOnBlock) {
      try {
        // Lightweight toast without requiring plugin instance
        try {
          const el = document.createElement('gr-alert');
          el.text = 'Opening in this tab due to popup blocker';
          document.body.appendChild(el);
          setTimeout(() => { try { el.remove(); } catch(_){} }, 4000);
        } catch (_) {}
        window.location.assign(final);
        return true;
      } catch (_) { /* fall through */ }
    }
    return false;
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
    // Resolve the workspace first, then try multiple delete routes for compatibility
    const headers = {'Accept': 'application/json'};
    if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;
    const base = (config.serverUrl || '').replace(/\/$/, '');
    try {
      const ws = await getWorkspaceByName(workspaceName);
      if (!ws || !ws.id) {
        throw new Error('Workspace not found or missing ID');
      }

      // Build a list of candidate deletion requests (method + url + optional body)
      const owner = ws.owner_name || 'me';
      const candidates = [];
      // Primary: DELETE by id
      candidates.push({ method: 'DELETE', url: `${base}/api/v2/workspaces/${encodeURIComponent(ws.id)}` });
      // Variants with hard/force flags used by some deployments
      candidates.push({ method: 'DELETE', url: `${base}/api/v2/workspaces/${encodeURIComponent(ws.id)}?hard=true` });
      candidates.push({ method: 'DELETE', url: `${base}/api/v2/workspaces/${encodeURIComponent(ws.id)}?force=true` });
      candidates.push({ method: 'DELETE', url: `${base}/api/v2/workspaces/${encodeURIComponent(ws.id)}?hard=true&force=true` });
      // Fallback A: DELETE by name under user scope (singular path)
      candidates.push({ method: 'DELETE', url: `${base}/api/v2/users/${encodeURIComponent(owner)}/workspace/${encodeURIComponent(ws.name)}` });
      // Fallback B: DELETE by name under user scope (plural path)
      candidates.push({ method: 'DELETE', url: `${base}/api/v2/users/${encodeURIComponent(owner)}/workspaces/${encodeURIComponent(ws.name)}` });
      // Fallback C: org-scoped delete by name (singular path)
      if (config.organization) {
        candidates.push({ method: 'DELETE', url: `${base}/api/v2/organizations/${encodeURIComponent(config.organization)}/members/${encodeURIComponent(owner)}/workspace/${encodeURIComponent(ws.name)}` });
        // Fallback D: org-scoped delete by name (plural path)
        candidates.push({ method: 'DELETE', url: `${base}/api/v2/organizations/${encodeURIComponent(config.organization)}/members/${encodeURIComponent(owner)}/workspaces/${encodeURIComponent(ws.name)}` });
      }
      // Fallback E: Global delete by name (non-scoped)
      candidates.push({ method: 'DELETE', url: `${base}/api/v2/workspaces/${encodeURIComponent(ws.name)}` });
      // Fallback F: POST action endpoint pattern used by some older proxies (with optional hard flag)
      candidates.push({ method: 'POST', url: `${base}/api/v2/workspaces/${encodeURIComponent(ws.id)}/delete` });
      candidates.push({ method: 'POST', url: `${base}/api/v2/workspaces/${encodeURIComponent(ws.id)}/delete?hard=true` });

      let lastErrorText = '';
      for (const c of candidates) {
        try {
          const h = Object.assign({}, headers, c.headers || {});
          const res = await fetchWithAuth(c.url, { method: c.method, headers: h, body: c.body });
          if (res.ok) return 'hard'; // success via hard delete
          const text = await res.text().catch(() => '');
          lastErrorText = `${res.status} ${text}`;
          // Log but continue to next candidate on 404/405/400
          if (res.status === 404 || res.status === 405 || res.status === 400) {
            console.warn(`[coder-workspace] DELETE candidate failed (${c.method} ${c.url}): ${lastErrorText}`);
            continue;
          }
          // For other errors, stop early
          console.error(`[coder-workspace] DELETE workspace failed: ${lastErrorText}`);
          throw new Error(`Coder API error ${res.status}: ${text}`);
        } catch (e) {
          // Network or fetch-level error; try next candidate
          console.warn('[coder-workspace] DELETE candidate error; trying next', e);
          continue;
        }
      }
      // If all direct delete routes failed, try softer decommission fallbacks:
      // 1) Mark dormant, 2) Reduce TTL. Attempt both regardless of individual failures.
      const jsonHeaders = Object.assign({}, headers, { 'Content-Type': 'application/json' });
      let softSucceeded = false;
      try {
        const dormantUrl = `${base}/api/v2/workspaces/${encodeURIComponent(ws.id)}/dormant`;
        const dormantRes = await fetchWithAuth(dormantUrl, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ dormant: true }) });
        if (!dormantRes.ok) {
          const t = await dormantRes.text().catch(() => '');
          console.warn('[coder-workspace] Dormant fallback failed:', dormantRes.status, t);
        } else {
          softSucceeded = true;
        }
      } catch (e) {
        console.warn('[coder-workspace] Dormant fallback error:', e);
      }
      try {
        const ttlUrl = `${base}/api/v2/workspaces/${encodeURIComponent(ws.id)}/ttl`;
        // Use 60 seconds to satisfy minimums enforced by some deployments
        const ttlRes = await fetchWithAuth(ttlUrl, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ ttl_ms: 60000 }) });
        if (!ttlRes.ok) {
          const t = await ttlRes.text().catch(() => '');
          console.warn('[coder-workspace] TTL fallback failed:', ttlRes.status, t);
        } else {
          softSucceeded = true;
        }
      } catch (e) {
        console.warn('[coder-workspace] TTL fallback error:', e);
      }
      if (softSucceeded) {
        console.warn('[coder-workspace] Soft decommission applied (dormant/ttl). Workspace will auto-expire shortly.');
        return 'soft';
      }
      throw new Error(`Unable to delete workspace via available routes: ${lastErrorText || 'no route'}`);
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
        // Wrap in try-catch to handle case where element isn't ready yet (Gerrit 3.4+)
        let openLastKey;
        try {
          openLastKey = changeActions.add('revision', OPEN_LAST_ACTION_LABEL);
        } catch (e) {
          // Element not ready yet, retry later
          // Check for TypeError about undefined addActionButton (Gerrit 3.4+ compatibility)
          const errorStr = (e && e.message ? e.message : String(e || ''));
          const errorName = (e && e.name ? e.name : '');
          if (errorStr.includes('addActionButton') ||
              errorStr.includes('Cannot read properties of undefined') ||
              errorStr.includes('reading \'addActionButton\'') ||
              (errorName === 'TypeError' && errorStr.includes('undefined'))) {
            return false;
          }
          throw e;
        }
        if (!openLastKey) return false;

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
              // Verify the saved workspace still exists; clear stale state if not
              try {
                if (currentMeta.workspaceName) {
                  const ws = await getWorkspaceByNameImpl(currentMeta.workspaceName);
                  if (ws) {
                    notify(plugin, `Opening Coder workspace for ${ctx.repo} @ ${ctx.branch}`);
                    openFinalUrl(currentUrl);
                    return;
                  }
                }
                console.warn('[coder-workspace] Saved workspace not found anymore; clearing cached state');
                clearCurrentWorkspace();
              } catch (_verr) {
                console.warn('[coder-workspace] Failed to verify saved workspace; clearing cached state');
                clearCurrentWorkspace();
              }
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
                  // Optional readiness wait before opening
                  if (config.waitForAppReadyMs > 0 && !(ws.latest_app_status && ws.latest_app_status.uri)) {
                    notify(plugin, `Waiting for Coder workspace app to be ready…`);
                    try {
                      const ready = await waitForWorkspaceApp(ws.name, config.waitForAppReadyMs, config.waitPollIntervalMs, ws) || ws;
                      const urlToOpen = computeWorkspaceUrl(ready || ws);
                      saveCurrentWorkspace(urlToOpen, baseMeta);
                      openFinalUrl(urlToOpen);
                    } catch (_) {
                      openFinalUrl(initialUrl);
                    }
                  } else {
                    openFinalUrl(initialUrl);
                  }
                  if (config.waitForAppReadyMs > 0 && !(ws.latest_app_status && ws.latest_app_status.uri)) {
                    // readiness handled above before opening
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
                      // Wait for readiness (optional) then open
                      if (config.waitForAppReadyMs > 0 && !(existing.latest_app_status && existing.latest_app_status.uri)) {
                        notify(plugin, `Waiting for Coder workspace app to be ready…`);
                        try {
                          const ready = await waitForWorkspaceApp(existing.name, config.waitForAppReadyMs, config.waitPollIntervalMs, existing) || existing;
                          const urlToOpen = computeWorkspaceUrl(ready || existing);
                          saveCurrentWorkspace(urlToOpen, baseMeta);
                          openFinalUrl(urlToOpen);
                        } catch (_) { openFinalUrl(url); }
                      } else {
                        openFinalUrl(url);
                      }
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
                    if (config.waitForAppReadyMs > 0 && !(existing.latest_app_status && existing.latest_app_status.uri)) {
                      notify(plugin, `Waiting for Coder workspace app to be ready…`);
                      try {
                        const ready = await waitForWorkspaceApp(existing.name, config.waitForAppReadyMs, config.waitPollIntervalMs, existing) || existing;
                        const urlToOpen = computeWorkspaceUrl(ready || existing);
                        saveCurrentWorkspace(urlToOpen, baseMeta);
                        openFinalUrl(urlToOpen);
                      } catch (_) { openFinalUrl(initialUrl); }
                    } else {
                      openFinalUrl(initialUrl);
                    }

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
                    if (config.waitForAppReadyMs > 0 && !(prefMatch.latest_app_status && prefMatch.latest_app_status.uri)) {
                      notify(plugin, `Waiting for Coder workspace app to be ready…`);
                      try {
                        const ready = await waitForWorkspaceApp(prefMatch.name, config.waitForAppReadyMs, config.waitPollIntervalMs, prefMatch) || prefMatch;
                        const urlToOpen = computeWorkspaceUrl(ready || prefMatch);
                        saveCurrentWorkspace(urlToOpen, baseMeta);
                        openFinalUrl(urlToOpen);
                      } catch (_) { openFinalUrl(initialUrl); }
                    } else {
                      openFinalUrl(initialUrl);
                    }
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
              const baseMeta = {repo: ctx.repo, branch: ctx.branch, change: ctx.change, patchset: ctx.patchset, workspaceName: ws && ws.name, workspaceOwner: ws && ws.owner_name};
              const initialUrl = computeWorkspaceUrl(ws);
              notify(plugin, `Coder workspace created: ${ws.name}`);
              saveCurrentWorkspace(initialUrl, baseMeta);
              if (config.waitForAppReadyMs > 0 && !(ws.latest_app_status && ws.latest_app_status.uri)) {
                notify(plugin, `Waiting for Coder workspace app to be ready…`);
                try {
                  const ready = await waitForWorkspaceApp(ws.name, config.waitForAppReadyMs, config.waitPollIntervalMs, ws) || ws;
                  const urlToOpen = computeWorkspaceUrl(ready || ws);
                  saveCurrentWorkspace(urlToOpen, baseMeta);
                  openFinalUrl(urlToOpen);
                } catch (_) { openFinalUrl(initialUrl); }
              } else {
                openFinalUrl(initialUrl);
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
                    if (config.waitForAppReadyMs > 0 && !(existing.latest_app_status && existing.latest_app_status.uri)) {
                      notify(plugin, `Waiting for Coder workspace app to be ready…`);
                      try {
                        const ready = await waitForWorkspaceApp(existing.name, config.waitForAppReadyMs, config.waitPollIntervalMs, existing) || existing;
                        const urlToOpen = computeWorkspaceUrl(ready || existing);
                        saveCurrentWorkspace(urlToOpen, baseMeta);
                        openFinalUrl(urlToOpen);
                      } catch (_) { openFinalUrl(initialUrl); }
                    } else {
                      openFinalUrl(initialUrl);
                    }
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
                  if (config.waitForAppReadyMs > 0 && !(existing.latest_app_status && existing.latest_app_status.uri)) {
                    try {
                      const ready = await waitForWorkspaceApp(existing.name, config.waitForAppReadyMs, config.waitPollIntervalMs, existing) || existing;
                      const urlToOpen = computeWorkspaceUrl(ready || existing);
                      saveCurrentWorkspace(urlToOpen, baseMeta);
                      openFinalUrl(urlToOpen);
                    } catch (_) { openFinalUrl(initialUrl); }
                  } else {
                    openFinalUrl(initialUrl);
                  }

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
                  if (config.waitForAppReadyMs > 0 && !(ws2.latest_app_status && ws2.latest_app_status.uri)) {
                    notify(plugin, `Waiting for Coder workspace app to be ready…`);
                    try {
                      const ready2 = await waitForWorkspaceApp(ws2.name, config.waitForAppReadyMs, config.waitPollIntervalMs, ws2) || ws2;
                      const urlToOpen2 = computeWorkspaceUrl(ready2 || ws2);
                      saveCurrentWorkspace(urlToOpen2, baseMeta2);
                      openFinalUrl(urlToOpen2);
                    } catch (_) { openFinalUrl(initialUrl2); }
                  } else {
                    openFinalUrl(initialUrl2);
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
        // Wrap in try-catch to handle case where element isn't ready yet (Gerrit 3.4+)
        let deleteKey;
        try {
          deleteKey = changeActions.add('revision', DELETE_ACTION_LABEL);
        } catch (e) {
          // Element not ready yet, retry later
          // Check for TypeError about undefined addActionButton (Gerrit 3.4+ compatibility)
          const errorStr = (e && e.message ? e.message : String(e || ''));
          const errorName = (e && e.name ? e.name : '');
          if (errorStr.includes('addActionButton') ||
              errorStr.includes('Cannot read properties of undefined') ||
              errorStr.includes('reading \'addActionButton\'') ||
              (errorName === 'TypeError' && errorStr.includes('undefined'))) {
            return false;
          }
          throw e;
        }
        if (!deleteKey) return false;

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

            const ctx = await getChangeContextFromPage();
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
            const ok = window.confirm(`Delete Coder workspace "${name}"?`);
            if (!ok) return;

            const kind = await deleteWorkspaceByName(name);
            if (kind === 'soft') {
              notify(plugin, 'Coder workspace scheduled to stop and expire in ~1 minute. It may remain visible briefly.');
              // Optional: background check after 75s to inform user
              setTimeout(async () => {
                try {
                  const w = await getWorkspaceByNameImpl(name);
                  if (!w) {
                    notify(plugin, 'Coder workspace has been removed.');
                  }
                } catch (_) { /* ignore */ }
              }, 75000);
            } else {
              notify(plugin, 'Coder workspace deleted');
            }
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
      ? `/api/v2/organizations/${encodeURIComponent(config.organization)}/members/me/workspaces`
      : `/api/v2/users/me/workspaces`;
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
    const allowedFrom = new Set(['repo','branch','change','patchset','url','gitHttpUrl','gitSshUrl','changeRef']);
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
        withAuthUrl: (u) => withAuthUrl(u),
        openFinalUrl: (u) => openFinalUrl(u),
        waitForWorkspaceApp: (name, timeoutMs, intervalMs, initialWs) => waitForWorkspaceApp(name, timeoutMs, intervalMs, initialWs),
        generateUniqueName,
        buildCreateRequest: (ctx) => buildCreateRequest(ctx),
        createWorkspaceStrict: (body) => createWorkspaceStrict(body),
        getChangeContextFromPage: () => getChangeContextFromPage(),
        // Expose direct lookup for unit tests
        getWorkspaceByName: (n) => getWorkspaceByName(n),
        deleteWorkspaceByName: (n) => deleteWorkspaceByName(n),
        setGetWorkspaceByName: (fn) => { getWorkspaceByNameImpl = fn || getWorkspaceByName; },
        setConfig: (patch) => { try { Object.assign(config, patch || {}); } catch(_){} },
      };
    }
  } catch (_) {}
})();
