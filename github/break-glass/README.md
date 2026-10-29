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

1. Review and merge the hotfix PR. Add two labels **before merging**:
   `skip-deploy`, so the regular release builds and publishes the image but
   does not deploy, and `hotfix`, so it builds on the large runner
   (`vars.BREAK_GLASS_RUNNER`). Both labels are defined in
   `WalletConnect/infra`.
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

Prerequisites: OpenSSH 8.2 or newer built with FIDO2 support (macOS: `brew
install openssh`; Ubuntu 22.04 and newer ship it), a YubiKey 5 with a FIDO2
PIN set (`ykman fido access change-pin`), and `gh` logged in.

1. **Generate the key on the device.** Plug the YubiKey in and run:

   ```bash
   ssh-keygen -t ed25519-sk -O resident -O verify-required \
     -O write-attestation="$HOME/.ssh/break_glass.att" -f ~/.ssh/break_glass
   cat ~/.ssh/break_glass.pub
   ```

   `-sk` means the key pair is created inside the authenticator and the
   private key never leaves it; `~/.ssh/break_glass` is only a handle to it.
   `verify-required` makes every signature ask for the PIN and a touch;
   `resident` keeps the credential on the device so another laptop can use it
   after `ssh-keygen -K`. The command fails without a FIDO2 device attached.
   Keep the `.att` file: it is the device's attestation, see step 3.

2. **Add one line to the repository's signers file**,
   `.github/break-glass-signers`, through a normal PR. The first field is your
   GitHub login exactly as GitHub shows it (principal matching is
   case-sensitive), then the namespace option, then the public line as printed:

   ```
   <github-login> namespaces="break-glass" sk-ssh-ed25519@openssh.com AAAA... <comment>
   ```

   One repository, one file: to run the break-glass path in both `rs-relay`
   and `pay-core`, the same line goes into both repositories.

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
   working on the next run; a replacement device is a new line. Enrolling a
   second YubiKey as a second line is the backup, since a lost device cannot
   be recovered.

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

- Dispatched on `main` only; the signers file is read from main.
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
