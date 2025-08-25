# CTA Assistant Action

A reusable GitHub Action for managing Copyright Transfer Agreement (CTA) signatures from contributors.

## Overview

This action automates the process of collecting CTA signatures from contributors to your repository. It integrates with pull requests to ensure all contributors have signed your CTA before their contributions can be merged.

This is a reusable wrapper around the upstream [contributor-assistant/github-action](https://github.com/contributor-assistant/github-action) that provides CTA-specific configuration and terminology for WalletConnect repositories.

## Features

- Automated CTA signature collection
- Configurable CTA document URL
- Customizable signature storage location
- Flexible commit messages and PR comments
- Support for remote signature storage
- Automatic pull request status updates

## Usage

### Basic Setup

1. Create a workflow file in your repository (e.g., `.github/workflows/cta.yml`):

```yaml
name: "CTA Assistant"
on:
  issue_comment:
    types: [created]
  pull_request_target:
    types: [opened, closed, synchronize]

# Required permissions
permissions:
  actions: write
  contents: write # can be 'read' if signatures are in remote repository
  pull-requests: write
  statuses: write

jobs:
  CTA:
    runs-on: ubuntu-latest
    steps:
      - uses: walletconnect/actions/github/cta-assistant@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # Required only for remote signature storage:
          # PERSONAL_ACCESS_TOKEN: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
```

### Advanced Configuration

```yaml
steps:
  - uses: walletconnect/actions/github/cta-assistant@v1
    with:
      cta-document-url: "https://your-domain.com/cta-document"
      signatures-path: "legal/signatures/cta.json"
      signatures-branch: "cta-signatures"
      create-file-commit-message: "docs: initialize CTA signatures file"
      signed-commit-message: "docs: @$contributorName signed the CTA"
      custom-pr-sign-comment: "I have read and agree to the CTA terms"
      custom-allsigned-prcomment: "All contributors have signed the CTA! 🎉"
      remote-organization-name: "your-org"
      remote-repository-name: "cta-signatures"
      lock-pullrequest-aftermerge: "false"
      allowlist: "external-contributor1,external-contributor2"
```

## Inputs

| Input                         | Description                                                                      | Required | Default                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `cta-document-url`            | URL to the CTA document                                                          | No       | `https://github.com/reown-com/copyright-transfer-agreement/blob/main/copyright-transfer-agreement/v1/Copyright-Transfer-Agreement-GITHUB.pdf` |
| `signatures-path`             | Path to store signatures                                                         | No       | `signatures/version1/cta.json`                                                                                                                |
| `signatures-branch`           | Branch for signatures (should not be protected)                                  | No       | `signatures`                                                                                                                                  |
| `create-file-commit-message`  | Commit message when creating signatures file                                     | No       | `Creating file for storing CTA Signatures`                                                                                                    |
| `signed-commit-message`       | Commit message when contributor signs                                            | No       | `@$contributorName has signed the CTA`                                                                                                        |
| `custom-pr-sign-comment`      | Comment contributors use to sign                                                 | No       | `I have read the CTA Document and I hereby sign the CTA`                                                                                      |
| `custom-allsigned-prcomment`  | Comment when all have signed                                                     | No       | `All contributors have signed the CTA ✍️ ✅`                                                                                                  |
| `custom-notsigned-prcomment`  | Custom message for unsigned contributors                                         | No       | Auto-generated                                                                                                                                |
| `remote-organization-name`    | Remote org for signature storage                                                 | No       | -                                                                                                                                             |
| `remote-repository-name`      | Remote repo for signature storage                                                | No       | -                                                                                                                                             |
| `lock-pullrequest-aftermerge` | Lock PR after merge                                                              | No       | `true`                                                                                                                                        |
| `allowlist`                   | Additional users to allowlist (appends to existing WalletConnect team allowlist) | No       | `""`                                                                                                                                          |

## How It Works

1. When a pull request is opened, the action checks if all contributors have signed the CTA
2. If not signed, a comment is posted with instructions and a link to the CTA document
3. Contributors sign by posting the specified comment text in the PR
4. Once all contributors have signed, the PR is marked as compliant
5. Signatures are stored in the specified branch and path

## Required Permissions

The workflow requires these permissions:

- `actions: write` - Update workflow status
- `contents: write` - Commit signature files (or `read` if using remote storage)
- `pull-requests: write` - Comment on PRs
- `statuses: write` - Update PR status checks

## Allowlist Configuration

The action includes a built-in allowlist of WalletConnect team members and bots who are exempt from signing the CTA. You can append additional users using the `allowlist` input:

```yaml
with:
  allowlist: "external-contributor1,external-contributor2,contractor-*"
```

**Important:** Your allowlist will be appended to (not replace) the existing WalletConnect team allowlist, which includes all bot users and current team members.

## Remote Storage

For organizations managing multiple repositories, you can store signatures in a centralized location:

1. Create a dedicated repository for signatures
2. Generate a Personal Access Token with `repo` scope
3. Add it as `PERSONAL_ACCESS_TOKEN` secret
4. Configure `remote-organization-name` and `remote-repository-name`

## Environment Variables

- `GITHUB_TOKEN` - Required (automatically provided)
- `PERSONAL_ACCESS_TOKEN` - Required only for remote signature storage

## Troubleshooting

### Contributors Can't Sign

- Ensure the comment text matches `custom-pr-sign-comment` exactly
- Check that the workflow has proper permissions
- Verify the signatures branch exists and is not protected

### Signatures Not Persisting

- Check write permissions to the repository
- Ensure the signatures branch is not protected
- Verify `PERSONAL_ACCESS_TOKEN` if using remote storage

### Status Not Updating

- Confirm `statuses: write` permission is granted
- Check that the workflow triggers on the correct events
