// Prevent the plugin from trying to install into Gerrit during tests
window.Gerrit = window.Gerrit || {};

describe('coder-workspace: renderNameTemplate and candidate names', () => {
  beforeAll(() => {
    // Load the plugin script, which will attach test helpers to window
    require('../plugin.js');
    if (!window.__coderWorkspaceTest__) {
      throw new Error('__coderWorkspaceTest__ not found on window');
    }
  });

  test('renderNameTemplate replaces {branchShort} correctly', () => {
    const { renderNameTemplate } = window.__coderWorkspaceTest__;
    const ctx = { repo: 'gerrit-coder', branch: 'refs/heads/main' };
    const name = renderNameTemplate('{repo}.{branchShort}', ctx);
    expect(name).toBe('gerrit-coder.main');
  });

  test('computeCandidateNames returns expected order and uniqueness', () => {
    const { computeCandidateNames } = window.__coderWorkspaceTest__;
    const ctx = { repo: 'gerrit-coder', branch: 'refs/heads/feature/foo', branchShort: 'foo', change: '123', patchset: '1' };
    const cfg = { workspaceNameTemplate: '{repo}-{change}-{patchset}', alternateNameTemplates: ['{repo}.{branchShort}', '{repo}.{branchShort}'] };
    const candidates = computeCandidateNames(ctx, cfg);
    expect(candidates).toEqual(['gerrit-coder-123-1', 'gerrit-coder.foo']);
  });
});
