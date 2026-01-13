# Claude Agent Action

Generic `@claude` handler with org defaults and author validation. Wraps [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) with built-in trigger validation and org-specific configuration.

## Features

- **Author validation** - Only allows trusted users (OWNER, MEMBER, COLLABORATOR by default)
- **Trigger detection** - Detects `@claude` mentions, excludes `@claude review` (handled by auto-review)
- **Org defaults** - Concise output, conventional commits, conventional branch naming
- **Tool restrictions** - Optionally limit Claude's available tools
- **Turn limits** - Prevent runaway API usage

## Usage

```yaml
name: Claude Code

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  claude:
    # Filter early to avoid spinning up runners unnecessarily
    if: |
      (
        (github.event_name == 'issue_comment' || github.event_name == 'pull_request_review_comment') &&
        contains(github.event.comment.body, '@claude') &&
        !contains(github.event.comment.body, '@claude review')
      ) ||
      (
        github.event_name == 'pull_request_review' &&
        contains(github.event.review.body, '@claude') &&
        !contains(github.event.review.body, '@claude review')
      ) ||
      (
        github.event_name == 'issues' &&
        (
          contains(github.event.issue.body, '@claude') ||
          contains(github.event.issue.title, '@claude')
        ) &&
        !contains(github.event.issue.body, '@claude review') &&
        !contains(github.event.issue.title, '@claude review')
      )
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: write
      pull-requests: write
      issues: write
      id-token: write
      actions: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - uses: WalletConnect/actions/claude/agent@master
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

> **Note:** The workflow `if` filter is optional but recommended for CI efficiency. It prevents runner spin-up for non-matching events. The action validates triggers internally regardless.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `anthropic_api_key` | Yes | — | Anthropic API key |
| `model` | No | `claude-sonnet-4-5-20250929` | Claude model to use |
| `allowed_tools` | No | (all) | Comma-separated list of allowed tools |
| `system_instructions` | No | (org defaults) | Behavioral guidelines prepended to prompts |
| `project_context` | No | — | Repo-specific context |
| `allowed_bots` | No | — | Bot usernames that can trigger |
| `max_turns` | No | `50` | Max agentic turns |
| `track_progress` | No | `true` | Show progress in comments |
| `allowed_authors` | No | `OWNER,MEMBER,COLLABORATOR` | Allowed author_association values |

## Examples

### Read-only mode

Restrict Claude to read-only tools:

```yaml
- uses: WalletConnect/actions/claude/agent@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    allowed_tools: "Read,Grep,Glob,WebFetch,WebSearch"
```

### Custom system instructions

Override org defaults:

```yaml
- uses: WalletConnect/actions/claude/agent@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    system_instructions: |
      Be extremely concise.
      Always write tests for new code.
      Use TypeScript strict mode.
```

### Project-specific context

Add context about your repo:

```yaml
- uses: WalletConnect/actions/claude/agent@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    project_context: |
      This is a React Native mobile app using Expo.
      State management uses Zustand.
      API calls go through src/api/ directory.
```

### Allow specific bots

```yaml
- uses: WalletConnect/actions/claude/agent@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    allowed_bots: "devin-ai-integration[bot],dependabot[bot]"
```

### Restrict author access

Only allow owners:

```yaml
- uses: WalletConnect/actions/claude/agent@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    allowed_authors: "OWNER"
```

## Default System Instructions

When `system_instructions` is not provided, the action uses:

```
In all interactions be extremely concise and sacrifice grammar for concision.
Use conventional commit format for commits.
Use conventional commit style naming for branches (e.g., fix/..., feat/...).
```

## Trigger Behavior

The action validates triggers before running:

1. **Author check** - `author_association` must be in `allowed_authors`
2. **Mention check** - Comment/issue must contain `@claude`
3. **Exclusion check** - `@claude review` is excluded (use auto-review action)

If any check fails, the action exits gracefully without error.

## Related Actions

- [`claude/auto-review`](../auto-review/) - Automated PR code review with `@claude review`
