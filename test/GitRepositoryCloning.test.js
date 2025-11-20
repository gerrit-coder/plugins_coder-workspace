// Prevent the plugin from trying to install into Gerrit during tests
window.Gerrit = window.Gerrit || {};

describe('coder-workspace: Git Repository Cloning', () => {
  let testHooks;

  beforeAll(() => {
    // Load the plugin script, which will attach test helpers to window
    require('../plugin.js');
    if (!window.__coderWorkspaceTest__) {
      throw new Error('__coderWorkspaceTest__ not found on window');
    }
    testHooks = window.__coderWorkspaceTest__;
  });

  describe('Change Context with Git URLs', () => {
    beforeEach(() => {
      // Mock window.location
      delete window.location;
      window.location = {
        origin: 'https://gerrit.example.com',
        pathname: '/c/test%2Fproject/+/12345/2',
        href: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2'
      };
    });


    test('should construct SSH git URL correctly', () => {
      const { buildCreateRequest } = window.__coderWorkspaceTest__;
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2'
      };

      const request = buildCreateRequest(ctx);
      const sshUrlParam = request.rich_parameter_values.find(p => p.name === 'GERRIT_GIT_SSH_URL');
      expect(sshUrlParam).toBeDefined();
      expect(sshUrlParam.value).toBe('ssh://gerrit.example.com:29418/test/project');
    });

    test('should construct change ref correctly for patchset', () => {
      const { buildCreateRequest } = window.__coderWorkspaceTest__;
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2'
      };

      const request = buildCreateRequest(ctx);
      const changeRefParam = request.rich_parameter_values.find(p => p.name === 'GERRIT_CHANGE_REF');
      expect(changeRefParam).toBeDefined();
      expect(changeRefParam.value).toBe('refs/changes/45/12345/2');
    });

    test('should construct change ref with correct last two digits', () => {
      // Test with change number 12345 -> last two digits are 45
      const ctx1 = {
        repo: 'test/project',
        change: '12345',
        patchset: '2',
        changeRef: 'refs/changes/45/12345/2'
      };
      expect(ctx1.changeRef).toBe('refs/changes/45/12345/2');

      // Test with change number 7 -> last two digits are 07
      const ctx2 = {
        repo: 'test/project',
        change: '7',
        patchset: '1',
        changeRef: 'refs/changes/07/7/1'
      };
      expect(ctx2.changeRef).toBe('refs/changes/07/7/1');

      // Test with change number 99 -> last two digits are 99
      const ctx3 = {
        repo: 'test/project',
        change: '99',
        patchset: '3',
        changeRef: 'refs/changes/99/99/3'
      };
      expect(ctx3.changeRef).toBe('refs/changes/99/99/3');
    });

    test('should handle missing patchset in change ref', () => {
      const { buildCreateRequest } = window.__coderWorkspaceTest__;
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: '' // No patchset means no change ref
      };

      const request = buildCreateRequest(ctx);
      const changeRefParam = request.rich_parameter_values.find(p => p.name === 'GERRIT_CHANGE_REF');
      expect(changeRefParam).toBeDefined();
      expect(changeRefParam.value).toBe('');
    });
  });

  describe('Git URL Construction from Context', () => {

    test('should construct SSH URL with default port 29418', () => {
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project'
      };

      expect(ctx.gitSshUrl).toBe('ssh://gerrit.example.com:29418/test/project');
    });
  });

  describe('Change context patchset fallbacks', () => {
    const getCtx = async () => await testHooks.getChangeContextFromPage();
    let originalQuerySelector;
    let originalLocation;
    let originalFetch;

    beforeEach(() => {
      originalQuerySelector = document.querySelector;
      originalLocation = window.location;
      originalFetch = global.fetch;
      delete window.location;
      window.location = {
        origin: 'https://gerrit.example.com',
        pathname: '/c/test%2Fproject/+/12345',
        href: 'https://gerrit.example.com/c/test%2Fproject/+/12345'
      };
      // Mock fetch to avoid actual API calls
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve(null)
      });
    });

    afterEach(() => {
      document.querySelector = originalQuerySelector;
      window.location = originalLocation;
      global.fetch = originalFetch;
    });

    test('uses patchRange.patchNum when change data not hydrated', async () => {
      const mockChangeView = {
        change: null,
        _change: null,
        viewState: {
          change: {
            project: 'test/project',
            branch: 'refs/heads/main',
            _number: 12345
          }
        },
        patchRange: { patchNum: 7 }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') {
          return mockGrApp;
        }
        return null;
      });

      const ctx = await getCtx();
      expect(ctx.patchset).toBe('7');
      expect(ctx.branch).toBe('refs/heads/main');
    });

    test('falls back to latestPatchNum when patchRange missing', async () => {
      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: 'refs/heads/dev',
          _number: 12345,
          revisions: {}
        },
        currentRevision: null,
        patchRange: null,
        latestPatchNum: 5
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') {
          return mockGrApp;
        }
        return null;
      });

      const ctx = await getCtx();
      expect(ctx.patchset).toBe('5');
      expect(ctx.branch).toBe('refs/heads/dev');
    });

    test('uses _patchRange.patchNum when patchRange is not available', async () => {
      const mockChangeView = {
        change: null,
        _change: null,
        viewState: {
          change: {
            project: 'test/project',
            branch: 'refs/heads/main',
            _number: 12345
          }
        },
        patchRange: null,
        _patchRange: { patchNum: 3 }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') {
          return mockGrApp;
        }
        return null;
      });

      const ctx = await getCtx();
      expect(ctx.patchset).toBe('3');
      expect(ctx.branch).toBe('refs/heads/main');
    });

    test('uses _allPatchSets to get latest patchset number', async () => {
      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: 'refs/heads/main',
          _number: 12345,
          revisions: {}
        },
        currentRevision: null,
        patchRange: null,
        latestPatchNum: null,
        _allPatchSets: [
          { number: 1 },
          { number: 2 },
          { number: 4 },
          { _number: 3 }
        ]
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') {
          return mockGrApp;
        }
        return null;
      });

      const ctx = await getCtx();
      expect(ctx.patchset).toBe('4'); // Should be max of [1, 2, 4, 3]
      expect(ctx.branch).toBe('refs/heads/main');
    });

    test('uses _currentRevision._number for patchset', async () => {
      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: 'refs/heads/main',
          _number: 12345,
          revisions: {}
        },
        currentRevision: null,
        patchRange: null,
        latestPatchNum: null,
        _currentRevision: {
          _number: 6,
          number: undefined
        }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') {
          return mockGrApp;
        }
        return null;
      });

      const ctx = await getCtx();
      expect(ctx.patchset).toBe('6');
      expect(ctx.branch).toBe('refs/heads/main');
    });

    test('uses _currentRevision.number when _number not available', async () => {
      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: 'refs/heads/main',
          _number: 12345,
          revisions: {}
        },
        currentRevision: null,
        patchRange: null,
        latestPatchNum: null,
        _currentRevision: {
          _number: undefined,
          number: 8
        }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') {
          return mockGrApp;
        }
        return null;
      });

      const ctx = await getCtx();
      expect(ctx.patchset).toBe('8');
      expect(ctx.branch).toBe('refs/heads/main');
    });

    test('uses viewState.change.revisions to get max patchset', async () => {
      const mockChangeView = {
        change: null,
        _change: null,
        viewState: {
          change: {
            project: 'test/project',
            branch: 'refs/heads/main',
            _number: 12345,
            revisions: {
              'abc123': { _number: 1 },
              'def456': { _number: 3 },
              'ghi789': { _number: 2 }
            }
          }
        },
        patchRange: null,
        latestPatchNum: null
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') {
          return mockGrApp;
        }
        return null;
      });

      const ctx = await getCtx();
      expect(ctx.patchset).toBe('3'); // Should be max of [1, 3, 2]
      expect(ctx.branch).toBe('refs/heads/main');
    });

    test('defaults to patchset 1 when change number exists but no patchset found', async () => {
      window.location.pathname = '/c/test%2Fproject/+/12345';

      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: 'refs/heads/main',
          _number: 12345,
          revisions: {}
        },
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

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') {
          return mockGrApp;
        }
        return null;
      });

      const ctx = await getCtx();
      expect(ctx.patchset).toBe('1'); // Should default to 1
      expect(ctx.change).toBe('12345'); // Should always be a string
      expect(ctx.branch).toBe('refs/heads/main');
    });

    test('extracts patchset from URL when available', async () => {
      window.location.pathname = '/c/test%2Fproject/+/12345/9';

      const mockChangeView = {
        change: null,
        _change: null,
        viewState: null,
        patchRange: null
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') {
          return mockGrApp;
        }
        return null;
      });

      const ctx = await getCtx();
      expect(ctx.patchset).toBe('9'); // Should extract from URL
      expect(ctx.change).toBe('12345');
      expect(ctx.repo).toBe('test/project');
    });
  });

  describe('Rich Parameters with Git Fields', () => {
    test('should include all git-related rich parameters by default', () => {
      const { buildCreateRequest } = testHooks;
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2'
      };

      const request = buildCreateRequest(ctx);
      const paramNames = request.rich_parameter_values.map(p => p.name);

      expect(paramNames).toContain('GERRIT_GIT_SSH_URL');
      expect(paramNames).toContain('GERRIT_CHANGE_REF');
      expect(paramNames).not.toContain('GERRIT_GIT_HTTP_URL');
      expect(paramNames).not.toContain('GERRIT_CLONE_AUTH');
    });

    test('should handle custom rich params override', () => {
      const { buildCreateRequest } = testHooks;
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2',
        _richParamsOverride: [
          {name: 'REPO', from: 'repo'},
          {name: 'GERRIT_GIT_SSH_URL', from: 'gitSshUrl'},
          {name: 'GERRIT_CHANGE_REF', from: 'changeRef'}
        ]
      };

      const request = buildCreateRequest(ctx);
      const paramNames = request.rich_parameter_values.map(p => p.name);

      expect(paramNames).toContain('GERRIT_GIT_SSH_URL');
      expect(paramNames).toContain('GERRIT_CHANGE_REF');
      expect(paramNames).not.toContain('GERRIT_GIT_HTTP_URL');
      expect(paramNames).not.toContain('GERRIT_CLONE_AUTH');
    });

    test('should exclude git-related parameters when enableCloneRepository is false', () => {
      // Simulate backend filtering: when enableCloneRepository = false,
      // the backend filters out GERRIT_GIT_SSH_URL and GERRIT_CHANGE_REF from richParams
      const { buildCreateRequest, setConfig } = testHooks;

      // Save original richParams (default from plugin.js)
      const originalRichParams = [
        {name: 'REPO', from: 'repo'},
        {name: 'BRANCH', from: 'branch'},
        {name: 'GERRIT_CHANGE', from: 'change'},
        {name: 'GERRIT_PATCHSET', from: 'patchset'},
        {name: 'GERRIT_CHANGE_URL', from: 'url'},
        {name: 'GERRIT_GIT_SSH_URL', from: 'gitSshUrl'},
        {name: 'GERRIT_CHANGE_REF', from: 'changeRef'}
      ];

      // Mock filtered config (as it would come from backend with enableCloneRepository = false)
      setConfig({
        richParams: [
          {name: 'REPO', from: 'repo'},
          {name: 'BRANCH', from: 'branch'},
          {name: 'GERRIT_CHANGE', from: 'change'},
          {name: 'GERRIT_PATCHSET', from: 'patchset'},
          {name: 'GERRIT_CHANGE_URL', from: 'url'}
          // GERRIT_GIT_SSH_URL and GERRIT_CHANGE_REF are filtered out by backend
        ]
      });

      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2'
      };

      const request = buildCreateRequest(ctx);
      const paramNames = request.rich_parameter_values.map(p => p.name);

      // Git-related parameters should not be included when filtered
      expect(paramNames).not.toContain('GERRIT_GIT_SSH_URL');
      expect(paramNames).not.toContain('GERRIT_CHANGE_REF');

      // Other parameters should still be included
      expect(paramNames).toContain('REPO');
      expect(paramNames).toContain('BRANCH');
      expect(paramNames).toContain('GERRIT_CHANGE');
      expect(paramNames).toContain('GERRIT_PATCHSET');
      expect(paramNames).toContain('GERRIT_CHANGE_URL');

      // Restore original config
      setConfig({ richParams: originalRichParams });
    });
  });

  describe('Branch Extraction and API Fallback', () => {
    const getCtx = async (includeApiFallback = true) => await testHooks.getChangeContextFromPage(includeApiFallback);
    let originalQuerySelector;
    let originalLocation;
    let originalFetch;

    beforeEach(() => {
      originalQuerySelector = document.querySelector;
      originalLocation = window.location;
      originalFetch = global.fetch;
      delete window.location;
      window.location = {
        origin: 'https://gerrit.example.com',
        pathname: '/c/test%2Fproject/+/12345/2',
        href: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2'
      };
      // Reset fetch mock for each test
      global.fetch = jest.fn();
    });

    afterEach(() => {
      document.querySelector = originalQuerySelector;
      window.location = originalLocation;
      global.fetch = originalFetch;
    });

    test('should extract branch from change object', async () => {
      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: 'refs/heads/main',
          _number: 12345
        },
        patchRange: { patchNum: 2 }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') return mockGrApp;
        return null;
      });

      global.fetch = jest.fn();

      const ctx = await getCtx();
      expect(ctx.branch).toBe('refs/heads/main');
      expect(ctx.branchShort).toBe('main');
      // Should not call API when branch is available in DOM
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should extract branch from _change when change is not available', async () => {
      const mockChangeView = {
        change: null,
        _change: {
          project: 'test/project',
          branch: 'refs/heads/develop',
          _number: 12345
        },
        patchRange: { patchNum: 2 }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') return mockGrApp;
        return null;
      });

      global.fetch = jest.fn();

      const ctx = await getCtx();
      expect(ctx.branch).toBe('refs/heads/develop');
      expect(ctx.branchShort).toBe('develop');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should extract branch from viewState when change is not hydrated', async () => {
      const mockChangeView = {
        change: null,
        _change: null,
        viewState: {
          change: {
            project: 'test/project',
            branch: 'refs/heads/feature',
            _number: 12345
          }
        },
        patchRange: { patchNum: 2 }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') return mockGrApp;
        return null;
      });

      global.fetch = jest.fn();

      const ctx = await getCtx();
      expect(ctx.branch).toBe('refs/heads/feature');
      expect(ctx.branchShort).toBe('feature');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should fetch branch from REST API when not available in DOM', async () => {
      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: '', // Empty branch
          _number: 12345
        },
        patchRange: { patchNum: 2 }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') return mockGrApp;
        return null;
      });

      // Mock successful API response with Gerrit's magic prefix
      const apiResponse = {
        ok: true,
        text: () => Promise.resolve(")]}'\n{\"branch\":\"refs/heads/master\",\"_number\":12345,\"project\":\"test/project\"}")
      };

      global.fetch = jest.fn()
        .mockResolvedValueOnce(apiResponse); // First URL succeeds

      const ctx = await getCtx(true);
      expect(ctx.branch).toBe('refs/heads/master');
      expect(ctx.branchShort).toBe('master');
      expect(global.fetch).toHaveBeenCalled();
      // Should try project~changeNum format first
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/changes/test%2Fproject~12345'),
        expect.any(Object)
      );
    });

    test('should try multiple API URL formats when first fails', async () => {
      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: '',
          _number: 12345
        },
        patchRange: { patchNum: 2 }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') return mockGrApp;
        return null;
      });

      // Mock API responses: first fails, second succeeds
      const apiResponse = {
        ok: true,
        text: () => Promise.resolve(")]}'\n{\"branch\":\"refs/heads/main\",\"_number\":12345}")
      };

      global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: false }) // First URL fails
        .mockResolvedValueOnce(apiResponse); // Second URL succeeds

      const ctx = await getCtx(true);
      expect(ctx.branch).toBe('refs/heads/main');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('should handle empty branch gracefully when API also fails', async () => {
      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: '',
          _number: 12345
        },
        patchRange: { patchNum: 2 }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') return mockGrApp;
        return null;
      });

      // Mock all API calls failing
      global.fetch = jest.fn().mockResolvedValue({ ok: false });

      const ctx = await getCtx(true);
      expect(ctx.branch).toBe('');
      expect(ctx.branchShort).toBe('');
      // Should still have other context
      expect(ctx.repo).toBe('test/project');
      expect(ctx.change).toBe('12345');
      expect(ctx.patchset).toBe('2');
    });

    test('should not call API when includeApiFallback is false', async () => {
      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: '',
          _number: 12345
        },
        patchRange: { patchNum: 2 }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') return mockGrApp;
        return null;
      });

      // Reset fetch mock to ensure clean state
      global.fetch = jest.fn();

      const ctx = await getCtx(false);
      expect(ctx.branch).toBe('');
      // Should not call API when includeApiFallback is false
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should extract branch from change.ref property', async () => {
      const mockChangeView = {
        change: {
          project: 'test/project',
          branch: '',
          ref: 'refs/heads/release', // Branch stored as ref
          _number: 12345
        },
        patchRange: { patchNum: 2 }
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockImplementation(selector => {
        if (selector === 'gr-app') return mockGrApp;
        return null;
      });

      global.fetch = jest.fn();

      const ctx = await getCtx();
      expect(ctx.branch).toBe('refs/heads/release');
      expect(ctx.branchShort).toBe('release');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Change Ref Format Validation', () => {
    test('should format change ref correctly for various change numbers', () => {
      const testCases = [
        { change: '1', patchset: '1', expected: 'refs/changes/01/1/1' },
        { change: '10', patchset: '2', expected: 'refs/changes/10/10/2' },
        { change: '99', patchset: '3', expected: 'refs/changes/99/99/3' },
        { change: '100', patchset: '1', expected: 'refs/changes/00/100/1' },
        { change: '12345', patchset: '2', expected: 'refs/changes/45/12345/2' },
        { change: '999999', patchset: '5', expected: 'refs/changes/99/999999/5' }
      ];

      testCases.forEach(({ change, patchset, expected }) => {
        const changeNumStr = String(change);
        const lastTwoDigits = changeNumStr.length >= 2
          ? changeNumStr.slice(-2)
          : changeNumStr.padStart(2, '0');
        const changeRef = `refs/changes/${lastTwoDigits}/${changeNumStr}/${patchset}`;
        expect(changeRef).toBe(expected);
      });
    });

    test('should return empty string when patchset is missing', () => {
      const change = '12345';
      const patchset = '';

      let changeRef = '';
      if (change && patchset) {
        const changeNumStr = String(change);
        const lastTwoDigits = changeNumStr.length >= 2
          ? changeNumStr.slice(-2)
          : changeNumStr.padStart(2, '0');
        changeRef = `refs/changes/${lastTwoDigits}/${changeNumStr}/${patchset}`;
      }

      expect(changeRef).toBe('');
    });
  });
});

