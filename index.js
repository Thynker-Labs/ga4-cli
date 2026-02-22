#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.ga4-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const ERROR_LOG_FILE = path.join(CONFIG_DIR, 'errors.log');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function logError(error, context = 'unknown') {
  ensureConfigDir();
  const timestamp = new Date().toISOString();
  const message = error?.stack || error?.message || String(error);
  const entry = `[${timestamp}] [${context}] ${message}\n\n`;
  fs.appendFileSync(ERROR_LOG_FILE, entry, 'utf-8');
}

function exitWithLoggedError(error, context) {
  logError(error, context);
  console.error(`Error: ${error.message}`);
  console.error(`Details logged to: ${ERROR_LOG_FILE}`);
  process.exit(1);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log(`No config found at ${CONFIG_FILE}`);
    console.log('Run with: ga4 init <path-to-service-account-json>');
    process.exit(1);
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (error) {
    exitWithLoggedError(error, 'loadConfig');
  }
}

async function initGA(credentialsPath) {
  try {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    ensureConfigDir();

    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(
        {
          credentialsPath: path.resolve(credentialsPath),
          credentials,
        },
        null,
        2,
      ),
    );

    console.log('Configuration saved!');
  } catch (error) {
    exitWithLoggedError(error, 'initGA');
  }
}

class GA4Service {
  constructor() {
    this.config = loadConfig();
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: this.config.credentials,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
    this.client = google.analyticsdata({ version: 'v1beta', auth });
    this.properties = [];
    this.propertyId = this.config.propertyId ? String(this.config.propertyId) : null;
  }

  setPropertyId(propertyId) {
    this.propertyId = String(propertyId);
  }

  requirePropertyId() {
    if (!this.propertyId) {
      throw new Error('No property selected. Provide --property <id> or add "propertyId" to ~/.ga4-cli/config.json');
    }
  }

  async getRealtimeSummary() {
    this.requirePropertyId();
    const res = await this.client.properties.runRealtimeReport({
      property: `properties/${this.propertyId}`,
      metrics: [{ name: 'activeUsers' }, { name: 'screenPageViewsPerMinute' }, { name: 'eventCountPerMinute' }],
    });

    const row = res.data?.rows?.[0];
    return {
      activeUsers: row?.metricValues?.[0]?.value || '0',
      pageviewsPerMinute: row?.metricValues?.[1]?.value || '0',
      eventsPerMinute: row?.metricValues?.[2]?.value || '0',
    };
  }

  async getReportSummary(startDate, endDate) {
    this.requirePropertyId();
    const res = await this.client.properties.runReport({
      property: `properties/${this.propertyId}`,
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
      ],
    });

    const row = res.data?.rows?.[0];
    const m = row?.metricValues || [];
    return {
      sessions: m[0]?.value || '0',
      totalUsers: m[1]?.value || '0',
      newUsers: m[2]?.value || '0',
      pageviews: m[3]?.value || '0',
      averageSessionDuration: m[4]?.value || '0',
      bounceRate: m[5]?.value || '0',
    };
  }
}

