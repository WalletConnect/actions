#!/usr/bin/env bash
# Sign a break-glass challenge with your enrolled YubiKey and dispatch the run.
#
#   break-glass-sign.sh <owner/repo> --pr <number>          # merged hotfix PR
#   break-glass-sign.sh <owner/repo> --tag <image tag>      # redeploy / roll back an existing image
#   options: --key ~/.ssh/break_glass  --workflow <file, auto-detected>  --ref main  --dry-run
#
# The challenge is bound to the PR's merge commit (or the tag), so the signature
# authorises exactly that deploy and nothing else. Touch the key when it blinks.
set -euo pipefail
REPO=${1:?usage: break-glass-sign.sh <owner/repo> --pr N | --tag T}; shift
KEY=~/.ssh/break_glass; WORKFLOW=""; REF=main; PR=""; TAG=""; DRY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pr) PR=$2; shift 2 ;; --tag) TAG=$2; shift 2 ;; --key) KEY=$2; shift 2 ;;
    --workflow) WORKFLOW=$2; shift 2 ;; --ref) REF=$2; shift 2 ;; --dry-run) DRY=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
{ [ -n "$PR" ] && [ -z "$TAG" ]; } || { [ -z "$PR" ] && [ -n "$TAG" ]; } || { echo "give exactly one of --pr or --tag" >&2; exit 2; }
[ -f "$KEY" ] || { echo "key $KEY not found; enrol with: ssh-keygen -t ed25519-sk -O resident -O verify-required -f $KEY" >&2; exit 2; }
# The challenge names the repository as GITHUB_REPOSITORY does, so use the
# canonical owner/name even when the caller passed an old (redirected) one.
REPO=$(gh api "repos/$REPO" --jq .full_name)
# The workflow file is break-glass.yml or break-glass.yaml depending on the repo.
if [ -z "$WORKFLOW" ]; then
  WORKFLOW=$(gh workflow list -R "$REPO" --all --json path --jq '.[] | .path | select(test("/break-glass\\.ya?ml$"))' | head -1 | xargs -r basename)
  [ -n "$WORKFLOW" ] || { echo "no break-glass.yml/.yaml workflow in $REPO; pass --workflow" >&2; exit 2; }
fi

if [ -n "$PR" ]; then
  pr=$(gh api "repos/$REPO/pulls/$PR")
  [ "$(jq -r .merged <<< "$pr")" = true ] || { echo "PR #$PR is not merged" >&2; exit 1; }
  sha=$(jq -r .merge_commit_sha <<< "$pr")
  msg="break-glass:$REPO:pr:$PR:$sha"
  inputs=(-f "pr=$PR")
else
  msg="break-glass:$REPO:tag:$TAG"
  inputs=(-f "image-tag=$TAG")
fi
echo "challenge: $msg"
echo "touch the YubiKey (and enter its PIN) to sign..."
sig=$(printf '%s' "$msg" | ssh-keygen -Y sign -n break-glass -f "$KEY")
proof=$(printf '%s' "$sig" | base64 | tr -d '\n')
if [ -n "$DRY" ]; then echo "$sig"; exit 0; fi
gh workflow run "$WORKFLOW" -R "$REPO" --ref "$REF" "${inputs[@]}" -f "proof=$proof"
echo "dispatched $WORKFLOW on $REF; run: https://github.com/$REPO/actions/workflows/$WORKFLOW"
