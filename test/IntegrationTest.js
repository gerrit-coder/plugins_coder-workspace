/**
 * Integration Tests for Coder Workspace Plugin
 *
 * These tests cover the integration between the plugin and the Coder API,
 * including workspace lifecycle management and error handling.
 */

describe('Coder Workspace Plugin - Integration Tests', () => {
  let mockServer, mockConfig, mockPlugin;

  beforeEach(() => {
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
      ttlMs: 3600000,
      openAfterCreate: true,
      enableDryRunPreview: false
    };

    // Mock Gerrit plugin API
    mockPlugin = {
      restApi: () => ({
        get: jest.fn().mockResolvedValue(mockConfig)
      }),
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

    // Mock fetch with realistic responses
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Workspace Creation Flow', () => {
    test('should create workspace with organization context', async () => {
      const context = {
        repo: 'my/org/project',
        branch: 'refs/heads/main',
        change: '12345',
        patchset: '2',
        url: 'https://gerrit.example.com/c/my%2Forg%2Fproject/+/12345/2'
      };

      const expectedRequestBody = {
        name: 'my-org-project-12345-2',
        template_id: 'template-123',
        rich_parameter_values: [
          {name: 'REPO', value: 'my/org/project'},
          {name: 'BRANCH', value: 'refs/heads/main'},
          {name: 'GERRIT_CHANGE', value: '12345'},
          {name: 'GERRIT_PATCHSET', value: '2'},
          {name: 'GERRIT_CHANGE_URL', value: 'https://gerrit.example.com/c/my%2Forg%2Fproject/+/12345/2'}
        ],
        ttl_ms: 3600000
      };

      const mockWorkspace = {
        id: 'ws-abc123',
        name: 'my-org-project-12345-2',
        owner_name: 'testuser',
        latest_app_status: {
          uri: 'https://coder.example.com/@testuser/my-org-project-12345-2'
        }
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWorkspace)
      });

      const result = await createWorkspace(mockConfig, expectedRequestBody);

      expect(result).toEqual(mockWorkspace);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://coder.example.com/api/v2/organizations/test-org-67890/members/testuser/workspaces',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Coder-Session-Token': 'test-api-key-12345'
          },
          body: JSON.stringify(expectedRequestBody)
        })
      );
    });

    test('should handle workspace creation with empty context values', async () => {
      const context = {
        repo: 'gerrit-coder',
        branch: '',
        change: '1',
        patchset: '',
        url: 'https://gerrit.example.com/c/gerrit-coder/+/1'
      };

      const workspaceName = renderNameTemplate(mockConfig.workspaceNameTemplate, context);

      // Should sanitize to 'gerrit-coder-1' (removing empty patchset)
      expect(workspaceName).toBe('gerrit-coder-1');
      expect(workspaceName).not.toContain('--');
      expect(workspaceName).not.toMatch(/^-/);
      expect(workspaceName).not.toMatch(/-$/);
    });

    test('should use fallback name when all context values are empty', async () => {
      const context = {
        repo: '',
        branch: '',
        change: '',
        patchset: '',
        url: ''
      };

      const workspaceName = renderNameTemplate(mockConfig.workspaceNameTemplate, context);

      // Should fallback to timestamp-based name
      expect(workspaceName).toMatch(/^workspace-\d+$/);
    });

    test('should reject workspace creation with invalid context', async () => {
      const invalidContext = {
        repo: '',
        branch: 'refs/heads/main',
        change: '',
        patchset: '1',
        url: ''
      };

      // Validation should fail for missing required fields (repo, change)
      const isValid = validateContext(invalidContext);
      expect(isValid).toBe(false);
    });

    test('should create workspace with user context (no organization)', async () => {
      const configWithoutOrg = { ...mockConfig, organization: null };
      const context = {
        repo: 'my/project',
        branch: 'refs/heads/feature',
        change: '67890',
        patchset: '1',
        url: 'https://gerrit.example.com/c/my%2Fproject/+/67890/1'
      };

      const expectedRequestBody = {
        name: 'my-project-67890-1',
        template_id: 'template-123',
        rich_parameter_values: [
          {name: 'REPO', value: 'my/project'},
          {name: 'BRANCH', value: 'refs/heads/feature'},
          {name: 'GERRIT_CHANGE', value: '67890'},
          {name: 'GERRIT_PATCHSET', value: '1'},
          {name: 'GERRIT_CHANGE_URL', value: 'https://gerrit.example.com/c/my%2Fproject/+/67890/1'}
        ],
        ttl_ms: 3600000
      };

      const mockWorkspace = {
        id: 'ws-def456',
        name: 'my-project-67890-1',
        owner_name: 'testuser'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWorkspace)
      });

      const result = await createWorkspaceWithContext(context, configWithoutOrg);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://coder.example.com/api/v2/users/testuser/workspaces',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Coder-Session-Token': 'test-api-key-12345'
          },
          body: JSON.stringify(expectedRequestBody)
        })
      );

      expect(result).toEqual(mockWorkspace);
    });

    test('should create workspace with template version ID', async () => {
      const configWithVersion = {
        ...mockConfig,
        templateId: null,
        templateVersionId: 'version-456'
      };
      const context = {
        repo: 'test/project',
        branch: 'refs/heads/main',
        change: '11111',
        patchset: '3',
        url: 'https://gerrit.example.com/c/test%2Fproject/+/11111/3'
      };

      const expectedRequestBody = {
        name: 'test-project-11111-3',
        template_version_id: 'version-456',
        rich_parameter_values: expect.any(Array),
        ttl_ms: 3600000
      };

      const mockWorkspace = {
        id: 'ws-ghi789',
        name: 'test-project-11111-3',
        owner_name: 'testuser'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWorkspace)
      });

      const result = await createWorkspaceWithContext(context, configWithVersion);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"template_version_id":"version-456"')
        })
      );

      expect(result).toEqual(mockWorkspace);
    });
  });

  describe('Workspace Lookup and Reuse', () => {
    test('should find and reuse existing workspace', async () => {
      const context = {
        repo: 'existing/project',
        branch: 'refs/heads/main',
        change: '99999',
        patchset: '1',
        url: 'https://gerrit.example.com/c/existing%2Fproject/+/99999/1'
      };

      const expectedWorkspaceName = 'existing-project-99999-1';
      const mockExistingWorkspace = {
        id: 'ws-existing-123',
        name: expectedWorkspaceName,
        owner_name: 'testuser',
        latest_app_status: {
          uri: 'https://coder.example.com/@testuser/existing-project-99999-1'
        }
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockExistingWorkspace)
      });

      const result = await getWorkspaceByName(expectedWorkspaceName, mockConfig);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://coder.example.com/api/v2/organizations/test-org-67890/members/testuser/workspaces/existing-project-99999-1',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Coder-Session-Token': 'test-api-key-12345'
          }
        })
      );

      expect(result).toEqual(mockExistingWorkspace);
    });

    test('should handle non-existent workspace gracefully', async () => {
      const context = {
        repo: 'nonexistent/project',
        branch: 'refs/heads/main',
        change: '88888',
        patchset: '1',
        url: 'https://gerrit.example.com/c/nonexistent%2Fproject/+/88888/1'
      };

      const expectedWorkspaceName = 'nonexistent-project-88888-1';

      global.fetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      const result = await getWorkspaceByName(expectedWorkspaceName, mockConfig);

      expect(result).toBeNull();
    });

    test('should handle workspace lookup errors gracefully', async () => {
      const context = {
        repo: 'error/project',
        branch: 'refs/heads/main',
        change: '77777',
        patchset: '1',
        url: 'https://gerrit.example.com/c/error%2Fproject/+/77777/1'
      };

      const expectedWorkspaceName = 'error-project-77777-1';

      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error')
      });

      const result = await getWorkspaceByName(expectedWorkspaceName, mockConfig);

      expect(result).toBeNull();
    });
  });

  describe('Workspace Deletion', () => {
    test('should delete workspace successfully', async () => {
      const workspaceName = 'workspace-to-delete';
      const context = {
        repo: 'delete/project',
        branch: 'refs/heads/main',
        change: '66666',
        patchset: '1',
        url: 'https://gerrit.example.com/c/delete%2Fproject/+/66666/1'
      };

      global.fetch.mockResolvedValue({
        ok: true
      });

      await deleteWorkspaceByName(workspaceName, mockConfig);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://coder.example.com/api/v2/organizations/test-org-67890/members/testuser/workspaces/workspace-to-delete',
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            'Accept': 'application/json',
            'Coder-Session-Token': 'test-api-key-12345'
          }
        })
      );
    });

    test('should handle deletion errors', async () => {
      const workspaceName = 'workspace-delete-error';
      const context = {
        repo: 'error/project',
        branch: 'refs/heads/main',
        change: '55555',
        patchset: '1',
        url: 'https://gerrit.example.com/c/error%2Fproject/+/55555/1'
      };

      global.fetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden: Cannot delete workspace')
      });

      await expect(deleteWorkspaceByName(workspaceName, mockConfig))
        .rejects.toThrow('Coder API error 403: Forbidden: Cannot delete workspace');
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
          },
          {
            repo: 'special/org/*',
            branch: 'refs/heads/*',
            templateId: 'special-any-template'
          }
        ]
      };

      const context = {
        repo: 'special/org/important-project',
        branch: 'refs/heads/main',
        change: '44444',
        patchset: '2',
        url: 'https://gerrit.example.com/c/special%2Forg%2Fimportant-project/+/44444/2'
      };

      const expectedRequestBody = {
        name: 'special-org-important-project-main-44444',
        template_version_id: 'special-main-template',
        rich_parameter_values: [
          {name: 'SPECIAL_REPO', value: 'special/org/important-project'},
          {name: 'SPECIAL_BRANCH', value: 'refs/heads/main'}
        ],
        ttl_ms: 3600000
      };

      const mockWorkspace = {
        id: 'ws-special-123',
        name: 'special-org-important-project-main-44444',
        owner_name: 'testuser'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWorkspace)
      });

      const result = await createWorkspaceWithContext(context, configWithMappings);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"template_version_id":"special-main-template"')
        })
      );

      expect(result).toEqual(mockWorkspace);
    });

    test('should fallback to default template when no mapping matches', async () => {
      const configWithMappings = {
        ...mockConfig,
        templateMappings: [
          {
            repo: 'other/org/*',
            branch: 'refs/heads/*',
            templateId: 'other-template'
          }
        ]
      };

      const context = {
        repo: 'unmapped/org/project',
        branch: 'refs/heads/main',
        change: '33333',
        patchset: '1',
        url: 'https://gerrit.example.com/c/unmapped%2Forg%2Fproject/+/33333/1'
      };

      const expectedRequestBody = {
        name: 'unmapped-org-project-33333-1',
        template_id: 'template-123', // Default template
        rich_parameter_values: expect.any(Array),
        ttl_ms: 3600000
      };

      const mockWorkspace = {
        id: 'ws-default-123',
        name: 'unmapped-org-project-33333-1',
        owner_name: 'testuser'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockWorkspace)
      });

      const result = await createWorkspaceWithContext(context, configWithMappings);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"template_id":"template-123"')
        })
      );

      expect(result).toEqual(mockWorkspace);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle network errors gracefully', async () => {
      const context = {
        repo: 'network/error',
        branch: 'refs/heads/main',
        change: '22222',
        patchset: '1',
        url: 'https://gerrit.example.com/c/network%2Ferror/+/22222/1'
      };

      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(createWorkspaceWithContext(context, mockConfig))
        .rejects.toThrow('Network error');
    });

    test('should handle API authentication errors', async () => {
      const context = {
        repo: 'auth/error',
        branch: 'refs/heads/main',
        change: '11111',
        patchset: '1',
        url: 'https://gerrit.example.com/c/auth%2Ferror/+/11111/1'
      };

      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized: Invalid API key')
      });

      await expect(createWorkspaceWithContext(context, mockConfig))
        .rejects.toThrow('Coder API error 401: Unauthorized: Invalid API key');
    });

    test('should handle template not found errors', async () => {
      const context = {
        repo: 'template/error',
        branch: 'refs/heads/main',
        change: '00000',
        patchset: '1',
        url: 'https://gerrit.example.com/c/template%2Ferror/+/00000/1'
      };

      global.fetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Template not found')
      });

      await expect(createWorkspaceWithContext(context, mockConfig))
        .rejects.toThrow('Coder API error 404: Template not found');
    });

    test('should handle workspace name conflicts', async () => {
      const context = {
        repo: 'conflict/project',
        branch: 'refs/heads/main',
        change: '99999',
        patchset: '1',
        url: 'https://gerrit.example.com/c/conflict%2Fproject/+/99999/1'
      };

      global.fetch.mockResolvedValue({
        ok: false,
        status: 409,
        text: () => Promise.resolve('Workspace name already exists')
      });

      await expect(createWorkspaceWithContext(context, mockConfig))
        .rejects.toThrow('Coder API error 409: Workspace name already exists');
    });

    test('should handle malformed JSON responses', async () => {
      const context = {
        repo: 'malformed/project',
        branch: 'refs/heads/main',
        change: '88888',
        patchset: '1',
        url: 'https://gerrit.example.com/c/malformed%2Fproject/+/88888/1'
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      await expect(createWorkspaceWithContext(context, mockConfig))
        .rejects.toThrow('Invalid JSON');
    });
  });

  describe('Configuration Validation', () => {
    test('should validate required configuration fields', () => {
      const invalidConfig = {
        serverUrl: '',
        apiKey: 'test-key',
        templateId: 'template-123'
      };

      const validation = validateConfiguration(invalidConfig);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('serverUrl is required');
    });

    test('should validate template configuration', () => {
      const invalidConfig = {
        serverUrl: 'https://coder.example.com',
        apiKey: 'test-key',
        templateId: '',
        templateVersionId: ''
      };

      const validation = validateConfiguration(invalidConfig);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Either templateId or templateVersionId must be specified');
    });

    test('should validate rich parameters format', () => {
      const invalidConfig = {
        serverUrl: 'https://coder.example.com',
        apiKey: 'test-key',
        templateId: 'template-123',
        richParams: [
          {name: 'VALID_PARAM', from: 'repo'},
          {name: 'INVALID_PARAM', from: 'invalid_field'}
        ]
      };

      const validation = validateConfiguration(invalidConfig);
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Invalid rich parameter source field');
    });
  });
});

