#!/usr/bin/env bash
# Compute 30-day bug-catch counts per platform.
#
# Heuristic (no labels required):
#
#   PR-time catch:  a merged PR where the workflow went red on commit A,
#                   then green on commit B (B != A), AND the diff between
#                   A and B contains at least one non-`.github/` file.
#                   The non-.github filter avoids counting workflow-only
#                   churn (e.g. pay-core PR #630's 18 CI commits).
#
#   Main-branch catch:  a default-branch run that went red, followed by
#                       a later success on the same branch, with at least
#                       one non-.github commit in the diff between SHAs.
#
# Each catch corresponds to "a real failure that got fixed" — not exactly
# "a bug caught", which is impossible to determine programmatically, but
# a directional proxy. The design doc accepts this tradeoff.
#
# Output: one JSON object per PLATFORM on stdout (multiple workflows on
# the same platform are aggregated), e.g.
#   {"platform":"kotlin","pr_time":5,"main":1,"total":6}

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

SINCE="$(iso_days_ago 30)"

# Returns 1 (true) if the diff between two SHAs in a repo contains a file
# outside .github/, else 0. Empty diff (same SHA) returns 0.
diff_touches_non_github() {
  local repo="$1" base="$2" head="$3"
  if [[ "$base" == "$head" ]]; then
    echo 0
    return
  fi
  local files
  files=$(gh api "repos/$repo/compare/$base...$head" --jq '.files[].filename' 2>/dev/null || true)
  if [[ -z "$files" ]]; then
    echo 0
    return
  fi
  if echo "$files" | grep -vq '^\.github/'; then
    echo 1
  else
    echo 0
  fi
}

# Walks <created_at>\t<head_sha>\t<conclusion> rows on stdin (must be sorted
# by created_at ascending) and counts failure→success transitions that
# touch non-.github files between the two SHAs. Prints the catch count.
count_red_green_transitions() {
  local repo="$1"
  local catches=0 failed_sha=""
  while IFS=$'\t' read -r _ sha conc; do
    case "$conc" in
      failure) failed_sha="$sha" ;;
      success)
        if [[ -n "$failed_sha" ]]; then
          if [[ "$(diff_touches_non_github "$repo" "$failed_sha" "$sha")" == 1 ]]; then
            catches=$((catches + 1))
          fi
          failed_sha=""
        fi
        ;;
    esac
  done
  echo "$catches"
}

# Resolve <created_at>\t<head_sha>\t<conclusion> per run, applying
# job_pattern when set. Emits sorted-by-created-at on stdout.
runs_with_conclusion() {
  local repo="$1" runs_json="$2" job_pattern="$3"
  if [[ -z "$runs_json" ]]; then
    return
  fi
  if [[ -z "$job_pattern" ]]; then
    printf '%s\n' "$runs_json" | jq -r '
      [.created_at, .head_sha, (.conclusion // "null")] | @tsv
    ' | sort
  else
    # When filtering by job, we need to look up each run's jobs and pick
    # the matching one's conclusion. resolve_conclusions returns
    # <run_id>\t<conclusion>. Join back to created_at + head_sha by id.
    local resolved
    resolved=$(printf '%s\n' "$runs_json" | resolve_conclusions "$repo" "$job_pattern")
    printf '%s\n' "$runs_json" | jq -r '[.id, .created_at, .head_sha] | @tsv' \
      | while IFS=$'\t' read -r id ca sha; do
          local conc
          conc=$(echo "$resolved" | awk -F'\t' -v id="$id" '$1 == id { print $2; exit }')
          [[ -n "$conc" ]] && printf '%s\t%s\t%s\n' "$ca" "$sha" "$conc"
        done | sort
  fi
}

count_main_catches() {
  local repo="$1" workflow_path="$2" job_pattern="${3:-}" branch="${4:-}"
  local query="created=>=$SINCE"
  [[ -n "$branch" ]] && query="branch=$branch&$query"
  local runs_json
  runs_json=$(fetch_runs "$repo" "$workflow_path" "$query")
  runs_with_conclusion "$repo" "$runs_json" "$job_pattern" \
    | count_red_green_transitions "$repo"
}

count_pr_time_catches() {
  local repo="$1" workflow_path="$2" job_pattern="${3:-}"
  local since_date="${SINCE%T*}"

  # Merged PRs in window.
  local prs
  prs=$(gh api "search/issues?q=repo:$repo+is:pr+is:merged+merged:>=$since_date&per_page=100" \
    --jq '.items[].number' 2>/dev/null || true)

  local total=0
  for pr_number in $prs; do
    local head_ref
    head_ref=$(gh api "repos/$repo/pulls/$pr_number" --jq '.head.ref' 2>/dev/null || true)
    [[ -z "$head_ref" ]] && continue

    local pr_runs_json
    pr_runs_json=$(fetch_runs "$repo" "$workflow_path" "event=pull_request&branch=$head_ref&created=>=$SINCE")
    [[ -z "$pr_runs_json" ]] && continue

    # Only one catch per PR (don't double-count multiple red→green flips).
    local catches
    catches=$(runs_with_conclusion "$repo" "$pr_runs_json" "$job_pattern" \
      | count_red_green_transitions "$repo")
    [[ "$catches" -gt 0 ]] && total=$((total + 1))
  done
  echo "$total"
}

# Emit one JSONL row per workflow entry, then aggregate by platform at the
# end via jq. Avoids associative arrays (bash 3.2 / macOS doesn't support
# them; CI Ubuntu does but the script should be testable locally).
per_workflow=$(mktemp)
trap 'rm -f "$per_workflow"' EXIT

while IFS= read -r entry; do
  repo=$(jq -r '.repo' <<<"$entry")
  workflow_path=$(jq -r '.workflow_path' <<<"$entry")
  job_pattern=$(jq -r '.job_pattern // ""' <<<"$entry")
  branch=$(jq -r '.branch // ""' <<<"$entry")
  platform=$(jq -r '.platform' <<<"$entry")

  pr_catches=$(count_pr_time_catches "$repo" "$workflow_path" "$job_pattern" 2>/dev/null || echo 0)
  main_catches=$(count_main_catches "$repo" "$workflow_path" "$job_pattern" "$branch" 2>/dev/null || echo 0)
  # Defend against count_* emitting a non-numeric or empty value when a
  # sub-pipeline trips set -e: coerce to integer.
  [[ "$pr_catches" =~ ^[0-9]+$ ]] || pr_catches=0
  [[ "$main_catches" =~ ^[0-9]+$ ]] || main_catches=0

  jq -nc \
    --arg platform "$platform" \
    --argjson pr_time "$pr_catches" \
    --argjson main "$main_catches" \
    '{platform: $platform, pr_time: $pr_time, main: $main}' >> "$per_workflow"
done < <(read_workflows)

# Aggregate by platform, preserve config order via index.
jq -sc '
  reduce .[] as $row ({platforms: [], by: {}};
    if (.by[$row.platform] == null)
    then .platforms += [$row.platform]
       | .by[$row.platform] = {pr_time: 0, main: 0}
    else . end
    | .by[$row.platform].pr_time += $row.pr_time
    | .by[$row.platform].main    += $row.main
  )
  | .platforms[] as $p
  | {platform: $p,
     pr_time: .by[$p].pr_time,
     main:    .by[$p].main,
     total:   (.by[$p].pr_time + .by[$p].main)}
' "$per_workflow"
