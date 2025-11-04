// Prevent plugin auto-install during tests
window.Gerrit = window.Gerrit || {};

describe('coder-workspace: readiness polling and deeplink computation', () => {
  beforeAll(() => {
    // Load plugin script to populate window.__coderWorkspaceTest__
    require('../plugin.js');
    if (!window.__coderWorkspaceTest__) {
      throw new Error('__coderWorkspaceTest__ not found on window');
    }
  });

  afterEach(() => {
    // Restore any injected functions/config to defaults between tests
    const { setGetWorkspaceByName, setConfig } = window.__coderWorkspaceTest__;
    setGetWorkspaceByName(undefined);
    setConfig({ appSlug: 'code-server', serverUrl: '' });
  });

  test('computeWorkspaceUrl falls back to app deeplink when latest_app_status.uri absent', () => {
    const { computeWorkspaceUrl, setConfig } = window.__coderWorkspaceTest__;
    // Ensure serverUrl and appSlug are set for deeplink
    setConfig({ serverUrl: 'https://coder.example.com', appSlug: 'code-server' });

    const wsNoUri = {
      owner_name: 'lemon',
      name: 'gerrit-coder-1.main',
      latest_app_status: null,
    };
    const url = computeWorkspaceUrl(wsNoUri);
    expect(url).toBe('https://coder.example.com/@lemon/gerrit-coder-1.main/apps/code-server/');

    const wsWithUri = {
      owner_name: 'lemon',
      name: 'anything',
      latest_app_status: { uri: 'https://coder.example.com/@lemon/exact-uri' },
    };
    const url2 = computeWorkspaceUrl(wsWithUri);
    expect(url2).toBe('https://coder.example.com/@lemon/exact-uri');
  });

  test('waitForWorkspaceApp polls until uri becomes available (within timeout)', async () => {
    const { waitForWorkspaceApp, setGetWorkspaceByName } = window.__coderWorkspaceTest__;

    let calls = 0;
    const created = { name: 'ws-123', owner_name: 'lemon', latest_app_status: null };
    const ready = { name: 'ws-123', owner_name: 'lemon', latest_app_status: { uri: 'https://coder.example.com/@lemon/ws-123' } };

    setGetWorkspaceByName(async (name) => {
      calls++;
      // First two calls: no URI yet
      if (calls < 3) return created;
      // Third call: becomes ready
      return ready;
    });

    const result = await waitForWorkspaceApp('ws-123', 1500, 50);
    expect(result).toEqual(ready);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  test('waitForWorkspaceApp returns last seen state when timeout elapses', async () => {
    const { waitForWorkspaceApp, setGetWorkspaceByName } = window.__coderWorkspaceTest__;

    const created = { name: 'ws-123', owner_name: 'lemon', latest_app_status: null };
    setGetWorkspaceByName(async () => created);

    const start = Date.now();
    const result = await waitForWorkspaceApp('ws-123', 200, 50);
    const elapsed = Date.now() - start;

    // Should time out and return the last seen workspace (without uri)
    expect(result).toEqual(created);
    expect(elapsed).toBeGreaterThanOrEqual(150);
  });

  test('generateUniqueName appends sanitized stamp and remains within limits', () => {
    const { generateUniqueName } = window.__coderWorkspaceTest__;
    const base = 'my/repo//invalid***name';
    const unique = generateUniqueName(base);

    // Should be sanitized (slashes/specials replaced) and contain hyphen stamp
    expect(unique).toMatch(/^my-repo-invalid-name-[a-z0-9]+$/);
    expect(unique.length).toBeLessThanOrEqual(63);
  });

  test('openFinalUrl appends coder_session_token when enabled', () => {
    const { setConfig, openFinalUrl } = window.__coderWorkspaceTest__;

    // Spy on window.open
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => ({}));

    setConfig({
      serverUrl: 'https://coder.example.com',
      apiKey: 'abc123',
      appendTokenToAppUrl: true,
    });

    const appUrl = 'https://coder.example.com/@lemon/gerrit-coder-1/apps/code-server/';
    openFinalUrl(appUrl);

    expect(openSpy).toHaveBeenCalledTimes(1);
    const calledUrl = openSpy.mock.calls[0][0];
    expect(calledUrl).toMatch(/^https:\/\/coder\.example\.com\/@lemon\/gerrit-coder-1\/apps\/code-server\//);
    expect(calledUrl).toContain('coder_session_token=abc123');

    openSpy.mockRestore();
  });
});
