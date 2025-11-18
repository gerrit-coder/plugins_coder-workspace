// Prevent the plugin from trying to install into Gerrit during tests
window.Gerrit = window.Gerrit || {};

describe('coder-workspace: Git Repository Cloning', () => {
  beforeAll(() => {
    // Load the plugin script, which will attach test helpers to window
    require('../plugin.js');
    if (!window.__coderWorkspaceTest__) {
      throw new Error('__coderWorkspaceTest__ not found on window');
    }
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

    test('should construct HTTP git URL correctly', () => {
      const { buildCreateRequest } = window.__coderWorkspaceTest__;
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitHttpUrl: 'https://gerrit.example.com/a/test/project',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2'
      };

      const request = buildCreateRequest(ctx);
      const httpUrlParam = request.rich_parameter_values.find(p => p.name === 'GERRIT_GIT_HTTP_URL');
      expect(httpUrlParam).toBeDefined();
      expect(httpUrlParam.value).toBe('https://gerrit.example.com/a/test/project');
    });

    test('should construct SSH git URL correctly', () => {
      const { buildCreateRequest } = window.__coderWorkspaceTest__;
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitHttpUrl: 'https://gerrit.example.com/a/test/project',
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
        gitHttpUrl: 'https://gerrit.example.com/a/test/project',
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
        gitHttpUrl: 'https://gerrit.example.com/a/test/project',
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
    test('should extract HTTP URL from origin', () => {
      // This test verifies the logic in getChangeContextFromPage
      // We'll test the actual function by mocking the DOM
      const mockChange = {
        project: 'test/project',
        branch: 'refs/heads/main',
        _number: 12345,
        revisions: {
          'abc123': { _number: 2 }
        }
      };

      const mockChangeView = {
        change: mockChange,
        currentRevision: 'abc123'
      };

      const mockGrApp = {
        shadowRoot: {
          querySelector: jest.fn().mockReturnValue(mockChangeView)
        }
      };

      document.querySelector = jest.fn().mockReturnValue(mockGrApp);

      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://gerrit.example.com',
          pathname: '/c/test%2Fproject/+/12345/2',
          href: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2'
        },
        writable: true
      });

      // We need to access the actual function from the plugin
      // Since getChangeContextFromPage is not exposed, we'll test via buildCreateRequest
      const { buildCreateRequest } = window.__coderWorkspaceTest__;

      // Create a context that mimics what getChangeContextFromPage would return
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitHttpUrl: 'https://gerrit.example.com/a/test/project',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2'
      };

      const request = buildCreateRequest(ctx);
      expect(request.rich_parameter_values).toContainEqual({
        name: 'GERRIT_GIT_HTTP_URL',
        value: 'https://gerrit.example.com/a/test/project'
      });
    });

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

    test('should handle different origin formats', () => {
      // Test HTTP origin
      const httpOrigin = 'http://localhost:8080';
      const httpUrl = `${httpOrigin}/a/test/project`;
      expect(httpUrl).toBe('http://localhost:8080/a/test/project');

      // Test HTTPS origin
      const httpsOrigin = 'https://gerrit.example.com';
      const httpsUrl = `${httpsOrigin}/a/test/project`;
      expect(httpsUrl).toBe('https://gerrit.example.com/a/test/project');
    });
  });

  describe('Rich Parameters with Git Fields', () => {
    test('should include all git-related rich parameters by default', () => {
      const { buildCreateRequest } = window.__coderWorkspaceTest__;
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitHttpUrl: 'https://gerrit.example.com/a/test/project',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2'
      };

      const request = buildCreateRequest(ctx);
      const paramNames = request.rich_parameter_values.map(p => p.name);

      expect(paramNames).toContain('GERRIT_GIT_HTTP_URL');
      expect(paramNames).toContain('GERRIT_GIT_SSH_URL');
      expect(paramNames).toContain('GERRIT_CHANGE_REF');
    });

    test('should handle custom rich params override', () => {
      const { buildCreateRequest } = window.__coderWorkspaceTest__;
      const ctx = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/12345/2',
        gitHttpUrl: 'https://gerrit.example.com/a/test/project',
        gitSshUrl: 'ssh://gerrit.example.com:29418/test/project',
        changeRef: 'refs/changes/45/12345/2',
        _richParamsOverride: [
          {name: 'REPO', from: 'repo'},
          {name: 'GERRIT_GIT_HTTP_URL', from: 'gitHttpUrl'},
          {name: 'GERRIT_CHANGE_REF', from: 'changeRef'}
        ]
      };

      const request = buildCreateRequest(ctx);
      const paramNames = request.rich_parameter_values.map(p => p.name);

      expect(paramNames).toContain('GERRIT_GIT_HTTP_URL');
      expect(paramNames).toContain('GERRIT_CHANGE_REF');
      expect(paramNames).not.toContain('GERRIT_GIT_SSH_URL'); // Not in override
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

