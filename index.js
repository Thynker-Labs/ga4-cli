#!/usr/bin/env node

const { GoogleAnalytics } = require('googleapis');
const blessed = require('blessed');
const contrib = require('blessed-contrib');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.ga4-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Load configuration
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.log(`No config found at ${CONFIG_FILE}`);
    console.log(`Run with: ga4-cli init <path-to-service-account-json>`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

// Initialize Google Analytics
async function initGA(credentialsPath) {
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
  
  // Save config
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    credentialsPath: path.resolve(credentialsPath),
    credentials: credentials
  }, null, 2));
  
  console.log('Configuration saved!');
  process.exit(0);
}

// Main TUI Application
class GA4TUI {
  constructor() {
    this.screen = blessed.screen({ smartCSR: true, title: 'GA4 CLI' });
    this.config = loadConfig();
    this.propertyId = null;
    this.realtimeInterval = null;
    this.currentMode = 'menu'; // menu, realtime, reports
    this.dateRange = this.getDefaultDateRange();
    
    this.setupLayout();
    this.setupKeys();
  }
  
  getDefaultDateRange() {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return {
      start: weekAgo,
      end: today
    };
  }
  
  formatDate(date) {
    return date.toISOString().split('T')[0];
  }
  
  async setupGA() {
    const { BetaAnalyticsDataClient } = require('googleapis').analyticsadmin;
    
    this.client = new BetaAnalyticsDataClient({
      credentials: this.config.credentials
    });
    
    // Get available properties
    const [properties] = await this.client.listProperties({
      filter: 'propertyType:PROPERTY'
    });
    
    this.properties = properties.map(p => ({
      id: p.name.split('/')[1],
      name: p.displayName
    }));
    
    if (this.properties.length === 0) {
      throw new Error('No GA4 properties found');
    }
    
    // Default to first property
    this.propertyId = this.properties[0].id;
  }
  
