I've reviewed the PR and found the following issues:

<details>
<summary>Found 3 issue(s)</summary>

#### Issue 1: SQL injection vulnerability in user query
**ID:** users-sql-injection-f3a2
**File:** src/database/users.ts:45
**Severity:** HIGH
**Category:** security
**Context:** The user query is constructed using string concatenation.
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
**Context:** The login function doesn't validate email format before processing.
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
**Context:** The lodash import is not used anywhere in the file.
**Fix:** Remove the unused import to keep the code clean.

</details>
