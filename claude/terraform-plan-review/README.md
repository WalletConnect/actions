# Claude Terraform Plan Review GitHub Action

Automated Terraform plan summaries using Claude AI.

## Overview

This GitHub Action provides automated, concise summaries for your Terraform plans within pull requests using Claude AI. It features:

- **Clear Summaries**: Distills noisy `terraform plan` output into a human-readable summary.
- **Impact Analysis**: Highlights resources to be added, changed, and destroyed.
- **Alignment Check**: Validates that the plan matches PR code changes and flags unexpected modifications.
- **Easy Integration**: Can be used as a standalone action or integrated into other actions.

## Usage

This action can be used in two ways:

1.  **Standalone**: As a separate step in your workflow after generating a Terraform plan.
2.  **Integrated**: Automatically as part of the `plan-terraform` action.

### Standalone Usage

You can use this action as a distinct step in any workflow.

```yaml
# ... after your terraform plan step ...
- name: Claude Terraform Plan Review
  uses: WalletConnect/actions/claude/terraform-plan-review@master
  with:
    anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
    terraform_plan: ${{ steps.plan.outputs.plan }} # Assumes plan output is in a step with id 'plan'
```

### Integrated Usage with `plan-terraform`

This action is also integrated directly into the `plan-terraform` action. By providing your `anthropic_api_key` to the `plan-terraform` action, it will automatically run this review action for you.

*For more details, see the documentation for the `plan-terraform` action.*

## Prerequisites

1.  **Anthropic API Key**: Obtain an API key from [Anthropic Console](https://console.anthropic.com/)
2.  **Repository Secret**: Add your API key as `ANTHROPIC_API_KEY` in your repository secrets.

## Inputs

| Input              | Required | Default                      | Description                                  |
| ------------------ | -------- | ---------------------------- | -------------------------------------------- |
| `anthropic_api_key`| ✅       | -                            | Your Anthropic API key for Claude access     |
| `model`            | ❌       | `claude-sonnet-4-5-20250929` | Claude model to use for reviews              |
| `terraform_plan`   | ✅       | -                            | The `terraform plan` output to be summarized |

## Output Details

The review includes:

- **Alignment Check**: Items explained by PR code changes vs unexpected changes
- **Potential Drift/Hidden Dependencies**: Suspected state drift or indirect impacts
- **Risky/Destructive Changes**: Force replacements, destroys, IAM changes
- **Verdict**: Whether the plan matches code changes or a mismatch is detected

## Security Considerations

### Credential Security

⚠️ **CRITICAL**: Never hardcode your Anthropic API key in workflow files!

- ✅ **Correct**: Always store credentials in GitHub Secrets: `${{ secrets.ANTHROPIC_API_KEY }}`
- ❌ **Incorrect**: Embedding API keys directly in workflow YAML files

## Support

For issues with the action, please check:

1.  GitHub Actions logs for detailed error messages.
2.  Your Anthropic API status and quotas.
3.  Repository permissions and secrets configuration.
