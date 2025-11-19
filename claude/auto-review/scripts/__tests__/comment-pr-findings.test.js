import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { readJsonFile, generateFindingHash, parseDiffHunks, isLineInDiff } from '../comment-pr-findings.js';

describe('generateFindingHash', () => {
  it('should use Claude ID when provided', () => {
    const result = generateFindingHash(
      'src/test.ts',
      'Test issue',
      'test-issue-abc123'
    );
    expect(result).toBe('test-issue-abc123');
  });

  it('should generate hash when Claude ID is null', () => {
    const result = generateFindingHash('src/test.ts', 'Test issue', null);
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[a-f0-9]{16}$/);
  });

  it('should generate hash when Claude ID is empty string', () => {
    const result = generateFindingHash('src/test.ts', 'Test issue', '');
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[a-f0-9]{16}$/);
  });

  it('should generate consistent hash for same inputs', () => {
    const hash1 = generateFindingHash('src/test.ts', 'Test issue');
    const hash2 = generateFindingHash('src/test.ts', 'Test issue');
    expect(hash1).toBe(hash2);
  });

  it('should generate different hashes for different files', () => {
    const hash1 = generateFindingHash('src/test1.ts', 'Test issue');
    const hash2 = generateFindingHash('src/test2.ts', 'Test issue');
    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hashes for different descriptions', () => {
    const hash1 = generateFindingHash('src/test.ts', 'Issue 1');
    const hash2 = generateFindingHash('src/test.ts', 'Issue 2');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle special characters in file and description', () => {
    const result = generateFindingHash(
      'src/my-file_v2.test.ts',
      'SQL injection: "SELECT * FROM users"'
    );
    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('readJsonFile', () => {
  it('should read and parse valid JSON file', () => {
    const validJson = JSON.stringify([{ id: 1, description: 'test' }]);
    const spy = vi.spyOn(fs, 'readFileSync').mockReturnValue(validJson);

    const result = readJsonFile('findings.json');

    expect(result).toEqual([{ id: 1, description: 'test' }]);
    spy.mockRestore();
  });

  it('should return null for non-existent file', () => {
    const error = new Error('File not found');
    error.code = 'ENOENT';
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw error;
    });

    const result = readJsonFile('missing.json');

    expect(result).toBeNull();
    spy.mockRestore();
  });

  it('should throw for other file errors', () => {
    const error = new Error('Permission denied');
    error.code = 'EACCES';
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw error;
    });

    expect(() => readJsonFile('forbidden.json')).toThrow('Permission denied');
    spy.mockRestore();
  });

  it('should throw for invalid JSON', () => {
    const spy = vi.spyOn(fs, 'readFileSync').mockReturnValue('{ invalid json }');

    expect(() => readJsonFile('bad.json')).toThrow();
    spy.mockRestore();
  });
});

describe('parseDiffHunks', () => {
  it('should parse single hunk header', () => {
    const patch = '@@ -10,6 +13,8 @@ function test() {\n some content';
    const result = parseDiffHunks(patch);
    expect(result).toEqual([{ start: 13, end: 20 }]);
  });

  it('should parse multiple hunk headers', () => {
    const patch = '@@ -1,5 +1,7 @@ header\ncontent\n@@ -20,3 +22,5 @@ another';
    const result = parseDiffHunks(patch);
    expect(result).toEqual([
      { start: 1, end: 7 },
      { start: 22, end: 26 }
    ]);
  });

  it('should handle hunk with single line (no count)', () => {
    const patch = '@@ -5 +5 @@ single line change';
    const result = parseDiffHunks(patch);
    expect(result).toEqual([{ start: 5, end: 5 }]);
  });

  it('should handle new file (starts at 0)', () => {
    const patch = '@@ -0,0 +1,15 @@ new file';
    const result = parseDiffHunks(patch);
    expect(result).toEqual([{ start: 1, end: 15 }]);
  });

  it('should return empty array for null/undefined patch', () => {
    expect(parseDiffHunks(null)).toEqual([]);
    expect(parseDiffHunks(undefined)).toEqual([]);
    expect(parseDiffHunks('')).toEqual([]);
  });

  it('should handle real-world patch from GitHub API', () => {
    const patch = '@@ -9,3 +9,8 @@ variable "cloudflare_metrics_v2_api_token" {\n variable "environment" {\n   type = string\n }\n+\n+variable "exporter_name" {\n+  type    = string\n+  default = "cloudflare_prometheus_exporter"\n+}';
    const result = parseDiffHunks(patch);
    expect(result).toEqual([{ start: 9, end: 16 }]);
  });
});

describe('isLineInDiff', () => {
  it('should return true for line within single range', () => {
    const ranges = [{ start: 10, end: 20 }];
    expect(isLineInDiff(10, ranges)).toBe(true);
    expect(isLineInDiff(15, ranges)).toBe(true);
    expect(isLineInDiff(20, ranges)).toBe(true);
  });

  it('should return false for line outside range', () => {
    const ranges = [{ start: 10, end: 20 }];
    expect(isLineInDiff(9, ranges)).toBe(false);
    expect(isLineInDiff(21, ranges)).toBe(false);
    expect(isLineInDiff(1, ranges)).toBe(false);
  });

  it('should work with multiple ranges', () => {
    const ranges = [
      { start: 1, end: 10 },
      { start: 50, end: 60 }
    ];
    expect(isLineInDiff(5, ranges)).toBe(true);
    expect(isLineInDiff(55, ranges)).toBe(true);
    expect(isLineInDiff(30, ranges)).toBe(false);
  });

  it('should return false for empty ranges', () => {
    expect(isLineInDiff(10, [])).toBe(false);
  });

  it('should handle edge case - line 5 outside range starting at 9', () => {
    // This is the actual bug case: file has changes at lines 9-16, but finding is at line 5
    const ranges = [{ start: 9, end: 16 }];
    expect(isLineInDiff(5, ranges)).toBe(false);
    expect(isLineInDiff(9, ranges)).toBe(true);
    expect(isLineInDiff(13, ranges)).toBe(true);
  });
});
