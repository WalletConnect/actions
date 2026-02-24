import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeNGrams,
  jaccardSimilarity,
  shouldSpawnDeduplication,
  listRepoFilesByExtension,
  fetchPrFiles,
  fetchPrLabels,
} from '../should-spawn-deduplication.js';
import { ghApi } from '../lib/github-utils.js';
import { spawnSync } from 'child_process';

vi.mock('../lib/github-utils.js', async () => {
  const actual = await vi.importActual('../lib/github-utils.js');
  return {
    ...actual,
    ghApi: vi.fn(),
  };
});

vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    spawnSync: vi.fn(actual.spawnSync),
  };
});

// ---- computeNGrams --------------------------------------------------------

describe('computeNGrams', () => {
  it('should return correct n-grams for a simple string', () => {
    const grams = computeNGrams('abcdef');
    expect(grams).toEqual(new Set(['abcde', 'bcdef']));
  });

  it('should return empty set for string shorter than n', () => {
    const grams = computeNGrams('abc');
    expect(grams.size).toBe(0);
  });

  it('should normalize whitespace', () => {
    const grams1 = computeNGrams('ab  cd  ef');
    const grams2 = computeNGrams('ab cd ef');
    expect(grams1).toEqual(grams2);
  });

  it('should return empty set for empty string', () => {
    const grams = computeNGrams('');
    expect(grams.size).toBe(0);
  });

  it('should support custom n parameter', () => {
    const grams = computeNGrams('abcdef', 3);
    expect(grams).toEqual(new Set(['abc', 'bcd', 'cde', 'def']));
  });

  it('should return single n-gram when string length equals n', () => {
    const grams = computeNGrams('abcde');
    expect(grams).toEqual(new Set(['abcde']));
  });
});

// ---- jaccardSimilarity ----------------------------------------------------

describe('jaccardSimilarity', () => {
  it('should return 1.0 for identical sets', () => {
    const set = new Set(['a', 'b', 'c']);
    expect(jaccardSimilarity(set, set)).toBe(1.0);
  });

  it('should return 0.0 for disjoint sets', () => {
    const a = new Set(['a', 'b']);
    const b = new Set(['c', 'd']);
    expect(jaccardSimilarity(a, b)).toBe(0.0);
  });

  it('should return correct value for partial overlap', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    // intersection=2, union=4
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it('should return 0.0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it('should return 0.0 when one set is empty', () => {
    expect(jaccardSimilarity(new Set(['a']), new Set())).toBe(0);
  });
});

// ---- shouldSpawnDeduplication ---------------------------------------------

