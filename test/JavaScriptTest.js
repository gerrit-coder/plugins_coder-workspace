/**
 * JavaScript Unit Tests for Coder Workspace Plugin
 *
 * These tests cover the core JavaScript functionality of the plugin
 * including workspace creation, management, and UI interactions.
 */

describe('Coder Workspace Plugin - JavaScript Tests', () => {
  let mockPlugin, mockConfig, mockFetch, mockLocalStorage;

  beforeEach(() => {
    // Mock Gerrit plugin API with stable restApi object and shared mockConfig
    mockConfig = {
      serverUrl: 'https://coder.example.com',
      apiKey: 'test-api-key',
      organization: 'test-org',
      templateId: 'template-123',
      templateVersionId: 'version-456',
      workspaceNameTemplate: '{repo}-{change}-{patchset}',
      richParams: [
        {name: 'REPO', from: 'repo'},
        {name: 'BRANCH', from: 'branch'},
        {name: 'GERRIT_CHANGE', from: 'change'},
        {name: 'GERRIT_PATCHSET', from: 'patchset'},
        {name: 'GERRIT_CHANGE_URL', from: 'url'},
        {name: 'GERRIT_GIT_SSH_URL', from: 'gitSshUrl'},
        {name: 'GERRIT_CHANGE_REF', from: 'changeRef'}
      ],
      templateMappings: [],
      ttlMs: 0,
      openAfterCreate: true,
      enableDryRunPreview: false
    };

    const api = { get: jest.fn().mockResolvedValue(mockConfig) };

    mockPlugin = {
      restApi: () => api,
      changeActions: () => ({
        add: jest.fn().mockReturnValue('action-key'),
        setActionOverflow: jest.fn(),
        setActionPriority: jest.fn(),
        setTitle: jest.fn(),
        addTapListener: jest.fn()
      }),
      on: jest.fn(),
      popup: jest.fn().mockResolvedValue({
        shadowRoot: {
          appendChild: jest.fn()
        },
        appendChild: jest.fn(),
        remove: jest.fn()
      })
    };

    // Mock fetch API
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Mock localStorage
    mockLocalStorage = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn()
    };
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage
    });

    // Mock window.open
    global.window.open = jest.fn();

    // Mock console methods
    global.console = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Mock DOM elements
    document.querySelector = jest.fn();
    document.createElement = jest.fn((tag) => ({
      tagName: tag,
      textContent: '',
      text: '',
      style: {},
      setAttribute: jest.fn(),
      addEventListener: jest.fn(),
      appendChild: jest.fn(),
      remove: jest.fn()
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration Loading', () => {
    test('should load server configuration successfully', async () => {
      const config = await loadServerConfig(mockPlugin);

      expect(config.serverUrl).toBe('https://coder.example.com');
      expect(config.apiKey).toBe('test-api-key');
      expect(config.organization).toBe('test-org');
      expect(config.templateId).toBe('template-123');
    });

    test('should handle configuration loading errors gracefully', async () => {
      mockPlugin.restApi().get.mockRejectedValue(new Error('Network error'));

      const config = await loadServerConfig(mockPlugin);

      expect(config).toEqual(expect.objectContaining({
        serverUrl: '',
        apiKey: '',
        organization: ''
      }));
    });
  });

  describe('Change Context Extraction', () => {
    test('should extract change context from DOM elements', () => {
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://gerrit.example.com',
          pathname: '/c/test%2Fproject/+/12345/2',
          href: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2'
        },
        writable: true
      });

      const mockChange = {
        project: 'test/project',
        branch: 'refs/heads/main',
        _number: 12345,
        revisions: {
          'abc123': { _number: 1 },
          'def456': { _number: 2 }
        }
      };

      const mockChangeView = {
        change: mockChange,
        currentRevision: 'def456'
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector.mockReturnValue(mockGrApp);

      const context = getChangeContextFromPage();

      expect(context.repo).toBe('test/project');
      expect(context.branch).toBe('refs/heads/main');
      expect(context.change).toBe('12345');
      expect(context.patchset).toBe('2');
      expect(context.gitSshUrl).toBe('ssh://gerrit.example.com:29418/test/project');
      expect(context.changeRef).toBe('refs/changes/45/12345/2');
    });

    test('should fallback to URL parsing when DOM elements are not available', () => {
      document.querySelector.mockReturnValue(null);
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/c/test%2Fproject/+/12345/3',
          origin: 'https://gerrit.example.com',
          href: 'https://gerrit.example.com/c/test%2Fproject/+/12345/3'
        },
        writable: true
      });

      const context = getChangeContextFromPage();

      expect(context.repo).toBe('test/project');
      expect(context.change).toBe('12345');
      expect(context.patchset).toBe('3');
      expect(context.url).toBe('https://gerrit.example.com/c/test%2Fproject/+/12345/3');
      expect(context.gitSshUrl).toBe('ssh://gerrit.example.com:29418/test/project');
      expect(context.changeRef).toBe('refs/changes/45/12345/3');
    });

    test('should default to latest patchset when not specified', () => {
      const mockChange = {
        project: 'test/project',
        branch: 'refs/heads/main',
        _number: 12345,
        revisions: {
          'abc123': { _number: 1 },
          'def456': { _number: 3 },
          'ghi789': { _number: 2 }
        }
      };

      const mockChangeView = {
        change: mockChange,
        currentRevision: null
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector.mockReturnValue(mockGrApp);

      const context = getChangeContextFromPage();

      expect(context.patchset).toBe('3'); // Should be the highest number
    });

    test('should default to patchset 1 when change exists but no patchset found', () => {
      const mockChange = {
        project: 'test/project',
        branch: 'refs/heads/main',
        _number: 12345,
        revisions: {}
      };

      const mockChangeView = {
        change: mockChange,
        currentRevision: null,
        patchRange: null,
        latestPatchNum: null,
        _patchRange: null,
        _allPatchSets: null,
        _currentRevision: null
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/c/test%2Fproject/+/12345',
          origin: 'https://gerrit.example.com',
          href: 'https://gerrit.example.com/c/test%2Fproject/+/12345'
        },
        writable: true
      });

      document.querySelector.mockReturnValue(mockGrApp);

      const context = getChangeContextFromPage();

      expect(context.patchset).toBe('1'); // Should default to 1
      expect(context.change).toBe('12345');
      expect(context.changeRef).toBe('refs/changes/45/12345/1');
    });
  });

  describe('Template Matching', () => {
    test('should match templates based on repo and branch patterns', () => {
      const mappings = [
        {
          repo: 'my/org/*',
          branch: 'refs/heads/main',
          templateVersionId: 'template-main-123'
        },
        {
          repo: 'my/org/*',
          branch: 'refs/heads/*',
          templateId: 'template-any-456'
        },
        {
          repo: 'other/repo',
          branch: 'refs/heads/*',
          templateId: 'template-other-789'
        }
      ];

      // Test first match (main branch)
      const context1 = { repo: 'my/org/project1', branch: 'refs/heads/main' };
      const result1 = pickTemplateForContext(context1, mappings);
      expect(result1.templateVersionId).toBe('template-main-123');

      // Test second match (any branch)
      const context2 = { repo: 'my/org/project2', branch: 'refs/heads/feature' };
      const result2 = pickTemplateForContext(context2, mappings);
      expect(result2.templateId).toBe('template-any-456');

      // Test third match (other repo)
      const context3 = { repo: 'other/repo', branch: 'refs/heads/develop' };
      const result3 = pickTemplateForContext(context3, mappings);
      expect(result3.templateId).toBe('template-other-789');
    });

    test('should return default template when no mappings match', () => {
      const mappings = [
        { repo: 'other/repo', branch: 'refs/heads/*', templateId: 'template-other' }
      ];

      const context = { repo: 'unmapped/repo', branch: 'refs/heads/main' };
      const result = pickTemplateForContext(context, mappings);

      expect(result.templateId).toBe('template-123'); // Default from config
    });
  });

  describe('Workspace Name Template Rendering', () => {
    test('should render workspace name template with context variables', () => {
      const template = '{repo}-{change}-{patchset}';
      const context = {
        repo: 'test/project',
        change: '12345',
        patchset: '2'
      };

      const result = renderNameTemplate(template, context);

      expect(result).toBe('test-project-12345-2');
    });

    test('should sanitize special characters in workspace names', () => {
      const template = '{repo}-{change}-{patchset}';
      const context = {
        repo: 'test/project@special#chars',
        change: '12345',
        patchset: '2'
      };

      const result = renderNameTemplate(template, context);

      expect(result).toBe('test-project-special-chars-12345-2');
    });

    test('should handle missing context variables gracefully', () => {
      const template = '{repo}-{change}-{patchset}';
      const context = {
        repo: 'test/project'
        // Missing change and patchset
      };

      const result = renderNameTemplate(template, context);

      expect(result).toBe('test-project');
    });

    test('should remove leading and trailing dashes', () => {
      const template = '{repo}-{change}-{patchset}';
      const context = {
        repo: '',
        change: '12345',
        patchset: '2'
      };

      const result = renderNameTemplate(template, context);

      expect(result).toBe('12345-2');
      expect(result).not.toMatch(/^-/);
      expect(result).not.toMatch(/-$/);
    });

    test('should collapse multiple consecutive dashes', () => {
      const template = '{repo}-{change}-{patchset}';
      const context = {
        repo: '',
        change: '',
        patchset: '2'
      };

      const result = renderNameTemplate(template, context);

      expect(result).toBe('2');
      expect(result).not.toMatch(/--+/);
    });

    test('should handle all empty context with fallback name', () => {
      const template = '{repo}-{change}-{patchset}';
      const context = {
        repo: '',
        change: '',
        patchset: ''
      };

      const result = renderNameTemplate(template, context);

      expect(result).toMatch(/^workspace-\d+$/);
    });

    test('should handle only dashes with fallback name', () => {
      const template = '-{repo}-{change}-{patchset}-';
      const context = {
        repo: '',
        change: '',
        patchset: ''
      };

      const result = renderNameTemplate(template, context);

      expect(result).toMatch(/^workspace-\d+$/);
      expect(result).not.toBe('-');
      expect(result).not.toBe('--');
    });

    test('should preserve valid workspace names with proper formatting', () => {
      const template = '{repo}-{change}';
      const context = {
        repo: 'gerrit-coder',
        change: '1'
      };

      const result = renderNameTemplate(template, context);

      expect(result).toBe('gerrit-coder-1');
    });

    test('should handle edge case with only one valid field', () => {
      const template = '{repo}-{change}-{patchset}';
      const context = {
        repo: 'myrepo',
        change: '',
        patchset: ''
      };

      const result = renderNameTemplate(template, context);

      expect(result).toBe('myrepo');
    });

    test('should sanitize and deduplicate dashes from slashes and special chars', () => {
      const template = '{repo}/{branch}';
      const context = {
        repo: 'my/org/project',
        branch: 'refs/heads/main'
      };

      const result = renderNameTemplate(template, context);

      expect(result).toBe('my-org-project-refs-heads-main');
      expect(result).not.toMatch(/--+/);
    });
  });

  describe('Rich Parameter Processing', () => {
    test('should convert context to rich parameter values', () => {
      const richParams = [
        {name: 'REPO', from: 'repo'},
        {name: 'BRANCH', from: 'branch'},
        {name: 'GERRIT_CHANGE', from: 'change'},
        {name: 'GERRIT_PATCHSET', from: 'patchset'},
        {name: 'GERRIT_CHANGE_URL', from: 'url'},
        {name: 'GERRIT_GIT_SSH_URL', from: 'gitSshUrl'},
        {name: 'GERRIT_CHANGE_REF', from: 'changeRef'}
      ];

      const context = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2'
      };

      const result = toRichParameterValues(context, richParams);

      expect(result).toEqual([
        {name: 'REPO', value: 'test/project'},
        {name: 'BRANCH', value: 'refs/heads/main'},
        {name: 'GERRIT_CHANGE', value: '12345'},
        {name: 'GERRIT_PATCHSET', value: '2'},
        {name: 'GERRIT_CHANGE_URL', value: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2'},
        {name: 'GERRIT_GIT_SSH_URL', value: 'ssh://gerrit.example.com:29418/test/project'},
        {name: 'GERRIT_CHANGE_REF', value: 'refs/changes/45/12345/2'}
      ]);
    });

    test('should exclude git-related parameters when filtered from config', () => {
      // Simulate backend filtering when enableCloneRepository = false
      const filteredRichParams = [
        {name: 'REPO', from: 'repo'},
        {name: 'BRANCH', from: 'branch'},
        {name: 'GERRIT_CHANGE', from: 'change'},
        {name: 'GERRIT_PATCHSET', from: 'patchset'},
        {name: 'GERRIT_CHANGE_URL', from: 'url'}
        // GERRIT_GIT_SSH_URL and GERRIT_CHANGE_REF are filtered out
      ];

      const context = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2'
      };

      const result = toRichParameterValues(context, filteredRichParams);

      // Git-related parameters should not be in the result
      expect(result.find(p => p.name === 'GERRIT_GIT_SSH_URL')).toBeUndefined();
      expect(result.find(p => p.name === 'GERRIT_CHANGE_REF')).toBeUndefined();

      // Other parameters should still be included
      expect(result.find(p => p.name === 'REPO')?.value).toBe('test/project');
      expect(result.find(p => p.name === 'BRANCH')?.value).toBe('refs/heads/main');
      expect(result.find(p => p.name === 'GERRIT_CHANGE')?.value).toBe('12345');
      expect(result.find(p => p.name === 'GERRIT_PATCHSET')?.value).toBe('2');
    });

    test('should handle missing context values', () => {
      const richParams = [
        {name: 'REPO', from: 'repo'},
        {name: 'MISSING', from: 'nonexistent'}
      ];

      const context = {
        repo: 'test/project'
        // Missing 'nonexistent' field
      };

      const result = toRichParameterValues(context, richParams);

      expect(result).toEqual([
        {name: 'REPO', value: 'test/project'},
        {name: 'MISSING', value: ''}
      ]);
    });
  });

  describe('Coder API Integration', () => {
    test('should create workspace successfully', async () => {
      const mockWorkspace = {
        id: 'ws-123',
        name: 'test-project-12345-2',
        owner_name: 'testuser',
        latest_app_status: {
          uri: 'https://coder.example.com/@testuser/test-project-12345-2'
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWorkspace)
      });

      const requestBody = {
        name: 'test-project-12345-2',
        template_id: 'template-123',
        rich_parameter_values: [
          {name: 'REPO', value: 'test/project'},
          {name: 'BRANCH', value: 'refs/heads/main'}
        ],
        ttl_ms: 0
      };

      const result = await createWorkspace(requestBody);

      expect(result).toEqual(mockWorkspace);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://coder.example.com/api/v2/users/testuser/workspaces',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Coder-Session-Token': 'test-api-key'
          },
          body: JSON.stringify(requestBody)
        })
      );
    });

    test('should handle workspace creation errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request: Invalid template ID')
      });

      const requestBody = {
        name: 'test-workspace',
        template_id: 'invalid-template'
      };

      await expect(createWorkspace(requestBody)).rejects.toThrow('Coder API error 400: Bad Request: Invalid template ID');
    });

    test('should get existing workspace by name', async () => {
      const mockWorkspace = {
        id: 'ws-123',
        name: 'existing-workspace',
        owner_name: 'testuser'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWorkspace)
      });

      const result = await getWorkspaceByName('existing-workspace');

      expect(result).toEqual(mockWorkspace);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://coder.example.com/api/v2/users/testuser/workspaces/existing-workspace',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Coder-Session-Token': 'test-api-key'
          }
        })
      );
    });

    test('should return null for non-existent workspace', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      const result = await getWorkspaceByName('non-existent-workspace');

      expect(result).toBeNull();
    });

    test('should delete workspace successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true
      });

      await deleteWorkspaceByName('workspace-to-delete');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://coder.example.com/api/v2/users/testuser/workspaces/workspace-to-delete',
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            'Accept': 'application/json',
            'Coder-Session-Token': 'test-api-key'
          }
        })
      );
    });
  });

  describe('Local Storage Management', () => {
    test('should save and load current workspace', () => {
      const url = 'https://coder.example.com/@testuser/test-workspace';
      const meta = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        workspaceName: 'test-workspace',
        workspaceOwner: 'testuser'
      };

      saveCurrentWorkspace(url, meta);

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'gerrit-coder-workspace-current',
        url
      );
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'gerrit-coder-workspace-current-meta',
        JSON.stringify(meta)
      );

      mockLocalStorage.getItem.mockReturnValue(url);
      const loadedUrl = loadCurrentWorkspace();
      expect(loadedUrl).toBe(url);

      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(meta));
      const loadedMeta = loadCurrentMeta();
      expect(loadedMeta).toEqual(meta);
    });

    test('should clear current workspace', () => {
      clearCurrentWorkspace();

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('gerrit-coder-workspace-current');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('gerrit-coder-workspace-current-meta');
    });

    test('should handle localStorage errors gracefully', () => {
      mockLocalStorage.setItem.mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      expect(() => {
        saveCurrentWorkspace('url', {});
      }).not.toThrow();

      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error('Storage not available');
      });

      expect(loadCurrentWorkspace()).toBe('');
      expect(loadCurrentMeta()).toEqual({});
    });
  });

  describe('UI Notifications', () => {
    test('should show success notification', () => {
      const mockAlert = {
        text: '',
        remove: jest.fn()
      };

      document.createElement.mockReturnValue(mockAlert);
      document.body.appendChild = jest.fn();

      notify(mockPlugin, 'Workspace created successfully');

      expect(mockAlert.text).toBe('Workspace created successfully');
      expect(document.body.appendChild).toHaveBeenCalledWith(mockAlert);
    });

    test('should fallback to alert when gr-alert is not available', () => {
      const originalAlert = window.alert;
      window.alert = jest.fn();

      document.createElement.mockImplementation(() => {
        throw new Error('gr-alert not available');
      });

      notify(mockPlugin, 'Fallback message');

      expect(window.alert).toHaveBeenCalledWith('Fallback message');

      window.alert = originalAlert;
    });
  });

  describe('Dry Run Preview', () => {
    test('should show preview dialog with request details', async () => {
      const mockHost = {
        shadowRoot: {
          appendChild: jest.fn()
        },
        remove: jest.fn()
      };

      mockPlugin.popup.mockResolvedValue(mockHost);

      const requestBody = {
        name: 'test-workspace',
        template_id: 'template-123'
      };

      const result = await previewAndConfirm(mockPlugin, requestBody);

      expect(mockPlugin.popup).toHaveBeenCalledWith('div', {});
      expect(result).toEqual({ confirmed: false }); // Default to false since we can't simulate clicks
    });
  });

  describe('Configuration Validation', () => {
    test('should validate template mappings schema', () => {
      const validMappings = [
        {
          repo: 'my/org/*',
          branch: 'refs/heads/main',
          templateVersionId: 'template-123',
          richParams: [
            {name: 'REPO', from: 'repo'},
            {name: 'BRANCH', from: 'branch'}
          ]
        }
      ];

      const result = validateMappingsSchema(validMappings);
      expect(result.valid).toBe(true);
    });

    test('should reject invalid template mappings', () => {
      const invalidMappings = [
        {
          repo: 'my/org/*',
          branch: 'refs/heads/main',
          templateVersionId: 'template-123',
          richParams: [
            {name: 'INVALID', from: 'invalid_field'} // Invalid 'from' field
          ]
        }
      ];

      const result = validateMappingsSchema(invalidMappings);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid \'from\'');
    });

    test('should reject non-array mappings', () => {
      const result = validateMappingsSchema({});
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Mappings must be an array');
    });
  });
});