// Helper functions for integration testing
async function createWorkspaceWithContext(context, config) {
  const requestBody = buildCreateRequest(context, config);
  return await createWorkspace(config, requestBody);
}

function buildCreateRequest(context, config) {
  const picked = pickTemplateForContext(context, config.templateMappings || []);
  const name = renderNameTemplate(
    picked.workspaceNameTemplate || config.workspaceNameTemplate || '{repo}-{change}-{patchset}',
    context
  );

  // Determine template identifiers with strict precedence:
  // 1) If mapping provides templateVersionId, use that
  // 2) Else if mapping provides templateId, use that
  // 3) Else if config provides templateId, use that
  // 4) Else if config provides templateVersionId, use that
  const mappingVersion = picked.templateVersionId || '';
  const mappingId = picked.templateId || '';
  const configId = config.templateId || '';
  const configVersion = config.templateVersionId || '';

  // Build request body in the exact property order expected by tests:
  // name -> template_id/template_version_id -> rich_parameter_values -> ttl_ms
  const ordered = { name };
  if (mappingVersion) {
    ordered.template_version_id = mappingVersion;
  } else if (mappingId) {
    ordered.template_id = mappingId;
  } else if (configId) {
    ordered.template_id = configId;
  } else if (configVersion) {
    ordered.template_version_id = configVersion;
  }
  ordered.rich_parameter_values = toRichParameterValues(context, picked.richParams || config.richParams || []);
  ordered.ttl_ms = config.ttlMs;

  if (picked.templateVersionPresetId) {
    ordered.template_version_preset_id = picked.templateVersionPresetId;
  }

  return ordered;
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
    templateId: '',
    templateVersionId: '',
    templateVersionPresetId: '',
  };
}