class GA4TUI {
  constructor(service) {
    const blessed = require('blessed');
    this.blessed = blessed;
    this.service = service;
    this.screen = blessed.screen({ smartCSR: true, title: 'GA4 CLI' });
    this.realtimeInterval = null;

    this.mainBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      style: { bg: 'black' },
    });

    this.contentBox = blessed.box({
      parent: this.mainBox,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
    });

    this.screen.key(['escape', 'q', 'C-c'], () => {
      if (this.realtimeInterval) clearInterval(this.realtimeInterval);
      process.exit(0);
    });
  }

  async showMenu() {
    const blessed = this.blessed;
    this.contentBox.children = [];

    const options = [
      { label: 'Realtime summary', action: () => this.showRealtime() },
      { label: 'Quit', action: () => process.exit(0) },
    ];

    const list = blessed.list({
      parent: this.contentBox,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 8,
      border: { type: 'line' },
      style: { selected: { bg: 'blue' } },
      items: options.map((o) => o.label),
    });

    list.focus();
    list.key('enter', () => options[list.selected].action());
    this.screen.render();
  }

  async showRealtime() {
    const blessed = this.blessed;
    this.contentBox.children = [];

    const box = blessed.box({
      parent: this.contentBox,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 10,
      border: { type: 'line' },
      content: 'Loading...',
    });

    const refresh = async () => {
      try {
        const summary = await this.service.getRealtimeSummary();
        box.setContent(
          `Realtime (property ${this.service.propertyId})\n\nActive Users: ${summary.activeUsers}\nPageviews/min: ${summary.pageviewsPerMinute}\nEvents/min: ${summary.eventsPerMinute}`,
        );
      } catch (error) {
        logError(error, 'tui:showRealtime');
        box.setContent(`Error: ${error.message}\nLogged to ${ERROR_LOG_FILE}`);
      }
      this.screen.render();
    };

    await refresh();
    this.realtimeInterval = setInterval(refresh, 5000);
    this.screen.render();
  }

  async start() {
    await this.showMenu();
  }
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function getDateRange(range) {
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today);

  switch (range) {
    case 'today':
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      break;
    case 'last30':
      start.setDate(start.getDate() - 30);
      break;
    case 'last90':
      start.setDate(start.getDate() - 90);
      break;
    case 'last7':
    default:
      start.setDate(start.getDate() - 7);
      break;
  }

  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {};
  const positionals = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      options[key] = value;
    } else {
      positionals.push(token);
    }
  }

  return { positionals, options };
}

function printUsage() {
  console.log(`Usage:
  ga4 init <service-account-json>
  ga4 tui [--property <id>]
  ga4 realtime --property <id> [--json]
  ga4 report --property <id> [--range today|yesterday|last7|last30|last90] [--json]

Notes:
  - TUI is still available and remains the default mode.
  - Errors are logged to ${ERROR_LOG_FILE}`);
}

async function runCliCommand(service, command, options) {
  if (options.property) service.setPropertyId(options.property);

  switch (command) {
    case 'realtime': {
      const summary = await service.getRealtimeSummary();
      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`Property: ${service.propertyId}`);
        console.log(`Active Users: ${summary.activeUsers}`);
        console.log(`Pageviews/min: ${summary.pageviewsPerMinute}`);
        console.log(`Events/min: ${summary.eventsPerMinute}`);
      }
      return;
    }
    case 'report': {
      const { startDate, endDate } = getDateRange(options.range);
      const summary = await service.getReportSummary(startDate, endDate);
      if (options.json) {
        console.log(JSON.stringify({ startDate, endDate, ...summary }, null, 2));
      } else {
        console.log(`Property: ${service.propertyId}`);
        console.log(`Range: ${startDate} to ${endDate}`);
        console.log(`Sessions: ${summary.sessions}`);
        console.log(`Users: ${summary.totalUsers}`);
        console.log(`New Users: ${summary.newUsers}`);
        console.log(`Pageviews: ${summary.pageviews}`);
      }
      return;
    }
    default:
      throw new Error(`Unsupported command: ${command}`);
  }
}

(async function main() {
  const { positionals, options } = parseArgs(process.argv.slice(2));
  const command = positionals[0] || 'tui';

  if (command === 'help' || options.help) {
    printUsage();
    return;
  }

  if (command === 'init') {
    if (!positionals[1]) {
      printUsage();
      process.exit(1);
    }
    await initGA(positionals[1]);
    return;
  }

  try {
    const service = new GA4Service();
    if (options.property) service.setPropertyId(options.property);

    if (command === 'tui') {
      const tui = new GA4TUI(service);
      await tui.start();
      return;
    }

    await runCliCommand(service, command, options);
  } catch (error) {
    exitWithLoggedError(error, `main:${command}`);
  }
})();
