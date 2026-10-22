# Break-glass deploy

Ships a merged hotfix to production in minutes, skipping the regular
pipeline's post-merge validation, for the rare incident where the normal
30 to 40 minute release is not acceptable. Used by `rs-relay` and `pay-core`.

The hotfix PR is reviewed and merged as usual, so it has passed PR CI. What
the break-glass path skips is only the staging validation and end-to-end
stage of the post-merge release.

## Flow

1. Merge the hotfix PR. Add the `skip-deploy` label to it **before merging**
   so the regular release builds and publishes the image but does not deploy
   (see below). If the label was forgotten, step 3 still cancels the regular
   deploy.
2. Dispatch `break-glass.yaml` on `main` with the PR number. Anyone with
   write access can do this.
3. The run resolves the PR's merge commit ([`resolve-pr`](resolve-pr/action.yml)),
   comments on the PR, and takes the `cd` concurrency group with
   `cancel-in-progress: true`, which cancels the regular pipeline's deploy
   stage in both repos while its image build keeps going.
4. In parallel: the image is built on the large runner, or the build is skipped
   when [`aws/ecr/image-exists`](../../aws/ecr/image-exists/action.yml) finds
   the regular pipeline already published that commit; and a job bound to the
   `break-glass` environment waits for approval.
5. Any **codeowner except the person who dispatched the run** approves the
   environment deployment. Reviewers are the repo's CODEOWNERS (managed in
   `WalletConnect/infra`, `terraform/github.tf`), self-review is prevented,
   admins cannot bypass, and only `main` may deploy, so the gated job always
   runs main's workflow code.
6. Staging and production are deployed. The repo's minimal test set runs
   afterwards against staging and does not block the production deploy.

## What each repository provides

`break-glass.yaml`:

```yaml
on:
  workflow_dispatch:
    inputs:
      pr:
        description: Merged hotfix PR number
        required: true
concurrency:
  group: cd              # the regular deploy stage's group in both repos
  cancel-in-progress: true
jobs:
  resolve:   # WalletConnect/actions/github/break-glass/resolve-pr → sha
  build:     # needs: resolve; large runner; skipped when aws/ecr/image-exists is true
  approve:   # needs: resolve; environment: break-glass; no steps needed
  deploy:    # needs: [build, approve]; staging + prod
  validate:  # needs: deploy; the minimal test set, continue-on-error
```

The regular release honours `skip-deploy` with one step before its deploy job:

```yaml
      - uses: WalletConnect/actions/github/merged-pr-labels/@2.5.7
        id: merged
        with:
          label: skip-deploy
      # then: if: steps.merged.outputs.has-label != 'true' on the deploy job
```

## Notes

- A Terraform Cloud apply that is already running is not cancelled with the
  GitHub job; the break-glass apply queues behind it on the workspace lock.
- A regular deploy that had not started when it was cancelled runs after the
  break-glass run and redeploys the same commit, which is a no-op in pay-core
  and a same-binary restart in rs-relay. The `skip-deploy` label avoids it.
- Rollback: dispatch the repo's manual deploy workflow with the previous tag.
- Audit: the environment review (who, when, which run and SHA), the PR comment
  and the run summary.
