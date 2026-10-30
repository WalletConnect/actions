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

1. Review and merge the hotfix PR. Title it `hotfix: …` or `hotfix(scope): …`
   and add the `skip-deploy` label **before merging**: the regular release
   then builds the image on the large runner (`vars.BREAK_GLASS_RUNNER`, from
   the title prefix) and publishes it, but does not deploy (from the label).
2. Dispatch `break-glass.yaml` on `main` with the helper, which signs the
   challenge on your YubiKey and dispatches in one go:

   ```bash
   break-glass-sign.sh WalletConnect/pay-core --pr 2090      # merged hotfix
   break-glass-sign.sh reown-com/rs-relay --tag v1.80.3     # redeploy or roll back an existing image
   ```

   This command is the only way to run it: a dispatch from the Actions page
   carries no proof and fails at the `verify` job. For a rollback, pass the
   tag you want: a `v*` release tag in rs-relay, the commit SHA of the release
   in pay-core (both visible in the release run that deployed it, or on the
   running ECS task definition).
3. The run resolves the target ([`resolve-pr`](resolve-pr/action.yml) for a
   PR, the ECR lookup for a tag) and comments on the PR. It takes the `cd`
   concurrency group with `cancel-in-progress: true`, which cancels the
   regular pipeline's deploy stage in both repos while its image build keeps
   going.
4. [`verify-proof`](verify-proof/action.yml) checks the `proof` input: by the
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

### Enrolling a YubiKey

Prerequisites: an OpenSSH with FIDO2 support and `gh` logged in.
- macOS: `brew install openssh`. Apple's own `ssh-keygen` cannot talk to FIDO2
  devices and there is no provider library to add to it; the helper finds
  Homebrew's binary by path, so no PATH change is needed. If you ever exported
  `SSH_SK_PROVIDER`, the helper ignores a dangling value, but remove it anyway.
- Linux: the distribution's `openssh-client` (Ubuntu 22.04+, Debian 12+ ship
  it built with libfido2). If the device is not detected, install
  `libfido2-1` and its udev rules and re-plug the key.
- A YubiKey 5 with a FIDO2 PIN set: `ykman fido access change-pin`.

1. **Generate the key on the device and get your signers line in one go:**

   ```bash
   break-glass-sign.sh --enrol
   ```

   Touch the key when it blinks and enter the PIN. The key is created inside
   the authenticator (`ed25519-sk`, resident, `verify-required`: PIN and touch
   per signature); `~/.ssh/break_glass` is only a handle to it, and
   `~/.ssh/break_glass.att` is the device attestation, see step 3. The command
   prints the line to add, with your GitHub login as principal:

   ```
   <github-login> namespaces="break-glass" sk-ssh-ed25519@openssh.com AAAA... <github-login> YubiKey
   ```

2. **Add that line to the repository's signers file**,
   `.github/break-glass-signers`, through a normal PR. One repository, one
   file: to run the break-glass path in both `rs-relay` and `pay-core`, the
   same line goes into both repositories.

3. **Review.** [`lint-signers`](lint-signers/action.yml) runs on the PR and
   rejects any key that is not an `sk-` type. CODEOWNERS covers the file, so a
   codeowner approves it. If the device brand matters, the reviewer checks
   that the attestation from step 1 chains to the Yubico FIDO root CA; the
   workflow only proves that a FIDO2 authenticator was touched, not which one.

4. **Try it without deploying.** Signing works as soon as the key exists;
   the signers file is only consulted by the run:

   ```bash
   break-glass-sign.sh <owner/repo> --tag <any existing image tag> --dry-run
   ```

   The YubiKey blinks, you touch it, the signature prints, nothing is
   dispatched.

5. **Rotation and loss.** Remove the line through a PR and the key stops
   working on the next run; a replacement device is a new line (`--enrol
   --key ~/.ssh/break_glass_2`). Enrolling a second YubiKey as a second line is
   the backup, since a lost device cannot be recovered.

## What each repository provides

`break-glass.yaml`:

```yaml
on:
  workflow_dispatch:
    inputs:
      pr:        { description: Merged hotfix PR number, required: false }
      image-tag: { description: Existing image tag to deploy, required: false }
      proof:     { description: YubiKey signature from break-glass-sign.sh, required: true }
concurrency:
  group: cd              # the regular deploy stage's group in both repos
  cancel-in-progress: true
jobs:
  resolve:         # exactly one of pr / image-tag; resolve-pr → sha, or ECR lookup → tag; computes the challenge
  verify:          # needs: resolve; verify-proof on the proof input
  build:           # needs: verify; large runner; skipped when aws/ecr/image-exists is true or in tag mode
  deploy-staging:  # needs: build
  deploy-prod:     # needs: build        (in parallel with staging)
  tests:           # needs: deploy-staging; the regular test suite, continue-on-error
```

`.github/break-glass-signers` and a lint job on PRs that touch it.

The regular release honours `skip-deploy` with one step before its deploy job:

```yaml
      - uses: WalletConnect/actions/github/merged-pr-labels/@2.5.7
        id: merged
        with:
          label: skip-deploy
      # then: if: steps.merged.outputs.has-label != 'true' on the deploy job
```

## Rules the run enforces

- Dispatched on the default branch only, and the signers file is read from
  that branch through the API: `verify-proof` enforces both itself, so a
  workflow copy on another branch cannot relax them.
- Nothing runs before `verify`: no cloud role, no build, no PR comment.
- A re-run must be by the dispatcher; the proof is bound to them.
- `terraform/` must not differ between the target commit and main HEAD: the
  deploy applies main's Terraform with the target image. Deploy main HEAD
  instead, or an image whose Terraform matches.
- After `verify`, in-flight regular releases of older commits are cancelled,
  so none of them can redeploy a version without the hotfix afterwards.

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
