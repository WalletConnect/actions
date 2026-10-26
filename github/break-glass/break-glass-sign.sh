#!/usr/bin/env bash
# Sign a break-glass challenge with your enrolled YubiKey and dispatch the run.
#
#   break-glass-sign.sh <owner/repo> --pr <number>          # merged hotfix PR
#   break-glass-sign.sh <owner/repo> --tag <image tag>      # redeploy / roll back an existing image
#   break-glass-sign.sh <owner/repo> --tag previous         # the image before the running one (see below)
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
  if [ "$TAG" = previous ]; then
    # The run deploys exactly the tag that is signed, so `previous` is resolved
    # here, not in the workflow. How depends on the repository.
    case "$REPO" in
      reown-com/rs-relay)
        # Releases are tagged v* and every tag is published to ECR; "previous" is the
        # release before the newest one (assumes the newest is what runs now).
        TAG=$(gh api "repos/$REPO/git/matching-refs/tags/v" --paginate --jq '.[].ref | ltrimstr("refs/tags/")' \
              | grep -E '^v[0-9]' | sort -V | tail -2 | head -1)
        ;;
      WalletConnect/pay-core)
        # The newest earlier prod task-definition revision whose image differs from
        # the running one. Needs AWS credentials for the prod account (AWS_PROFILE).
        command -v aws >/dev/null || { echo "aws CLI needed to resolve 'previous' for $REPO; pass the tag explicitly" >&2; exit 2; }
        name=wc-${AWS_REGION:-eu-central-1}-prod-pay-core
        image_of() { aws ecs describe-task-definition --task-definition "$1" --query "taskDefinition.containerDefinitions[?name=='$name'].image | [0]" --output text; }
        td=$(aws ecs describe-services --cluster "$name-cluster" --services "$name-service" --query 'services[0].taskDefinition' --output text)
        family=${td%:*}; rev=${td##*:}; running=$(image_of "$td"); running=${running##*:}; TAG=""
        for prev in $(seq $((rev - 1)) -1 $((rev - 25))); do
          [ "$prev" -ge 1 ] || break
          image=$(image_of "$family:$prev" 2>/dev/null) || continue
          t=${image##*:}; if [ -n "$t" ] && [ "$t" != None ] && [ "$t" != "$running" ]; then TAG=$t; break; fi
        done
        [ -n "$TAG" ] || { echo "no earlier prod revision runs a different image than $running; pass the tag explicitly" >&2; exit 2; }
        ;;
      *) echo "'previous' is not defined for $REPO; pass the tag explicitly" >&2; exit 2 ;;
    esac
    echo "previous = $TAG"
  fi
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
