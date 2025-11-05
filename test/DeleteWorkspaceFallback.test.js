// Prevent plugin auto-install during tests
window.Gerrit = window.Gerrit || {};

describe('coder-workspace: delete fallbacks', () => {
  beforeEach(() => {
    jest.resetModules();
    // Silence expected warnings/errors from fallback attempts in tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    // Load plugin script to populate window.__coderWorkspaceTest__
    require('../plugin.js');
    if (!window.__coderWorkspaceTest__) {
      throw new Error('__coderWorkspaceTest__ not found on window');
    }
    const { setConfig, setGetWorkspaceByName } = window.__coderWorkspaceTest__;
    // Use real lookup but we'll stub fetch responses deterministically
    setGetWorkspaceByName(undefined);
    setConfig({ serverUrl: 'https://coder.example.com', user: 'lemon', apiKey: 'k', organization: '' });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    const { setConfig, setGetWorkspaceByName } = window.__coderWorkspaceTest__;
    setGetWorkspaceByName(undefined);
    setConfig({ serverUrl: '', user: 'me', apiKey: '', organization: '' });
    jest.clearAllMocks();
    // Restore console spies
    if (console.warn && console.warn.mockRestore) console.warn.mockRestore();
    if (console.error && console.error.mockRestore) console.error.mockRestore();
  });

  test('falls back to DELETE by user/name (plural) when id and singular routes fail', async () => {
    const { getWorkspaceByName, deleteWorkspaceByName } = window.__coderWorkspaceTest__;

    // First call (inside delete) resolves workspace by name
    const ws = { id: 'abc-123', name: 'gerrit-coder-1', owner_name: 'lemon' };

    // Mock fetch for getWorkspaceByName flow: singular by-name returns ws
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/users/lemon/workspace/gerrit-coder-1');
      return Promise.resolve({ ok: true, json: () => Promise.resolve(ws) });
    });

    // Candidate 1: DELETE by id -> 405
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/workspaces/abc-123');
      expect(opts && opts.method).toBe('DELETE');
      return Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') });
    });

    // Candidate 2: DELETE by id?hard=true -> 405
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/workspaces/abc-123?hard=true');
      expect(opts && opts.method).toBe('DELETE');
      return Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') });
    });

    // Candidate 3: DELETE by id?force=true -> 405
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/workspaces/abc-123?force=true');
      expect(opts && opts.method).toBe('DELETE');
      return Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') });
    });

    // Candidate 4: DELETE by id?hard=true&force=true -> 405
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/workspaces/abc-123?hard=true&force=true');
      expect(opts && opts.method).toBe('DELETE');
      return Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') });
    });

    // Candidate 5: DELETE by user/name (singular) -> 405
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/users/lemon/workspace/gerrit-coder-1');
      expect(opts && opts.method).toBe('DELETE');
      return Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') });
    });

    // Candidate 6: DELETE by user/name (plural) -> 200
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/users/lemon/workspaces/gerrit-coder-1');
      expect(opts && opts.method).toBe('DELETE');
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
    });

    await expect(deleteWorkspaceByName('gerrit-coder-1')).resolves.toBe('hard');

    // We expect exactly 7 fetches: GET-by-name + 4 id variants + DELETE user (singular) + DELETE user (plural)
    expect(global.fetch).toHaveBeenCalledTimes(7);
  });

  test('falls through to POST action endpoint when DELETE routes fail', async () => {
    const { deleteWorkspaceByName } = window.__coderWorkspaceTest__;

    const ws = { id: 'abc-456', name: 'gerrit-coder-2', owner_name: 'lemon' };

    // 1) Lookup by name
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(ws) }));
    // 2) DELETE by id -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 3) DELETE by id?hard=true -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 4) DELETE by id?force=true -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 5) DELETE by id?hard=true&force=true -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 6) DELETE by user/name (singular) -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 7) DELETE by user/name (plural) -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 8) Global by-name delete -> 404
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') }));
    // 9) Since no org configured, skip org-scoped; next is POST action endpoint -> 200
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/workspaces/abc-456/delete');
      expect(opts && opts.method).toBe('POST');
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
    });

    await expect(deleteWorkspaceByName('gerrit-coder-2')).resolves.toBe('hard');

    expect(global.fetch).toHaveBeenCalledTimes(9);
  });

  test('throws when all deletion candidates fail (and dormant+ttl fallback fails)', async () => {
    const { deleteWorkspaceByName, setConfig } = window.__coderWorkspaceTest__;

    const ws = { id: 'abc-789', name: 'gerrit-coder-3', owner_name: 'lemon' };

    // Enable org to exercise org-scoped path too
    setConfig({ organization: 'org-1' });

    // 1) Lookup by name
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(ws) }));
    // 2) DELETE by id -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 3) DELETE by id?hard=true -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 4) DELETE by id?force=true -> 400
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('Bad Request') }));
    // 5) DELETE by id?hard=true&force=true -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 6) DELETE by user/name (singular) -> 404
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') }));
    // 7) DELETE by user/name (plural) -> 404
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') }));
    // 8) DELETE org-scoped (singular) -> 400
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('Bad Request') }));
    // 9) DELETE org-scoped (plural) -> 400
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('Bad Request') }));
    // 10) Global by-name delete -> 404
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') }));
    // 11) POST action endpoint -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 12) POST action endpoint (hard) -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 13) PUT dormant -> 400
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/workspaces/abc-789/dormant');
      expect(opts && opts.method).toBe('PUT');
      // should be JSON body {dormant:true}
      return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('Bad Request') });
    });
    // 14) PUT ttl -> 400, but verify ttl_ms=60000 in request body
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/workspaces/abc-789/ttl');
      expect(opts && opts.method).toBe('PUT');
      expect(JSON.parse(opts.body)).toEqual({ ttl_ms: 60000 });
      return Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('Bad Request') });
    });

    await expect(deleteWorkspaceByName('gerrit-coder-3')).rejects.toThrow(/Unable to delete workspace/);

    expect(global.fetch).toHaveBeenCalledTimes(14); // 1 lookup + 11 candidates + 2 soft fallbacks (dormant, ttl)
  });

  test('returns soft when hard delete routes fail but dormant+ttl succeed', async () => {
    const { deleteWorkspaceByName } = window.__coderWorkspaceTest__;

    const ws = { id: 'abc-soft', name: 'gerrit-coder-soft', owner_name: 'lemon' };

    // 1) Lookup by name
    global.fetch.mockImplementationOnce((url, opts) => Promise.resolve({ ok: true, json: () => Promise.resolve(ws) }));
    // 2-5) DELETE by id variants -> 405
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    // 6-7) DELETE user/name (singular, plural) -> 405/404
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 405, text: () => Promise.resolve('Method Not Allowed') }));
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') }));
    // 8) Global by-name delete -> 400
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('Bad Request') }));
    // 9-10) POST action endpoints -> 404
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') }));
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not Found') }));
    // 11) PUT dormant -> 200
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/workspaces/abc-soft/dormant');
      expect(opts && opts.method).toBe('PUT');
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
    });
    // 12) PUT ttl -> 204, with ttl_ms=60000
    global.fetch.mockImplementationOnce((url, opts) => {
      expect(url).toBe('https://coder.example.com/api/v2/workspaces/abc-soft/ttl');
      expect(opts && opts.method).toBe('PUT');
      expect(JSON.parse(opts.body)).toEqual({ ttl_ms: 60000 });
      return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
    });

    await expect(deleteWorkspaceByName('gerrit-coder-soft')).resolves.toBe('soft');
    expect(global.fetch).toHaveBeenCalledTimes(12);
  });
});
