# Claude Auto Review GitHub Action

Automated code review using Claude AI with configurable project context and incremental review capabilities.

## Overview

This GitHub Action provides automated code reviews for your pull requests using Claude AI. It features:

- **Smart incremental reviews** - Only flags new issues in subsequent commits
- **Configurable prompts** - Customize review focus with project-specific context
- **Multiple trigger modes** - Automatic on PR open or manual via comments
- **Security-focused** - Built-in emphasis on security, performance, and best practices

## Prerequisites

1. **Anthropic API Key**: Obtain an API key from [Anthropic Console](https://console.anthropic.com/)
2. **Repository Secret**: Add your API key as `ANTHROPIC_API_KEY` in repository secrets
3. **Permissions**: Ensure the workflow has appropriate GitHub token permissions

## Quick Start

Create a workflow file (e.g., `.github/workflows/claude-review.yml`):

```yaml
name: Claude Auto Review

on:
  pull_request:
    types: [opened]
    branches: [main] # or your default branch
  issue_comment:
    types: [created]

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 60  # Recommended: control timeout at job level
    if: |
      github.event_name == 'pull_request'
      || (
        github.event_name == 'issue_comment'
        && github.event.issue.pull_request
        && contains(github.event.comment.body, '@claude review')
      )
    permissions:
      contents: read
      pull-requests: write
      issues: write
      id-token: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Claude Review
        uses: WalletConnect/actions/claude/auto-review@master
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Configuration Options

### Inputs

| Input               | Required | Default                      | Description                                                                                           |
| ------------------- | -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `anthropic_api_key` | ✅       | -                            | Your Anthropic API key for Claude access                                                              |
| `model`             | ❌       | `claude-sonnet-4-5-20250929` | Claude model to use for reviews                                                                       |
| `timeout_minutes`   | ❌       | -                            | ⚠️ DEPRECATED: Accepted but ignored by v1 (no effect). Use job-level `timeout-minutes` instead.       |
| `custom_prompt`     | ❌       | -                            | Complete custom prompt override. Ignores all other prompt inputs if provided                          |
| `project_context`   | ❌       | -                            | Additional project-specific context to help Claude understand your codebase                           |

## Usage Examples

### Basic Usage

```yaml
- name: Claude Review
  uses: WalletConnect/actions/claude/auto-review@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### With Project Context

```yaml
- name: Claude Review
  uses: WalletConnect/actions/claude/auto-review@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    project_context: |
      This is a React TypeScript application using:
      - Next.js with App Router
      - PostgreSQL with Prisma ORM  
      - tRPC for API layer
      - Jest for testing

      Key considerations:
      - Follow React Query patterns for data fetching
      - Ensure proper TypeScript strict mode compliance
      - Maintain API route security with proper validation
```

### With Custom Model and Timeout

```yaml
jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 90  # Job-level timeout (recommended)
    steps:
      - name: Claude Review
        uses: WalletConnect/actions/claude/auto-review@master
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          model: claude-sonnet-4-5-20250929
```

### With Complete Custom Prompt

```yaml
- name: Claude Review
  uses: WalletConnect/actions/claude/auto-review@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    custom_prompt: |
      Review this Python Django pull request focusing specifically on:
      1. Django best practices and security patterns
      2. Database migration safety
      3. API endpoint security and validation
      4. Test coverage for new functionality
      5. Performance implications of ORM queries

      Provide specific, actionable feedback with code examples.
```

## Workflow Integration

### Automatic Reviews

The action can automatically review PRs when they are opened:

```yaml
on:
  pull_request:
    types: [opened, synchronize] # Include synchronize for incremental reviews
    branches: [main, develop]
```

### Manual Triggers

Enable manual reviews by commenting `@claude review` on any PR:

```yaml
on:
  issue_comment:
    types: [created]

jobs:
  review:
    if: |
      github.event.issue.pull_request
      && contains(github.event.comment.body, '@claude review')
```

### Combined Approach (Recommended)

```yaml
on:
  pull_request:
    types: [opened]
    branches: [main]
  issue_comment:
    types: [created]

jobs:
  review:
    if: |
      github.event_name == 'pull_request'
      || (
        github.event_name == 'issue_comment'
        && github.event.issue.pull_request
        && contains(github.event.comment.body, '@claude review')
      )
```

## Review Features

### Incremental Reviews

For PR updates (`synchronize` events) or manual `@claude review` triggers after the initial review, Claude:

- ✅ Checks existing review comments
- ✅ Only flags **new** issues in latest commits
- ✅ Notes if previously flagged issues were resolved
- ✅ Avoids repeating previous feedback

### Built-in Review Focus Areas

The default prompt emphasizes:

- **Code Quality** - Best practices for your tech stack
- **Security** - Authentication, API endpoints, data handling
- **Performance** - Frontend and backend optimization opportunities
- **Testing** - Coverage and quality of test implementations
- **Type Safety** - Proper usage of type systems
- **Error Handling** - Edge cases and error scenarios
- **Maintainability** - Code readability and structure
- **Static Resource Caching** - Validates Cache-Control headers for static immutable resources (fonts, images, CSS, JS) to ensure proper caching (1 year minimum for immutable assets)
- **External Dependencies** - Flags URLs pointing to domains outside approved company domains

## Best Practices

### 1. Provide Project Context

Always include relevant project context to get more targeted reviews:

```yaml
project_context: |
  Tech Stack: React + TypeScript + Node.js
  Database: MongoDB with Mongoose
  Testing: Jest + React Testing Library
  Deployment: Docker on AWS ECS

  Focus Areas:
  - MongoDB query optimization
  - React performance patterns  
  - Proper error boundaries usage
  - Docker security practices
```

### 2. Use Branch Protection

Consider requiring Claude reviews before merging:

```yaml
on:
  pull_request:
    types: [opened, synchronize]
```

### 3. Combine with Other Checks

Claude reviews complement (don't replace) automated testing:

```yaml
jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      # Your test steps

  claude-review:
    needs: tests # Run after tests pass
    # Claude review steps
```

## Troubleshooting

### Common Issues

**"Action timed out"**

- Increase `timeout_minutes` for large PRs
- Consider breaking large changes into smaller PRs

**"API key invalid"**

- Verify `ANTHROPIC_API_KEY` secret is set correctly
- Ensure API key has sufficient credits/quota

**"No review posted"**

- Check GitHub token permissions include `pull-requests: write`
- Verify workflow triggers are configured correctly

**"Review quality is generic"**

- Add specific `project_context` about your tech stack
- Include coding standards and architectural patterns
- Mention specific areas of concern for your project

### Getting Better Reviews

1. **Be Specific**: Include detailed project context about your architecture, patterns, and concerns
2. **Update Context**: Keep project context current as your codebase evolves
3. **Use Manual Triggers**: Comment `@claude review` for focused reviews of specific changes
4. **Iterate on Prompts**: Refine custom prompts based on review quality

## Security Considerations

### Access Control

- Only users with repository write access can trigger the Claude Code Action
- GitHub Apps and bots are blocked by default for additional security
- Authentication tokens are short-lived and scoped to the specific repository

### Required GitHub App Permissions

The Claude GitHub App requires these specific permissions:

- **Pull Requests**: Read/write access to create and update pull request reviews
- **Issues**: Read/write access to respond to issue comments
- **Contents**: Read/write access to analyze and modify repository files

### Credential Security

⚠️ **CRITICAL**: Never hardcode your Anthropic API key or OAuth token in workflow files!

- ✅ **Correct**: Always store credentials in GitHub Secrets: `${{ secrets.ANTHROPIC_API_KEY }}`
- ❌ **Incorrect**: Embedding API keys directly in workflow YAML files
- API keys are securely handled through GitHub Secrets infrastructure
- All communication between the action and Anthropic's API uses HTTPS

### Additional Security Features

- All commits made by Claude are automatically signed for authenticity verification
- The action only has read access to code and write access to PR comments
- No code or sensitive data is stored by the action beyond the GitHub workflow execution
- Short-lived tokens ensure minimal security exposure window

### For Complete Security Details

For comprehensive security information and best practices, see the [official Claude Code Action security documentation](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md).

## Support

For issues with the action itself, please check:

1. GitHub Actions logs for detailed error messages
2. Anthropic API status and quotas
3. Repository permissions and secrets configuration
