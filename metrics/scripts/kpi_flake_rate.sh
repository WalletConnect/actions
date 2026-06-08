#!/usr/bin/env bash
# Compute 7-day flake rate per workflow.
#
# Flake rate = (failures that passed on rerun) / (all failures)
#
# A "failure that passed on rerun" is a workflow run whose final
# conclusion is success but run_attempt > 1 — i.e. an earlier attempt
# on the same SHA failed and a re-run flipped it green. This is the
# definition the design doc commits to. Note: in-job retries (like the
# wrapper inside pay-core's sub-validate.yml's Maestro job) are
# invisible at this level, so they aren't counted as flakes.
#
# Output: one JSON object per workflow on stdout, e.g.
#   {"platform":"kotlin","label":"kotlin","recovered":1,"failed":2,"total_failures":3,"rate":33.33}

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

  # For each run in window, we need both run_attempt and the resolved
  # conclusion. We can't fold this into resolve_conclusions without
  # losing the attempt count, so we re-pair.
  runs_json=$(fetch_runs "$repo" "$workflow_path" "$query")
  if [[ -z "$runs_json" ]]; then
    jq -nc --arg p "$platform" --arg l "$label" '{platform:$p, label:$l, recovered:0, failed:0, total_failures:0, rate:0.0}'
    continue
  fi

  # attempts: <run_id>\t<run_attempt>
  attempts=$(printf '%s\n' "$runs_json" | jq -r '"\(.id)\t\(.run_attempt)"')
  # conclusions: <run_id>\t<conclusion>
  conclusions=$(printf '%s\n' "$runs_json" | resolve_conclusions "$repo" "$job_pattern")

  # Join on run_id, count recovered vs failed.
  recovered=0
  failed=0
  while IFS=$'\t' read -r run_id conclusion; do
    attempt=$(echo "$attempts" | awk -F'\t' -v id="$run_id" '$1 == id { print $2; exit }')
    case "$conclusion:$attempt" in
      success:1) : ;;          # clean pass
      success:*) recovered=$((recovered + 1)) ;;  # green after rerun = flake recovered
      failure:*) failed=$((failed + 1)) ;;        # red even after any reruns
      *)         : ;;          # cancelled / skipped / startup_failure — ignore
    esac
  done <<<"$conclusions"

  total=$((recovered + failed))
  if [[ $total -gt 0 ]]; then
    rate=$(awk -v r="$recovered" -v t="$total" 'BEGIN { printf "%.2f", (r/t) * 100 }')
  else
    rate="0.00"
  fi

  jq -nc \
    --arg platform "$platform" \
    --arg label "$label" \
    --argjson recovered "$recovered" \
    --argjson failed "$failed" \
    --argjson total "$total" \
    --argjson rate "$rate" \
    '{platform: $platform, label: $label, recovered: $recovered, failed: $failed, total_failures: $total, rate: $rate}'
done < <(read_workflows)
