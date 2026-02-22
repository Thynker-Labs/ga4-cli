# GA4 CLI

Google Analytics 4 CLI with TUI + command-line modes.

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

### TUI mode (default)

```bash
ga4
# or
ga4 tui
```

### CLI mode

```bash
# realtime summary
ga4 realtime --property 123456789

# report summary (default range: last7)
ga4 report --property 123456789 --range last30

# JSON output
ga4 realtime --property 123456789 --json
ga4 report --property 123456789 --range today --json
```

Valid `--range` values:
- `today`
- `yesterday`
- `last7`
- `last30`
- `last90`

## Error logging

All runtime errors are appended to:

`~/.ga4-cli/errors.log`

The CLI also prints the log path when an error occurs.

## Configuration

Config is stored at: `~/.ga4-cli/config.json`

Optional: set a default property ID in config to avoid passing `--property` every time.

```json
{
  "credentials": { "...": "..." },
  "propertyId": "123456789"
}
```

## License

MIT
