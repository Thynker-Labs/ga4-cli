# GA4 CLI

Google Analytics 4 CLI with TUI - Realtime monitoring and Reports.

## Installation

```bash
git clone https://github.com/thynker-labs/ga4-cli.git
cd ga4-cli
npm install
npm link
```

## Setup

### 1. Enable Google Analytics Data API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Search for and enable **Google Analytics Data API**
4. Go to **IAM & Admin** → **Service Accounts**
5. Create a service account (or use existing)
6. Click on the service account → **Keys** tab
7. Add key → Create new key → **JSON**
8. Download the JSON file

### 2. Add Service Account to GA4

1. Go to [GA4 Admin](https://analytics.google.com)
2. Select your property
3. Go to **Property Access Management**
4. Add user → Enter service account email (from JSON file)
5. Assign **Viewer** role

### 3. Initialize CLI

```bash
ga4 init /path/to/your-service-account-key.json
```

## Usage

```bash
# Start the TUI
ga4
```

### Controls

- **Arrow keys** - Navigate menus
- **Enter** - Select
- **Escape** - Go back / Exit submenu
- **q** or **Ctrl+C** - Quit

### Features

#### Realtime Mode
- Active users
- Pageviews per minute
- Events per minute
- Active pages (top 10)
- Top events (top 10)
- Auto-refreshes every 5 seconds

#### Reports Mode
Date range options:
- Today
- Yesterday
- Last 7 days
- Last 30 days
- Last 90 days
- This month
- Last month

Metrics:
- Sessions, Users, New Users
- Pageviews
- Average Session Duration
- Bounce Rate
- Top Pages
- Top Events
- Traffic Sources

## Configuration

Config is stored at: `~/.ga4-cli/config.json`

To reinitialize with new credentials:
```bash
ga4 init /path/to/new-key.json
```

## License

MIT
