<details>
<summary>Found 4 issue(s)</summary>

#### Issue 1: SQL injection vulnerability in user query
**ID:** sec-users-sql-injection-f3a2
**File:** src/database/users.ts:45
**Severity:** HIGH
**Category:** security

**Context:**
- **Pattern:** Query at line 45 builds SQL via string concatenation with user-provided `userId`
- **Risk:** Allows arbitrary SQL injection via crafted input
- **Impact:** Unauthorized data access, modification, or database destruction
- **Trigger:** Any endpoint accepting user input that reaches this query

**Recommendation:** Use parameterized queries:
```typescript
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
```

#### Issue 2: Race condition in cache update
**ID:** bug-cache-race-condition-a1b2
**File:** src/services/cache.ts:89
**Severity:** HIGH
**Category:** bug

**Context:**
- **Pattern:** Cache read at line 85 and write at line 89 are separate non-atomic operations
- **Risk:** Concurrent requests can read stale data and overwrite each other's updates
- **Impact:** Data inconsistency, lost updates, stale cache serving
- **Trigger:** Multiple simultaneous requests updating the same cache key

**Recommendation:** Use atomic operations:
```typescript
await cache.setNX(key, value, { EX: ttl });
```

#### Issue 3: N+1 query pattern in user fetch
**ID:** pat-userservi-n-plus-one-c3d4
**File:** src/services/userService.ts:156
**Severity:** MEDIUM
**Category:** performance

**Context:**
- **Pattern:** Loop at line 156 executes individual DB query per user ID
- **Risk:** O(n) database round-trips instead of O(1) batch query
- **Impact:** Degraded performance, database connection exhaustion under load
- **Trigger:** Fetching multiple users (e.g., listing team members)

**Recommendation:** Use batch fetching:
```typescript
const users = await db.query('SELECT * FROM users WHERE id = ANY($1)', [userIds]);
```

#### Issue 4: Missing input validation
**ID:** bug-auth-missing-validation-8b91
**File:** src/auth/login.ts:23
**Severity:** MEDIUM
**Category:** bug

**Context:**
- **Pattern:** Login function accepts email parameter without format validation
- **Risk:** Invalid email formats passed to downstream services
- **Impact:** Unexpected errors, failed lookups, or security bypass attempts
- **Trigger:** User submits malformed email in login form

**Recommendation:** Add email validation:
```typescript
if (!isValidEmail(email)) {
  throw new Error('Invalid email format');
}
```

</details>