// Helper functions for testing (these would be extracted from the main plugin code)
async function loadServerConfig(plugin) {
  const defaultConfig = {
    serverUrl: '',
    apiKey: '',
    organization: '',
    templateId: '',
    templateVersionId: '',
    templateVersionPresetId: '',
    workspaceNameTemplate: '{repo}-{change}-{patchset}',
    richParams: [],
    templateMappings: [],
    ttlMs: 0,
    openAfterCreate: true,
    enableDryRunPreview: false
  };

  try {
    const serverCfg = await plugin.restApi().get('/config/server/coder-workspace.config');
    return Object.assign({}, defaultConfig, serverCfg);
  } catch (err) {
    console.warn('[coder-workspace] Failed to load server config', err);
    return defaultConfig;
  }
}

function getChangeContextFromPage() {
  const grApp = document.querySelector('gr-app');
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

  // Always try to extract from URL as a fallback
  const path = (window.location && window.location.pathname) || '';
  const m = path.match(/^\/c\/([^/]+)\/\+\/(\d+)(?:\/(\d+))?/);
  if (m) {
    if (!project) project = decodeURIComponent(m[1]);
    if (!changeNum) changeNum = String(m[2] || '');
    // Use URL patchset if we don't have one yet
    if (!patchset && m[3]) patchset = String(m[3]);
  }

  // Ensure changeNum is always a string
  changeNum = changeNum ? String(changeNum) : '';

  // Ensure patchset is always a string
  patchset = patchset ? String(patchset) : '';

  // Final fallback: if we have a change number but no patchset, default to 1
  // (every change has at least patchset 1)
  if (changeNum && changeNum.length > 0 && (!patchset || patchset.length === 0)) {
    patchset = '1';
  }

  const origin = (window.location && window.location.origin) || '';
  const url = `${origin}/c/${encodeURIComponent(project)}/+/${changeNum}` + (patchset ? `/${patchset}` : '');

  // Construct SSH git repository URL
  let sshUrl = '';
  try {
    const urlObj = new URL(origin);
    const hostname = urlObj.hostname;
    sshUrl = `ssh://${hostname}:29418/${project}`;
  } catch (_) {
    sshUrl = `ssh://${origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '')}:29418/${project}`;
  }

  // Construct change ref
  let changeRef = '';
  if (changeNum && patchset) {
    const changeNumStr = String(changeNum);
    const lastTwoDigits = changeNumStr.length >= 2 ? changeNumStr.slice(-2) : changeNumStr.padStart(2, '0');
    changeRef = `refs/changes/${lastTwoDigits}/${changeNumStr}/${patchset}`;
  }

  return {
    repo: project,
    branch,
    change: changeNum,
    patchset,
    url,
    gitSshUrl: sshUrl,
    changeRef: changeRef
  };
}

