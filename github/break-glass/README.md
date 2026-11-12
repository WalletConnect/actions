# Break-glass deploy

Ships a hotfix to production in minutes. The run skips the regular release's
post-merge validation, deploys staging and production in parallel, and runs
the repository's usual test suite afterwards without blocking. It is
authorised by the person who dispatches it proving possession of an enrolled
YubiKey. Used by `rs-relay` and `pay-core`.

This repository provides the proof: [`break-glass-sign.py`](break-glass-sign.py)
signs it, [`verify-proof`](verify-proof/action.yml) checks it and returns what
was signed, [`lint-signers`](lint-signers/action.yml) checks the signers file.
What a proof may deploy is each repository's decision, made in its own
`break-glass.yaml`.

## Flow

1. Sign what you want deployed, with the helper from a checkout of this
   repository (a commit you trust: the helper decides what your key signs).
   The fields are the ones your repository's workflow reads, for example:

   ```bash
   break-glass-sign.py WalletConnect/pay-core -f image_tag=3f2a9c1e… -f terraform_ref=main | pbcopy
   ```

   The YubiKey blinks; touch it. The proof is printed as one
   line (piped to the clipboard above).
2. Open Actions → `break-glass` → Run workflow on `main`, paste the proof into
   the `proof` input, and run it within 10 minutes of signing.
3. Every job that deploys starts with `verify-proof`. Nothing is deployed
   before it passes.
4. The job checks the signed fields against the repository's own rules and
   deploys.

## The proof

```json
{"payload":"{\"aud\":\"WalletConnect/pay-core\",\"iat\":1762862400,\"image_tag\":\"3f2a9c1e…\",\"terraform_ref\":\"main\"}","sig":"U1NIU0lHAAAAAQ…"}
```

- `payload` is a JSON object kept as a string, so the signed bytes survive
  copying unchanged. `sig` is the body of an `ssh-keygen -Y sign -n break-glass`
  signature over exactly those bytes, with no trailing newline.
- `aud` is the repository as `GITHUB_REPOSITORY` reports it (rs-relay is
  `reown-com/rs-relay`; letter case does not matter). `iat` is the signing
  time in unix seconds. The helper sets both.
- Every other field is the repository's own: the helper signs whatever
  `-f key=value` pairs it is given, as strings, and `verify-proof` returns them
  unchecked. A repository can add fields without a change here.

`verify-proof` accepts the proof when:

- the run is on the default branch, and the signers file is read from that
  branch through the API, not from the checkout;
- the signature verifies against the signers file for principal
  `github.actor` in namespace `break-glass`, so the dispatcher and the signer
  are the same login;
- the signing key is an `sk-` (FIDO2) type, and the signature carries the
  authenticator's "touched" flag. `ssh-keygen` checks neither, so
  `verify-proof` reads both from the signature itself. A key made with
  `-O no-touch-required` is rejected here;
- `aud` is this repository;
- `iat` is at most `max-age` (600 s) old and at most 120 s in the future,
  measured when `verify-proof` runs.

Then it outputs `payload` (the verified JSON, compact), `signer` and `key-type`.

### Replay

A proof only verifies for its signer's GitHub login, in its repository, for
10 minutes after signing (`max-age`). Within that window the same login can
use it again, by a new dispatch or a re-run; after it, `verify-proof` fails
and a new proof is needed. A re-run must also be started by the dispatcher.

This only holds for a job that runs `verify-proof` itself. GitHub lets anyone
with write access re-run a single job of an old run, for 30 days, and jobs
that are not re-run keep their outputs: a deploy job that relies on a
separate `verify` job would deploy again without the proof being looked at.
So every job that deploys calls `verify-proof` as its first step, and a retry
is possible for 10 minutes, by the dispatcher.

### Enrolling a YubiKey

Prerequisites: OpenSSH 8.2 or newer built with FIDO2 support. On macOS that
is `brew install openssh`, used by full path (`/opt/homebrew/bin/ssh-keygen`,
which `break-glass-sign.py` picks up on its own); Apple's own `ssh-keygen`
cannot talk to FIDO2 devices and there is no provider library to add to it.
Ubuntu 22.04 and newer ship it. Plus Python 3.9 or newer (macOS's `python3`
is fine), and a YubiKey 5.

1. **Generate the key on the device.** Plug the YubiKey in and run:

   ```bash
   ssh-keygen -t ed25519-sk \
     -O write-attestation="$HOME/.ssh/break_glass.att" -f ~/.ssh/break_glass
   cat ~/.ssh/break_glass.pub
   ```

   (macOS: `/opt/homebrew/bin/ssh-keygen …`, and make sure `SSH_SK_PROVIDER`
   is not set in your shell.)

   `-sk` means the key pair is created inside the authenticator and the
   private key never leaves it. Every signature needs a touch, and
   `verify-proof` rejects one made without. No PIN is involved.
   `~/.ssh/break_glass` is a handle the device needs to sign: the YubiKey
   alone, without that file, cannot produce a proof, and neither can the file
   without the YubiKey. A passphrase on the file is optional (the helper
   asks for it when signing). Losing the file means enrolling a new key. The command
   fails without a FIDO2 device attached. Keep the `.att` file: it is the
   device's attestation, see step 3.

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
   rejects any key that is not an `sk-` type and any principal that is a
   pattern (`*`) instead of one exact login. CODEOWNERS covers the file, so a
   codeowner approves it, and first checks that the attestation from step 1
   chains to the Yubico FIDO root CA. That check is the only proof that the
   key lives in a YubiKey: an `sk-` key can also be made in software, and
   neither the lint nor the run can tell.

