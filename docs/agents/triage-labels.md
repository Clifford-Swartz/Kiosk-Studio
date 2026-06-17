# Triage Labels

Kiosk Studio uses five canonical labels for issue triage:

| Label | Meaning | When to apply |
|-------|---------|--------------|
| `needs-triage` | Maintainer needs to evaluate | Issue is newly opened, lacks context, or needs prioritization |
| `needs-info` | Waiting on reporter | Issue lacks reproduction steps, version info, or other details needed to proceed |
| `ready-for-agent` | Fully specified, AFK-ready | Issue is clear, reproducible, and an agent can pick it up without human context |
| `ready-for-human` | Needs human implementation | Issue is ready but requires human judgment, design input, or manual work |
| `wontfix` | Will not be actioned | Issue is out of scope, duplicate, or explicitly deprioritized |

All label names match their keys exactly (e.g., `needs-triage`, not `bug:needs-triage`).
