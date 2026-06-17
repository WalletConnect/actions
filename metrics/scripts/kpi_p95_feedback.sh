#!/usr/bin/env bash
# Compute 7-day P95 PR feedback time per workflow.
#
# Definition: P95 over PR-time runs (event = pull_request) of
#   max(job.completed_at) - min(job.started_at)
# across the run's non-skipped jobs. We measure from when the first
# job actually starts to when the last job completes, deliberately
# excluding the runner-allocation queue wait that sits between the
# run's `run_started_at` and the first job's `started_at`. Using the
# run-level `updated_at - run_started_at` would include that queue
# wait, which inflated rn's P95 to 1055m on 2026-06-17 when GH's
# macOS pool kept runs queued for 20+ minutes before any job ran.
#
# Trade-off: this is "CI compute wall-clock" rather than "developer
# feedback wall-clock". Queue-wait pain is a separate problem and
# deserves its own metric — measuring it here would conflate two
# different problems under one P95.
#
# Per-run cost: 1 extra API call to /actions/runs/{id}/jobs. With
# ~14 completed runs/platform/week × 5 platforms, that's ~70 extra
# calls per digest, well within the 5000/hour primary rate limit.
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

  # Restrict to runs that actually completed with a real outcome. `cancelled`
  # / `skipped` / `startup_failure` etc. don't represent a feedback event.
  # Emit `id<TAB>run_started_at` per line so the inner loop can filter jobs
  # to only those that ran in the latest attempt.
  run_meta=$(fetch_runs "$repo" "$workflow_path" "event=pull_request&created=>=$SINCE" \
    | jq -r 'select(.status == "completed" and (.conclusion == "success" or .conclusion == "failure"))
             | select(.run_started_at != null)
             | "\(.id)\t\(.run_started_at)"')

  # For each qualifying run, fetch its jobs and compute
  #   max(job.completed_at) - min(job.started_at)
  # over non-skipped jobs that started at-or-after run_started_at. The
  # last filter is critical for re-runs: GH's "Re-run failed jobs" only
  # re-executes the failed jobs, but the unchanged jobs still come back
  # tagged with the new run_attempt and their original (old-day)
  # started_at. Without the time filter, max(completed) - min(started)
  # spans the gap between attempts (17h+ in the 2026-06-17 outlier).
  #
  # `gh api --paginate` concatenates multiple `{total_count, jobs:[...]}`
  # objects (one per page); jq -s flattens across pages before reducing.
  durations=""
  while IFS=$'\t' read -r run_id run_started_at; do
    [[ -z "$run_id" ]] && continue
    d=$(gh api "repos/$repo/actions/runs/$run_id/jobs?per_page=100" --paginate 2>/dev/null \
      | jq -s --arg t "$run_started_at" '
          [.[].jobs[]]
          | map(select(.status == "completed" and (.conclusion // "") != "skipped"
                       and .started_at != null and .completed_at != null
                       and .started_at >= $t))
          | if length > 0 then
              (map(.completed_at | fromdateiso8601) | max) - (map(.started_at | fromdateiso8601) | min)
            else empty end' 2>/dev/null) || continue
    [[ -n "$d" ]] && durations+="${d}"$'\n'
  done <<< "$run_meta"
  durations="${durations%$'\n'}"

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
