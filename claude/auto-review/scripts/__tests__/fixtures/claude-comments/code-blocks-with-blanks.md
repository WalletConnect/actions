<details>
<summary>Found 1 issue(s)</summary>

#### Issue 1: Incorrect async error handling
**ID:** api-async-error-2f8a
**File:** src/api/client.ts:67
**Severity:** HIGH
**Category:** error-handling
**Context:** The async function doesn't properly handle promise rejections.
**Recommendation:** Wrap the async operation in try-catch:
```typescript
async function fetchData() {
  try {
    const response = await fetch(url);

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Fetch failed:', error);
    throw error;
  }
}
```

**Exploit Scenario:** Unhandled promise rejections can crash the Node.js process in production.

</details>
