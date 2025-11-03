/**
 * Candidate names unit tests (Jest + jsdom)
 */

describe('coder-workspace: candidate names generation', () => {
  beforeAll(async () => {
    // Prevent plugin install during tests
    global.window.Gerrit = global.window.Gerrit || {};
    await import('../plugin.js');
    if (!window.__coderWorkspaceTest__) {
      throw new Error('__coderWorkspaceTest__ not found on window');
    }
  });

  test('falls back to default alternates and adds {repo}-{change} when branch is empty', () => {
    const { computeCandidateNames } = window.__coderWorkspaceTest__;
    const ctx = { repo: 'gerrit-coder', branch: '', change: '1', patchset: '' };
    const cfg = { workspaceNameTemplate: '{repo}-{change}-{patchset}', alternateNameTemplates: [] };
    const candidates = computeCandidateNames(ctx, cfg);
    // expectedName from template is "gerrit-coder-1" (patchset empty drops)
    // alternates default to ['{repo}.{branchShort}'] => 'gerrit-coder' (branchShort empty trims trailing dot)
    // plus heuristic '{repo}-{change}' because branch is empty => 'gerrit-coder-1' (deduped)
    expect(candidates).toEqual(['gerrit-coder-1', 'gerrit-coder']);
  });

  test('uses provided alternates when present (no branch heuristic)', () => {
    const { computeCandidateNames } = window.__coderWorkspaceTest__;
    const ctx = { repo: 'gerrit-coder', branch: 'refs/heads/feature/foo', branchShort: 'foo', change: '123', patchset: '1' };
    const cfg = { workspaceNameTemplate: '{repo}-{change}-{patchset}', alternateNameTemplates: ['{repo}.{branchShort}'] };
    const candidates = computeCandidateNames(ctx, cfg);
    expect(candidates).toEqual(['gerrit-coder-123-1', 'gerrit-coder.foo']);
  });
});
