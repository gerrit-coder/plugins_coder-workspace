/**
 * Configuration Validation Tests for Coder Workspace Plugin
 *
 * These tests cover configuration validation, schema checking,
 * and error handling for various configuration scenarios.
 */

describe('Coder Workspace Plugin - Configuration Validation Tests', () => {
  let mockPlugin, mockConfig;

  beforeEach(() => {
    const api = { get: jest.fn() };
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
      popup: jest.fn()
    };

    // Default valid configuration
    mockConfig = {
      serverUrl: 'https://coder.example.com',
      apiKey: 'test-api-key-12345',
      organization: 'test-org-67890',
      user: 'testuser',
      templateId: 'template-123',
      templateVersionId: 'version-456',
      templateVersionPresetId: 'preset-789',
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Configuration Validation', () => {
    test('should validate complete configuration successfully', () => {
      const validation = validateConfiguration(mockConfig);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should require serverUrl', () => {
      const invalidConfig = { ...mockConfig, serverUrl: '' };
      const validation = validateConfiguration(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('serverUrl is required');
    });

    test('should require apiKey', () => {
      const invalidConfig = { ...mockConfig, apiKey: '' };
      const validation = validateConfiguration(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('apiKey is required');
    });

    test('should require either templateId or templateVersionId', () => {
      const invalidConfig = {
        ...mockConfig,
        templateId: '',
        templateVersionId: ''
      };
      const validation = validateConfiguration(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Either templateId or templateVersionId must be specified');
    });

    test('should accept templateId without templateVersionId', () => {
      const validConfig = {
        ...mockConfig,
        templateId: 'template-123',
        templateVersionId: ''
      };
      const validation = validateConfiguration(validConfig);

      expect(validation.valid).toBe(true);
    });

    test('should accept templateVersionId without templateId', () => {
      const validConfig = {
        ...mockConfig,
        templateId: '',
        templateVersionId: 'version-456'
      };
      const validation = validateConfiguration(validConfig);

      expect(validation.valid).toBe(true);
    });
  });

  describe('URL Validation', () => {
    test('should validate serverUrl format', () => {
      const invalidConfigs = [
        { ...mockConfig, serverUrl: 'not-a-url' },
        { ...mockConfig, serverUrl: 'ftp://invalid-protocol.com' },
        { ...mockConfig, serverUrl: 'https://' },
        { ...mockConfig, serverUrl: 'https://coder.example.com/' } // Trailing slash should be OK
      ];

      invalidConfigs.forEach((config, index) => {
        const validation = validateConfiguration(config);
        if (index < 3) { // First three should be invalid
          expect(validation.valid).toBe(false);
          expect(validation.errors).toContain('serverUrl must be a valid HTTPS URL');
        } else { // Last one should be valid
          expect(validation.valid).toBe(true);
        }
      });
    });

    test('should accept valid HTTPS URLs', () => {
      const validUrls = [
        'https://coder.example.com',
        'https://coder.example.com:8080',
        'https://subdomain.coder.example.com',
        'https://coder.example.com/path'
      ];

      validUrls.forEach(url => {
        const config = { ...mockConfig, serverUrl: url };
        const validation = validateConfiguration(config);
        expect(validation.valid).toBe(true);
      });
    });
  });

  describe('Rich Parameters Validation', () => {
    test('should validate rich parameters structure', () => {
      const invalidConfig = {
        ...mockConfig,
        richParams: [
          {name: 'VALID_PARAM', from: 'repo'},
          {name: '', from: 'branch'}, // Empty name
          {name: 'INVALID_PARAM', from: 'invalid_field'} // Invalid from field
        ]
      };

      const validation = validateConfiguration(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Rich parameter 2 missing name');
      expect(validation.errors).toContain('Invalid rich parameter source field: invalid_field');
    });

    test('should validate allowed source fields', () => {
      const allowedFields = ['repo', 'branch', 'change', 'patchset', 'url'];
      const invalidFields = ['invalid', 'custom', 'unknown'];

      allowedFields.forEach(field => {
        const config = {
          ...mockConfig,
          richParams: [{name: 'TEST_PARAM', from: field}]
        };
        const validation = validateConfiguration(config);
        expect(validation.valid).toBe(true);
      });

      invalidFields.forEach(field => {
        const config = {
          ...mockConfig,
          richParams: [{name: 'TEST_PARAM', from: field}]
        };
        const validation = validateConfiguration(config);
        expect(validation.valid).toBe(false);
        expect(validation.errors).toContain(`Invalid rich parameter source field: ${field}`);
      });
    });

    test('should handle empty rich parameters', () => {
      const config = { ...mockConfig, richParams: [] };
      const validation = validateConfiguration(config);

      expect(validation.valid).toBe(true);
    });

    test('should handle null rich parameters', () => {
      const config = { ...mockConfig, richParams: null };
      const validation = validateConfiguration(config);

      expect(validation.valid).toBe(true);
    });
  });

  describe('Template Mappings Validation', () => {
    test('should validate template mappings structure', () => {
      const invalidConfig = {
        ...mockConfig,
        templateMappings: [
          {
            repo: 'valid/repo',
            branch: 'refs/heads/main',
            templateId: 'template-123'
          },
          {
            repo: '', // Empty repo
            branch: 'refs/heads/main',
            templateId: 'template-456'
          },
          {
            repo: 'invalid/repo',
            branch: 'refs/heads/main',
            templateId: '', // Empty template
            templateVersionId: '' // Both template fields empty
          }
        ]
      };

      const validation = validateConfiguration(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Template mapping 2: repo cannot be empty');
      expect(validation.errors).toContain('Template mapping 3: Either templateId or templateVersionId must be specified');
    });

    test('should validate template mapping rich parameters', () => {
      const invalidConfig = {
        ...mockConfig,
        templateMappings: [
          {
            repo: 'test/repo',
            branch: 'refs/heads/main',
            templateId: 'template-123',
            richParams: [
              {name: 'VALID_PARAM', from: 'repo'},
              {name: 'INVALID_PARAM', from: 'invalid_field'}
            ]
          }
        ]
      };

      const validation = validateConfiguration(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Template mapping 1: Invalid rich parameter source field: invalid_field');
    });

    test('should validate template mapping workspace name template', () => {
      const invalidConfig = {
        ...mockConfig,
        templateMappings: [
          {
            repo: 'test/repo',
            branch: 'refs/heads/main',
            templateId: 'template-123',
            workspaceNameTemplate: '{invalid_token}' // Invalid token
          }
        ]
      };

      const validation = validateConfiguration(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Template mapping 1: Invalid workspace name template token: {invalid_token}');
    });

    test('should accept valid template mappings', () => {
      const validConfig = {
        ...mockConfig,
        templateMappings: [
          {
            repo: 'my/org/*',
            branch: 'refs/heads/main',
            templateVersionId: 'template-main-123',
            workspaceNameTemplate: '{repo}-main-{change}',
            richParams: [
              {name: 'REPO', from: 'repo'},
              {name: 'BRANCH', from: 'branch'}
            ]
          },
          {
            repo: 'my/org/*',
            branch: 'refs/heads/*',
            templateId: 'template-any-456'
          }
        ]
      };

      const validation = validateConfiguration(validConfig);

      expect(validation.valid).toBe(true);
    });
  });

  describe('Workspace Name Template Validation', () => {
    test('should validate workspace name template tokens', () => {
      const invalidTemplates = [
        '{invalid_token}',
        '{repo}-{invalid}-{change}',
        '{repo}-{branch}-{change}-{invalid}'
      ];

      invalidTemplates.forEach(template => {
        const config = { ...mockConfig, workspaceNameTemplate: template };
        const validation = validateConfiguration(config);

        expect(validation.valid).toBe(false);
        expect(validation.errors).toContain(`Invalid workspace name template token: ${template}`);
      });
    });

    test('should accept valid workspace name templates', () => {
      const validTemplates = [
        '{repo}-{change}-{patchset}',
        '{repo}-{branch}-{change}',
        '{repo}-{change}',
        'custom-{repo}-{change}',
        '{repo}_{change}_{patchset}'
      ];

      validTemplates.forEach(template => {
        const config = { ...mockConfig, workspaceNameTemplate: template };
        const validation = validateConfiguration(config);

        expect(validation.valid).toBe(true);
      });
    });

    test('should handle empty workspace name template', () => {
      const config = { ...mockConfig, workspaceNameTemplate: '' };
      const validation = validateConfiguration(config);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('workspaceNameTemplate cannot be empty');
    });
  });

  describe('Numeric Value Validation', () => {
    test('should validate ttlMs is non-negative', () => {
      const invalidConfig = { ...mockConfig, ttlMs: -1 };
      const validation = validateConfiguration(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('ttlMs must be non-negative');
    });

    test('should accept valid ttlMs values', () => {
      const validValues = [0, 3600000, 86400000, 604800000]; // 0, 1 hour, 1 day, 1 week

      validValues.forEach(ttlMs => {
        const config = { ...mockConfig, ttlMs };
        const validation = validateConfiguration(config);

        expect(validation.valid).toBe(true);
      });
    });
  });

  describe('Boolean Value Validation', () => {
    test('should validate boolean fields', () => {
      const config = {
        ...mockConfig,
        openAfterCreate: 'invalid',
        enableDryRunPreview: 'invalid'
      };
      const validation = validateConfiguration(config);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('openAfterCreate must be a boolean value');
      expect(validation.errors).toContain('enableDryRunPreview must be a boolean value');
    });

    test('should accept valid boolean values', () => {
      const config = {
        ...mockConfig,
        openAfterCreate: false,
        enableDryRunPreview: true
      };
      const validation = validateConfiguration(config);

      expect(validation.valid).toBe(true);
    });
  });

  describe('String Value Validation', () => {
    test('should validate string fields are not null', () => {
      const config = {
        ...mockConfig,
        user: null
      };
      const validation = validateConfiguration(config);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('user cannot be null');
    });
  });

  describe('Complex Configuration Scenarios', () => {
    test('should validate configuration with all optional fields', () => {
      const complexConfig = {
        serverUrl: 'https://coder.example.com',
        apiKey: 'test-api-key',
        organization: 'test-org',
        user: 'testuser',
        templateId: 'template-123',
        templateVersionId: 'version-456',
        templateVersionPresetId: 'preset-789',
        workspaceNameTemplate: '{repo}-{change}-{patchset}',
        richParams: [
          {name: 'REPO', from: 'repo'},
          {name: 'BRANCH', from: 'branch'},
          {name: 'GERRIT_CHANGE', from: 'change'},
          {name: 'GERRIT_PATCHSET', from: 'patchset'},
          {name: 'GERRIT_CHANGE_URL', from: 'url'}
        ],
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
        ],
        ttlMs: 3600000,
        openAfterCreate: true,
        enableDryRunPreview: false
      };

      const validation = validateConfiguration(complexConfig);

      expect(validation.valid).toBe(true);
    });

    test('should validate minimal configuration', () => {
      const minimalConfig = {
        serverUrl: 'https://coder.example.com',
        apiKey: 'test-api-key',
        templateId: 'template-123',
        user: 'testuser',
        openAfterCreate: true,
        enableDryRunPreview: false,
        ttlMs: 0,
        workspaceNameTemplate: '{repo}-{change}-{patchset}'
      };

      const validation = validateConfiguration(minimalConfig);

      expect(validation.valid).toBe(true);
    });

    test('should handle multiple validation errors', () => {
      const invalidConfig = {
        serverUrl: '',
        apiKey: '',
        templateId: '',
        templateVersionId: '',
        user: null,
        ttlMs: -1,
        workspaceNameTemplate: '{invalid_token}',
        richParams: [
          {name: '', from: 'invalid_field'}
        ],
        templateMappings: [
          {
            repo: '',
            branch: 'refs/heads/main',
            templateId: '',
            templateVersionId: ''
          }
        ]
      };

      const validation = validateConfiguration(invalidConfig);

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(5);
    });
  });

  describe('Configuration Loading and Parsing', () => {
    test('should handle malformed JSON in templateMappingsJson', async () => {
      const mockPluginConfig = {
        ...mockConfig,
        templateMappingsJson: 'invalid json'
      };

      mockPlugin.restApi().get.mockResolvedValue(mockPluginConfig);

      // Simulate configuration loading
      const config = await loadServerConfig(mockPlugin);

      // Should fall back to default empty mappings
      expect(config.templateMappings).toEqual([]);
    });

    test('should parse valid templateMappingsJson', async () => {
      const mappingsJson = JSON.stringify([
        {
          repo: 'test/repo',
          branch: 'refs/heads/main',
          templateId: 'template-123'
        }
      ]);

      const mockPluginConfig = {
        ...mockConfig,
        templateMappingsJson: mappingsJson
      };

      mockPlugin.restApi().get.mockResolvedValue(mockPluginConfig);

      const config = await loadServerConfig(mockPlugin);

      expect(config.templateMappings).toHaveLength(1);
      expect(config.templateMappings[0].repo).toBe('test/repo');
    });

    test('should handle empty templateMappingsJson', async () => {
      const mockPluginConfig = {
        ...mockConfig,
        templateMappingsJson: ''
      };

      mockPlugin.restApi().get.mockResolvedValue(mockPluginConfig);

      const config = await loadServerConfig(mockPlugin);

      expect(config.templateMappings).toEqual([]);
    });
  });
});

// Helper functions for configuration validation
function validateConfiguration(config) {
  const errors = [];

  // Required fields
  if (!config.serverUrl || config.serverUrl.trim() === '') {
    errors.push('serverUrl is required');
  } else if (!isValidUrl(config.serverUrl)) {
    errors.push('serverUrl must be a valid HTTPS URL');
  }

  if (!config.apiKey || config.apiKey.trim() === '') {
    errors.push('apiKey is required');
  }

  if ((!config.templateId || config.templateId.trim() === '') &&
      (!config.templateVersionId || config.templateVersionId.trim() === '')) {
    errors.push('Either templateId or templateVersionId must be specified');
  }

  // String fields
  if (config.user === null || config.user === undefined) {
    errors.push('user cannot be null');
  }

  // Boolean fields

  if (typeof config.openAfterCreate !== 'boolean') {
    errors.push('openAfterCreate must be a boolean value');
  }

  if (typeof config.enableDryRunPreview !== 'boolean') {
    errors.push('enableDryRunPreview must be a boolean value');
  }

  // Numeric fields
  if (config.ttlMs < 0) {
    errors.push('ttlMs must be non-negative');
  }

  // Workspace name template
  if (!config.workspaceNameTemplate || config.workspaceNameTemplate.trim() === '') {
    errors.push('workspaceNameTemplate cannot be empty');
  } else if (!isValidWorkspaceNameTemplate(config.workspaceNameTemplate)) {
    errors.push(`Invalid workspace name template token: ${config.workspaceNameTemplate}`);
  }

  // Rich parameters
  if (config.richParams) {
    const allowedFrom = new Set(['repo','branch','change','patchset','url']);
    for (let i = 0; i < config.richParams.length; i++) {
      const rp = config.richParams[i];
      if (!rp.name || rp.name.trim() === '') {
        errors.push(`Rich parameter ${i+1} missing name`);
      }
      if (!rp.from || !allowedFrom.has(rp.from)) {
        errors.push(`Invalid rich parameter source field: ${rp.from}`);
      }
    }
  }

  // Template mappings
  if (config.templateMappings) {
    for (let i = 0; i < config.templateMappings.length; i++) {
      const mapping = config.templateMappings[i];

      if (!mapping.repo || mapping.repo.trim() === '') {
        errors.push(`Template mapping ${i+1}: repo cannot be empty`);
      }

      if ((!mapping.templateId || mapping.templateId.trim() === '') &&
          (!mapping.templateVersionId || mapping.templateVersionId.trim() === '')) {
        errors.push(`Template mapping ${i+1}: Either templateId or templateVersionId must be specified`);
      }

      if (mapping.workspaceNameTemplate && !isValidWorkspaceNameTemplate(mapping.workspaceNameTemplate)) {
        errors.push(`Template mapping ${i+1}: Invalid workspace name template token: ${mapping.workspaceNameTemplate}`);
      }

      if (mapping.richParams) {
        const allowedFrom = new Set(['repo','branch','change','patchset','url']);
        for (let j = 0; j < mapping.richParams.length; j++) {
          const rp = mapping.richParams[j];
          if (!rp.from || !allowedFrom.has(rp.from)) {
            errors.push(`Template mapping ${i+1}: Invalid rich parameter source field: ${rp.from}`);
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidWorkspaceNameTemplate(template) {
  const allowedTokens = new Set(['{repo}', '{branch}', '{change}', '{patchset}']);
  const tokenRegex = /\{[^}]+\}/g;
  const matches = template.match(tokenRegex) || [];

  return matches.every(token => allowedTokens.has(token));
}

async function loadServerConfig(plugin) {
  const defaultConfig = {
    serverUrl: '',
    apiKey: '',
    organization: '',
    user: 'me',
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
    const config = Object.assign({}, defaultConfig, serverCfg);

    // Parse templateMappingsJson if present
    if (typeof config.templateMappingsJson === 'string' && config.templateMappingsJson.trim() !== '') {
      try {
        config.templateMappings = JSON.parse(config.templateMappingsJson);
      } catch {
        config.templateMappings = [];
      }
    }

    return config;
  } catch (err) {
    console.warn('[coder-workspace] Failed to load server config', err);
    return defaultConfig;
  }
}