  setupLayout() {
    // Main box
    this.mainBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      style: { bg: 'black' }
    });
    
    // Title
    this.title = blessed.box({
      parent: this.mainBox,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      style: { bg: 'blue', fg: 'white' },
      tags: true
    });
    
    // Content area
    this.contentBox = blessed.box({
      parent: this.mainBox,
      top: 3,
      left: 0,
      width: '100%',
      height: '100%-3'
    });
  }
  
  setupKeys() {
    // Quit on Escape or q
    this.screen.key(['escape', 'q', 'C-c'], () => {
      if (this.realtimeInterval) {
        clearInterval(this.realtimeInterval);
      }
      process.exit(0);
    });
  }
  
  async showMenu() {
    this.currentMode = 'menu';
    
    const menuItems = [
      { label: '📊 Realtime', action: () => this.showRealtime() },
      { label: '📅 Reports', action: () => this.showReports() },
      { label: '⚙️  Properties', action: () => this.showProperties() },
      { label: '❌ Quit', action: () => process.exit(0) }
    ];
    
    // Clear content
    this.contentBox.children = [];
    
    const titleText = blessed.box({
      parent: this.contentBox,
      top: '10%',
      left: 'center',
      width: '100%',
      tags: true,
      content: '{bold}GA4 Analytics CLI{/bold}\n\nSelect an option:',
      style: { fg: 'white', align: 'center' }
    });
    
    const menuBox = blessed.listtable({
      parent: this.contentBox,
      top: '40%',
      left: 'center',
      width: '40%',
      height: menuItems.length + 2,
      border: { type: 'line' },
      style: {
        header: { fg: 'blue', bold: true },
        cell: { fg: 'white' },
        selected: { bg: 'blue', fg: 'white' }
      },
      rows: menuItems.map((item, i) => [item.label])
    });
    
    menuBox.focus();
    
    menuBox.key('enter', () => {
      const idx = menuBox.selected;
      menuItems[idx].action();
    });
    
    this.screen.render();
  }
  
  async showProperties() {
    this.contentBox.children = [];
    
    const header = blessed.box({
      parent: this.contentBox,
      top: 2,
      left: 'center',
      content: 'Select Property (press Enter to select, Esc to go back)',
      style: { fg: 'white' }
    });
    
    const list = blessed.list({
      parent: this.contentBox,
      top: 5,
      left: 'center',
      width: '60%',
      height: '80%',
      border: { type: 'line' },
      style: {
        selected: { bg: 'blue', fg: 'white' }
      },
      items: this.properties.map(p => `${p.name} (${p.id})`)
    });
    
    list.focus();
    
    list.key('enter', () => {
      const selected = this.properties[list.selected];
      this.propertyId = selected.id;
      this.showMenu();
    });
    
    list.key('escape', () => this.showMenu());
    
    this.screen.render();
  }
  
  async showRealtime() {
    this.currentMode = 'realtime';
    this.contentBox.children = [];
    
    const header = blessed.box({
      parent: this.contentBox,
      top: 0,
      left: 'center',
      content: '📊 Realtime Mode (auto-refresh every 5s) - Press Esc to go back',
      style: { fg: 'green', bold: true }
    });
    
    // Stats grid
    this.rtUsers = blessed.box({
      parent: this.contentBox,
      top: 3,
      left: 2,
      width: '30%',
      height: 8,
      border: { type: 'line' },
      style: { border: { fg: 'cyan' } },
      content: 'Loading...'
    });
    
    this.rtPageviews = blessed.box({
      parent: this.contentBox,
      top: 3,
      left: '35%',
      width: '30%',
      height: 8,
      border: { type: 'line' },
      style: { border: { fg: 'cyan' } },
      content: 'Loading...'
    });
    
    this.rtEvents = blessed.box({
      parent: this.contentBox,
      top: 3,
      left: '68%',
      width: '30%',
      height: 8,
      border: { type: 'line' },
      style: { border: { fg: 'cyan' } },
      content: 'Loading...'
    });
    
    // Active pages
    this.rtPages = blessed.box({
      parent: this.contentBox,
      top: 12,
      left: 2,
      width: '48%',
      height: '70%',
      border: { type: 'line', fg: 'cyan' },
      style: { border: { fg: 'cyan' } },
      content: 'Loading...'
    });
    
    // Active events
    this.rtTopEvents = blessed.box({
      parent: this.contentBox,
      top: 12,
      left: '52%',
      width: '46%',
      height: '70%',
      border: { type: 'line', fg: 'cyan' },
      style: { border: { fg: 'cyan' } },
      content: 'Loading...'
    });
    
    this.screen.render();
    
    // Fetch data immediately and then every 5 seconds
    await this.fetchRealtimeData();
    
    this.realtimeInterval = setInterval(() => {
      this.fetchRealtimeData();
    }, 5000);
    
    // Handle escape
    this.contentBox.key('escape', () => {
      if (this.realtimeInterval) {
        clearInterval(this.realtimeInterval);
        this.realtimeInterval = null;
      }
      this.showMenu();
    });
    
    this.screen.render();
  }
  
  async fetchRealtimeData() {
    try {
      // Realtime active users
      const [usersRes] = await this.client.runRealtimeReport({
        property: `properties/${this.propertyId}`,
        metrics: [{ name: 'activeUsers' }],
        dimensions: [{ name: 'unifiedScreenName' }]
      });
      
      const activeUsers = usersRes.rows?.reduce((sum, row) => sum + parseInt(row.metricValues[0].value), 0) || 0;
      
      // Pageviews per minute
      const [pvRes] = await this.client.runRealtimeReport({
        property: `properties/${this.propertyId}`,
        metrics: [{ name: 'screenPageViewsPerMinute' }]
      });
      
      const pageviewsPerMin = pvRes.rows?.[0]?.metricValues[0]?.value || '0';
      
      // Events per minute
      const [eventsRes] = await this.client.runRealtimeReport({
        property: `properties/${this.propertyId}`,
        metrics: [{ name: 'eventCountPerMinute' }]
      });
      
      const eventsPerMin = eventsRes.rows?.[0]?.metricValues[0]?.value || '0';
      
      // Active pages
      const [pagesRes] = await this.client.runRealtimeReport({
        property: `properties/${this.propertyId}`,
        metrics: [{ name: 'activeUsers' }],
        dimensions: [{ name: 'unifiedScreenName' }],
        limit: 10
      });
      
      const pages = pagesRes.rows?.map(row => ({
        page: row.dimensionValues[0].value,
        users: row.metricValues[0].value
      })) || [];
      
      // Top events
      const [topEventsRes] = await this.client.runRealtimeReport({
        property: `properties/${this.propertyId}`,
        metrics: [{ name: 'eventCount' }],
        dimensions: [{ name: 'eventName' }],
        limit: 10
      });
      
      const topEvents = topEventsRes.rows?.map(row => ({
        event: row.dimensionValues[0].value,
        count: row.metricValues[0].value
      })) || [];
      
      // Update UI
      this.rtUsers.setContent(`{bold}Active Users{/bold}\n\n${activeUsers}`);
      this.rtPageviews.setContent(`{bold}Pageviews/min{/bold}\n\n${pageviewsPerMin}`);
      this.rtEvents.setContent(`{bold}Events/min{/bold}\n\n${eventsPerMin}`);
      
      const pagesContent = `{bold}Active Pages${' '.repeat(20)}\n}${
        pages.map(p => `${p.page.substring(0, 30)} ${p.users}`).join('\n')
      }`;
      this.rtPages.setContent(pagesContent);
      
      const eventsContent = `{bold}Top Events${' '.repeat(20)}\n}${
        topEvents.map(e => `${e.event.substring(0, 25)} ${e.count}`).join('\n')
      }`;
      this.rtTopEvents.setContent(eventsContent);
      
      this.screen.render();
    } catch (err) {
      this.rtUsers.setContent(`Error: ${err.message}`);
      this.screen.render();
    }
  }
  
  async showReports() {
    this.currentMode = 'reports';
    this.contentBox.children = [];
    
    const header = blessed.box({
      parent: this.contentBox,
      top: 0,
      left: 2,
      content: `📅 Reports: ${this.formatDate(this.dateRange.start)} to ${this.formatDate(this.dateRange.end)}`,
      style: { fg: 'yellow', bold: true }
    });
    
    // Date range selection
    const dateBox = blessed.box({
      parent: this.contentBox,
      top: 2,
      left: 2,
      width: '50%',
      height: 10,
      border: { type: 'line', fg: 'green' },
      content: `
[b]Date Range Options:[/b]
[1] Today
[2] Yesterday
[3] Last 7 days
[4] Last 30 days
[5] Last 90 days
[6] This month
[7] Last month
[8] Custom range
      `.trim()
    });
    
    const input = blessed.textbox({
      parent: this.contentBox,
      top: 13,
      left: 2,
      width: '30%',
      height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      placeholder: 'Enter number (1-8)'
    });
    
    input.focus();
    
    input.key('enter', async () => {
      const val = input.getValue().trim();
      await this.handleDateRangeSelect(val);
    });
    
    this.screen.render();
  }
  
  async handleDateRangeSelect(choice) {
    const today = new Date();
    let start = new Date(today);
    let end = new Date(today);
    
    switch (choice) {
      case '1': // Today
        start = new Date(today);
        break;
      case '2': // Yesterday
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        break;
      case '3': // Last 7 days
        start.setDate(start.getDate() - 7);
        break;
      case '4': // Last 30 days
        start.setDate(start.getDate() - 30);
        break;
      case '5': // Last 90 days
        start.setDate(start.getDate() - 90);
        break;
      case '6': // This month
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case '7': // Last month
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case '8': // Custom - would need more input
        this.contentBox.children = [];
        const customMsg = blessed.box({
          parent: this.contentBox,
          top: '40%',
          left: 'center',
          content: 'Custom range not yet implemented. Use preset options.',
          style: { fg: 'red' }
        });
        this.screen.render();
        await new Promise(r => setTimeout(r, 2000));
        this.showReports();
        return;
      default:
        this.showReports();
        return;
    }
    
    this.dateRange = { start, end };
    await this.showReportData();
  }
  
  async showReportData() {
    this.contentBox.children = [];
    
    const header = blessed.box({
      parent: this.contentBox,
      top: 0,
      left: 2,
      content: `📊 Report: ${this.formatDate(this.dateRange.start)} to ${this.formatDate(this.dateRange.end)} - Press Esc for menu`,
      style: { fg: 'yellow', bold: true }
    });
    
    try {
      // Main metrics
      const [reportRes] = await this.client.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [{ startDate: this.formatDate(this.dateRange.start), endDate: this.formatDate(this.dateRange.end) }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
          { name: 'screenPageViews' }
        ]
      });
      
      const row = reportRes.rows?.[0];
      const metrics = row?.metricValues.map(m => m.value) || [];
      
      const sessions = metrics[0] || '0';
      const users = metrics[1] || '0';
      const newUsers = metrics[2] || '0';
      const avgDuration = metrics[3] || '0';
      const bounceRate = metrics[4] || '0';
      const pageviews = metrics[5] || '0';
      
      // Format duration
      const durationSec = parseFloat(avgDuration);
      const mins = Math.floor(durationSec / 60);
      const secs = Math.floor(durationSec % 60);
      const durationStr = `${mins}m ${secs}s`;
      
      // Overview box
      const overview = blessed.box({
        parent: this.contentBox,
        top: 2,
        left: 2,
        width: '48%',
        height: 12,
        border: { type: 'line', fg: 'cyan' },
        content: `{bold}Overview${' '.repeat(25)}
Sessions:     ${parseInt(sessions).toLocaleString()}
Users:        ${parseInt(users).toLocaleString()}
New Users:    ${parseInt(newUsers).toLocaleString()}
Pageviews:    ${parseInt(pageviews).toLocaleString()}
Avg Session:  ${durationStr}
Bounce Rate:  ${(parseFloat(bounceRate) * 100).toFixed(1)}%`
      });
      
      // Top pages
      const [pagesRes] = await this.client.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [{ startDate: this.formatDate(this.dateRange.start), endDate: this.formatDate(this.dateRange.end) }],
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'averageSessionDuration' }],
        limit: 10
      });
      
      const topPages = pagesRes.rows?.map(row => ({
        page: row.dimensionValues[0].value,
        views: row.metricValues[0].value,
        avgDuration: row.metricValues[1].value
      })) || [];
      
      const pagesBox = blessed.box({
        parent: this.contentBox,
        top: 15,
        left: 2,
        width: '48%',
        height: '70%',
        border: { type: 'line', fg: 'green' },
        content: `{bold}Top Pages${' '.repeat(22)}\n}${
          topPages.map(p => `${p.page.substring(0, 25).padEnd(26)}${parseInt(p.views).toLocaleString()}`).join('\n')
        }`
      });
      
      // Top events
      const [eventsRes] = await this.client.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [{ startDate: this.formatDate(this.dateRange.start), endDate: this.formatDate(this.dateRange.end) }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'users' }],
        limit: 10
      });
      
      const topEvents = eventsRes.rows?.map(row => ({
        event: row.dimensionValues[0].value,
        count: row.metricValues[0].value,
        users: row.metricValues[1].value
      })) || [];
      
      const eventsBox = blessed.box({
        parent: this.contentBox,
        top: 15,
        left: '52%',
        width: '46%',
        height: '70%',
        border: { type: 'line', fg: 'magenta' },
        content: `{bold}Top Events${' '.repeat(22)}\n}${
          topEvents.map(e => `${e.event.substring(0, 20).padEnd(21)}${parseInt(e.count).toLocaleString()}`).join('\n')
        }`
      });
      
      // Sources
      const [sourcesRes] = await this.client.runReport({
        property: `properties/${this.propertyId}`,
        dateRanges: [{ startDate: this.formatDate(this.dateRange.start), endDate: this.formatDate(this.dateRange.end) }],
        dimensions: [{ name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        limit: 10
      });
      
      const sources = sourcesRes.rows?.map(row => ({
        source: row.dimensionValues[0].value,
        sessions: row.metricValues[0].value,
        users: row.metricValues[1].value
      })) || [];
      
      const sourcesBox = blessed.box({
        parent: this.contentBox,
        top: 2,
        left: '52%',
        width: '46%',
        height: 12,
        border: { type: 'line', fg: 'blue' },
        content: `{bold}Traffic Sources${' '.repeat(17)}\n}${
          sources.map(s => `${s.source.substring(0, 20).padEnd(21)}${parseInt(s.sessions).toLocaleString()}`).join('\n')
        }`
      });
      
      this.screen.render();
      
    } catch (err) {
      const errorBox = blessed.box({
        parent: this.contentBox,
        top: '40%',
        left: 'center',
        content: `Error: ${err.message}`,
        style: { fg: 'red' }
      });
      this.screen.render();
    }
  }
  
  async start() {
    try {
      await this.setupGA();
      this.showMenu();
    } catch (err) {
      console.error('Failed to initialize:', err.message);
      process.exit(1);
    }
  }
}

// CLI Entry Point
const args = process.argv.slice(2);

if (args[0] === 'init') {
  if (!args[1]) {
    console.log('Usage: ga4-cli init <path-to-service-account-json>');
    console.log('\nGet your service account JSON from Google Cloud Console:');
    console.log('1. Go to https://console.cloud.google.com');
    console.log('2. Create a project or select existing');
    console.log('3. Enable Google Analytics Data API');
    console.log('4. Go to IAM & Admin > Service Accounts');
    console.log('5. Create service account and download JSON key');
    console.log('6. Add service account email to GA4 property with Viewer access');
    process.exit(1);
  }
  initGA(args[1]);
} else {
  const tui = new GA4TUI();
  tui.start();
}
