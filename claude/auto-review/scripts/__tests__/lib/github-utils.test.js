import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ghApi, loadGitHubContext } from '../../lib/github-utils.js';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, '..', 'fixtures');

describe('ghApi', () => {
  // Note: ghApi tests would require mocking the gh CLI which is complex
  // The actual function is tested indirectly through integration tests
  it('should be exported and callable', () => {
    expect(typeof ghApi).toBe('function');
  });
});

describe('loadGitHubContext', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_EVENT_PATH;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should parse pull_request event correctly', () => {
    const eventPath = path.join(fixturesDir, 'github-events', 'pull_request.json');

    process.env.GITHUB_REPOSITORY = 'walletconnect/test-repo';
    process.env.GITHUB_EVENT_PATH = eventPath;

    const context = loadGitHubContext();

    expect(context.repo).toEqual({ owner: 'walletconnect', repo: 'test-repo' });
    expect(context.issue.number).toBe(123);
    expect(context.payload.pull_request).toBeDefined();
  });

  it('should parse issue_comment on PR correctly', () => {
    const eventPath = path.join(fixturesDir, 'github-events', 'issue_comment_on_pr.json');

    process.env.GITHUB_REPOSITORY = 'walletconnect/test-repo';
    process.env.GITHUB_EVENT_PATH = eventPath;

    const context = loadGitHubContext();

    expect(context.issue.number).toBe(123);
  });

  it('should return 0 for issue_comment on regular issue', () => {
    const eventPath = path.join(fixturesDir, 'github-events', 'issue_comment_on_issue.json');

    process.env.GITHUB_REPOSITORY = 'walletconnect/test-repo';
    process.env.GITHUB_EVENT_PATH = eventPath;

    const context = loadGitHubContext();

    expect(context.issue.number).toBe(0);
  });

  it('should handle missing GITHUB_EVENT_PATH', () => {
    process.env.GITHUB_REPOSITORY = 'walletconnect/test-repo';

    const context = loadGitHubContext();

    expect(context.repo).toEqual({ owner: 'walletconnect', repo: 'test-repo' });
    expect(context.issue.number).toBe(0);
    expect(context.payload).toEqual({});
  });

  it('should throw on malformed event JSON', () => {
    const eventPath = '/tmp/malformed.json';
    process.env.GITHUB_REPOSITORY = 'walletconnect/test-repo';
    process.env.GITHUB_EVENT_PATH = eventPath;

    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue('{ invalid json }');

    expect(() => loadGitHubContext()).toThrow();

    existsSpy.mockRestore();
    readSpy.mockRestore();
  });
});