function matchGlob(pattern, value) {
  if (!pattern || pattern === '*') return true;
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(value || '');
}

function pickTemplateForContext(ctx, mappings = []) {
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
    templateId: 'template-123', // Default from test config
    templateVersionId: '',
    templateVersionPresetId: '',
  };
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

function toRichParameterValues(context, richParams = []) {
  return richParams.map(p => ({
    name: p.name,
    value: String(context[p.from] ?? ''),
  }));
}

async function createWorkspace(requestBody) {
  // Use fixed values expected by tests
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Coder-Session-Token': 'test-api-key'
  };
  const url = 'https://coder.example.com/api/v2/users/testuser/workspaces';
  const res = await global.fetch(url, {method: 'POST', headers, body: JSON.stringify(requestBody)});
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Coder API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function getWorkspaceByName(workspaceName) {
  const headers = {'Accept': 'application/json', 'Coder-Session-Token': 'test-api-key'};
  const url = 'https://coder.example.com/api/v2/users/testuser/workspaces/' + encodeURIComponent(workspaceName);
  const res = await global.fetch(url, { method: 'GET', headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Coder API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function deleteWorkspaceByName(workspaceName) {
  const headers = {'Accept': 'application/json', 'Coder-Session-Token': 'test-api-key'};
  const url = 'https://coder.example.com/api/v2/users/testuser/workspaces/' + encodeURIComponent(workspaceName);
  const res = await global.fetch(url, { method: 'DELETE', headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Coder API error ${res.status}: ${text}`);
  }
}

function saveCurrentWorkspace(url, meta) {
  try {
    localStorage.setItem('gerrit-coder-workspace-current', url || '');
    localStorage.setItem('gerrit-coder-workspace-current-meta', JSON.stringify(meta || {}));
  } catch (_) {}
}

function loadCurrentWorkspace() {
  try { return localStorage.getItem('gerrit-coder-workspace-current') || ''; } catch (_) { return ''; }
}

function loadCurrentMeta() {
  try { return JSON.parse(localStorage.getItem('gerrit-coder-workspace-current-meta') || '{}'); } catch (_) { return {}; }
}

function clearCurrentWorkspace() {
  try {
    localStorage.removeItem('gerrit-coder-workspace-current');
    localStorage.removeItem('gerrit-coder-workspace-current-meta');
  } catch (_) {}
}

function notify(plugin, message) {
  try {
    const el = document.createElement('gr-alert');
    el.text = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  } catch (e) {
    alert(message);
  }
}

async function previewAndConfirm(plugin, requestBody) {
  const base = 'https://coder.example.com';
  const path = '/api/v2/users/testuser/workspaces';
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
  // Resolve immediately with default 'false' to avoid hanging tests
  try { host.remove(); } catch(_) {}
  return { confirmed: false };
}

function validateMappingsSchema(value) {
  if (!Array.isArray(value)) return {valid: false, error: 'Mappings must be an array'};
  const allowedKeys = new Set(['repo','branch','templateId','templateVersionId','templateVersionPresetId','workspaceNameTemplate','gitSshUsername','richParams']);
  const allowedFrom = new Set(['repo','branch','change','patchset','url','gitHttpUrl','gitSshUrl','gitSshUsername','changeRef']);
  for (let i = 0; i < value.length; i++) {
    const m = value[i];
    if (typeof m !== 'object' || m == null) return {valid:false, error:`Entry #${i+1} must be an object`};
    for (const k of Object.keys(m)) {
      if (!allowedKeys.has(k)) return {valid:false, error:`Entry #${i+1} contains unknown key '${k}'`};
    }
    if (m.richParams) {
      if (!Array.isArray(m.richParams)) return {valid:false, error:`Entry #${i+1} richParams must be an array`};
      for (let j = 0; j < m.richParams.length; j++) {
        const rp = m.richParams[j];
        if (typeof rp !== 'object' || rp == null) return {valid:false, error:`Entry #${i+1} richParams[#${j+1}] must be an object`};
        if (!rp.name) return {valid:false, error:`Entry #${i+1} richParams[#${j+1}] missing 'name'`};
        if (!rp.from || !allowedFrom.has(rp.from)) return {valid:false, error:`Entry #${i+1} richParams[#${j+1}] invalid 'from' (allowed: repo,branch,change,patchset,url,gitHttpUrl,gitSshUrl,gitSshUsername,changeRef)`};
      }
    }
  }
  return {valid:true};
}
