import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldSpawnBreakingChanges, fetchPrFiles, fetchPrLabels } from '../should-spawn-breaking-changes.js';
import { ghApi } from '../lib/github-utils.js';

vi.mock('../lib/github-utils.js', async () => {
  const actual = await vi.importActual('../lib/github-utils.js');
  return {
    ...actual,
    ghApi: vi.fn(),
  };
});

describe('shouldSpawnBreakingChanges', () => {
  it('should spawn when action.yml is modified', () => {
    const files = [{ filename: 'action.yml', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('action.yml');
  });

  it('should spawn when action.yaml is modified', () => {
    const files = [{ filename: 'some/path/action.yaml', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('action.yml');
  });

  it('should spawn when workflow YAML is modified', () => {
    const files = [{ filename: '.github/workflows/deploy.yml', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('workflow');
  });

  it('should spawn when package.json is changed', () => {
    const files = [{ filename: 'package.json', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('package manifests');
  });

  it('should spawn when type definition is changed', () => {
    const files = [{ filename: 'src/types.ts', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('type definitions');
  });

  it('should spawn when .d.ts file is changed', () => {
    const files = [{ filename: 'dist/index.d.ts', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('type definitions');
  });

  it('should spawn when a file is deleted', () => {
    const files = [{ filename: 'src/api.ts', status: 'removed' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('removed files');
  });

  it('should spawn when schema/migration file is changed', () => {
    const files = [{ filename: 'db/migrations/002.sql', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('schema/migration');
  });

  it('should spawn when API route file is changed', () => {
    const files = [{ filename: 'src/api/routes.ts', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('API routes');
  });

  it('should spawn when breaking change keywords found in patch', () => {
    const files = [{ filename: 'src/config.ts', status: 'modified', patch: '-  required: false\n+  required: true' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('keywords');
  });

  it('should not spawn for docs-only changes', () => {
    const files = [{ filename: 'README.md', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('documentation-only');
  });

  it('should not spawn for test-only changes', () => {
    const files = [{ filename: 'src/__tests__/app.test.ts', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('test-only');
  });

  it('should not spawn for trivial code changes without signals', () => {
    const files = [{ filename: 'src/helper.ts', status: 'modified', additions: 5, deletions: 2 }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('No breaking change signals');
  });

  it('should spawn when PR has breaking label', () => {
    const files = [{ filename: 'README.md', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files, { labels: ['breaking'] });
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('breaking label');
  });

  it('should spawn when PR has breaking-change label', () => {
    const files = [{ filename: 'README.md', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files, { labels: ['breaking-change'] });
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('breaking label');
  });

  it('should not spawn when skip-review label is present', () => {
    const files = [{ filename: 'action.yml', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files, { labels: ['skip-review'] });
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('skip-review');
  });

  it('should spawn when force flag is set', () => {
    const files = [{ filename: 'README.md', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files, { force: true });
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('forced');
  });

  it('should not spawn for empty files array', () => {
    const result = shouldSpawnBreakingChanges([]);
    expect(result.spawn).toBe(false);
  });

  it('should not spawn for null/undefined files', () => {
    const result = shouldSpawnBreakingChanges(null);
    expect(result.spawn).toBe(false);
  });

  it('should combine multiple trigger reasons', () => {
    const files = [
      { filename: 'action.yml', status: 'modified' },
      { filename: 'src/old.ts', status: 'removed' },
    ];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('action.yml');
    expect(result.reason).toContain('removed files');
  });

  it('should detect go.mod as package manifest', () => {
    const files = [{ filename: 'go.mod', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('package manifests');
  });

  it('should detect pyproject.toml as package manifest', () => {
    const files = [{ filename: 'pyproject.toml', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('package manifests');
  });

  it('should detect controller files as API routes', () => {
    const files = [{ filename: 'src/users.controller.ts', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('API routes');
  });

  it('should detect interfaces.ts as type definition', () => {
    const files = [{ filename: 'src/interfaces.ts', status: 'modified' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('type definitions');
  });

  it('should detect export keyword in patch', () => {
    const files = [{ filename: 'src/lib.ts', status: 'modified', patch: '-export function doStuff()' }];
    const result = shouldSpawnBreakingChanges(files);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('keywords');
  });
});

describe('fetchPrFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call ghApi with correct endpoint', () => {
    ghApi.mockReturnValue([{ filename: 'test.js' }]);
    const context = { repo: { owner: 'org', repo: 'repo' }, issue: { number: 42 } };
    const result = fetchPrFiles(context);
    expect(ghApi).toHaveBeenCalledWith('/repos/org/repo/pulls/42/files');
    expect(result).toEqual([{ filename: 'test.js' }]);
  });

  it('should return empty array when ghApi returns null', () => {
    ghApi.mockReturnValue(null);
    const context = { repo: { owner: 'org', repo: 'repo' }, issue: { number: 1 } };
    const result = fetchPrFiles(context);
    expect(result).toEqual([]);
  });
});

describe('fetchPrLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call ghApi and return label names', () => {
    ghApi.mockReturnValue([{ name: 'bug' }, { name: 'breaking' }]);
    const context = { repo: { owner: 'org', repo: 'repo' }, issue: { number: 42 } };
    const result = fetchPrLabels(context);
    expect(ghApi).toHaveBeenCalledWith('/repos/org/repo/issues/42/labels');
    expect(result).toEqual(['bug', 'breaking']);
  });

  it('should return empty array when ghApi returns null', () => {
    ghApi.mockReturnValue(null);
    const context = { repo: { owner: 'org', repo: 'repo' }, issue: { number: 1 } };
    const result = fetchPrLabels(context);
    expect(result).toEqual([]);
  });
});
