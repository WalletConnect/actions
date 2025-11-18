import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { readJsonFile, generateFindingHash } from '../comment-pr-findings.js';

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
