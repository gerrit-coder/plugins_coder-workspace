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

