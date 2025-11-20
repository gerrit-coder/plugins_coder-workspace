// Prevent plugin auto-install during tests
window.Gerrit = window.Gerrit || {};

describe('coder-workspace: strictName create behavior', () => {
  beforeEach(() => {
    jest.resetModules();
    require('../plugin.js');
    if (!window.__coderWorkspaceTest__) throw new Error('__coderWorkspaceTest__ not found');
    const { setConfig, setGetWorkspaceByName } = window.__coderWorkspaceTest__;
    setGetWorkspaceByName(undefined);
    setConfig({
      serverUrl: 'https://coder.example.com',
      apiKey: 'k',
      organization: '',
      strictName: true,
      workspaceNameTemplate: '{repo}-{change}',
    });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    const { setConfig, setGetWorkspaceByName } = window.__coderWorkspaceTest__;
    setGetWorkspaceByName(undefined);
    setConfig({ serverUrl: '', apiKey: '', organization: '', strictName: false });
    jest.clearAllMocks();
  });

  test('strict create: POST success returns created workspace', async () => {
    const { buildCreateRequest, createWorkspaceStrict } = window.__coderWorkspaceTest__;

    const ctx = { repo: 'gerrit-coder', change: '1', branch: 'refs/heads/main', patchset: '1', url: '' };
    const body = buildCreateRequest(ctx);

    const ws = { name: 'gerrit-coder-1', owner_name: 'lemon', latest_app_status: null };
    global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ws) });

    const result = await createWorkspaceStrict(body);
    expect(result).toEqual(ws);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://coder.example.com/api/v2/users/me/workspaces',
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('strict create: 409 -> fetch existing by name (singular per docs), no auto-suffix', async () => {
    const { buildCreateRequest, createWorkspaceStrict } = window.__coderWorkspaceTest__;
    const ctx = { repo: 'gerrit-coder', change: '1', branch: 'refs/heads/main', patchset: '1', url: '' };
    const body = buildCreateRequest(ctx);

    // Suppress expected warning log from 409 path during test output
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // POST 409
    global.fetch.mockResolvedValueOnce({ ok: false, status: 409, text: () => Promise.resolve('Workspace name already exists') });
  // GET existing by name (singular endpoint succeeds)
    const ws = { name: 'gerrit-coder-1', owner_name: 'lemon' };
    global.fetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(ws) });

    const result = await createWorkspaceStrict(body);
    expect(result).toEqual(ws);
    // Assert singular GET-by-name path used
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://coder.example.com/api/v2/users/me/workspace/gerrit-coder-1',
      expect.objectContaining({ method: 'GET' })
    );

    warnSpy.mockRestore();
  });

  test('strict create: 409 -> existing not visible -> throw', async () => {
    const { buildCreateRequest, createWorkspaceStrict } = window.__coderWorkspaceTest__;
    const ctx = { repo: 'gerrit-coder', change: '1', branch: 'refs/heads/main', patchset: '1', url: '' };
    const body = buildCreateRequest(ctx);

    // Suppress expected warnings from 409/conflict handling to keep output clean
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // POST 409
    global.fetch.mockResolvedValueOnce({ ok: false, status: 409, text: () => Promise.resolve('Workspace name already exists') });
    // GET returns 404
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(createWorkspaceStrict(body)).rejects.toThrow();

    warnSpy.mockRestore();
  });
});