4. **Try it without deploying.** [`manual-test.py`](manual-test.py) signs a
   proof with your key and verifies it the way a run does, including that
   altered or expired copies are rejected. Nothing is dispatched:

   ```bash
   manual-test.py --key ~/.ssh/break_glass
   ```

   Without `--key` it first makes a throwaway key on the YubiKey, which also
   tests the command of step 1.

5. **Rotation and loss.** Remove the line through a PR and the key stops
   working on the next run; a replacement device is a new line. Enrolling a
   second YubiKey as a second line is the backup, since a lost device cannot
   be recovered.

## What each repository provides

`break-glass.yaml`, for example:

```yaml
on:
  workflow_dispatch:
    inputs:
      proof: { description: Output of break-glass-sign.py, required: true }
concurrency:
  group: cd              # the regular deploy stage's group
  cancel-in-progress: true
jobs:
  deploy-prod:
    runs-on: ubuntu-latest
    steps:
      - id: proof                          # first step of every job that deploys
        uses: WalletConnect/actions/github/break-glass/verify-proof@<sha>
        with:
          proof: ${{ inputs.proof }}
      - name: Check the signed fields      # the repository's own rules, see below
        env:
          IMAGE_TAG: ${{ fromJSON(steps.proof.outputs.payload).image_tag }}
          TERRAFORM_REF: ${{ fromJSON(steps.proof.outputs.payload).terraform_ref }}
        run: ./scripts/break-glass-check.sh
      # … assume the cloud role and deploy, reading the same two values
  deploy-staging:  # the same steps, in parallel with prod
  tests:           # needs: deploy-staging; the regular test suite, continue-on-error
```

Do not put `verify-proof` in a job of its own that the deploy jobs `need`:
such a deploy job can be re-run alone, long after the proof expired (see
[Replay](#replay)). The token needs `contents: read`.

Plus `.github/break-glass-signers` and a `lint-signers` job on PRs that touch it.

`verify-proof` vouches for who signed and when, not for what the fields point
to. The repository's workflow decides that, and should at least:

- deploy Terraform only from reviewed code: a `terraform_ref` that is the
  default branch or a commit reachable from it;
- deploy only images built from the default branch;
- keep image tags immutable in ECR (`imageTagMutability = IMMUTABLE`):
  a signature over a tag name only pins an image if the tag cannot move;
- pass signed values to scripts through `env:`, never as `${{ }}` inside
  `run:`, since they are free text.

Nothing should run before `verify-proof` in a job: no cloud role, no build,
no PR comment.

The regular release can honour a `skip-deploy` PR label, so a hotfix's image
is built and published but not deployed by the regular pipeline, with one
step before its deploy job:

```yaml
      - uses: WalletConnect/actions/github/merged-pr-labels/@<sha>
        id: merged
        with:
          label: skip-deploy
      # then: if: steps.merged.outputs.has-label != 'true' on the deploy job
```

## Paging

A repository can page its on-call with a **P1** on every deploy with a proof,
through [`incident-io/alert`](../../incident-io/alert/action.yml). Fire it in
a step of every job that deploys, right after `verify-proof`, with
`if: always() && inputs.proof` and `continue-on-error: true`: it pages whether
or not the proof verified and never blocks the deploy. Do not fire it from a
job of its own: **Re-run failed jobs** skips a job that succeeded, so the
re-run would deploy without a page. A last `if: always()` job that `needs` the
deploy jobs resolves the alert; it re-runs with them. Put
`github.run_attempt` in the `deduplication-key` of both, so each attempt is
its own alert. Values read from the proof before it verified are the
dispatcher's claims: strip them before use.

The alert source and the routes (`metadata.service` `relay` → Relay path,
`pay-core` → Pay Core path) are defined in `infra-monitoring-grafana`,
`terraform/break_glass.tf`. The repository needs the variable
`BREAK_GLASS_INCIDENT_IO_URL` and the secret `BREAK_GLASS_INCIDENT_IO_TOKEN`
(both from that Terraform's outputs); without them the paging job warns and
the deploy proceeds.

## Notes

- A Terraform Cloud apply that is already running is not cancelled with the
  GitHub job; the break-glass apply queues behind it on the workspace lock.
- A regular deploy that had not started when it was cancelled runs after the
  break-glass run. The `skip-deploy` label avoids it.
- The proof protects the break-glass path. Any branch can still run a
  modified workflow with the same repository secrets and the org-wide OIDC
  trust; tightening that trust is a separate change in `infra-aws-org`.
- Audit: the `verify-proof` step summary (signer, key type, signed payload) and the
  deployment records of the existing environments.
- Tests: [`tests/`](tests/test_break_glass.py) sign and verify proofs with
  a software `sk-` key (CI has no YubiKey; needs the OpenSSL 3 `openssl`
  CLI) and lint signers files; run
  `python3 -m unittest discover -s github/break-glass/tests` after changing
  the helper, `verify-proof` or `lint-signers`.
