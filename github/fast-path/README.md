# Fast path (break-glass) deploy

Ships a hotfix from an open pull request to production before it is merged,
with one human approval, for the rare case where waiting for review, CI and
the normal release is not acceptable. Used by `rs-relay` and `pay-core`.

## Flow

1. Someone adds the `fast-path` label to the PR.
2. [`trigger`](trigger/action.yml) (run from a `pull_request_target` workflow,
   i.e. base-branch code) pins the PR head SHA and dispatches the repository's
   `fast-path` workflow **on the default branch**, so the deploy logic is
   always main's, never the PR's. It comments the run link on the PR.
3. The `fast-path` workflow builds and publishes the image for that SHA (or
   skips the build when [`aws/ecr/image-exists`](../../aws/ecr/image-exists/action.yml)
   finds it already published) while, in parallel, a job bound to the
   `break-glass` environment waits for approval.
4. An approver (team `break-glass-approvers`, managed in
   `WalletConnect/infra` `terraform/github.tf`) approves the environment
   deployment in the run. GitHub records who approved which run and SHA;
   self-approval is prevented.
5. The workflow re-checks that the PR head is still the pinned SHA, deploys,
   and labels the PR `fast-path:deployed`.
6. Every normal release pipeline calls [`guard`](guard/action.yml) before its
   production deploy: while an open PR carries `fast-path:deployed` and the
   commit being deployed does not contain its head SHA, the deploy fails
   instead of rolling the hotfix back. Merging the PR clears the hold.

The label is only a request. Anyone with write access can add it; it starts a
build and publishes an image, nothing more. The authorization is the
environment approval.

## What each repository provides

A three-line trigger workflow:

```yaml
name: fast-path-trigger
on:
  pull_request_target:
    types: [labeled]
permissions:
  contents: read
  actions: write
  pull-requests: write
jobs:
  trigger:
    if: github.event.label.name == 'fast-path'
    runs-on: ubuntu-latest
    steps:
      - uses: WalletConnect/actions/github/fast-path/trigger/@2.5.7
        with:
          workflow: fast-path.yaml
```

A `fast-path` workflow on `workflow_dispatch` with inputs `pr` and `sha`, and
jobs in this shape:

| Job | Notes |
|---|---|
| `resolve` | PR open, head still equals `sha`; outputs the image tag |
| `build` | repository-specific; skip when `aws/ecr/image-exists` says the tag is there |
| `approve` | `environment: break-glass`, no steps needed; `needs: [resolve]` |
| `deploy` | `needs: [build, approve]`; re-check head SHA, deploy, add `fast-path:deployed` |

And the guard in front of every production deploy of the normal pipelines:

```yaml
      - uses: WalletConnect/actions/github/fast-path/guard/@2.5.7
        # with: { mode: warn }   # annotate only; default fails the job
```

## Operating it

- Approvers get GitHub's environment-review notification; the run page shows
  the PR, the SHA and the image tag before approving.
- After the deploy, merge the PR promptly. Until then, normal releases to
  production are blocked by the guard (by design) and the PR comment says so.
- Reverting a fast-pathed change: deploy the previous tag with the
  repository's manual deploy workflow, then remove `fast-path:deployed` from
  the PR so the guard releases the hold.
- Each repository's own docs describe its build and deploy specifics and the
  runner used for the build.
