import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseClaudeComment, getLatestClaudeComment } from '../extract-findings-from-comment.js';
import { ghApi } from '../lib/github-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures');

// Mock ghApi for getLatestClaudeComment tests
vi.mock('../lib/github-utils.js', async () => {
  const actual = await vi.importActual('../lib/github-utils.js');
  return {
    ...actual,
    ghApi: vi.fn(),
  };
});

describe('parseClaudeComment', () => {
  it('should parse a valid single issue with all fields', () => {
    const comment = fs.readFileSync(
      path.join(fixturesDir, 'claude-comments', 'valid-single-issue.md'),
      'utf8'
    );

    const findings = parseClaudeComment(comment);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: 'users-sql-injection-f3a2',
      description: 'SQL injection vulnerability in user query',
      severity: 'HIGH',
      category: 'security',
      file: 'src/database/users.ts',
      line: 45,
    });
    expect(findings[0].recommendation).toContain('parameterized queries');
    expect(findings[0].recommendation).toContain('```typescript');
    expect(findings[0].exploit_scenario).toContain('attacker');
    expect(findings[0].context).toContain('string concatenation');
  });

  it('should parse multiple issues', () => {
    const comment = fs.readFileSync(
      path.join(fixturesDir, 'claude-comments', 'valid-multiple-issues.md'),
      'utf8'
    );

    const findings = parseClaudeComment(comment);

    expect(findings).toHaveLength(3);
    expect(findings[0].description).toBe('SQL injection vulnerability in user query');
    expect(findings[1].description).toBe('Missing input validation');
    expect(findings[2].description).toBe('Unused import statement');
    expect(findings[2].severity).toBe('LOW');
    // Verify context extraction for all issues
    expect(findings[0].context).toContain('string concatenation');
    expect(findings[1].context).toContain('email format');
    expect(findings[2].context).toContain('Lodash import');
  });

  it('should handle code blocks with blank lines in recommendations', () => {
    const comment = fs.readFileSync(
      path.join(fixturesDir, 'claude-comments', 'code-blocks-with-blanks.md'),
      'utf8'
    );

    const findings = parseClaudeComment(comment);

    expect(findings).toHaveLength(1);
    expect(findings[0].recommendation).toContain('try {');
    expect(findings[0].recommendation).toContain('const response = await fetch(url);');
    expect(findings[0].recommendation).toContain('\n\n');
    expect(findings[0].recommendation).toContain('const data = await response.json();');
    expect(findings[0].context).toContain('promise rejections');
  });

  it('should handle missing optional fields', () => {
    const comment = fs.readFileSync(
      path.join(fixturesDir, 'claude-comments', 'missing-fields.md'),
      'utf8'
    );

    const findings = parseClaudeComment(comment);

    expect(findings).toHaveLength(2);

    // First issue missing ID, severity, category, context
    expect(findings[0].id).toBeNull();
    expect(findings[0].severity).toBe('MEDIUM'); // default
    expect(findings[0].file).toBe('src/services/cache.ts');
    expect(findings[0].line).toBe(89);
    expect(findings[0].context).toBeUndefined(); // No **Context:** field

    // Second issue missing file/line, context
    expect(findings[1].id).toBe('payment-no-error-handling-9a3c');
    expect(findings[1].severity).toBe('HIGH');
    expect(findings[1].file).toBeUndefined();
    expect(findings[1].context).toBeUndefined(); // No **Context:** field
  });

  it('should handle both "Recommendation:" and "Fix:" labels', () => {
    const commentWithFix = `#### Issue 1: Test issue
**File:** test.ts:10
**Severity:** HIGH

**Fix:** Use better approach.`;

    const findings = parseClaudeComment(commentWithFix);

    expect(findings).toHaveLength(1);
    expect(findings[0].recommendation).toBe('Use better approach.');
  });

  it('should use fallback file path extraction', () => {
    const comment = `#### Issue 1: Bad pattern
src/services/bad.js:42

This is a problem.`;

    const findings = parseClaudeComment(comment);

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('src/services/bad.js');
    expect(findings[0].line).toBe(42);
  });

  it('should handle malformed markdown gracefully', () => {
    const comment = fs.readFileSync(
      path.join(fixturesDir, 'claude-comments', 'malformed.md'),
      'utf8'
    );

    const findings = parseClaudeComment(comment);

    // Malformed should not match the pattern
    expect(findings).toHaveLength(0);
  });

  it('should return empty array for empty comment', () => {
    const findings = parseClaudeComment('');
    expect(findings).toEqual([]);
  });

  it('should return empty array for comment with no issues', () => {
    const comment = 'I reviewed the PR and found no issues. Looks good!';
    const findings = parseClaudeComment(comment);
    expect(findings).toEqual([]);
  });

  it('should handle special characters in file paths', () => {
    const comment = `#### Issue 1: Test
**File:** src/components/User-Profile_v2.test.tsx:15
**Severity:** LOW

Problem here.`;

    const findings = parseClaudeComment(comment);

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('src/components/User-Profile_v2.test.tsx');
    expect(findings[0].line).toBe(15);
  });

  it('should handle very long descriptions', () => {
    const longDesc = 'A'.repeat(1000);
    const comment = `#### Issue 1: ${longDesc}
**File:** test.ts:1

Content.`;

    const findings = parseClaudeComment(comment);

    expect(findings).toHaveLength(1);
    expect(findings[0].description).toBe(longDesc);
  });

  it('should extract multi-line exploit scenarios', () => {
    const comment = `#### Issue 1: XSS vulnerability
**File:** app.js:10
**Severity:** HIGH

Problem description.

**Exploit Scenario:** An attacker could inject script tags.

They could steal user cookies.
This is dangerous.

**Recommendation:** Sanitize input.`;

    const findings = parseClaudeComment(comment);

    expect(findings).toHaveLength(1);
    expect(findings[0].exploit_scenario).toContain('inject script tags');
    expect(findings[0].exploit_scenario).toContain('steal user cookies');
  });

  it('should handle case-insensitive severity matching', () => {
    const comment = `#### Issue 1: Test
**File:** test.ts:1
**Severity:** high

Problem.`;

    const findings = parseClaudeComment(comment);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('HIGH');
  });

  it('should extract agent from brk- ID prefix', () => {
    const comment = `#### Issue 1: Action input removed
**ID:** brk-action-remove-timeout-input-e4f1
**File:** action.yml:15
**Severity:** CRITICAL
**Category:** breaking_change

**Context:**
- **Pattern:** Input \`timeout_minutes\` was removed
- **Risk:** Consumers referencing this input get workflow validation errors
- **Impact:** All workflows using timeout_minutes will fail
- **Trigger:** Any consumer upgrading to this version

**Recommendation:** Keep the input with a deprecation warning.`;

    const findings = parseClaudeComment(comment);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('brk-action-remove-timeout-input-e4f1');
    expect(findings[0].agent).toBe('review-breaking-changes');
    expect(findings[0].severity).toBe('CRITICAL');
    expect(findings[0].category).toBe('breaking_change');
  });

  it('should extract agent from lic- ID prefix', () => {
    const comment = `#### Issue 1: GPL dependency detected
**ID:** lic-gpl-library-a3f1
**File:** package.json:15
**Severity:** HIGH
**Category:** license_compliance

**Context:**
- **Pattern:** GPL-3.0 licensed dependency added

**Recommendation:** Replace with MIT-licensed alternative.`;

    const findings = parseClaudeComment(comment);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe('lic-gpl-library-a3f1');
    expect(findings[0].agent).toBe('review-license-compliance');
  });

  it('should not set agent for non-prefixed IDs', () => {
    const comment = `#### Issue 1: SQL injection
**ID:** users-sql-injection-f3a2
**File:** src/users.ts:10
**Severity:** HIGH

Problem.`;

    const findings = parseClaudeComment(comment);
    expect(findings).toHaveLength(1);
    expect(findings[0].agent).toBeUndefined();
  });

  it('should skip extraction if no file path found', () => {
    const comment = `#### Issue 1: Missing file info

This is the issue with no file specified.`;

    const findings = parseClaudeComment(comment);

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBeUndefined();
    expect(findings[0].description).toBe('Missing file info');
  });
});

