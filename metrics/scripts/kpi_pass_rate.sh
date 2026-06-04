#!/usr/bin/env bash
# Compute 7-day pass rate per workflow on main.
#
# Pass rate = success / (success + failure)
# Runs with conclusion neither success nor failure (cancelled, skipped,
# startup_failure, etc.) are excluded — they aren't signals about test health.
#
# Output: one JSON object per workflow on stdout, e.g.
#   {"platform":"kotlin","label":"kotlin","success":26,"failure":1,"total":27,"rate":96.30}

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

SINCE="$(iso_days_ago 7)"

while IFS= read -r entry; do
  repo=$(jq -r '.repo' <<<"$entry")
  workflow_path=$(jq -r '.workflow_path' <<<"$entry")
  job_pattern=$(jq -r '.job_pattern // ""' <<<"$entry")
  branch=$(jq -r '.branch // ""' <<<"$entry")
  label=$(jq -r '.label' <<<"$entry")
  platform=$(jq -r '.platform' <<<"$entry")

  query="created=>=$SINCE"
  [[ -n "$branch" ]] && query="branch=$branch&$query"

  conclusions=$(fetch_runs "$repo" "$workflow_path" "$query" \
    | resolve_conclusions "$repo" "$job_pattern" \
    | awk -F'\t' '{print $2}')

  success=$(echo "$conclusions" | grep -c '^success$' || true)
  failure=$(echo "$conclusions" | grep -c '^failure$' || true)
  total=$((success + failure))

  if [[ $total -gt 0 ]]; then
    rate=$(awk -v s="$success" -v t="$total" 'BEGIN { printf "%.2f", (s/t) * 100 }')
  else
    rate="0.00"
  fi

  jq -nc \
    --arg platform "$platform" \
    --arg label "$label" \
    --argjson success "$success" \
    --argjson failure "$failure" \
    --argjson total "$total" \
    --argjson rate "$rate" \
    '{platform: $platform, label: $label, success: $success, failure: $failure, total: $total, rate: $rate}'
done < <(read_workflows)
