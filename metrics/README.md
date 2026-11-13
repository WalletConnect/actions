# Maestro E2E KPIs

Daily Slack post (09:00 UTC, `#wx-e2e-kpis`) tracking four KPIs across the Maestro E2E suites (WalletConnect Pay, and WalletKit connect for WX SLO 2), one table per suite. Design doc: [WalletConnect Pay Maestro E2E KPIs — measurement plan](https://walletconnect.notion.site/WalletConnect-Pay-Maestro-E2E-KPIs-measurement-plan-35d3a661771e81f1a78cec0019f8afbd).

## Layout

```
metrics/
├── README.md                   ← you are here
├── config/
│   └── workflows.json          ← suites map + (suite, repo, workflow_path, label, platform[, branch, job_pattern]) entries
└── scripts/
    ├── lib.sh                  ← shared helpers (gh, jq, date math, percentile, kpi_cell)
    ├── kpi_pass_rate.sh        ← pass / (pass + fail), main, 7d
    ├── kpi_flake_rate.sh       ← recovered / total failures, 7d
    ├── kpi_p95_feedback.sh     ← P95(updated_at - created_at), PR runs, 7d
    ├── kpi_bug_catches.sh      ← PR-time + main red→green pairs, 30d
    ├── post_to_slack.sh        ← assemble message + POST to webhook
    └── tests/
        └── post_to_slack_test.sh ← dated alert + deduplication regression tests

.github/workflows/maestro-kpi-aggregate.yml  ← daily cron + workflow_dispatch
```

## Adding or removing a workflow

Edit `config/workflows.json`. The top-level `suites` map (`id → title`) sets which tables the Slack post has, their order, and their titles. Each entry needs:

| Field | Required | Notes |
|---|---|---|
| `suite` | yes | Key of the `suites` map; picks the Slack table. Entries (and old artifacts) without it count as `pay`. |
| `repo` | yes | `owner/name` |
| `workflow_path` | yes | `.github/workflows/foo.yml` — stable across renames |
| `label` | yes | Row name in the suite's table. Unique within its suite: suite + label key the row across pass/flake/P95 and the alert state. Keep it ≤12 chars to fit the column. |
| `platform` | yes | Used to aggregate bug-catches. Keep it distinct across suites (e.g. `kotlin` for Pay, `kotlin-connect` for WalletKit connect) so suites never merge. |
| `branch` | no | When set (e.g. `"main"`), pass/flake/bug-catch filter to that branch. Omit for workflows that don't fire on push (SDK repos are PR-trigger only). |
| `job_pattern` | no | Bash regex; when set, the conclusion is read from the matching **job** inside each workflow run rather than the run's overall status. Used when one job of many is in scope, including jobs nested inside called reusable workflows (e.g. pay-core's Maestro CD job lives inside `sub-validate.yml`, surfaced via the `event_release.yml` parent run). |

Re-running the workflow (`gh workflow run maestro-kpi-aggregate.yml --repo WalletConnect/actions`) picks up the config without redeploy.

## Manual trigger

```bash
gh workflow run maestro-kpi-aggregate.yml --repo WalletConnect/actions
```

Posts to the same `#wx-e2e-kpis` channel as the cron run. Useful for testing config changes.

## Secrets

Both set as **repository** secrets on `WalletConnect/actions` (the only consumer):

| Secret | What |
|---|---|
| `KPI_GITHUB_PAT` | Token with `actions:read` + `metadata:read` on the 5 tracked repos (kotlin/swift/flutter under `reown-com`, `reown-com/react-native-examples`, `WalletConnect/pay-core`). Fine-grained PAT preferred. |
| `SLACK_KPI_WEBHOOK_URL` | Incoming-webhook URL for `#wx-e2e-kpis`. |

## What's a "bug catch"?

A red→green run pair where the diff between the two commits touches at least one non-`.github/` file. Two flavours:

- **PR-time catch**: a merged PR where the workflow went red on commit A then green on commit B.
- **Main-branch catch**: a `main` run went red, a later `main` run went green.

Heuristic, not exact. Known biases:
- Counts test-infrastructure fixes that aren't product bug fixes (e.g. a flow YAML edit).
- Misses fixes that only touch test infrastructure under `.github/` (filter excludes them by design).
- Per the design doc, the numbers are directionally correct, not exact.

## Output

Daily 09:00 UTC post to `#wx-e2e-kpis`, one table per suite, each with its own Attention line:

````
📊 Maestro E2E KPIs — 7d window: 2026-11-06 → 2026-11-13

*💳 WalletConnect Pay*
```              Pass rate               Flake rate              P95 PR feedback
              (success/total)         (recovered/failures)    (n = sample size)
──────────────────────────────────────────────────────────────────────────────
kotlin        ✅ 100.00% (11/11)      — (no failures)         ✅ 14m (n=4)
swift         🟡 87.50% (7/8)         ✅ 0.00% (0/1)          — (no PR runs)
rn            🟡 94.59% (35/37)       🔴 33.33% (1/3)         ✅ 27m (n=5)
core (CD)     🔴 68.42% (13/19)       🔴 25.00% (2/8)         — (no PR runs)
──────────────────────────────────────────────────────────────────────────────
🎯 targets    ≥95%                    <5%                     <30m

⚠️ Attention: swift pass 87.50%; rn pass 94.59%, flake 33.33%; …```

*🔗 WalletKit connect*
```              Pass rate               Flake rate              P95 PR feedback
              (success/total)         (recovered/failures)    (n = sample size)
──────────────────────────────────────────────────────────────────────────────
kotlin        ✅ 100.00% (7/7)        — (no failures)         ✅ 12m (n=4)
rn android    ✅ 100.00% (7/7)        — (no failures)         🟡 34m (n=3)
rn ios        🟡 85.71% (6/7)         — (no failures)         🟡 34m (n=3)
──────────────────────────────────────────────────────────────────────────────
🎯 targets    ≥95%                    <5%                     <30m

⚠️ Attention: rn ios pass 85.71%, P95 34m; rn android P95 34m```
````

> Bug-catches KPI (kpi_bug_catches.sh) is kept in-tree for a future
> iteration but currently not surfaced — heuristic is too noisy to act
> on without more triage.

Separate threshold-breach alerts post when:

| Condition | Threshold |
|---|---|
| Pass rate on `main` | `<90%` for 2 consecutive days |
| Flake rate | `>10%` |
| P95 feedback | `>45m` |

Each separate alert names the row as `suite/label` (e.g. `` `connect/rn ios` ``), includes the UTC report date and is posted only when its
condition becomes active. It is suppressed on subsequent reports while the
same rolling-window breach remains active. After the metric recovers, a later
breach posts a new dated alert. The `Attention` line inside the daily summary
continues to show all metrics that currently miss their targets, per suite.

When alert-state tracking is first deployed (or its retained artifact is
missing), the report initializes the current conditions without emitting
alerts. This avoids assigning today's date to a breach that began earlier.

Run the Slack formatting and alert-state regression tests locally with:

```bash
bash metrics/scripts/tests/post_to_slack_test.sh
```

## Limitations

- **In-job retries are invisible.** `pay-core`'s `sub-validate.yml` wraps Maestro in a one-shot retry inside a single workflow run. From GitHub's perspective this is one attempt with one final conclusion — flake is undercounted there. Trade documented in the design doc.
- **No backfill.** Numbers start accruing from the day this lands. The first 7d window will be partial.
- **No per-flow breakdown.** "Which test is flakiest" is explicitly v2 work in the design doc.
- **Personal-PAT bus factor.** v1 uses a PAT owned by one person. Migrate to a service account or GitHub App before this becomes load-bearing.
