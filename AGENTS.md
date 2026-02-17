# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Repository Overview

WalletConnect's shared GitHub Actions and reusable workflows for infrastructure, deployments, and AI-powered code review.

## Development Commands

### Auto-Review Tests
```bash
cd claude/auto-review
pnpm install               # Install dependencies
pnpm test                  # Run tests
pnpm test:watch           # Watch mode
pnpm test:coverage        # With coverage report
```

### Pre-commit Hooks
```bash
pre-commit install        # Install hooks
pre-commit run --all-files # Run all checks
```

## Architecture

### Directory Structure

- **actions/** - High-level composite actions (deploy-terraform, deploy-ecs, plan-terraform)
- **terraform/** - Terraform primitives (init, plan, apply, validate, select-workspace, check-fmt)
- **aws/** - AWS-specific actions (ECS deploy/task-image, Grafana key management)
- **github/** - GitHub utilities (paths-filter, branch-name, release versioning, CTA assistant)
- **claude/** - AI review actions
  - **auto-review/** - PR code review with inline findings comments
  - **terraform-plan-review/** - Terraform plan analysis
- **deploy-window/** - Deploy timing controls

### Auto-Review Action (`claude/auto-review/`)

Wraps `anthropics/claude-code-action` to provide automated PR reviews. Key components:

- `action.yml` - Main composite action with dynamic prompt generation
- `scripts/extract-findings-from-comment.js` - Parses AI agent's comment to extract structured findings
- `scripts/comment-pr-findings.js` - Posts inline PR review comments from findings.json
- `scripts/lib/github-utils.js` - Shared utilities (gh CLI wrapper, context loading)

**Flow:** AI agent reviews PR → posts comment → extract-findings parses issues → comment-pr-findings posts inline comments

### Workflows

- `.github/workflows/claude.yml` - General AI agent invocation (@claude mentions, excluding @claude review)
- `.github/workflows/claude-review.yml` - Auto-review on PR open or @claude review comment
- `.github/workflows/test-claude-auto-review.yml` - CI for auto-review scripts

## Key Conventions

### Composite Actions
- All actions use `using: composite` with bash steps
- Inputs: kebab-case naming
- Outputs: written via `>> $GITHUB_OUTPUT`
- Use `working-directory` field over `cd` in scripts
- `$GITHUB_ENV`/`$GITHUB_OUTPUT` multiline syntax (`{name}<<{delimiter}`) is GitHub Actions-specific, NOT bash heredoc. Quoted delimiters like `<<'EOF'` are invalid — always use plain `<<EOF`

### Terraform Usage
- Set environment via `TF_WORKSPACE` env var
- Run non-interactively with `-no-color` and `TF_INPUT=0`
- Apply with `-auto-approve`
- Var files located at `vars/{environment}.tfvars`

### AWS Usage
- Configure credentials with `aws-actions/configure-aws-credentials@v4`
- Always require explicit region input
- Grafana: temporary keys with short TTL, cleanup via `always()` condition

### Security
- Mask sensitive values with `::add-mask::`
- External domains limited to: reown.com, walletconnect.com, walletconnect.org
- Cleanup temporary credentials/keys in `always()` steps

### Action References
- Consumers should pin to full 40-char commit SHA, not branch names
- Internal action refs use `@master` for this repo

## Testing Guidelines

For `claude/auto-review/` scripts:
- Tests use Vitest with v8 coverage
- Node.js 20+ required
- Test files: `scripts/__tests__/*.test.js`
- Fixtures: `scripts/__tests__/fixtures/`
- Scripts are ES modules with execution guards for testability
