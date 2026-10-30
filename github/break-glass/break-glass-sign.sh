#!/usr/bin/env bash
# Break-glass helper: enrol a YubiKey, or sign a challenge with it and dispatch
# the break-glass workflow. macOS and Linux.
#
#   break-glass-sign.sh <owner/repo> --pr <number>       # merged hotfix PR → its merge commit
#   break-glass-sign.sh <owner/repo> --tag <image tag>   # redeploy / roll back an existing image
#   break-glass-sign.sh --enrol                           # generate the key on the YubiKey, print the signers line
#   options: --key ~/.ssh/break_glass  --workflow <file, auto-detected>  --ref main  --dry-run
#
# The challenge is bound to the PR's merge commit (or the tag), so the signature
# authorises exactly that deploy and nothing else. Touch the key when it blinks.
#
# FIDO2 support lives in OpenSSH, not in the key tooling: Apple's /usr/bin/ssh-keygen
# has none and no provider library can be added to it, so macOS needs Homebrew's
# OpenSSH (`brew install openssh`), found below by path. Linux distributions build
# openssh-client against libfido2 already. Override with SSH_KEYGEN=/path/to/ssh-keygen.
set -euo pipefail

usage() { sed -n '2,8p' "$0" >&2; exit 2; }
die() { echo "error: $*" >&2; exit 1; }

# Usage before anything else, so help works on any machine.
[ $# -gt 0 ] || usage
case "$1" in -h|--help) usage ;; esac

# ---- find an ssh-keygen that can do FIDO2 ------------------------------------
pick_ssh_keygen() {
  if [ -n "${SSH_KEYGEN:-}" ]; then echo "$SSH_KEYGEN"; return; fi
  case "$(uname -s)" in
    Darwin)
      for c in /opt/homebrew/bin/ssh-keygen /usr/local/bin/ssh-keygen; do [ -x "$c" ] && { echo "$c"; return; }; done
      die "macOS: Apple's ssh-keygen cannot talk to FIDO2 keys and there is no provider to add. Install OpenSSH: brew install openssh" ;;
    *) command -v ssh-keygen || die "ssh-keygen not found; install openssh-client (built with libfido2)" ;;
  esac
}
SSH_KEYGEN=$(pick_ssh_keygen)
# A leftover SSH_SK_PROVIDER pointing at a missing library makes every sk operation fail
# with "provider … is not an OpenSSH FIDO library"; Homebrew's and distro builds have the
# provider built in, so only keep the variable when it names an existing file.
if [ -n "${SSH_SK_PROVIDER:-}" ] && [ ! -f "$SSH_SK_PROVIDER" ]; then
  echo "note: ignoring SSH_SK_PROVIDER=$SSH_SK_PROVIDER (no such file); using the built-in provider" >&2
  unset SSH_SK_PROVIDER
fi
# Enrolment and signing both need a build with FIDO2 support. The usage text is no
# proof (Apple's build lists ed25519-sk too), so check what can be checked: on
# macOS the Apple binary is out, on Linux the binary must link libfido2.
# BREAK_GLASS_SKIP_FIDO_CHECK=1 is for testing the script with a plain key only.
[ -n "${BREAK_GLASS_SKIP_FIDO_CHECK:-}" ] || case "$(uname -s)" in
  Darwin) [ "$SSH_KEYGEN" != /usr/bin/ssh-keygen ] || die "/usr/bin/ssh-keygen cannot talk to FIDO2 keys; brew install openssh" ;;
  Linux)  if command -v ldd >/dev/null && ! ldd "$(command -v "$SSH_KEYGEN")" 2>/dev/null | grep -q fido2; then
            die "$SSH_KEYGEN is not built with libfido2 (install your distribution's openssh-client, Ubuntu 22.04+ / Debian 12+ ship it)"
          fi ;;
esac

