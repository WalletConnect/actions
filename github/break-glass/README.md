# Break-glass deploy

Ships a merged hotfix to production in minutes. The run skips every test,
deploys staging and production in parallel, and runs the repository's usual
test suite afterwards without blocking. It is authorised by the person who
dispatches it proving possession of an enrolled YubiKey. Used by `rs-relay`
and `pay-core`.

The hotfix PR is reviewed and merged as usual, so it has passed PR CI. What
the break-glass path skips is the post-merge staging validation and
end-to-end stage of the regular release.

## Flow

1. Review and merge the hotfix PR. Add the `skip-deploy` label **before
   merging**: the regular release then builds and publishes the image but
   does not deploy (see below).
2. Dispatch `break-glass.yaml` on `main` with the helper, which signs the
   challenge on your YubiKey and dispatches in one go:

   ```bash
   break-glass-sign.sh WalletConnect/pay-core --pr 2090      # merged hotfix
   break-glass-sign.sh reown-com/rs-relay --tag v1.80.3     # redeploy or roll back an existing image
   ```

   Dispatching from the Actions page also works: the run then posts the
   challenge as a comment on the PR (or the repo's tracking issue in tag mode)
   and waits up to ten minutes for your signed reply.
3. The run resolves the target ([`resolve-pr`](resolve-pr/action.yml) for a
   PR, the ECR lookup for a tag) and comments on the PR. It takes the `cd`
   concurrency group with `cancel-in-progress: true`, which cancels the
   regular pipeline's deploy stage in both repos while its image build keeps
   going.
4. [`verify-proof`](verify-proof/action.yml) checks the signature: by the
   dispatcher, listed in `.github/break-glass-signers`, `sk-` key, over the
   challenge the run computed itself. Nothing is built or deployed before this
   passes.
5. The image is built on the large runner, or the build is skipped when
   [`aws/ecr/image-exists`](../../aws/ecr/image-exists/action.yml) finds the
   regular pipeline already published that commit.
6. Staging and production are deployed in parallel, each followed by its
   health check.
7. The repository's current test suite runs against staging, non-blocking.
   Failures notify; nothing is rolled back automatically.

## The proof

The challenge is bound to what is deployed:

- PR mode: `break-glass:<owner/repo>:pr:<number>:<merge commit sha>`
- Tag mode: `break-glass:<owner/repo>:tag:<image tag>`

`<owner/repo>` is the canonical name, as `GITHUB_REPOSITORY` reports it
(rs-relay is `reown-com/rs-relay`); the helper resolves it for you.
A captured signature can only redeploy that same commit or tag, which is
harmless; a compromised laptop cannot sign for any other commit without the
device being touched. The dispatcher and the signer must be the same login.

### Enrolment

```bash
ssh-keygen -t ed25519-sk -O resident -O verify-required -f ~/.ssh/break_glass
cat ~/.ssh/break_glass.pub
```

`verify-required` makes every signature ask for the PIN and a touch. Add a
line to the repo's `.github/break-glass-signers`, through a normal PR
(CODEOWNERS covers the file):

```
<github-login> namespaces="break-glass" sk-ssh-ed25519@openssh.com AAAA... <comment>
```

[`lint-signers`](lint-signers/action.yml) runs on PRs touching the file and
rejects any key that is not an `sk-` type. To require the YubiKey brand
specifically, verify the attestation `ssh-keygen -O write-attestation=...`
produces at enrolment; the workflow cannot check the brand later.

## What each repository provides

`break-glass.yaml`:

```yaml
on:
  workflow_dispatch:
    inputs:
      pr:        { description: Merged hotfix PR number, required: false }
      image-tag: { description: Existing image tag to deploy (or "previous"), required: false }
      proof:     { description: YubiKey signature from break-glass-sign.sh, required: false }
concurrency:
  group: cd              # the regular deploy stage's group in both repos
  cancel-in-progress: true
jobs:
  resolve:         # exactly one of pr / image-tag; resolve-pr → sha, or ECR lookup → tag; computes the challenge
  verify:          # needs: resolve; verify-proof (issue = the PR, or the tracking issue in tag mode)
  build:           # needs: verify; large runner; skipped when aws/ecr/image-exists is true or in tag mode
  deploy-staging:  # needs: build
  deploy-prod:     # needs: build        (in parallel with staging)
  tests:           # needs: deploy-staging; the regular test suite, continue-on-error
```

`.github/break-glass-signers`, a lint job on PRs that touch it, and in tag
mode the repo's rule for `previous` (pay-core: the ECS task definition's
previous revision; rs-relay: the previous `v*` tag).

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
  break-glass run and redeploys the same commit, a no-op in pay-core and a
  same-binary restart in rs-relay. The `skip-deploy` label avoids it.
- The proof protects the break-glass path. Any branch can still run a
  modified workflow with the same repository secrets and the org-wide OIDC
  trust; tightening that trust is a separate change in `infra-aws-org`.
- Audit: the PR comment (who, which commit, proof verified), the run summary,
  and the deployment records of the existing environments.
