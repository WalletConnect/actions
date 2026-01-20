I've reviewed the PR and found the following issues:

<details>
<summary>Found 3 issue(s)</summary>

#### Issue 1: SQL injection vulnerability in user query
**ID:** users-sql-injection-f3a2
**File:** src/database/users.ts:45
**Severity:** HIGH
**Category:** security
**Context:**
- **Pattern:** Query at line 45 builds SQL via string concatenation with user-provided `userId`
- **Risk:** Allows arbitrary SQL injection via crafted input (e.g., `1' OR '1'='1`)
- **Impact:** Unauthorized data access, modification, or database destruction
- **Trigger:** Any endpoint accepting user input that reaches this query
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
**Context:**
- **Pattern:** Login function at line 23 doesn't validate email format before processing
- **Risk:** Malformed input could cause downstream errors or enable enumeration attacks
- **Impact:** Poor UX, potential injection vectors, or service errors
- **Trigger:** Invalid emails reaching database or authentication provider
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
**Context:**
- **Pattern:** Lodash import at line 1 is never referenced in the file's code
- **Risk:** Unused imports increase bundle size and confuse dependency understanding
- **Impact:** ~70KB added to bundle, slower load times, misleading dependency graph
- **Trigger:** Tree-shaking not configured or import not removed
**Fix:** Remove the unused import to keep the code clean.

</details>
