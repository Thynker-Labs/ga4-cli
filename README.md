# GA4 CLI

A terminal-based Google Analytics 4 client with both interactive TUI and headless CLI modes. Query realtime stats, historical reports, and per-path analytics without leaving the shell.

## Features

- **Realtime** – Active users, views, events (CLI or TUI with auto-refresh)
- **Reports** – Sessions, users, pageviews, bounce rate, engagement across date ranges
- **Top pages/screens** – Path + title with views, sessions, bounce, and engagement time
- **Path reports** – Full metrics for specific URL paths (handles trailing slash variants)
- **TUI** – Interactive menu with realtime dashboard, top pages/screens report, and path lookup with date picker
- **JSON output** – Machine-readable output for scripting and automation

## Installation

```bash
git clone https://github.com/thynker-labs/ga4-cli.git
cd ga4-cli
npm install
npm link
```

## Setup

### 1. Enable Google Analytics Data API

1. Open [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable **Google Analytics Data API** (APIs & Services → Library)
4. Go to **IAM & Admin** → **Service Accounts**
5. Create a service account (or use an existing one)
6. Add key → Create new key → **JSON**
7. Download the JSON key file

### 2. Grant access in GA4

1. Go to [GA4 Admin](https://analytics.google.com)
2. Select your property
3. **Property Access Management** → Add user
4. Enter the service account email from the JSON file
5. Assign **Viewer** role

### 3. Initialize the CLI

```bash
ga4 init /path/to/service-account-key.json
```

## Usage

### TUI mode (default)

```bash
ga4
# or
ga4 tui [--property <id>]
```

Interactive menu:

- **Realtime summary** – Refreshes every 5 seconds with countdown; press `Esc`/`B` to return to menu
- **Top pages/screens** – Pick `today`, `yesterday`, `last 7`, `last 30`, or custom dates
- **Path report** – Enter a path, choose a date range, then view full path metrics
- **Quit**

### CLI commands

```bash
# Realtime summary
ga4 realtime --property 268092156

# Historical report (default: last 7 days)
ga4 report --property 268092156 --range last30

# Top pages/screens for a date range
ga4 pages --property 268092156 --range yesterday --limit 25

# Path-specific metrics (queries /path and /path/ variants)
ga4 path /about --property 268092156 --range last90

# All-time data (last 5 years)
ga4 report --property 268092156 --range all

# Custom date range
ga4 pages --property 268092156 --range custom --start-date 2026-02-01 --end-date 2026-02-25

# JSON output for scripting
ga4 realtime --property 268092156 --json
ga4 report --property 268092156 --range today --json
ga4 pages --property 268092156 --range last7 --json
ga4 path /article/slug --property 268092156 --json
```

### Date ranges

| Value      | Description      |
|-----------|------------------|
| `today`   | Today only       |
| `yesterday` | Yesterday only |
| `last7`   | Last 7 days (default) |
| `last30`  | Last 30 days     |
| `last90`  | Last 90 days     |
| `all`     | Last 5 years     |
| `custom`  | Use `--start-date` + `--end-date` |

### Path reports

The `path` command automatically:

- Queries both `/path` and `/path/` (with and without trailing slash)
- Falls back to a prefix match if exact match returns no data
- Returns sessions, users, new users, pageviews, events, average session duration, bounce rate, engagement rate

Example:

```bash
ga4 path /2026/my-article-slug --property 268092156 --range last90
```

## Configuration

Config file: `~/.ga4-cli/config.json` (Windows: `%USERPROFILE%\.ga4-cli\config.json`)

Optional `propertyId` for a default property:

```json
{
  "credentials": { "..." },
  "propertyId": "268092156"
}
```

## Error logging

Errors are appended to `~/.ga4-cli/errors.log`. The CLI prints the log path when an error occurs.

## Requirements

- Node.js 20+
- GA4 property with Data API enabled
- Service account with Viewer access to the property

## License

MIT
