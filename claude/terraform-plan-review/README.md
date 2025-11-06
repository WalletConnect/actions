# Claude Terraform Plan Review GitHub Action

Automated Terraform plan review and analysis using Claude AI.

## Overview

This GitHub Action provides automated, intelligent reviews of Terraform plans within pull requests using Claude AI. It features:

- **Comprehensive Analysis**: Reviews complete Terraform plans regardless of size
- **Alignment Validation**: Checks that planned changes match PR code modifications
- **Risk Assessment**: Identifies destructive changes, drift, and unexpected modifications
- **Clear Communication**: Posts structured, readable reviews directly on PRs
- **Non-Blocking**: Can be configured to provide feedback without blocking merges

## Quick Start

Create a workflow file (e.g., `.github/workflows/terraform-plan.yml`):

```yaml
name: Terraform Plan & Review

on:
  pull_request:
    types: [opened, synchronize]
    branches: [main]
    paths:
      - 'terraform/**'

permissions:
  id-token: write
  contents: read
  pull-requests: write

jobs:
  plan:
    name: Terraform Plan
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          cli_config_credentials_token: ${{ secrets.TF_API_TOKEN }}

      - name: Terraform Init
        run: terraform init

      - name: Terraform Plan
        run: |
          terraform plan -no-color 2>&1 | tee plan_output.txt

      - name: Upload Plan for Review
        uses: actions/upload-artifact@v4
        with:
          name: terraform-plan
          path: plan_output.txt
          retention-days: 1

  review:
    name: AI Plan Review
    runs-on: ubuntu-latest
    needs: plan
    if: ${{ always() && needs.plan.result != 'cancelled' }}
    continue-on-error: true
    permissions:
      id-token: write
      contents: read
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download Terraform Plan
        uses: actions/download-artifact@v4
        with:
          name: terraform-plan
          path: /tmp

      - name: Claude Terraform Plan Review
        uses: WalletConnect/actions/claude/terraform-plan-review@master
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          terraform_plan_file: /tmp/plan_output.txt
```

## Prerequisites

