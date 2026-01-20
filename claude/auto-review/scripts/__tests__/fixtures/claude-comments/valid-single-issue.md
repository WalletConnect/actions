I've reviewed the PR and found the following issues:

<details>
<summary>Found 1 issue(s)</summary>

#### Issue 1: SQL injection vulnerability in user query
**ID:** users-sql-injection-f3a2
**File:** src/database/users.ts:45
**Severity:** HIGH
**Category:** security
**Context:** The query at line 45 builds SQL using string concatenation with user-provided `userId`. This allows attackers to inject arbitrary SQL by crafting malicious input (e.g., `1' OR '1'='1`). Any endpoint accepting user input that reaches this query is vulnerable. Impact: unauthorized data access, data modification, or database destruction.
**Recommendation:** Use parameterized queries to prevent SQL injection:
```typescript
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
```

**Exploit Scenario:** An attacker could inject malicious SQL by passing a crafted userId like `1' OR '1'='1` to access all user records.

</details>
