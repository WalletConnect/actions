# Maestro E2E KPIs

Daily Slack post (09:00 UTC, `#e2e-kpis`) tracking four KPIs across the WalletConnect Pay Maestro E2E suites in five repos. Design doc: [WalletConnect Pay Maestro E2E KPIs — measurement plan](https://walletconnect.notion.site/WalletConnect-Pay-Maestro-E2E-KPIs-measurement-plan-35d3a661771e81f1a78cec0019f8afbd).

## Layout

```
metrics/
├── README.md                   ← you are here
├── config/
│   └── workflows.json          ← (repo, workflow_path, label, platform[, job_pattern]) tuples
└── scripts/
    ├── lib.sh                  ← shared helpers (gh, jq, date math, percentile, kpi_cell)
    ├── kpi_pass_rate.sh        ← pass / (pass + fail), main, 7d
    ├── kpi_flake_rate.sh       ← recovered / total failures, 7d
    ├── kpi_p95_feedback.sh     ← P95(updated_at - created_at), PR runs, 7d
    ├── kpi_bug_catches.sh      ← PR-time + main red→green pairs, 30d
    └── post_to_slack.sh        ← assemble message + POST to webhook

.github/workflows/maestro-kpi-aggregate.yml  ← daily cron + workflow_dispatch
```

## Adding or removing a workflow

Edit `config/workflows.json`. Each entry needs:

| Field | Required | Notes |
|---|---|---|
| `repo` | yes | `owner/name` |
| `workflow_path` | yes | `.github/workflows/foo.yml` — stable across renames |
| `label` | yes | Shown in the Slack table column |
| `platform` | yes | Used to aggregate bug-catches |
| `job_pattern` | no | Bash regex; when set, the conclusion is read from the matching **job** inside each workflow run rather than the run's overall status. Used for reusable workflows like pay-core's `sub-validate.yml` where one job of many is in scope |

Re-running the workflow (`gh workflow run maestro-kpi-aggregate.yml --repo WalletConnect/actions`) picks up the config without redeploy.

## Manual trigger

```bash
gh workflow run maestro-kpi-aggregate.yml --repo WalletConnect/actions
```

Posts to the same `#e2e-kpis` channel as the cron run. Useful for testing config changes.

## Secrets

Both set as **organization** secrets on `WalletConnect` (granted to this repo):

| Secret | What |
|---|---|
| `KPI_GITHUB_PAT` | Token with `actions:read` + `metadata:read` on the 5 tracked repos (kotlin/swift/flutter under `reown-com`, `reown-com/react-native-examples`, `WalletConnect/pay-core`). Fine-grained PAT preferred. |
| `SLACK_KPI_WEBHOOK_URL` | Incoming-webhook URL for `#e2e-kpis`. |

## What's a "bug catch"?

A red→green run pair where the diff between the two commits touches at least one non-`.github/` file. Two flavours:

- **PR-time catch**: a merged PR where the workflow went red on commit A then green on commit B.
- **Main-branch catch**: a `main` run went red, a later `main` run went green.

Heuristic, not exact. Known biases:
- Counts test-infrastructure fixes that aren't product bug fixes (e.g. a flow YAML edit).
- Misses fixes that only touch test infrastructure under `.github/` (filter excludes them by design).
- Per the design doc, the numbers are directionally correct, not exact.

## Output

Daily 09:00 UTC post to `#e2e-kpis`:

```
📊 Maestro E2E KPIs — 2026-06-03

                       Pass rate   Flake rate  P95 PR feedback
                       (7d, main)  (7d)        (7d)
────────────────────────────────────────────────────────────
kotlin                  ✅ 98.2%   ✅ 2.1%     ✅ 22m
swift                   🟡 91.5%   🟡 8.3%     🟡 34m
flutter                 ✅ 99.0%   ✅ 1.2%     ✅ 18m
rn                      ✅ 96.8%   ✅ 3.4%     ✅ 28m
core (PR)               ✅ 97.1%   ✅ 4.0%     ✅ 25m
core (CD)               ✅ 96.0%   ✅ 0.0%     ✅ 28m
────────────────────────────────────────────────────────────
🎯 targets              ≥95%       <5%         <30m

🐛 Bug catches — last 30d: 14 total (avg every 2.1 days)
   PR-time catches:  11   •   Main-branch catches:  3

   kotlin   ▓▓▓▓▓ 5
   swift    ▓ 1
   flutter  ▓▓ 2
   rn       ▓▓▓ 3
   core     ▓▓▓ 3

⚠️ Attention: swift pass 91.5%, flake 8.3%, P95 34m
```

Separate threshold-breach alerts post when:

| Condition | Threshold |
|---|---|
| Pass rate on `main` | `<90%` for 2 consecutive days |
| Flake rate | `>10%` |
| P95 feedback | `>45m` |

## Limitations

- **In-job retries are invisible.** `pay-core`'s `sub-validate.yml` wraps Maestro in a one-shot retry inside a single workflow run. From GitHub's perspective this is one attempt with one final conclusion — flake is undercounted there. Trade documented in the design doc.
- **No backfill.** Numbers start accruing from the day this lands. The first 7d window will be partial.
- **No per-flow breakdown.** "Which test is flakiest" is explicitly v2 work in the design doc.
- **Personal-PAT bus factor.** v1 uses a PAT owned by one person. Migrate to a service account or GitHub App before this becomes load-bearing.
