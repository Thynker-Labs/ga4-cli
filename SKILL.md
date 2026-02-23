---
name: ga4-cli
description: Query Google Analytics 4 (GA4) from the terminal. Use when users need realtime analytics, historical reports, or per-path metrics. Supports TUI mode, CLI commands, path-specific reports with trailing-slash variants, and JSON output for automation. Requires a GA4 property ID and service account credentials.
license: MIT
compatibility: Requires Node.js 14+, Google Analytics Data API enabled, GA4 property with service account access. Network access required for API calls.
metadata:
  author: Sid Wahi
  version: "1.0"
---

# GA4 CLI Skill

Instructions for agents working with the GA4 CLI tool.

## When to use

- User asks for Google Analytics 4 data, GA4 reports, or analytics metrics
- User wants to run `ga4` commands, debug GA4 CLI, or add features
- User mentions realtime stats, page views, sessions, path reports, or property metrics

## Quick reference

### Commands

| Command | Purpose |
|---------|---------|
| `ga4 init <json-path>` | Initialize with service account credentials |
| `ga4 tui [--property \<id\>]` | Interactive TUI (default mode) |
| `ga4 realtime --property \<id\> [--json]` | Realtime active users, views, events |
| `ga4 report --property \<id\> [--range ...] [--json]` | Historical report summary |
| `ga4 path \<path\> --property \<id\> [--range ...] [--json]` | Metrics for a specific URL path |

### Date ranges

`today`, `yesterday`, `last7`, `last30`, `last90`, `all` (last 5 years)

### Path command behavior

- Queries both `path` and `path/` (with and without trailing slash)
- Falls back to `BEGINS_WITH` when exact match returns no data
- Returns sessions, users, pageviews, events, bounce rate, engagement rate

## Development tasks

### Adding new commands

1. Add case to `runCliCommand()` in `index.js`
2. Update `printUsage()` with the new command and options
3. Add corresponding `GA4Service` method if API access is needed

### Adding new metrics or dimensions

- Use `requestBody` wrapper for googleapis REST calls (not top-level params)
- Realtime API: only `activeUsers`, `eventCount`, `keyEvents`, `screenPageViews` are valid
- Core reports: see [GA4 API schema](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)

### Path report edge cases

- When dimensions are used, GA4 may not return `totals`; aggregate from `rows` when totals is undefined
- Bounce/engagement rates come as 0–1; multiply by 100 for display when value &lt; 1
- `pagePath` dimension is for web; paths are stored without leading slash variations

## File structure

```
ga4-cli/
├── index.js      # Main entry, GA4Service, GA4TUI, CLI parsing
├── package.json
├── SKILL.md      # This file
└── README.md
```

## Configuration

- Config: `~/.ga4-cli/config.json` (or `%USERPROFILE%\.ga4-cli\` on Windows)
- Errors: `~/.ga4-cli/errors.log`
- Optional `propertyId` in config avoids passing `--property` every time