1. **Anthropic API Key**: Obtain an API key from [Anthropic Console](https://console.anthropic.com/)
2. **Repository Secret**: Add your API key as `ANTHROPIC_API_KEY` in repository secrets
3. **Permissions**: Ensure the workflow has the required permissions (see examples below)

## Required Permissions

The review job requires these GitHub token permissions:

```yaml
permissions:
  id-token: write      # Required for Claude authentication via OIDC
  contents: read       # Required to read repository files
  pull-requests: write # Required to post review comments on PRs
```

⚠️ **Important**: If your job defines its own `permissions` block, it overrides the workflow-level permissions. Always include all three permissions in the job.

## Inputs

| Input                    | Required | Default                      | Description                                                      |
| ------------------------ | -------- | ---------------------------- | ---------------------------------------------------------------- |
| `anthropic_api_key`      | ✅       | -                            | Your Anthropic API key for Claude access                         |
| `model`                  | ❌       | `claude-sonnet-4-5-20250929` | Claude model to use for reviews                                  |
| `terraform_plan_file`    | ✅       | -                            | Path to file containing the Terraform plan output                |
| `terraform_plan_log_file`| ❌       | -                            | Path to file containing Terraform plan logs (warnings/errors)    |

## Usage Examples

### Recommended: Non-Blocking Separate Job

This pattern ensures the plan job completes quickly while the AI review runs independently without blocking merges:

```yaml
name: Terraform Plan & Review

on:
  pull_request:
    types: [opened, synchronize]
    branches: [main]
    paths:
      - 'terraform/**'

permissions:
  id-token: write
  contents: read
  pull-requests: write

jobs:
  plan:
    name: Terraform Plan
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          cli_config_credentials_token: ${{ secrets.TF_API_TOKEN }}

      - name: Terraform Init
        working-directory: terraform
        run: terraform init

      - name: Terraform Plan
        working-directory: terraform
        run: |
          set -o pipefail
          terraform plan -no-color 2>&1 | tee plan_output.txt

      - name: Upload Plan for Review
        if: ${{ always() }}
        uses: actions/upload-artifact@v4
        with:
          name: terraform-plan
          path: terraform/plan_output.txt
          retention-days: 1

  review:
    name: AI Plan Review
    runs-on: ubuntu-latest
    needs: plan
    if: ${{ always() && needs.plan.result != 'cancelled' }}
    continue-on-error: true  # Non-blocking: failures won't prevent PR merge
    permissions:
      id-token: write
      contents: read
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download Terraform Plan
        uses: actions/download-artifact@v4
        with:
          name: terraform-plan
          path: /tmp

      - name: Claude Terraform Plan Review
        uses: WalletConnect/actions/claude/terraform-plan-review@master
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          terraform_plan_file: /tmp/plan_output.txt
```

**Benefits:**
- ✅ Plan job gets green checkmark immediately
- ✅ Review runs in parallel without blocking
- ✅ `continue-on-error: true` ensures review failures don't block merges
- ✅ Developers get plan results quickly, review comes later

### With HCP Terraform (Terraform Cloud)

```yaml
jobs:
  plan:
    name: Terraform Plan
    runs-on: ubuntu-latest
    env:
      TF_API_TOKEN: ${{ secrets.TF_API_TOKEN }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          cli_config_credentials_token: ${{ secrets.TF_API_TOKEN }}

      - name: Terraform Init
        working-directory: terraform
        run: terraform init -no-color

      - name: Terraform Plan
        working-directory: terraform
        env:
          TF_WORKSPACE: production
        run: |
          set -o pipefail
          terraform plan -no-color 2>&1 | tee plan_output.txt

      - name: Upload Plan for Review
        uses: actions/upload-artifact@v4
        with:
          name: terraform-plan
          path: terraform/plan_output.txt
          retention-days: 1

  review:
    name: AI Plan Review
    runs-on: ubuntu-latest
    needs: plan
    if: ${{ always() && needs.plan.result != 'cancelled' }}
    continue-on-error: true
    permissions:
      id-token: write
      contents: read
      pull-requests: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download Terraform Plan
        uses: actions/download-artifact@v4
        with:
          name: terraform-plan
          path: /tmp

      - name: Claude Terraform Plan Review
        uses: WalletConnect/actions/claude/terraform-plan-review@master
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          terraform_plan_file: /tmp/plan_output.txt
```

### With Plan Logs (Warnings/Errors)

Include Terraform logs for more comprehensive reviews:

```yaml
- name: Terraform Plan
  working-directory: terraform
  run: |
    set -o pipefail
    terraform plan -no-color 2>&1 | tee plan_output.txt

- name: Upload Plan and Logs
  uses: actions/upload-artifact@v4
  with:
    name: terraform-plan
    path: |
      terraform/plan_output.txt
    retention-days: 1

# In review job:
- name: Claude Terraform Plan Review
  uses: WalletConnect/actions/claude/terraform-plan-review@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    terraform_plan_file: /tmp/plan_output.txt
    terraform_plan_log_file: /tmp/plan_output.txt  # Same file contains both
```

### Using with plan-terraform Action

If you're using the `plan-terraform` composite action, you can access the plan files via outputs:

```yaml
- name: Terraform Plan
  id: plan
  uses: WalletConnect/actions/actions/plan-terraform@master
  with:
    environment: production
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: us-east-1

- name: Claude Review
  uses: WalletConnect/actions/claude/terraform-plan-review@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    terraform_plan_file: ${{ steps.plan.outputs.plan-text-file }}
    terraform_plan_log_file: ${{ steps.plan.outputs.plan-log-file }}
```

## Review Output

The action posts a **concise summary** at the top of the comment with full details in a collapsible section to keep PRs clean and scannable.

### Summary (Always Visible)

```markdown
## 📊 Terraform Plan Review

**Summary:**
- 5 resources to add, 0 to change, 3 to destroy
- Verdict: ✅ Plan matches code changes
- Risk Level: Medium - Destroying 3 dev environment dashboards
```

### Full Analysis (Collapsible)

Click "📋 Full Analysis" to expand and see:

- **Plan Summary**: Resource counts and cost impact
- **Alignment Check**:
  - ✅ Expected changes matching PR code modifications
  - ⚠️ Unexpected changes not explained by PR diff
- **Risk Assessment**:
  - 🔍 Potential drift or hidden dependencies
  - 🔥 Risky/destructive changes (force replacements, destroys, IAM)
  - 🧭 Warnings and errors from Terraform
- **Detailed Changes**: Complete list of all resources being modified

This format ensures PRs remain readable even with multiple plan reviews while preserving all analysis details.

## Best Practices

### 1. Use Separate Jobs

Run the review in a separate job with `continue-on-error: true` to avoid blocking merges:

```yaml
review:
  needs: plan
  continue-on-error: true  # Non-blocking
```

### 2. Always Upload Plan as Artifact

Use artifacts to share the plan between jobs:

```yaml
- name: Upload Plan
  uses: actions/upload-artifact@v4
  with:
    name: terraform-plan
    path: terraform/plan_output.txt
    retention-days: 1  # Clean up after 1 day
```

### 3. Use if Conditions Wisely

Run the review even if the plan fails, but skip if cancelled:

```yaml
review:
  needs: plan
  if: ${{ always() && needs.plan.result != 'cancelled' }}
```

### 4. Set Appropriate Permissions

Always explicitly set required permissions at the job level:

```yaml
permissions:
  id-token: write      # For Claude authentication
  contents: read       # To read repository
  pull-requests: write # To post comments
```

### 5. Handle Large Plans

The action automatically handles large plans by:
- Reading the full plan file (no size limits)
- Posting a truncated preview to PR comments
- Instructing Claude to read the complete file

## Troubleshooting

### Common Issues

**"Unable to get ACTIONS_ID_TOKEN_REQUEST_URL"**

Solution: Add `id-token: write` permission to the job:
```yaml
permissions:
  id-token: write  # ← Required for Claude authentication
  contents: read
  pull-requests: write
```

**"Argument list too long"**

This should not occur with the file-based approach. Ensure you're passing file paths, not content:
```yaml
# ✅ Correct
terraform_plan_file: /tmp/plan_output.txt

# ❌ Incorrect (deprecated)
terraform_plan: ${{ steps.plan.outputs.stdout }}
```

**"No review posted"**

- Verify `ANTHROPIC_API_KEY` secret is set correctly
- Ensure `pull-requests: write` permission is granted
- Check that the plan file path is correct

**"Plan truncated"**

The PR comment may be truncated for readability, but Claude reviews the full plan. Check workflow logs for the complete review output.

### Getting Better Reviews

1. **Include Complete Plans**: Ensure stderr and warnings are captured
2. **Descriptive PR Descriptions**: Help Claude understand the intent
3. **Clear Commit Messages**: Provide context for changes
4. **Review Logs**: Check workflow logs for detailed analysis

## Security Considerations

### Credential Security

⚠️ **CRITICAL**: Never hardcode your Anthropic API key in workflow files!

- ✅ **Correct**: `${{ secrets.ANTHROPIC_API_KEY }}`
- ❌ **Incorrect**: Hardcoding keys in YAML

### Plan Content

- Plans may contain sensitive data (resource names, configurations)
- Plan files are ephemeral (stored in artifacts with short retention)
- Review comments on PRs are visible to repository members
- Claude processes plans securely via Anthropic's API

### Permissions

The action requires minimal permissions:
- `id-token: write` - For OIDC authentication
- `contents: read` - To read repository files
- `pull-requests: write` - To post comments

## Migrating from Content-Based to File-Based

If you're upgrading from an older version that used `terraform_plan` (content) input:

**Before:**
```yaml
- name: Claude Review
  uses: WalletConnect/actions/claude/terraform-plan-review@v1
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    terraform_plan: ${{ steps.plan.outputs.stdout }}
```

**After:**
```yaml
- name: Save Plan
  run: terraform plan -no-color > /tmp/plan.txt

- name: Claude Review
  uses: WalletConnect/actions/claude/terraform-plan-review@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    terraform_plan_file: /tmp/plan.txt
```

## Support

For issues with the action, please check:

1. GitHub Actions logs for detailed error messages
2. Your Anthropic API status and quotas
3. Repository permissions and secrets configuration
4. Ensure all required permissions are set at the job level

For questions or feature requests, please open an issue in the repository.
