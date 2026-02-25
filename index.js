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
      requestBody: {
        metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'eventCount' }],
      },
    });

    const row = res.data?.rows?.[0];
    return {
      activeUsers: row?.metricValues?.[0]?.value || '0',
      screenPageViews: row?.metricValues?.[1]?.value || '0',
      eventCount: row?.metricValues?.[2]?.value || '0',
    };
  }

  async getRealtimeTopPages(limit = 20) {
    this.requirePropertyId();
    const res = await this.client.properties.runRealtimeReport({
      property: `properties/${this.propertyId}`,
      requestBody: {
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: String(limit),
      },
    });
    const rows = res.data?.rows || [];
    return rows.map((r) => ({
      page: r.dimensionValues?.[0]?.value || '(not set)',
      views: r.metricValues?.[0]?.value || '0',
    }));
  }

  async getReportSummary(startDate, endDate) {
    this.requirePropertyId();
    const res = await this.client.properties.runReport({
      property: `properties/${this.propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'screenPageViews' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
        ],
      },
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

  async getTopPagesReport(startDate, endDate, limit = 20) {
    this.requirePropertyId();
    const res = await this.client.properties.runReport({
      property: `properties/${this.propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'sessions' },
          { name: 'bounceRate' },
          { name: 'averageSessionDuration' },
        ],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: String(limit),
      },
    });

    const formatRate = (v) => {
      const n = parseFloat(v);
      if (isNaN(n)) return v;
      return n > 0 && n < 1 ? String(Math.round(n * 1000) / 10) : String(Math.round(n * 10) / 10);
    };

    const formatDuration = (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? v : String(Math.round(n * 10) / 10);
    };

    const rows = res.data?.rows || [];
    return rows.map((r) => ({
      path: r.dimensionValues?.[0]?.value || '(not set)',
      pageTitle: r.dimensionValues?.[1]?.value || '(not set)',
      views: r.metricValues?.[0]?.value || '0',
      sessions: r.metricValues?.[1]?.value || '0',
      bounceRate: formatRate(r.metricValues?.[2]?.value || '0'),
      engagementTime: formatDuration(r.metricValues?.[3]?.value || '0'),
    }));
  }

  getPathVariants(path) {
    const p = String(path || '').trim();
    if (!p) return [];
    const normalized = p.startsWith('/') ? p : `/${p}`;
    if (normalized === '/') return ['/'];
    const withTrailing = normalized.endsWith('/') ? normalized : `${normalized}/`;
    const withoutTrailing = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
    return [...new Set([withTrailing, withoutTrailing])];
  }

  async getPathReport(pathInput, startDate, endDate) {
    this.requirePropertyId();
    const pathVariants = this.getPathVariants(pathInput);
    if (pathVariants.length === 0) {
      throw new Error('Path cannot be empty');
    }

    const normalized = pathInput.trim().startsWith('/') ? pathInput.trim() : `/${pathInput.trim()}`;
    const basePath = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;

    const buildRequest = (dimensionFilter) => ({
      property: `properties/${this.propertyId}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'screenPageViews' },
          { name: 'eventCount' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
          { name: 'engagementRate' },
        ],
        dimensionFilter,
      },
    });

    let res = await this.client.properties.runReport(
      buildRequest({
        filter: {
          fieldName: 'pagePath',
          inListFilter: {
            values: pathVariants,
            caseSensitive: false,
          },
        },
      }),
    );

    const getTotalViews = (r) => parseInt(r?.data?.totals?.[0]?.metricValues?.[3]?.value || '0', 10);
    const getRows = (r) => r?.data?.rows || [];

    if (getTotalViews(res) === 0 && getRows(res).length === 0) {
      res = await this.client.properties.runReport(
        buildRequest({
          filter: {
            fieldName: 'pagePath',
            stringFilter: {
              matchType: 'BEGINS_WITH',
              value: basePath,
              caseSensitive: false,
            },
          },
        }),
      );
    }

    const rows = getRows(res);
    const totals = res.data?.totals?.[0]?.metricValues;

    const sumMetric = (metricIndex) =>
      String(
        rows.reduce((sum, row) => sum + parseFloat(row.metricValues?.[metricIndex]?.value || '0'), 0),
      );

    const weightedAvg = (metricIndex, weightIndex = 0) => {
      if (rows.length === 0) return '0';
      if (rows.length === 1) return rows[0].metricValues?.[metricIndex]?.value || '0';
      let sumWx = 0;
      let sumW = 0;
      rows.forEach((row) => {
        const w = parseFloat(row.metricValues?.[weightIndex]?.value || '0');
        sumWx += parseFloat(row.metricValues?.[metricIndex]?.value || '0') * w;
        sumW += w;
      });
      return sumW > 0 ? String(Math.round((sumWx / sumW) * 100) / 100) : '0';
    };

    const m = totals || [];
    const formatRate = (v) => {
      const n = parseFloat(v);
      if (n > 0 && n < 1) return String(Math.round(n * 1000) / 10);
      return v;
    };
    const formatDuration = (v) => {
      const n = parseFloat(v);
      return isNaN(n) ? v : String(Math.round(n * 10) / 10);
    };
    const metric = (i) => {
      let v;
      if (m[i]?.value) v = m[i].value;
      else if (rows.length === 0) v = '0';
      else if ([0, 1, 2, 3, 4].includes(i)) v = sumMetric(i);
      else v = weightedAvg(i, 0);
      if (i === 5) v = formatDuration(v);
      else if (i === 6 || i === 7) v = formatRate(v);
      return v;
    };

    return {
      path: pathInput,
      pathVariants,
      sessions: metric(0),
      totalUsers: metric(1),
      newUsers: metric(2),
      pageviews: metric(3),
      eventCount: metric(4),
      averageSessionDuration: metric(5),
      bounceRate: metric(6),
      engagementRate: metric(7),
      byPath: rows.map((r) => ({
        pagePath: r.dimensionValues?.[0]?.value || '(not set)',
        sessions: r.metricValues?.[0]?.value || '0',
        totalUsers: r.metricValues?.[1]?.value || '0',
        newUsers: r.metricValues?.[2]?.value || '0',
        pageviews: r.metricValues?.[3]?.value || '0',
        eventCount: r.metricValues?.[4]?.value || '0',
        averageSessionDuration: r.metricValues?.[5]?.value || '0',
        bounceRate: r.metricValues?.[6]?.value || '0',
        engagementRate: r.metricValues?.[7]?.value || '0',
      })),
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
    this.activeViewId = 0;

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

    this.screen.key(['q', 'C-c'], () => {
      this.stopRealtime();
      process.exit(0);
    });
  }

  stopRealtime() {
    if (this.realtimeInterval) {
      clearInterval(this.realtimeInterval);
      this.realtimeInterval = null;
    }
  }

  clearContent() {
    this.stopRealtime();
    while (this.contentBox.children.length) {
      this.contentBox.children[0].destroy();
    }
    this.activeViewId += 1;
  }

  async showMenu() {
    const blessed = this.blessed;
    this.clearContent();

    const options = [
      { label: 'Realtime summary', action: () => this.showRealtime() },
      { label: 'Top pages/screens', action: () => this.showTopPagesDateRange() },
      { label: 'Path report', action: () => this.showPathInput() },
      { label: 'Quit', action: () => process.exit(0) },
    ];

    const list = blessed.list({
      parent: this.contentBox,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 10,
      border: { type: 'line' },
      style: { selected: { bg: 'blue' } },
      items: options.map((o) => o.label),
      keys: true,
      vi: true,
    });

    blessed.text({
      parent: this.contentBox,
      bottom: 0,
      left: 'center',
      content: 'Use arrows + Enter. Press q to quit.',
      style: { fg: 'gray' },
    });

    list.focus();
    list.key('enter', () => options[list.selected].action());
    this.screen.render();
  }

  showDateRangeSelector(title, onSelect, onBack) {
    const blessed = this.blessed;
    this.clearContent();
    const options = [
      { label: 'Today', value: 'today' },
      { label: 'Yesterday', value: 'yesterday' },
      { label: 'Last 7 days', value: 'last7' },
      { label: 'Last 30 days', value: 'last30' },
      { label: 'Custom (enter start/end date)', value: 'custom' },
      { label: 'Back', value: 'back' },
    ];

    const list = blessed.list({
      parent: this.contentBox,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 12,
      border: { type: 'line' },
      label: ` ${title} `,
      keys: true,
      vi: true,
      style: { selected: { bg: 'blue' } },
      items: options.map((o) => o.label),
    });

    list.focus();
    list.key(['escape', 'b'], () => onBack());
    list.key('enter', () => {
      const selected = options[list.selected];
      if (!selected || selected.value === 'back') {
        onBack();
        return;
      }

      if (selected.value === 'custom') {
        this.showCustomDateRangeInput(onSelect, () => this.showDateRangeSelector(title, onSelect, onBack));
        return;
      }

      const range = getDateRange(selected.value);
      onSelect({
        ...range,
        rangeLabel: selected.label,
      });
    });

    blessed.text({
      parent: this.contentBox,
      bottom: 0,
      left: 'center',
      content: 'Choose range and press Enter. Esc/B to go back.',
      style: { fg: 'gray' },
    });

    this.screen.render();
  }

  showCustomDateRangeInput(onSelect, onBack) {
    const blessed = this.blessed;
    this.clearContent();

    const form = blessed.form({
      parent: this.contentBox,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 13,
      border: { type: 'line' },
      label: ' Custom Date Range ',
      keys: true,
    });

    blessed.text({
      parent: form,
      top: 1,
      left: 2,
      content: 'Enter both dates: YYYY-MM-DD YYYY-MM-DD',
    });
    blessed.text({
      parent: form,
      top: 2,
      left: 2,
      content: 'Example: 2026-02-01 2026-02-25',
      style: { fg: 'gray' },
    });

    const input = blessed.textbox({
      parent: form,
      top: 4,
      left: 2,
      width: '95%-4',
      height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      name: 'dates',
    });

    const errorText = blessed.text({
      parent: form,
      top: 8,
      left: 2,
      content: '',
      style: { fg: 'red' },
    });

    blessed.text({
      parent: form,
      top: 10,
      left: 2,
      content: 'Enter to continue  |  Esc/B to go back',
      style: { fg: 'gray' },
    });

    form.on('submit', (data) => {
      const raw = String(data.dates || '').trim();
      const parts = raw.split(/[,\s]+/).filter(Boolean);
      const startDate = parts[0];
      const endDate = parts[1];
      if (!startDate || !endDate || !isIsoDate(startDate) || !isIsoDate(endDate)) {
        errorText.setContent('Invalid input. Use: YYYY-MM-DD YYYY-MM-DD');
        this.screen.render();
        return;
      }
      onSelect({
        startDate,
        endDate,
        rangeLabel: `Custom (${startDate} to ${endDate})`,
      });
    });

    input.key('enter', () => form.submit());
    input.key(['escape', 'b'], () => onBack());
    input.focus();
    this.screen.render();
  }

  async showPathInput() {
    const blessed = this.blessed;
    this.clearContent();

    const form = blessed.form({
      parent: this.contentBox,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 12,
      border: { type: 'line' },
      label: ' Path Report ',
      keys: true,
    });

    blessed.text({
      parent: form,
      top: 1,
      left: 2,
      content: 'Enter path (e.g. /about or /blog/post):',
    });

    const input = blessed.textbox({
      parent: form,
      top: 3,
      left: 2,
      width: '95%-4',
      height: 3,
      border: { type: 'line' },
      inputOnFocus: true,
      name: 'path',
    });

    const errorText = blessed.text({
      parent: form,
      top: 7,
      left: 2,
      content: '',
      style: { fg: 'red' },
    });

    blessed.text({
      parent: form,
      top: 9,
      left: 2,
      content: 'Press Enter to continue  |  Esc/B to go back',
      style: { fg: 'gray' },
    });

    input.focus();
    input.key(['escape', 'b'], () => this.showMenu());

    form.on('submit', (data) => {
      const pathInput = String(data.path || '').trim();
      if (!pathInput) {
        errorText.setContent('Path is required.');
        this.screen.render();
        return;
      }
      this.showDateRangeSelector(
        'Choose Date Range For Path Report',
        ({ startDate, endDate, rangeLabel }) => this.showPathReport(pathInput, startDate, endDate, rangeLabel),
        () => this.showPathInput(),
      );
    });

    input.key('enter', () => form.submit());
    this.screen.render();
  }

  async showPathReport(pathInput, startDate, endDate, rangeLabel) {
    const blessed = this.blessed;
    this.clearContent();
    const viewId = this.activeViewId;

    const box = blessed.box({
      parent: this.contentBox,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      border: { type: 'line' },
      style: { border: { fg: 'cyan' } },
      tags: true,
      content: '{cyan-fg}Loading path report...{/}',
      scrollable: true,
      keys: true,
    });

    const goBack = () =>
      this.showDateRangeSelector(
        'Choose Date Range For Path Report',
        ({ startDate: nextStart, endDate: nextEnd, rangeLabel: nextLabel }) =>
          this.showPathReport(pathInput, nextStart, nextEnd, nextLabel),
        () => this.showPathInput(),
      );
    box.key(['escape', 'b'], goBack);
    box.key(['r'], () => this.showPathReport(pathInput, startDate, endDate, rangeLabel));

    try {
      const report = await this.service.getPathReport(pathInput, startDate, endDate);
      if (viewId !== this.activeViewId) return;

      const lines = [
        `{cyan-fg}Path Report{/}  |  {green-fg}${report.path}{/}`,
        `Includes variants: {yellow-fg}${report.pathVariants.join(', ')}{/}`,
        `Range: ${startDate} to ${endDate} (${rangeLabel})  |  Property: ${this.service.propertyId}`,
        '',
        '{cyan-fg}Metrics{/}',
        `  Sessions:         {green-fg}${report.sessions}{/}`,
        `  Total Users:      {green-fg}${report.totalUsers}{/}`,
        `  New Users:        {green-fg}${report.newUsers}{/}`,
        `  Pageviews:        {green-fg}${report.pageviews}{/}`,
        `  Events:           {green-fg}${report.eventCount}{/}`,
        `  Avg Session:      {green-fg}${report.averageSessionDuration}s{/}`,
        `  Bounce Rate:      {green-fg}${report.bounceRate}%{/}`,
        `  Engagement Rate:  {green-fg}${report.engagementRate}%{/}`,
      ];

      if (report.byPath?.length > 1) {
        lines.push('', '{cyan-fg}By path variant:{/}');
        report.byPath.forEach((p) => {
          lines.push(`  {yellow-fg}${p.pagePath}{/}: ${p.pageviews} views, ${p.sessions} sessions`);
        });
      }

      lines.push('', '{gray-fg}Press Esc/B to change range, R to refresh{/}');
      box.setContent(lines.join('\n'));
      box.setScrollPerc(0);
    } catch (error) {
      if (viewId !== this.activeViewId) return;
      logError(error, 'tui:showPathReport');
      box.setContent(`{red-fg}Error:{/} ${error.message}\n\n{gray-fg}Press Esc/B to go back{/}`);
    }

    this.screen.render();
  }

  showTopPagesDateRange() {
    this.showDateRangeSelector(
      'Choose Date Range For Top Pages/Screens',
      ({ startDate, endDate, rangeLabel }) => this.showTopPagesReport(startDate, endDate, rangeLabel),
      () => this.showMenu(),
    );
  }

  async showTopPagesReport(startDate, endDate, rangeLabel, limit = 20) {
    const blessed = this.blessed;
    this.clearContent();
    const viewId = this.activeViewId;

    const box = blessed.box({
      parent: this.contentBox,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      border: { type: 'line' },
      style: { border: { fg: 'green' } },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      content: '{green-fg}Loading top pages/screens...{/}',
    });

    box.key(['escape', 'b'], () => this.showTopPagesDateRange());
    box.key(['r'], () => this.showTopPagesReport(startDate, endDate, rangeLabel, limit));

    try {
      const pages = await this.service.getTopPagesReport(startDate, endDate, limit);
      if (viewId !== this.activeViewId) return;
      const pathWidth = 34;
      const titleWidth = 30;
      const truncate = (value, width) => {
        const text = String(value || '');
        return text.length > width ? `${text.slice(0, width - 3)}...` : text;
      };
      const lines = [
        `{green-fg}Top Pages/Screens{/}  |  Property: {cyan-fg}${this.service.propertyId}{/}`,
        `Range: ${startDate} to ${endDate} (${rangeLabel})  |  Rows: ${pages.length}`,
        '',
        `${'#'.padEnd(3)} ${'Path'.padEnd(pathWidth)} ${'Title'.padEnd(titleWidth)} ${'Views'.padStart(8)} ${'Sessions'.padStart(10)} ${'Bounce'.padStart(8)} ${'Engage'.padStart(8)}`,
        '-'.repeat(3 + pathWidth + titleWidth + 42),
      ];

      if (pages.length === 0) {
        lines.push('{yellow-fg}No rows returned for this date range.{/}');
      } else {
        pages.forEach((row, idx) => {
          lines.push(
            `${String(idx + 1).padEnd(3)} ${truncate(row.path, pathWidth).padEnd(pathWidth)} ${truncate(row.pageTitle, titleWidth).padEnd(titleWidth)} ${row.views.padStart(8)} ${row.sessions.padStart(10)} ${`${row.bounceRate}%`.padStart(8)} ${row.engagementTime.padStart(8)}`,
          );
        });
      }

      lines.push('', '{gray-fg}Press Esc/B to change range, R to refresh{/}');
      box.setContent(lines.join('\n'));
      box.setScrollPerc(0);
    } catch (error) {
      if (viewId !== this.activeViewId) return;
      logError(error, 'tui:showTopPagesReport');
      box.setContent(`{red-fg}Error:{/} ${error.message}\n\n{gray-fg}Press Esc/B to go back{/}`);
    }

    this.screen.render();
  }

  async showRealtime() {
    const blessed = this.blessed;
    this.clearContent();
    const viewId = this.activeViewId;

    const summaryBox = blessed.box({
      parent: this.contentBox,
      top: 0,
      left: 0,
      width: '100%',
      height: 6,
      border: { type: 'line' },
      style: { border: { fg: 'cyan' } },
      tags: true,
      content: 'Loading...',
    });

    const pagesBox = blessed.box({
      parent: this.contentBox,
      top: 6,
      left: 0,
      width: '100%',
      height: '100%-6',
      border: { type: 'line' },
      style: { border: { fg: 'green' } },
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      content: 'Loading top pages...',
    });
    pagesBox.key(['escape', 'b'], () => this.showMenu());
    pagesBox.key(['r'], () => refresh());
    pagesBox.focus();

    let countdown = 5;
    let lastSummary = null;

    const formatSummaryLine = (s, secs) => {
      if (!s) return '';
      const cd = secs !== undefined ? `  |  {yellow-fg}Refreshing in {bold}${secs}{/bold}s{/}` : '';
      return `{cyan-fg}Realtime{/} (property {green-fg}${this.service.propertyId}{/})  |  {cyan-fg}Active Users:{/} {green-fg}${s.activeUsers}{/}  |  {cyan-fg}Views:{/} {green-fg}${s.screenPageViews}{/}  |  {cyan-fg}Events:{/} {green-fg}${s.eventCount}{/}${cd}\n{gray-fg}Esc/B: menu  |  R: refresh now  |  q: quit{/}`;
    };

    const refresh = async () => {
      try {
        const [summary, topPages] = await Promise.all([
          this.service.getRealtimeSummary(),
          this.service.getRealtimeTopPages(20),
        ]);
        if (viewId !== this.activeViewId) return;
        lastSummary = summary;
        countdown = 5;

        summaryBox.setContent(formatSummaryLine(summary));
        const maxLen = 60;
        const truncate = (s) => (s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s);
        const header = '\n{cyan-fg} #  Page{/}'.padEnd(maxLen + 22) + '{cyan-fg}Views{/}\n' + '─'.repeat(maxLen + 12);
        const rows = topPages.map(
          (p, i) => ` {green-fg}${String(i + 1).padStart(2)}{/}  ${truncate(p.page).padEnd(maxLen)}  {yellow-fg}${p.views}{/}`,
        );
        pagesBox.setContent(header + '\n' + rows.join('\n'));
        pagesBox.setScrollPerc(0);
      } catch (error) {
        if (viewId !== this.activeViewId) return;
        logError(error, 'tui:showRealtime');
        summaryBox.setContent(`{red-fg}Error:{/} ${error.message}`);
        pagesBox.setContent(`Logged to ${ERROR_LOG_FILE}`);
      }
      this.screen.render();
    };

    const tick = () => {
      if (viewId !== this.activeViewId) return;
      if (countdown > 0) {
        if (lastSummary) {
          summaryBox.setContent(formatSummaryLine(lastSummary, countdown));
        }
        countdown--;
        this.screen.render();
      } else {
        refresh();
      }
    };

    await refresh();
    this.realtimeInterval = setInterval(tick, 1000);
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
    case 'all':
    case 'alltime':
      start.setFullYear(start.getFullYear() - 5);
      break;
    case 'last7':
    default:
      start.setDate(start.getDate() - 7);
      break;
  }

  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function resolveDateRange(options = {}) {
  const range = options.range;
  const startDate = options['start-date'];
  const endDate = options['end-date'];
  const hasCustomRange = Boolean(startDate || endDate);

  if (range === 'custom' || hasCustomRange) {
    if (!startDate || !endDate) {
      throw new Error('Custom range requires both --start-date and --end-date');
    }
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      throw new Error('Dates must use YYYY-MM-DD format');
    }
    return { startDate, endDate };
  }

  return getDateRange(range);
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
  ga4 report --property <id> [--range today|yesterday|last7|last30|last90|all|custom] [--start-date YYYY-MM-DD --end-date YYYY-MM-DD] [--json]
  ga4 pages --property <id> [--range today|yesterday|last7|last30|last90|all|custom] [--start-date YYYY-MM-DD --end-date YYYY-MM-DD] [--limit 20] [--json]
  ga4 path <path> --property <id> [--range today|yesterday|last7|last30|last90|all|custom] [--start-date YYYY-MM-DD --end-date YYYY-MM-DD] [--json]

  - Errors are logged to ${ERROR_LOG_FILE}`);
}

async function runCliCommand(service, command, options, positionals = []) {
  if (options.property) service.setPropertyId(options.property);

  switch (command) {
    case 'realtime': {
      const summary = await service.getRealtimeSummary();
      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`Property: ${service.propertyId}`);
        console.log(`Active Users: ${summary.activeUsers}`);
        console.log(`Views: ${summary.screenPageViews}`);
        console.log(`Events: ${summary.eventCount}`);
      }
      return;
    }
    case 'report': {
      const { startDate, endDate } = resolveDateRange(options);
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
    case 'pages': {
      const { startDate, endDate } = resolveDateRange(options);
      const limit = options.limit ? parseInt(options.limit, 10) : 20;
      if (isNaN(limit) || limit <= 0) {
        throw new Error('--limit must be a positive integer');
      }

      const pages = await service.getTopPagesReport(startDate, endDate, limit);
      if (options.json) {
        console.log(JSON.stringify({ startDate, endDate, limit, rows: pages }, null, 2));
      } else {
        console.log(`Property: ${service.propertyId}`);
        console.log(`Range: ${startDate} to ${endDate}`);
        console.log(`Top pages/screens (limit ${limit})`);
        if (pages.length === 0) {
          console.log('No rows returned.');
          return;
        }

        const pathWidth = 36;
        const titleWidth = 34;
        const truncate = (value, width) => {
          const text = String(value || '');
          if (text.length <= width) return text;
          return `${text.slice(0, width - 3)}...`;
        };

        console.log(
          `${'#'.padEnd(3)} ${'Path'.padEnd(pathWidth)} ${'Title'.padEnd(titleWidth)} ${'Views'.padStart(8)} ${'Sessions'.padStart(10)} ${'Bounce'.padStart(8)} ${'Engage(s)'.padStart(10)}`,
        );
        console.log('-'.repeat(3 + pathWidth + titleWidth + 42));
        pages.forEach((row, idx) => {
          console.log(
            `${String(idx + 1).padEnd(3)} ${truncate(row.path, pathWidth).padEnd(pathWidth)} ${truncate(row.pageTitle, titleWidth).padEnd(titleWidth)} ${row.views.padStart(8)} ${row.sessions.padStart(10)} ${`${row.bounceRate}%`.padStart(8)} ${row.engagementTime.padStart(10)}`,
          );
        });
      }
      return;
    }
    case 'path': {
      const pathArg = options.path ?? positionals[1];
      if (!pathArg) {
        console.error('Usage: ga4 path <path> --property <id> [--range last7]');
        process.exit(1);
      }
      const { startDate, endDate } = resolveDateRange(options);
      const pathReport = await service.getPathReport(pathArg, startDate, endDate);
      if (options.json) {
        console.log(JSON.stringify({ startDate, endDate, ...pathReport }, null, 2));
      } else {
        console.log(`Property: ${service.propertyId}`);
        console.log(`Path: ${pathReport.path} (includes: ${pathReport.pathVariants.join(', ')})`);
        console.log(`Range: ${startDate} to ${endDate}`);
        console.log(`Sessions: ${pathReport.sessions}`);
        console.log(`Users: ${pathReport.totalUsers}`);
        console.log(`New Users: ${pathReport.newUsers}`);
        console.log(`Pageviews: ${pathReport.pageviews}`);
        console.log(`Events: ${pathReport.eventCount}`);
        console.log(`Avg Session: ${pathReport.averageSessionDuration}s`);
        console.log(`Bounce Rate: ${pathReport.bounceRate}%`);
        console.log(`Engagement Rate: ${pathReport.engagementRate}%`);
        if (pathReport.byPath?.length > 1) {
          console.log('\nBy path variant:');
          pathReport.byPath.forEach((p) => {
            console.log(`  ${p.pagePath}: ${p.pageviews} views, ${p.sessions} sessions`);
          });
        }
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

    await runCliCommand(service, command, options, positionals);
  } catch (error) {
    exitWithLoggedError(error, `main:${command}`);
  }
})();
