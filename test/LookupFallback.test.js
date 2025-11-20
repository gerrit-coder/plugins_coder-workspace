// Prevent plugin auto-install during tests
window.Gerrit = window.Gerrit || {};

describe('coder-workspace: GET-by-name variants and name-only fallback', () => {
  beforeEach(() => {
    jest.resetModules();
    // Load plugin script to populate window.__coderWorkspaceTest__
    require('../plugin.js');
    if (!window.__coderWorkspaceTest__) {
      throw new Error('__coderWorkspaceTest__ not found on window');
    }
    // Configure server URL and user
    const { setConfig, setGetWorkspaceByName } = window.__coderWorkspaceTest__;
    setGetWorkspaceByName(undefined); // ensure real implementation
    setConfig({ serverUrl: 'https://coder.example.com', apiKey: 'k', organization: '' });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    // Reset injected fetch and config
    const { setConfig, setGetWorkspaceByName } = window.__coderWorkspaceTest__;
    setGetWorkspaceByName(undefined);
    setConfig({ serverUrl: '', apiKey: '', organization: '' });
    jest.clearAllMocks();
  });

  test('uses singular GET /api/v2/users/{user}/workspace/{name} per docs', async () => {
    const { getWorkspaceByName } = window.__coderWorkspaceTest__;

    const ws = { name: 'gerrit-coder-1', owner_name: 'lemon', latest_app_status: { uri: 'https://coder.example.com/@lemon/gerrit-coder-1' } };
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(ws) });

    const result = await getWorkspaceByName('gerrit-coder-1');

    expect(result).toEqual(ws);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://coder.example.com/api/v2/users/me/workspace/gerrit-coder-1',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Accept: 'application/json', 'Coder-Session-Token': 'k' }) })
    );
  });

  test('falls back to name-only global search when owner+name yields nothing', async () => {
    const { getWorkspaceByName } = window.__coderWorkspaceTest__;

    const ws = { name: 'gerrit-coder-1', owner_name: 'lemon', latest_app_status: { uri: 'https://coder.example.com/@lemon/gerrit-coder-1' } };

    // Suppress expected lookup warnings during fallbacks
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Call 1: singular GET-by-name -> 404
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    // Call 2: list with owner+name -> empty result
    global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ workspaces: [] }) });
    // Call 3: list with name-only -> returns desired workspace
    global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ workspaces: [ws] }) });

    const result = await getWorkspaceByName('gerrit-coder-1');

    expect(result).toEqual(ws);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://coder.example.com/api/v2/users/me/workspace/gerrit-coder-1',
      expect.objectContaining({ method: 'GET' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^https:\/\/coder\.example\.com\/api\/v2\/workspaces\?q=name%3Agerrit-coder-1&limit=10$/),
      expect.objectContaining({ method: 'GET' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/^https:\/\/coder\.example\.com\/api\/v2\/workspaces\?q=name%3Agerrit-coder-1&limit=10$/),
      expect.objectContaining({ method: 'GET' })
    );

    warnSpy.mockRestore();
  });

  test('retries GET with token as query param on 401', async () => {
    const { getWorkspaceByName } = window.__coderWorkspaceTest__;

    const ws = { name: 'gerrit-coder-1', owner_name: 'lemon', latest_app_status: null };

    // First attempt: 401 Unauthorized
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
    // Retry (with query param token): succeed
    global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ws) });

    const result = await getWorkspaceByName('gerrit-coder-1');
    expect(result).toEqual(ws);

    expect(global.fetch).toHaveBeenNthCalledWith(1,
      'https://coder.example.com/api/v2/users/me/workspace/gerrit-coder-1',
      expect.objectContaining({ method: 'GET' })
    );
    const secondUrl = global.fetch.mock.calls[1][0];
    expect(secondUrl).toMatch(/^https:\/\/coder\.example\.com\/api\/v2\/users\/me\/workspace\/gerrit-coder-1/);
    expect(secondUrl).toContain('coder_session_token=k');
  });
});