describe('shouldSpawnDeduplication', () => {
  // ---- Skip / force conditions ----

  it('should not spawn when skip-review label present', () => {
    const files = [{ filename: 'src/new.js', status: 'added' }];
    const result = shouldSpawnDeduplication(files, { labels: ['skip-review'] });
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('skip-review label present');
  });

  it('should spawn when force flag set', () => {
    const files = [{ filename: 'README.md', status: 'modified' }];
    const result = shouldSpawnDeduplication(files, { force: true });
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('forced');
    expect(result.similarPairs).toEqual([]);
  });

  it('should not spawn for empty files array', () => {
    const result = shouldSpawnDeduplication([]);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No files in PR');
  });

  it('should not spawn for null files', () => {
    const result = shouldSpawnDeduplication(null);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No files in PR');
  });

  it('should spawn on deduplication label with empty pairs', () => {
    const files = [{ filename: 'src/app.js', status: 'modified' }];
    const result = shouldSpawnDeduplication(files, { labels: ['deduplication'] });
    expect(result.spawn).toBe(true);
    expect(result.reason).toBe('deduplication label');
    expect(result.similarPairs).toEqual([]);
  });

  // ---- No added files ----

  it('should not spawn when no added files', () => {
    const files = [{ filename: 'src/existing.js', status: 'modified' }];
    const result = shouldSpawnDeduplication(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No added files in PR');
  });

  // ---- Docs-only / test-only exclusion ----

  it('should not spawn for docs-only changes', () => {
    const files = [{ filename: 'README.md', status: 'added' }];
    const result = shouldSpawnDeduplication(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('documentation-only');
  });

  it('should not spawn for test-only changes', () => {
    const files = [{ filename: 'src/__tests__/foo.test.js', status: 'added' }];
    const result = shouldSpawnDeduplication(files);
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('test-only');
  });

  // ---- Similarity detection ----

  it('should spawn when added file is highly similar to repo file', () => {
    const content = 'function handleRequest(req, res) {\n  const data = req.body;\n  validate(data);\n  process(data);\n  res.json({ ok: true });\n}\n';
    const files = [{ filename: 'src/new-handler.js', status: 'added' }];
    const result = shouldSpawnDeduplication(files, {}, {
      addedFileContents: new Map([['src/new-handler.js', content]]),
      repoFileContents: new Map([['src/old-handler.js', content]]),
    });
    expect(result.spawn).toBe(true);
    expect(result.similarPairs.length).toBeGreaterThan(0);
    expect(result.similarPairs[0].similarity).toBeGreaterThanOrEqual(0.7);
    expect(result.similarPairs[0].newFile).toBe('src/new-handler.js');
    expect(result.similarPairs[0].existingFile).toBe('src/old-handler.js');
  });

  it('should not spawn when similarity is below threshold', () => {
    const addedContent = 'const x = 1;\nconst y = 2;\nconst z = 3;\nconst w = 4;\nconst v = 5;\n';
    const repoContent = 'function totally() {\n  different();\n  code();\n  here();\n  really();\n}\n';
    const files = [{ filename: 'src/new.js', status: 'added' }];
    const result = shouldSpawnDeduplication(files, {}, {
      addedFileContents: new Map([['src/new.js', addedContent]]),
      repoFileContents: new Map([['src/existing.js', repoContent]]),
    });
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('No similar file pairs');
  });

  it('should detect new-vs-new similarity', () => {
    const content = 'export function process(input) {\n  const validated = validate(input);\n  const transformed = transform(validated);\n  return save(transformed);\n}\n';
    const files = [
      { filename: 'src/a.js', status: 'added' },
      { filename: 'src/b.js', status: 'added' },
    ];
    const result = shouldSpawnDeduplication(files, {}, {
      addedFileContents: new Map([
        ['src/a.js', content],
        ['src/b.js', content],
      ]),
      repoFileContents: new Map(),
    });
    expect(result.spawn).toBe(true);
    expect(result.similarPairs.length).toBe(1);
    expect(result.similarPairs[0].similarity).toBe(1);
  });

  it('should return correct similarPairs data structure', () => {
    const content = 'line one\nline two\nline three\nline four\nline five\n';
    const files = [{ filename: 'src/new.js', status: 'added' }];
    const result = shouldSpawnDeduplication(files, {}, {
      addedFileContents: new Map([['src/new.js', content]]),
      repoFileContents: new Map([['src/existing.js', content]]),
    });
    expect(result.spawn).toBe(true);
    const pair = result.similarPairs[0];
    expect(pair).toHaveProperty('newFile');
    expect(pair).toHaveProperty('existingFile');
    expect(pair).toHaveProperty('similarity');
    expect(typeof pair.similarity).toBe('number');
  });

  it('should cap similar pairs at 20', () => {
    // Create 25 repo files identical to the added file
    const content = 'export const handler = (req, res) => {\n  res.send("ok");\n  return true;\n  // padding\n  // more padding\n}\n';
    const repoContents = new Map();
    for (let i = 0; i < 25; i++) {
      repoContents.set(`src/clone-${i}.js`, content);
    }
    const files = [{ filename: 'src/new.js', status: 'added' }];
    const result = shouldSpawnDeduplication(files, {}, {
      addedFileContents: new Map([['src/new.js', content]]),
      repoFileContents: repoContents,
    });
    expect(result.spawn).toBe(true);
    expect(result.similarPairs.length).toBeLessThanOrEqual(20);
  });

  // ---- Multi-extension scenario ----

  it('should detect similarity across different extensions in same PR', () => {
    const content = 'export function handler(req, res) {\n  validate(req);\n  process(req);\n  res.json({ ok: true });\n  return;\n}\n';
    const files = [
      { filename: 'src/new.js', status: 'added' },
      { filename: 'src/new.ts', status: 'added' },
    ];
    const result = shouldSpawnDeduplication(files, {}, {
      addedFileContents: new Map([['src/new.js', content], ['src/new.ts', content]]),
      repoFileContents: new Map([['src/old.js', content], ['src/old.ts', content]]),
    });
    expect(result.spawn).toBe(true);
    // Should find: new.js vs old.js, new.ts vs old.ts, plus cross-ext new-vs-new
    expect(result.similarPairs.length).toBeGreaterThanOrEqual(2);
  });

  // ---- Binary / small file exclusion ----

  it('should skip binary extensions', () => {
    const files = [{ filename: 'assets/logo.png', status: 'added' }];
    const result = shouldSpawnDeduplication(files, {}, {
      addedFileContents: new Map([['assets/logo.png', 'binary data here but lets pretend\nline2\nline3\nline4\nline5\n']]),
      repoFileContents: new Map(),
    });
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('No eligible added files');
  });

  it('should skip files with fewer than 5 lines', () => {
    const files = [{ filename: 'src/tiny.js', status: 'added' }];
    const result = shouldSpawnDeduplication(files, {}, {
      addedFileContents: new Map([['src/tiny.js', 'one\ntwo\nthree']]),
      repoFileContents: new Map(),
    });
    expect(result.spawn).toBe(false);
    expect(result.reason).toContain('No eligible added files');
  });
});

// ---- listRepoFilesByExtension ---------------------------------------------

describe('listRepoFilesByExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return file paths for given extension', () => {
    spawnSync.mockReturnValue({
      stdout: './src/foo.js\n./src/bar.js\n',
      status: 0,
      error: null,
    });
    const result = listRepoFilesByExtension('.js');
    expect(result).toEqual(['./src/foo.js', './src/bar.js']);
  });

  it('should pass exclusion dirs to find command', () => {
    spawnSync.mockReturnValue({ stdout: '', status: 0, error: null });
    listRepoFilesByExtension('.ts');
    const args = spawnSync.mock.calls[0][1];
    expect(args).toContain('*/node_modules/*');
    expect(args).toContain('*/.git/*');
    expect(args).toContain('*/vendor/*');
  });

  it('should handle empty result', () => {
    spawnSync.mockReturnValue({ stdout: '', status: 0, error: null });
    const result = listRepoFilesByExtension('.rs');
    expect(result).toEqual([]);
  });

  it('should return empty array on error', () => {
    spawnSync.mockReturnValue({ stdout: '', status: 1, error: new Error('fail') });
    const result = listRepoFilesByExtension('.js');
    expect(result).toEqual([]);
  });
});

// ---- fetchPrFiles / fetchPrLabels -----------------------------------------

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
    ghApi.mockReturnValue([{ name: 'bug' }, { name: 'deduplication' }]);
    const context = { repo: { owner: 'org', repo: 'repo' }, issue: { number: 42 } };
    const result = fetchPrLabels(context);
    expect(ghApi).toHaveBeenCalledWith('/repos/org/repo/issues/42/labels');
    expect(result).toEqual(['bug', 'deduplication']);
  });

  it('should return empty array when ghApi returns null', () => {
    ghApi.mockReturnValue(null);
    const context = { repo: { owner: 'org', repo: 'repo' }, issue: { number: 1 } };
    const result = fetchPrLabels(context);
    expect(result).toEqual([]);
  });
});