# ---- arguments ----------------------------------------------------------------
REPO=""; KEY=~/.ssh/break_glass; WORKFLOW=""; REF=main; PR=""; TAG=""; DRY=""; ENROL=""
case "$1" in --enrol|--enroll) ENROL=1; shift ;; *) REPO=$1; shift ;; esac
while [ $# -gt 0 ]; do
  case "$1" in
    --pr) PR=$2; shift 2 ;; --tag) TAG=$2; shift 2 ;; --key) KEY=$2; shift 2 ;;
    --workflow) WORKFLOW=$2; shift 2 ;; --ref) REF=$2; shift 2 ;; --dry-run) DRY=1; shift ;;
    -h|--help) usage ;; *) echo "unknown option $1" >&2; usage ;;
  esac
done
command -v gh >/dev/null || die "gh (GitHub CLI) is required and must be logged in"

# ---- enrol: create the key on the device, print the signers line ----------------
if [ -n "$ENROL" ]; then
  [ -e "$KEY" ] && die "$KEY already exists; pass --key for another path or remove it"
  login=$(gh api user --jq .login) || die "gh is not logged in"
  echo "Generating an ed25519-sk key on the YubiKey (resident, PIN + touch per signature)." >&2
  echo "Touch the key when it blinks; enter its FIDO2 PIN when asked (set one with: ykman fido access change-pin)." >&2
  "$SSH_KEYGEN" -t ed25519-sk -O resident -O verify-required -O write-attestation="$KEY.att" -f "$KEY" -C "$login break-glass"
  pub=$(cut -d' ' -f1,2 "$KEY.pub")
  case "$pub" in sk-*) ;; *) die "unexpected key type: $pub" ;; esac
  echo >&2
  echo "Add this line to .github/break-glass-signers in each repository, through a PR:" >&2
  echo "$login namespaces=\"break-glass\" $pub $login YubiKey"
  echo >&2
  echo "Keep $KEY.att (device attestation) and the handle $KEY; the private key never leaves the device." >&2
  exit 0
fi

# ---- sign and dispatch ----------------------------------------------------------
[ -n "$REPO" ] || usage
{ [ -n "$PR" ] && [ -z "$TAG" ]; } || { [ -z "$PR" ] && [ -n "$TAG" ]; } || die "give exactly one of --pr or --tag"
[ -f "$KEY" ] || die "key $KEY not found; enrol with: $0 --enrol"
# The challenge names the repository as GITHUB_REPOSITORY does, so use the canonical
# owner/name even when the caller passed an old (redirected) one.
REPO=$(gh api "repos/$REPO" --jq .full_name) || die "cannot read repository $REPO"
# The workflow file is break-glass.yml or break-glass.yaml depending on the repo.
if [ -z "$WORKFLOW" ]; then
  WORKFLOW=$(gh workflow list -R "$REPO" --all --json path --jq '.[] | .path | select(test("/break-glass\\.ya?ml$"))' | head -1)
  WORKFLOW=${WORKFLOW##*/}
  [ -n "$WORKFLOW" ] || die "no break-glass.yml/.yaml workflow in $REPO; pass --workflow"
fi

if [ -n "$PR" ]; then
  [[ "$PR" =~ ^[0-9]+$ ]] || die "--pr takes a pull request number"
  pr=$(gh api "repos/$REPO/pulls/$PR") || die "cannot read PR #$PR"
  [ "$(jq -r .merged <<< "$pr")" = true ] || die "PR #$PR is not merged"
  sha=$(jq -r .merge_commit_sha <<< "$pr")
  msg="break-glass:$REPO:pr:$PR:$sha"
  inputs=(-f "pr=$PR")
else
  [[ "$TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,299}$ ]] || die "--tag is not a valid image tag"
  msg="break-glass:$REPO:tag:$TAG"
  inputs=(-f "image-tag=$TAG")
fi
echo "challenge: $msg" >&2
echo "touch the YubiKey (and enter its PIN) to sign..." >&2
sig=$(printf '%s' "$msg" | "$SSH_KEYGEN" -Y sign -n break-glass -f "$KEY") || die "signing failed"
proof=$(printf '%s' "$sig" | base64 | tr -d '\n')
if [ -n "$DRY" ]; then echo "$sig"; exit 0; fi
gh workflow run "$WORKFLOW" -R "$REPO" --ref "$REF" "${inputs[@]}" -f "proof=$proof"
echo "dispatched $WORKFLOW on $REF; runs: https://github.com/$REPO/actions/workflows/$WORKFLOW" >&2
