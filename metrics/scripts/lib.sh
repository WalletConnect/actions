#!/usr/bin/env bash
# Shared helpers for metrics/scripts/kpi_*.sh.
#
# Requires: gh CLI (authenticated), jq, date (GNU coreutils — macOS users
# need `gawk` and `gdate` via brew, but CI runs on Ubuntu).
#
# All public functions print to stdout. Errors go to stderr and exit non-zero.

set -euo pipefail

CONFIG_PATH="${CONFIG_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config/workflows.json}"

# ISO-8601 timestamp N days ago, e.g. iso_days_ago 7 -> 2026-05-27T11:23:45Z
# Works on both GNU date (Ubuntu CI) and BSD date (macOS local testing).
iso_days_ago() {
  if date -u -d "$1 days ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null; then
    return 0
  fi
  date -u -v "-$1d" +"%Y-%m-%dT%H:%M:%SZ"
}

# Read all workflow entries from config as one-line JSON objects (jq -c).
read_workflows() {
  jq -c '.workflows[]' "$CONFIG_PATH"
}

# Page through GitHub workflow_runs for (repo, workflow_path), filtered by
# the query string the caller provides (e.g. "branch=main&event=push&created=...").
# Echoes one JSON workflow_run per line. Stops after 5 pages (500 runs) to
# bound API usage; the 7d / 30d windows for our workflows fit comfortably.
fetch_runs() {
  local repo="$1" workflow_path="$2" query="$3"
  # API takes the workflow filename (or numeric id), not the full path.
  local workflow_file="${workflow_path##*/}"
  local page=1
  while [[ $page -le 5 ]]; do
    local response
    # `gh api --jq` pretty-prints by default; re-emit as compact one-per-line
    # so downstream consumers can read line-by-line.
    response=$(gh api "repos/$repo/actions/workflows/$workflow_file/runs?per_page=100&page=$page&$query" \
      --jq '.workflow_runs[]' 2>/dev/null | jq -c '.' || true)
    if [[ -z "$response" ]]; then
      break
    fi
    # Drop runs the workflow tagged "(skip-metrics)" in its run-name (here:
    # display_title) — they shouldn't count toward any KPI. Filter AFTER computing
    # `count` so pagination keys off the raw page size, not the post-filter size.
    local count
    count=$(printf '%s\n' "$response" | wc -l)
    printf '%s\n' "$response" | jq -c 'select((.display_title // "") | contains("(skip-metrics)") | not)'
    if [[ $count -lt 100 ]]; then
      break
    fi
    page=$((page + 1))
  done
}

# For each run, resolve the effective conclusion: either the workflow run's
# top-level conclusion, or — when job_pattern is set in the config entry —
# the conclusion of the (first) job whose name matches the regex.
#
# Reads run JSON lines on stdin; writes lines of `<run_id>\t<conclusion>` to
# stdout. Skips runs with no matching job (job_pattern set but no match).
resolve_conclusions() {
  local repo="$1" job_pattern="${2:-}"
  while IFS= read -r run; do
    local run_id
    run_id=$(jq -r '.id' <<<"$run")
    if [[ -z "$job_pattern" ]]; then
      jq -r '"\(.id)\t\(.conclusion // "null")"' <<<"$run"
    else
      # Pipe through jq separately so we can pass the pattern via --arg.
      # Interpolating into --jq's expression string risks breaking the
      # filter (silently — swallowed by 2>/dev/null) on any future
      # job_pattern containing ", \, or jq metachars.
      local conclusion
      conclusion=$(gh api "repos/$repo/actions/runs/$run_id/jobs" 2>/dev/null \
        | jq -r --arg pat "$job_pattern" \
          '.jobs[] | select(.name | test($pat)) | .conclusion' \
        | head -1 || true)
      if [[ -n "$conclusion" ]]; then
        printf '%s\t%s\n' "$run_id" "$conclusion"
      fi
    fi
  done
}

# Compute the Nth percentile of a list of numbers on stdin (one per line).
# Usage: echo -e "10\n20\n30\n40" | percentile 95
# Uses sort(1) instead of awk's gawk-only asort() for portability.
percentile() {
  local p="$1"
  sort -n | awk -v p="$p" '
    { a[NR] = $1 }
    END {
      if (NR == 0) { print "0"; exit }
      idx = int((p / 100) * NR + 0.999999)
      if (idx < 1) idx = 1
      if (idx > NR) idx = NR
      print a[idx]
    }
  '
}

# Pretty-print a KPI value as a single Slack-table cell with status icon.
# Usage: kpi_cell <numeric_value> <threshold_op> <threshold> <suffix>
#   e.g. kpi_cell 96.5 ">=" 95 "%" -> "✅ 96.5%"
# Operators supported: >=, <, <=
kpi_cell() {
  local value="$1" op="$2" threshold="$3" suffix="${4:-}"
  local pass
  case "$op" in
    ">=") pass=$(awk -v v="$value" -v t="$threshold" 'BEGIN { print (v >= t) ? 1 : 0 }') ;;
    "<")  pass=$(awk -v v="$value" -v t="$threshold" 'BEGIN { print (v <  t) ? 1 : 0 }') ;;
    "<=") pass=$(awk -v v="$value" -v t="$threshold" 'BEGIN { print (v <= t) ? 1 : 0 }') ;;
    *) echo "kpi_cell: unknown op $op" >&2; return 1 ;;
  esac
  if [[ "$pass" == 1 ]]; then
    echo "✅ ${value}${suffix}"
    return
  fi
  # Soft-yellow zone: within 10% of threshold. Otherwise red.
  local within_soft
  within_soft=$(awk -v v="$value" -v t="$threshold" -v op="$op" 'BEGIN {
    if (op == ">=") { print (v >= t * 0.9) ? 1 : 0 }
    else            { print (v <= t * 1.5) ? 1 : 0 }
  }')
  if [[ "$within_soft" == 1 ]]; then
    echo "🟡 ${value}${suffix}"
  else
    echo "🔴 ${value}${suffix}"
  fi
}
