#!/usr/bin/env bash
# Rebuilds the expired-payment pool (see expired-payment.sh) from the newest
# `pay-expired-pool` artifacts that earlier runs of this repo uploaded.
#
# Artifacts, not actions/cache: the cache is branch-scoped (a PR only sees its
# own and its base branch's caches) and evicted least-recently-used once a repo
# passes 10 GB, which dropped the tiny pool within hours in repos with large
# Gradle caches. Artifacts are listed repo-wide and kept for their retention.
#
#   fetch-expired-pool.sh <pool-file>
#
# Needs GH_TOKEN with actions:read, GITHUB_REPOSITORY and GITHUB_API_URL.
# Never fails the job: on any problem the pool starts empty.
set -uo pipefail

POOL_FILE="$1"
ARTIFACT_NAME="pay-expired-pool"
# Several artifacts, so one from a run that started with an empty pool (e.g.
# its own fetch failed) doesn't hide the entries of the runs before it.
MAX_ARTIFACTS=5
MAX_ENTRIES=20
API="${GITHUB_API_URL:-https://api.github.com}/repos/$GITHUB_REPOSITORY"

mkdir -p "$(dirname "$POOL_FILE")"
: > "$POOL_FILE"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

api() {
  curl -fsS --retry 3 --retry-all-errors --max-time 30 \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' "$@"
}

LIST=$(api "$API/actions/artifacts?name=$ARTIFACT_NAME&per_page=30") || {
  echo "::warning::Could not list $ARTIFACT_NAME artifacts (does the job have 'actions: read'?); the pool starts empty."
  exit 0
}

# Newest first. Only runs of this repository: a fork PR's run uploads to this
# repo too, and its pool must not reach other runs.
IDS=$(jq -r --argjson max "$MAX_ARTIFACTS" '
  [.artifacts[]
   | select(.expired == false)
   | select(.workflow_run.head_repository_id == .workflow_run.repository_id)]
  | sort_by(.created_at) | reverse | .[:$max][] | .id' <<< "$LIST") || IDS=""

if [ -z "$IDS" ]; then
  echo "::warning::No $ARTIFACT_NAME artifact found; the pool starts empty."
  exit 0
fi

for ID in $IDS; do
  if api -L -o "$WORK/$ID.zip" "$API/actions/artifacts/$ID/zip" \
    && unzip -p "$WORK/$ID.zip" pool.tsv > "$WORK/$ID.tsv" 2>/dev/null; then
    cat "$WORK/$ID.tsv" >> "$WORK/all.tsv"
  else
    echo "::warning::Could not download $ARTIFACT_NAME artifact $ID; skipping it."
  fi
done

# Keep well-formed lines only (the URL ends up in the flow), drop duplicates,
# oldest first so expired-payment.sh's "newest old-enough entry" pick holds.
if [ -f "$WORK/all.tsv" ]; then
  awk -F'\t' 'NF == 2 && $1 ~ /^[0-9]+$/ && $2 ~ /^https:\/\/pay\.walletconnect\.com\/\?pid=pay_[A-Za-z0-9]+$/ && !seen[$2]++' \
    "$WORK/all.tsv" | sort -t$'\t' -k1,1n | tail -n "$MAX_ENTRIES" > "$POOL_FILE"
fi
echo "Restored $(wc -l < "$POOL_FILE" | tr -d ' ') pool entries from $(wc -w <<< "$IDS" | tr -d ' ') artifact(s)."