describe('getLatestClaudeComment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockContext = {
    repo: { owner: 'walletconnect', repo: 'test-repo' },
    issue: { number: 123 },
  };

  it('should return null when no comments exist', () => {
    ghApi.mockReturnValue([]);
    const result = getLatestClaudeComment(mockContext);
    expect(result).toBeNull();
  });

  it('should return the single Claude comment', () => {
    const claudeComment = {
      id: 1,
      user: { login: 'claude[bot]' },
      body: 'Issue 1: Problem found',
      created_at: '2025-01-01T00:00:00Z',
    };
    ghApi.mockReturnValue([claudeComment]);

    const result = getLatestClaudeComment(mockContext);
    expect(result).toEqual(claudeComment);
  });

  it('should return the most recent Claude comment when multiple exist', () => {
    const comments = [
      { id: 1, user: { login: 'claude[bot]' }, body: 'Issue 1', created_at: '2025-01-01' },
      { id: 2, user: { login: 'user' }, body: 'Comment', created_at: '2025-01-02' },
      { id: 3, user: { login: 'claude[bot]' }, body: 'Issue 2', created_at: '2025-01-03' },
    ];
    ghApi.mockReturnValue(comments);

    const result = getLatestClaudeComment(mockContext);
    expect(result.id).toBe(3);
  });

  it('should filter out non-bot comments', () => {
    const comments = [
      { id: 1, user: { login: 'user1' }, body: 'Issue 1', created_at: '2025-01-01' },
      { id: 2, user: { login: 'user2' }, body: 'Finding 1', created_at: '2025-01-02' },
    ];
    ghApi.mockReturnValue(comments);

    const result = getLatestClaudeComment(mockContext);
    expect(result).toBeNull();
  });

  it('should filter out Claude comments without Issue or Finding keywords', () => {
    const comments = [
      { id: 1, user: { login: 'claude[bot]' }, body: 'Just a regular comment', created_at: '2025-01-01' },
      { id: 2, user: { login: 'claude[bot]' }, body: 'Finding 1: Problem', created_at: '2025-01-02' },
    ];
    ghApi.mockReturnValue(comments);

    const result = getLatestClaudeComment(mockContext);
    expect(result.id).toBe(2);
  });

  it('should handle null/undefined user gracefully', () => {
    const comments = [
      { id: 1, user: null, body: 'Issue 1', created_at: '2025-01-01' },
      { id: 2, body: 'Issue 2', created_at: '2025-01-02' },
    ];
    ghApi.mockReturnValue(comments);

    const result = getLatestClaudeComment(mockContext);
    expect(result).toBeNull();
  });
});
