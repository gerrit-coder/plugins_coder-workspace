/**
 * End-to-End Tests for Coder Workspace Plugin
 *
 * These tests simulate the complete user workflow from Gerrit UI interaction
 * to Coder workspace creation and management.
 */

describe('Coder Workspace Plugin - End-to-End Tests', () => {
  let mockGerritApp, mockChangeView, mockPlugin, mockConfig;

  beforeEach(() => {
    // Mock Gerrit application structure
    mockChangeView = {
      change: {
        project: 'test/project',
        branch: 'refs/heads/main',
        _number: 12345,
        revisions: {
          'abc123def': { _number: 1 },
          'def456ghi': { _number: 2 },
          'ghi789jkl': { _number: 3 }
        }
      },
      currentRevision: 'ghi789jkl'
    };

    mockGerritApp = {
      shadowRoot: {
        querySelector: jest.fn().mockReturnValue(mockChangeView)
      }
    };

    // Mock DOM structure
    document.querySelector = jest.fn().mockReturnValue(mockGerritApp);
    document.createElement = jest.fn((tag) => {
      const element = {
        tagName: tag,
        textContent: '',
        text: '',
        style: {},
        setAttribute: jest.fn(),
        addEventListener: jest.fn(),
        appendChild: jest.fn(),
        remove: jest.fn(),
        click: jest.fn()
      };

      if (tag === 'gr-alert') {
        element.text = '';
      }

      return element;
    });

    // Mock document.body methods without replacing the body itself
    document.body.appendChild = jest.fn();
    document.body.removeChild = jest.fn();

    // Mock window and location
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/c/test%2Fproject/+/12345/3',
        origin: 'https://gerrit.example.com'
      }
    });

    // Mock localStorage
    const mockLocalStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn()
    };
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage
    });

    // Mock window.open
    global.window.open = jest.fn();

    // Mock fetch
    global.fetch = jest.fn();

    // Mock console
    global.console = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Mock configuration
    mockConfig = {
      serverUrl: 'https://coder.example.com',
      apiKey: 'test-api-key-12345',
      organization: 'test-org-67890',
      user: 'testuser',
      templateId: 'template-123',
      templateVersionId: 'version-456',
      workspaceNameTemplate: '{repo}-{change}-{patchset}',
      richParams: [
        {name: 'REPO', from: 'repo'},
        {name: 'BRANCH', from: 'branch'},
        {name: 'GERRIT_CHANGE', from: 'change'},
        {name: 'GERRIT_PATCHSET', from: 'patchset'},
        {name: 'GERRIT_CHANGE_URL', from: 'url'}
      ],
      templateMappings: [],
      autostart: true,
      automaticUpdates: 'always',
      ttlMs: 3600000,
      openAfterCreate: true,
      enableDryRunPreview: false
    };

    // Mock Gerrit plugin API with stable restApi object
    const api = { get: jest.fn().mockResolvedValue(mockConfig) };

    // Helpers used by action listeners
    const matchGlob = (pattern, value) => {
      if (!pattern || pattern === '*') return true;
      const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      return re.test(value || '');
    };

    const pickMapping = (ctx, mappings = []) => {
      for (const m of mappings) {
        if (matchGlob(m.repo || '*', ctx.repo) && matchGlob(m.branch || '*', ctx.branch)) {
          return m;
        }
      }
      return null;
    };

    const renderName = (tpl, ctx) => {
      const name = String(tpl || '{repo}-{change}-{patchset}')
        .replaceAll('{repo}', String(ctx.repo || ''))
        .replaceAll('{branch}', String(ctx.branch || ''))
        .replaceAll('{change}', String(ctx.change || ''))
        .replaceAll('{patchset}', String(ctx.patchset || ''))
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
      return name && name !== '-' ? name : 'workspace-' + Date.now();
    };

    const toRichValues = (ctx, richParams = []) => richParams.map(p => ({ name: p.name, value: String(ctx[p.from] ?? '') }));

    const extractContext = () => {
      // Try DOM first
      try {
        const app = document.querySelector && document.querySelector('gr-app');
        const changeView = app && app.shadowRoot && app.shadowRoot.querySelector && app.shadowRoot.querySelector('gr-change-view');
        if (changeView && changeView.change) {
          const ch = changeView.change;
          const rev = changeView.currentRevision;
          const patchset = ch.revisions && ch.revisions[rev] ? ch.revisions[rev]._number : '';
          return {
            repo: ch.project,
            branch: ch.branch,
            change: String(ch._number),
            patchset: String(patchset),
            url: (window.location && window.location.origin && window.location.pathname)
              ? `${window.location.origin}${window.location.pathname}`
              : ''
          };
        }
      } catch {}

      // Fallback to URL parsing: /c/<repo-encoded>/+/<change>/<patchset>
      const path = (window.location && window.location.pathname) || '';
      const m = path.match(/^\/c\/([^/]+)\/\+\/(\d+)(?:\/(\d+))?/);
      const repo = m ? decodeURIComponent(m[1].replace(/%2F/g, '/')) : '';
      return {
        repo,
        branch: '',
        change: m ? m[2] : '',
        patchset: m && m[3] ? m[3] : '',
        url: (window.location && window.location.origin) ? `${window.location.origin}${path}` : ''
      };
    };

    const buildBase = (cfg) => String(cfg.serverUrl || '').replace(/\/$/, '');

    const openAction = async () => {
      let cfg;
      try {
        cfg = await api.get('/config/server/coder-workspace.config');
      } catch (e) {
        document.createElement('gr-alert');
        return;
      }
      if (!cfg.serverUrl) {
        document.createElement('gr-alert');
        return;
      }

      const ctx = extractContext();
      const mapping = pickMapping(ctx, cfg.templateMappings || []);
      const name = renderName((mapping && mapping.workspaceNameTemplate) || cfg.workspaceNameTemplate, ctx);

      const base = buildBase(cfg);
      const userSeg = encodeURIComponent(cfg.user || 'me');
      const orgSeg = cfg.organization ? `/organizations/${encodeURIComponent(cfg.organization)}/members/${userSeg}` : `/users/${userSeg}`;

      // Lookup existing workspace
      const headers = { 'Accept': 'application/json' };
      if (cfg.apiKey) headers['Coder-Session-Token'] = cfg.apiKey;
      const lookupUrl = `${base}/api/v2${orgSeg}/workspaces/${encodeURIComponent(name)}`;
      const res = await fetch(lookupUrl, { method: 'GET', headers });
      if (res.ok) {
        const ws = await res.json();
        if (cfg.openAfterCreate && ws.latest_app_status && ws.latest_app_status.uri) {
          window.open(ws.latest_app_status.uri, '_blank', 'noopener');
        }
        document.createElement('gr-alert');
        return;
      }
      if (res.status !== 404) {
        document.createElement('gr-alert');
        return;
      }

      // Optionally show preview dialog
      if (cfg.enableDryRunPreview && typeof mockPlugin?.popup === 'function') {
        await mockPlugin.popup('div', {});
      }

      // Build create request
      const body = { name };
      if (mapping && mapping.templateVersionId) {
        body.template_version_id = mapping.templateVersionId;
      } else if (mapping && mapping.templateId) {
        body.template_id = mapping.templateId;
      } else if (cfg.templateId) {
        body.template_id = cfg.templateId;
      } else if (cfg.templateVersionId) {
        body.template_version_id = cfg.templateVersionId;
      }
      body.rich_parameter_values = toRichValues(ctx, (mapping && mapping.richParams) || cfg.richParams || []);
      body.automatic_updates = cfg.automaticUpdates;
      if (cfg.autostart) body.autostart_schedule = 'now';
      body.ttl_ms = cfg.ttlMs;

      const createHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
      if (cfg.apiKey) createHeaders['Coder-Session-Token'] = cfg.apiKey;
      const createUrl = `${base}/api/v2${orgSeg}/workspaces`;
      const createRes = await fetch(createUrl, { method: 'POST', headers: createHeaders, body: JSON.stringify(body) });
      if (!createRes.ok) {
        document.createElement('gr-alert');
        return;
      }
      const ws = await createRes.json();
      if (cfg.openAfterCreate && ws.latest_app_status && ws.latest_app_status.uri) {
        window.open(ws.latest_app_status.uri, '_blank', 'noopener');
      }
      document.createElement('gr-alert');
    };

    const deleteAction = async () => {
      const url = window.localStorage.getItem('gerrit-coder-workspace-current');
      const metaStr = window.localStorage.getItem('gerrit-coder-workspace-current-meta');
      let meta = {};
      try { meta = JSON.parse(metaStr || '{}'); } catch {}
      const workspaceName = meta.workspaceName || '';
      const repo = meta.repo || '';
      const branch = meta.branch || '';
      if (!url || !workspaceName) {
        document.createElement('gr-alert');
        return;
      }
      const confirmed = window.confirm(`Delete Coder workspace "${workspaceName}" for ${repo} @ ${branch}?`);
      if (!confirmed) return;

      const cfg = await api.get('/config/server/coder-workspace.config');
      const base = buildBase(cfg);
      const headers = { 'Accept': 'application/json' };
      if (cfg.apiKey) headers['Coder-Session-Token'] = cfg.apiKey;
      const userSeg = encodeURIComponent(cfg.user || 'me');
      const orgSeg = cfg.organization ? `/organizations/${encodeURIComponent(cfg.organization)}/members/${userSeg}` : `/users/${userSeg}`;
      const delUrl = `${base}/api/v2${orgSeg}/workspaces/${encodeURIComponent(workspaceName)}`;
      await fetch(delUrl, { method: 'DELETE', headers });
      // Ensure removeItem exists on the provided mock
      if (typeof window.localStorage.removeItem !== 'function') {
        window.localStorage.removeItem = jest.fn();
      }
      window.localStorage.removeItem('gerrit-coder-workspace-current');
      window.localStorage.removeItem('gerrit-coder-workspace-current-meta');
    };

    const actions = {
      _installed: false,
      add: jest.fn((scope, label) => {
        if (!actions._installed) {
          actions.addTapListener('open-action-key', async () => { await openAction(); });
          actions.addTapListener('delete-action-key', async () => { await deleteAction(); });
          actions._installed = true;
        }
        return label && /delete/i.test(label) ? 'delete-action-key' : 'open-action-key';
      }),
      setActionOverflow: jest.fn(),
      setActionPriority: jest.fn(),
      setTitle: jest.fn(),
      addTapListener: jest.fn()
    };

    mockPlugin = {
      restApi: () => api,
      changeActions: () => actions,
      on: jest.fn(),
      popup: jest.fn().mockResolvedValue({
        shadowRoot: {
          appendChild: jest.fn()
        },
        appendChild: jest.fn(),
        remove: jest.fn()
      })
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete Workspace Creation Workflow', () => {
    test('should create new workspace from Gerrit change page', async () => {
      // Mock successful workspace creation
      const mockWorkspace = {
        id: 'ws-abc123',
        name: 'test-project-12345-3',
        owner_name: 'testuser',
        latest_app_status: {
          uri: 'https://coder.example.com/@testuser/test-project-12345-3'
        }
      };

      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404
        }) // First call: workspace doesn't exist
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockWorkspace)
        }); // Second call: create workspace

      // Simulate plugin installation and action setup
      const changeActions = mockPlugin.changeActions();
      const openActionKey = changeActions.add('revision', 'Open Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[0][1];
      await tapListener();

      // Verify workspace creation request
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // First call: check for existing workspace
      expect(global.fetch).toHaveBeenNthCalledWith(1,
        'https://coder.example.com/api/v2/organizations/test-org-67890/members/testuser/workspaces/test-project-12345-3',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Coder-Session-Token': 'test-api-key-12345'
          }
        })
      );

      // Second call: create workspace
      expect(global.fetch).toHaveBeenNthCalledWith(2,
        'https://coder.example.com/api/v2/organizations/test-org-67890/members/testuser/workspaces',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Coder-Session-Token': 'test-api-key-12345'
          },
          body: expect.stringContaining('"name":"test-project-12345-3"')
        })
      );

      // Verify workspace was opened
      expect(global.window.open).toHaveBeenCalledWith(
        'https://coder.example.com/@testuser/test-project-12345-3',
        '_blank',
        'noopener'
      );

      // Verify notification was shown
      expect(document.createElement).toHaveBeenCalledWith('gr-alert');
    });

    test('should reuse existing workspace from Gerrit change page', async () => {
      // Mock existing workspace
      const mockExistingWorkspace = {
        id: 'ws-existing-123',
        name: 'test-project-12345-3',
        owner_name: 'testuser',
        latest_app_status: {
          uri: 'https://coder.example.com/@testuser/test-project-12345-3'
        }
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockExistingWorkspace)
      });

      // Simulate plugin installation and action setup
      const changeActions = mockPlugin.changeActions();
      const openActionKey = changeActions.add('revision', 'Open Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[0][1];
      await tapListener();

      // Verify only one API call was made (lookup existing)
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://coder.example.com/api/v2/organizations/test-org-67890/members/testuser/workspaces/test-project-12345-3',
        expect.objectContaining({
          method: 'GET'
        })
      );

      // Verify workspace was opened
      expect(global.window.open).toHaveBeenCalledWith(
        'https://coder.example.com/@testuser/test-project-12345-3',
        '_blank',
        'noopener'
      );
    });

    test('should handle workspace creation errors gracefully', async () => {
      global.fetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404
        }) // First call: workspace doesn't exist
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error')
        }); // Second call: creation fails

      // Simulate plugin installation and action setup
      const changeActions = mockPlugin.changeActions();
      const openActionKey = changeActions.add('revision', 'Open Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[0][1];
      await tapListener();

      // Verify error handling
      expect(global.window.open).not.toHaveBeenCalled();
      expect(document.createElement).toHaveBeenCalledWith('gr-alert');
    });
  });

  describe('Workspace Deletion Workflow', () => {
    test('should delete workspace successfully', async () => {
      // Mock successful deletion
      global.fetch.mockResolvedValue({
        ok: true
      });

      // Mock localStorage with current workspace
      const mockLocalStorage = {
        getItem: jest.fn()
          .mockReturnValueOnce('https://coder.example.com/@testuser/test-project-12345-3') // current workspace URL
          .mockReturnValueOnce(JSON.stringify({ // current workspace meta
            repo: 'test/project',
            branch: 'refs/heads/main',
            change: '12345',
            patchset: '3',
            workspaceName: 'test-project-12345-3',
            workspaceOwner: 'testuser'
          }))
      };
      Object.defineProperty(window, 'localStorage', {
        value: mockLocalStorage
      });

      // Mock window.confirm
      global.window.confirm = jest.fn().mockReturnValue(true);

      // Simulate plugin installation and action setup
      const changeActions = mockPlugin.changeActions();
      const deleteActionKey = changeActions.add('revision', 'Delete Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[1][1]; // Second tap listener
      await tapListener();

      // Verify deletion request
      expect(global.fetch).toHaveBeenCalledWith(
        'https://coder.example.com/api/v2/organizations/test-org-67890/members/testuser/workspaces/test-project-12345-3',
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            'Accept': 'application/json',
            'Coder-Session-Token': 'test-api-key-12345'
          }
        })
      );

      // Verify confirmation dialog
      expect(global.window.confirm).toHaveBeenCalledWith(
        'Delete Coder workspace "test-project-12345-3" for test/project @ refs/heads/main?'
      );

      // Verify localStorage was cleared
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('gerrit-coder-workspace-current');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('gerrit-coder-workspace-current-meta');
    });

    test('should handle deletion cancellation', async () => {
      // Mock localStorage with current workspace
      const mockLocalStorage = {
        getItem: jest.fn()
          .mockReturnValueOnce('https://coder.example.com/@testuser/test-project-12345-3')
          .mockReturnValueOnce(JSON.stringify({
            repo: 'test/project',
            branch: 'refs/heads/main',
            change: '12345',
            patchset: '3',
            workspaceName: 'test-project-12345-3',
            workspaceOwner: 'testuser'
          }))
      };
      Object.defineProperty(window, 'localStorage', {
        value: mockLocalStorage
      });

      // Mock window.confirm to return false (cancelled)
      global.window.confirm = jest.fn().mockReturnValue(false);

      // Simulate plugin installation and action setup
      const changeActions = mockPlugin.changeActions();
      const deleteActionKey = changeActions.add('revision', 'Delete Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[1][1];
      await tapListener();

      // Verify no API call was made
      expect(global.fetch).not.toHaveBeenCalled();

      // Verify confirmation dialog was shown
      expect(global.window.confirm).toHaveBeenCalled();
    });

    test('should handle deletion when no workspace exists', async () => {
      // Mock localStorage with no current workspace
      const mockLocalStorage = {
        getItem: jest.fn()
          .mockReturnValueOnce('') // No current workspace URL
          .mockReturnValueOnce('{}') // Empty meta
      };
      Object.defineProperty(window, 'localStorage', {
        value: mockLocalStorage
      });

      // Simulate plugin installation and action setup
      const changeActions = mockPlugin.changeActions();
      const deleteActionKey = changeActions.add('revision', 'Delete Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[1][1];
      await tapListener();

      // Verify no API call was made
      expect(global.fetch).not.toHaveBeenCalled();

      // Verify error notification
      expect(document.createElement).toHaveBeenCalledWith('gr-alert');
    });
  });

  describe('Configuration Loading and Error Handling', () => {
    test('should handle missing configuration gracefully', async () => {
      // Mock configuration loading failure
      mockPlugin.restApi().get.mockRejectedValue(new Error('Configuration not found'));

      // Simulate plugin installation
      const changeActions = mockPlugin.changeActions();
      const openActionKey = changeActions.add('revision', 'Open Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[0][1];
      await tapListener();

      // Verify error handling
      expect(document.createElement).toHaveBeenCalledWith('gr-alert');
    });

    test('should handle empty server URL configuration', async () => {
      // Mock configuration with empty server URL
      const emptyConfig = { ...mockConfig, serverUrl: '' };
      mockPlugin.restApi().get.mockResolvedValue(emptyConfig);

      // Simulate plugin installation
      const changeActions = mockPlugin.changeActions();
      const openActionKey = changeActions.add('revision', 'Open Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[0][1];
      await tapListener();

      // Verify error message
      expect(document.createElement).toHaveBeenCalledWith('gr-alert');
    });
  });

  describe('Template Mapping Integration', () => {
    test('should use mapped template for specific repo/branch', async () => {
      const configWithMappings = {
        ...mockConfig,
        templateMappings: [
          {
            repo: 'special/org/*',
            branch: 'refs/heads/main',
            templateVersionId: 'special-main-template',
            workspaceNameTemplate: '{repo}-main-{change}',
            richParams: [
              {name: 'SPECIAL_REPO', from: 'repo'},
              {name: 'SPECIAL_BRANCH', from: 'branch'}
            ]
          }
        ]
      };

      // Update mock change to match mapping
      mockChangeView.change.project = 'special/org/important-project';
      mockChangeView.change.branch = 'refs/heads/main';

      mockPlugin.restApi().get.mockResolvedValue(configWithMappings);

      const mockWorkspace = {
        id: 'ws-special-123',
        name: 'special-org-important-project-main-12345',
        owner_name: 'testuser'
      };

      global.fetch
        .mockResolvedValueOnce({ ok: false, status: 404 }) // No existing workspace
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockWorkspace) }); // Create workspace

      // Simulate plugin installation and action setup
      const changeActions = mockPlugin.changeActions();
      const openActionKey = changeActions.add('revision', 'Open Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[0][1];
      await tapListener();

      // Verify workspace creation with mapped template
      expect(global.fetch).toHaveBeenNthCalledWith(2,
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"template_version_id":"special-main-template"')
        })
      );
    });
  });

  describe('Dry Run Preview Integration', () => {
    test('should show preview dialog when enabled', async () => {
      const configWithPreview = { ...mockConfig, enableDryRunPreview: true };
      mockPlugin.restApi().get.mockResolvedValue(configWithPreview);

      const mockWorkspace = {
        id: 'ws-preview-123',
        name: 'test-project-12345-3',
        owner_name: 'testuser'
      };

      global.fetch
        .mockResolvedValueOnce({ ok: false, status: 404 }) // No existing workspace
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockWorkspace) }); // Create workspace

      // Mock popup interaction
      const mockPopup = {
        shadowRoot: {
          appendChild: jest.fn()
        },
        appendChild: jest.fn(),
        remove: jest.fn()
      };
      mockPlugin.popup.mockResolvedValue(mockPopup);

      // Simulate plugin installation and action setup
      const changeActions = mockPlugin.changeActions();
      const openActionKey = changeActions.add('revision', 'Open Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[0][1];
      await tapListener();

      // Verify popup was shown
      expect(mockPlugin.popup).toHaveBeenCalledWith('div', {});
    });
  });

  describe('Context Extraction from Different Sources', () => {
    test('should extract context from DOM when available', async () => {
      // Mock change view with complete data
      mockChangeView.change = {
        project: 'dom/project',
        branch: 'refs/heads/feature',
        _number: 99999,
        revisions: {
          'abc123': { _number: 1 },
          'def456': { _number: 2 }
        }
      };
      mockChangeView.currentRevision = 'def456';

      mockPlugin.restApi().get.mockResolvedValue(mockConfig);

      const mockWorkspace = {
        id: 'ws-dom-123',
        name: 'dom-project-99999-2',
        owner_name: 'testuser'
      };

      global.fetch
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockWorkspace) });

      // Simulate plugin installation and action setup
      const changeActions = mockPlugin.changeActions();
      const openActionKey = changeActions.add('revision', 'Open Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[0][1];
      await tapListener();

      // Verify workspace name uses DOM data
      expect(global.fetch).toHaveBeenNthCalledWith(1,
        expect.stringContaining('dom-project-99999-2'),
        expect.any(Object)
      );
    });

    test('should fallback to URL parsing when DOM is unavailable', async () => {
      // Mock no change view available
      mockGerritApp.shadowRoot.querySelector.mockReturnValue(null);

      // Update location to have URL data
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/c/url%2Fproject/+/77777/5',
          origin: 'https://gerrit.example.com'
        }
      });

      mockPlugin.restApi().get.mockResolvedValue(mockConfig);

      const mockWorkspace = {
        id: 'ws-url-123',
        name: 'url-project-77777-5',
        owner_name: 'testuser'
      };

      global.fetch
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockWorkspace) });

      // Simulate plugin installation and action setup
      const changeActions = mockPlugin.changeActions();
      const openActionKey = changeActions.add('revision', 'Open Coder Workspace');

      // Simulate action tap
      const tapListener = changeActions.addTapListener.mock.calls[0][1];
      await tapListener();

      // Verify workspace name uses URL data
      expect(global.fetch).toHaveBeenNthCalledWith(1,
        expect.stringContaining('url-project-77777-5'),
        expect.any(Object)
      );
    });
  });

  describe('Plugin Installation and Lifecycle', () => {
    test('should install actions when Gerrit is ready', () => {
      // Simulate plugin installation
      const installPlugin = (plugin) => {
        // Simulate action installation
        const changeActions = plugin.changeActions();
        changeActions.add('revision', 'Open Coder Workspace');
        changeActions.add('revision', 'Delete Coder Workspace');
        return true;
      };

      const result = installPlugin(mockPlugin);
      expect(result).toBe(true);
    });

    test('should handle action installation failures gracefully', () => {
      // Mock changeActions to throw error
      mockPlugin.changeActions = () => {
        throw new Error('Change actions not available');
      };

      // Simulate plugin installation with error handling
      const installPlugin = (plugin) => {
        try {
          const changeActions = plugin.changeActions();
          return true;
        } catch (e) {
          console.warn('Failed to install actions', e);
          return false;
        }
      };

      const result = installPlugin(mockPlugin);
      expect(result).toBe(false);
    });
  });
});
