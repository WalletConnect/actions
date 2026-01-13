# WalletConnect GitHub Actions

Shared GitHub Actions and reusable workflows for infrastructure, deployments, and AI-powered code review.

## Directory Structure

```
actions/
├── actions/          # High-level composite actions
│   ├── deploy-terraform/      # Complete Terraform deployment
│   ├── deploy-ecs/            # ECS service deployment
│   ├── plan-terraform/        # Terraform planning
│   └── fmt-check-terraform/   # Terraform formatting check
├── terraform/        # Terraform primitives
│   ├── init/         # Initialize Terraform
│   ├── plan/         # Generate execution plan
│   ├── apply/        # Apply changes
│   ├── validate/     # Validate configuration
│   ├── select-workspace/  # Switch workspace
│   └── check-fmt/    # Format checking
├── aws/             # AWS-specific actions
│   ├── ecs/         # ECS operations (deploy-image, get-task-image)
│   └── grafana/     # Grafana key management
├── github/          # GitHub utilities
│   ├── paths-filter/         # Path-based filtering
│   ├── branch-name/          # Branch name utilities
│   ├── latest-release-version/  # Release versioning
│   ├── update-release-version/  # Update release versions
│   └── cta-assistant/        # CTA assistant
├── claude/          # AI-powered review
│   ├── agent/                # Generic Claude agent handling
│   ├── auto-review/          # PR code review with inline comments
│   └── terraform-plan-review/  # Terraform plan analysis
└── deploy-window/   # Deploy timing controls
```

## Quick Start

### Deploy Terraform Infrastructure

```yaml
- uses: WalletConnect/actions/actions/deploy-terraform@master
  with:
    environment: staging
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: us-east-1
```

### Deploy ECS Service

```yaml
- uses: WalletConnect/actions/actions/deploy-ecs@master
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: us-east-1
    cluster-name: my-cluster
    service-name: my-service
    task-definition-name: my-task
    image-name: my-image:v1.0.0
```

### AI Code Review

```yaml
- uses: WalletConnect/actions/claude/auto-review@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    model: claude-sonnet-4-5-20250929
    project_context: |
      This is a payment processing service using Node.js and TypeScript.
```

## Key Conventions

### Composite Actions
- All actions use `using: composite` with bash steps
- Inputs use kebab-case naming
- Outputs written via `>> $GITHUB_OUTPUT`
- Use `working-directory` field over `cd` in scripts

### Terraform Usage
- Set environment via `TF_WORKSPACE` env var
- Run non-interactively with `-no-color` and `TF_INPUT=0`
- Apply with `-auto-approve`
- Var files located at `vars/{environment}.tfvars`

### AWS Usage
- Configure credentials with `aws-actions/configure-aws-credentials@v4`
- Always require explicit region input
- Grafana keys have short TTL, cleanup via `always()` condition

### Security
- Mask sensitive values with `::add-mask::`
- External domains limited to: reown.com, walletconnect.com, walletconnect.org
- Cleanup temporary credentials/keys in `always()` steps

### Action References
- Consumers should pin to full 40-char commit SHA, not branch names
- Internal action refs use `@master` for this repo

## Development

### Auto-Review Tests

```bash
cd claude/auto-review
pnpm install          # Install dependencies
pnpm test            # Run tests
pnpm test:watch      # Watch mode
pnpm test:coverage   # With coverage
```

### Pre-commit Hooks

```bash
pre-commit install           # Install hooks
pre-commit run --all-files  # Run all checks
```

## Claude Auto-Review

The `claude/auto-review` action provides automated PR reviews with inline findings comments.

**Key components:**
- `action.yml` - Main composite action with dynamic prompt generation
- `scripts/extract-findings-from-comment.js` - Parses AI comment to extract structured findings
- `scripts/comment-pr-findings.js` - Posts inline PR review comments from findings.json
- `scripts/lib/github-utils.js` - Shared utilities (gh CLI wrapper, context loading)

**Flow:** AI agent reviews PR → posts comment → extract-findings parses issues → comment-pr-findings posts inline comments

## Workflows

- `.github/workflows/claude.yml` - General AI agent invocation (@claude mentions)
- `.github/workflows/claude-review.yml` - Auto-review on PR open or @claude review comment
- `.github/workflows/test-claude-auto-review.yml` - CI for auto-review scripts
