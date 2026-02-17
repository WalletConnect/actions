import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldSpawnLicenseCompliance,
  fetchPrFiles,
  fetchPrLabels,
} from '../should-spawn-license-compliance.js';
import { ghApi } from '../lib/github-utils.js';

vi.mock('../lib/github-utils.js', async () => {
  const actual = await vi.importActual('../lib/github-utils.js');
  return {
    ...actual,
    ghApi: vi.fn(),
  };
});

describe('shouldSpawnLicenseCompliance', () => {
  // ---- Manifest files trigger spawn ----------------------------------------

  it.each([
    ['package.json', 'npm'],
    ['go.mod', 'Go'],
    ['go.sum', 'Go (lockfile)'],
    ['Cargo.toml', 'Rust'],
    ['Cargo.lock', 'Rust (lockfile)'],
    ['pyproject.toml', 'Python'],
    ['setup.py', 'Python'],
    ['setup.cfg', 'Python'],
    ['Gemfile', 'Ruby'],
    ['Gemfile.lock', 'Ruby (lockfile)'],
    ['composer.json', 'PHP'],
    ['build.gradle', 'Java/Kotlin'],
    ['pom.xml', 'Java/Kotlin'],
  ])('should spawn for %s (%s)', (filename, ecosystem) => {
    const result = shouldSpawnLicenseCompliance([`some/path/${filename}`]);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain(filename);
    expect(result.reason).toContain(ecosystem);
  });

  // ---- Lockfiles trigger spawn ---------------------------------------------

  it.each([
    ['pnpm-lock.yaml', 'npm (lockfile)'],
    ['package-lock.json', 'npm (lockfile)'],
    ['yarn.lock', 'npm (lockfile)'],
    ['Cargo.lock', 'Rust (lockfile)'],
    ['go.sum', 'Go (lockfile)'],
    ['Gemfile.lock', 'Ruby (lockfile)'],
  ])('should spawn for lockfile %s', (filename, ecosystem) => {
    const result = shouldSpawnLicenseCompliance([filename]);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain(ecosystem);
  });

  // ---- requirements*.txt variants ------------------------------------------

  it('should spawn for requirements.txt', () => {
    const result = shouldSpawnLicenseCompliance(['requirements.txt']);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('Python');
  });

  it('should spawn for requirements-dev.txt', () => {
    const result = shouldSpawnLicenseCompliance(['requirements-dev.txt']);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('Python');
  });

  // ---- Non-manifest files do not trigger -----------------------------------

  it('should not spawn for non-manifest files', () => {
    const result = shouldSpawnLicenseCompliance([
      'src/app.ts',
      'README.md',
      'docs/architecture.md',
    ]);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No dependency manifest files changed');
  });

  // ---- Empty / null files --------------------------------------------------

  it('should not spawn for empty files array', () => {
    const result = shouldSpawnLicenseCompliance([]);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No changed files');
  });

  it('should not spawn for null files', () => {
    const result = shouldSpawnLicenseCompliance(null);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No changed files');
  });

  it('should not spawn for undefined files', () => {
    const result = shouldSpawnLicenseCompliance(undefined);
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('No changed files');
  });

  // ---- skip-review label ---------------------------------------------------

  it('should not spawn when skip-review label is present', () => {
    const result = shouldSpawnLicenseCompliance(['package.json'], {
      labels: ['skip-review'],
    });
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('skip-review label present');
  });

  it('should not spawn when skip-review label is among multiple labels', () => {
    const result = shouldSpawnLicenseCompliance(['package.json'], {
      labels: ['enhancement', 'skip-review', 'urgent'],
    });
    expect(result.spawn).toBe(false);
    expect(result.reason).toBe('skip-review label present');
  });

  // ---- Force flag ----------------------------------------------------------

  it('should spawn when force flag is set even with no manifest files', () => {
    const result = shouldSpawnLicenseCompliance(['src/app.ts'], {
      force: true,
    });
    expect(result.spawn).toBe(true);
    expect(result.reason).toBe('Force flag set');
  });

  it('should spawn when force flag is set even with skip-review label', () => {
    const result = shouldSpawnLicenseCompliance(['src/app.ts'], {
      labels: ['skip-review'],
      force: true,
    });
    expect(result.spawn).toBe(true);
    expect(result.reason).toBe('Force flag set');
  });

  // ---- Multiple manifest files combine reasons -----------------------------

  it('should combine reasons for multiple manifest files', () => {
    const result = shouldSpawnLicenseCompliance([
      'package.json',
      'go.mod',
      'src/main.go',
    ]);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('package.json (npm)');
    expect(result.reason).toContain('go.mod (Go)');
  });

  // ---- Nested paths --------------------------------------------------------

  it('should match manifest files in subdirectories', () => {
    const result = shouldSpawnLicenseCompliance([
      'services/api/package.json',
      'services/worker/Cargo.toml',
    ]);
    expect(result.spawn).toBe(true);
    expect(result.reason).toContain('package.json (npm)');
    expect(result.reason).toContain('Cargo.toml (Rust)');
  });
});

describe('fetchPrFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockContext = {
    repo: { owner: 'walletconnect', repo: 'test-repo' },
    issue: { number: 42 },
  };

  it('should call ghApi with correct endpoint and return filenames', () => {
    ghApi.mockReturnValue([
      { filename: 'package.json' },
      { filename: 'src/index.ts' },
    ]);

    const files = fetchPrFiles(mockContext);

    expect(ghApi).toHaveBeenCalledWith(
      '/repos/walletconnect/test-repo/pulls/42/files'
    );
    expect(files).toEqual(['package.json', 'src/index.ts']);
  });

  it('should return empty array when ghApi returns null', () => {
    ghApi.mockReturnValue(null);
    const files = fetchPrFiles(mockContext);
    expect(files).toEqual([]);
  });
});

describe('fetchPrLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockContext = {
    repo: { owner: 'walletconnect', repo: 'test-repo' },
    issue: { number: 42 },
  };

  it('should call ghApi with correct endpoint and return label names', () => {
    ghApi.mockReturnValue([
      { name: 'bug' },
      { name: 'skip-review' },
    ]);

    const labels = fetchPrLabels(mockContext);

    expect(ghApi).toHaveBeenCalledWith(
      '/repos/walletconnect/test-repo/issues/42/labels'
    );
    expect(labels).toEqual(['bug', 'skip-review']);
  });

  it('should return empty array when ghApi returns null', () => {
    ghApi.mockReturnValue(null);
    const labels = fetchPrLabels(mockContext);
    expect(labels).toEqual([]);
  });
});
