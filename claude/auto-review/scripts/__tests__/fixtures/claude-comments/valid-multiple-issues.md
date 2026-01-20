I've reviewed the PR and found the following issues:

<details>
<summary>Found 3 issue(s)</summary>

#### Issue 1: SQL injection vulnerability in user query
**ID:** users-sql-injection-f3a2
**File:** src/database/users.ts:45
**Severity:** HIGH
**Category:** security
**Context:** The query at line 45 builds SQL using string concatenation with user-provided `userId`. This allows attackers to inject arbitrary SQL by crafting malicious input (e.g., `1' OR '1'='1`). Any endpoint accepting user input that reaches this query is vulnerable. Impact: unauthorized data access, data modification, or database destruction.
**Recommendation:** Use parameterized queries:
```typescript
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
```

**Exploit Scenario:** An attacker could inject malicious SQL.

#### Issue 2: Missing input validation
**ID:** auth-missing-validation-8b91
**File:** src/auth/login.ts:23
**Severity:** MEDIUM
**Category:** security
**Context:** The login function at line 23 doesn't validate email format before processing. Malformed input could cause downstream errors or be used for enumeration attacks. Without validation, invalid emails may reach the database or authentication provider, potentially causing failures or security issues. Impact: poor UX, potential injection vectors, or service errors.
**Recommendation:** Add email validation:
```typescript
if (!isValidEmail(email)) {
  throw new Error('Invalid email format');
}
```

#### Issue 3: Unused import statement
**ID:** utils-unused-import-c5d4
**File:** src/utils/helpers.ts:1
**Severity:** LOW
**Category:** code-quality
**Context:** The lodash import at line 1 is never referenced in the file's code. Unused imports increase bundle size unnecessarily and create confusion about actual dependencies. This adds ~70KB (unminified) to the bundle when tree-shaking isn't configured. Impact: slower load times and misleading dependency graph.
**Fix:** Remove the unused import to keep the code clean.

</details>
