#!/usr/bin/env bash
# Compute 7-day P95 PR feedback time per workflow.
#
# Definition: P95 of (run.updated_at - run.created_at) over PR-time runs
# (event = pull_request) in the last 7 days. updated_at is the latest
# state change — for a completed run that's when it finished.
#
# Output: one JSON object per workflow on stdout, e.g.
#   {"platform":"kotlin","label":"kotlin","p95_seconds":1320,"p95_minutes":22,"count":18}

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

SINCE="$(iso_days_ago 7)"

while IFS= read -r entry; do
  repo=$(jq -r '.repo' <<<"$entry")
  workflow_path=$(jq -r '.workflow_path' <<<"$entry")
  label=$(jq -r '.label' <<<"$entry")
  platform=$(jq -r '.platform' <<<"$entry")

  # Filter to runs that actually completed with a real outcome — `cancelled`
  # / `skipped` / `startup_failure` etc. inflate P95 because the run sits
  # queued (or limps along) for hours before the final state change, which
  # is what updated_at captures.
  durations=$(fetch_runs "$repo" "$workflow_path" "event=pull_request&created=>=$SINCE" \
    | jq -r 'select(.status == "completed" and (.conclusion == "success" or .conclusion == "failure")) |
             ((.updated_at | fromdateiso8601) - (.created_at | fromdateiso8601))')

  if [[ -z "$durations" ]]; then
    jq -nc --arg p "$platform" --arg l "$label" \
      '{platform:$p, label:$l, p95_seconds:0, p95_minutes:0, count:0}'
    continue
  fi

  count=$(echo "$durations" | wc -l | tr -d ' ')
  p95_seconds=$(echo "$durations" | percentile 95)
  p95_minutes=$(awk -v s="$p95_seconds" 'BEGIN { printf "%d", s / 60 }')

  jq -nc \
    --arg platform "$platform" \
    --arg label "$label" \
    --argjson p95_seconds "$p95_seconds" \
    --argjson p95_minutes "$p95_minutes" \
    --argjson count "$count" \
    '{platform: $platform, label: $label, p95_seconds: $p95_seconds, p95_minutes: $p95_minutes, count: $count}'
done < <(read_workflows)