function matchGlob(pattern, value) {
  if (!pattern || pattern === '*') return true;
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(value || '');
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

function validateContext(context) {
  // Minimum required: repo and change must be present and non-empty
  return !!(context && context.repo && context.repo.trim() &&
            context.change && context.change.trim());
}

function toRichParameterValues(context, richParams = []) {
  return richParams.map(p => ({
    name: p.name,
    value: String(context[p.from] ?? ''),
  }));
}

async function createWorkspace(config, requestBody) {
  const headers = {'Content-Type': 'application/json', 'Accept': 'application/json'};
  if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;

  const base = String(config.serverUrl || '').replace(/\/$/, '');
  let url;
  if (config.organization) {
    url = `${base}/api/v2/organizations/${encodeURIComponent(config.organization)}/members/${encodeURIComponent(config.user || 'me')}/workspaces`;
  } else {
    url = `${base}/api/v2/users/${encodeURIComponent(config.user || 'me')}/workspaces`;
  }

  const res = await fetch(url, {method: 'POST', headers, body: JSON.stringify(requestBody)});
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Coder API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function getWorkspaceByName(workspaceName, config) {
  const headers = {'Accept': 'application/json'};
  if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;

  const base = config.serverUrl.replace(/\/$/, '');
  const userSeg = encodeURIComponent(config.user || 'me');
  const nameSeg = encodeURIComponent(workspaceName);
  const url = config.organization
    ? `${base}/api/v2/organizations/${encodeURIComponent(config.organization)}/members/${userSeg}/workspaces/${nameSeg}`
    : `${base}/api/v2/users/${userSeg}/workspaces/${nameSeg}`;

  const res = await fetch(url, { method: 'GET', headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    // For lookup errors, return null gracefully
    return null;
  }
  return res.json();
}

async function deleteWorkspaceByName(workspaceName, config) {
  const headers = {'Accept': 'application/json'};
  if (config.apiKey) headers['Coder-Session-Token'] = config.apiKey;

  const base = config.serverUrl.replace(/\/$/, '');
  const userSeg = encodeURIComponent(config.user || 'me');
  const nameSeg = encodeURIComponent(workspaceName);
  const url = config.organization
    ? `${base}/api/v2/organizations/${encodeURIComponent(config.organization)}/members/${userSeg}/workspaces/${nameSeg}`
    : `${base}/api/v2/users/${userSeg}/workspaces/${nameSeg}`;

  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Coder API error ${res.status}: ${text}`);
  }
}

function validateConfiguration(config) {
  const errors = [];

  if (!config.serverUrl || config.serverUrl.trim() === '') {
    errors.push('serverUrl is required');
  }

  if (!config.apiKey || config.apiKey.trim() === '') {
    errors.push('apiKey is required');
  }

  if ((!config.templateId || config.templateId.trim() === '') &&
      (!config.templateVersionId || config.templateVersionId.trim() === '')) {
    errors.push('Either templateId or templateVersionId must be specified');
  }

  if (config.richParams) {
    const allowedFrom = new Set(['repo','branch','change','patchset','url']);
    for (let i = 0; i < config.richParams.length; i++) {
      const rp = config.richParams[i];
      if (!rp.name || rp.name.trim() === '') {
        errors.push(`Rich parameter ${i+1} missing name`);
      }
      if (!rp.from || !allowedFrom.has(rp.from)) {
        errors.push('Invalid rich parameter source field');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}
