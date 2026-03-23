// ===== Configuration =====
const API_BASE = '/api/statistics/stream/xml';

// CSS custom properties are the single source of truth for colors.
// cssVar() reads the live value at render time so theme switches propagate automatically.
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const SERIES_CONFIG = {
  'Carbune':          { label: 'Cărbune',        cssVar: '--c-coal',         group: 'source' },
  'Hidrocarburi':     { label: 'Hidrocarburi',   cssVar: '--c-hydrocarbons', group: 'source' },
  'Hidro':            { label: 'Hidro',          cssVar: '--c-hydro',        group: 'source' },
  'Nuclear':          { label: 'Nuclear',        cssVar: '--c-nuclear',      group: 'source' },
  'Eolian':           { label: 'Eolian',         cssVar: '--c-wind',         group: 'source' },
  'Fotovoltaic':      { label: 'Fotovoltaic',    cssVar: '--c-solar',        group: 'source' },
  'Biomasa':          { label: 'Biomasă',        cssVar: '--c-biomass',      group: 'source' },
  'Stocare':          { label: 'Stocare',        cssVar: '--c-storage',      group: 'source' },
  'Sold':             { label: 'Sold export',    cssVar: '--c-export',       group: 'meta'   },
  'Putere debitată':  { label: 'Producție',      cssVar: '--c-production',   group: 'meta'   },
  'Putere cerută':    { label: 'Consum',         cssVar: '--c-consumption',  group: 'meta'   },
};

function seriesColor(key) {
  return cssVar(SERIES_CONFIG[key].cssVar);
}

// Normalize graph titles from XML (e.g. "Putere debitată" -> our key)
// The XML may use varying diacritics; map known variants to our canonical keys
const TITLE_ALIASES = {
  'Putere debitată': 'Putere debitată',
  'Putere debitata': 'Putere debitată',
  'Putere cerută':   'Putere cerută',
  'Putere ceruta':   'Putere cerută',
};

function normalizeTitle(title) {
  return TITLE_ALIASES[title] || title;
}

const RENEWABLE_KEYS = ['Hidro', 'Eolian', 'Fotovoltaic', 'Biomasa'];
const SOURCE_KEYS = Object.keys(SERIES_CONFIG).filter(k => SERIES_CONFIG[k].group === 'source');
const PRODUCTION_KEY = 'Putere debitată';
const CONSUMPTION_KEY = 'Putere cerută';

// Table column order and labels — static, computed once
const TABLE_COLUMNS = ['Ora', ...SOURCE_KEYS, PRODUCTION_KEY, CONSUMPTION_KEY, 'Sold'];
const TABLE_COLUMN_LABELS = {
  'Ora': 'Ora',
  ...Object.fromEntries(Object.entries(SERIES_CONFIG).map(([k, v]) => [k, v.label])),
};

// ===== State =====
let rawData = [];
let mainChart = null;
let donutChart = null;
let supplyDemandChart = null;
let flatpickrInstance = null;
let sortColumn = null;
let sortDirection = 'asc';
let abortController = null;
let lastFetchFrom = null;
let lastFetchTo = null;

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const themeToggle = $('#themeToggle');
const loadDataBtn = $('#loadData');
const dateRangeInput = $('#dateRange');
const loadingOverlay = $('#loadingOverlay');
const tableToggle = $('#tableToggle');
const tableWrap = $('#tableWrap');
const errorBanner = $('#errorBanner');
const errorMessage = $('#errorMessage');
const errorRetry = $('#errorRetry');
const liveAnnouncer = $('#liveAnnouncer');

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', init);

function init() {
  initTheme();
  initDatePicker();
  initTableToggle();
  loadLast24Hours();
}

// ===== Theme =====
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateChartsTheme();
  });
}

function getTheme() {
  return document.documentElement.getAttribute('data-theme');
}

function updateChartsTheme() {
  const fore = chartForeColor();
  const grid = chartGridColor();
  const tooltipTheme = chartTooltipTheme();
  const opts = {
    chart: { foreColor: fore },
    tooltip: { theme: tooltipTheme },
    grid: { borderColor: grid },
  };

  if (mainChart) mainChart.updateOptions(opts, false, false);
  if (supplyDemandChart) supplyDemandChart.updateOptions(opts, false, false);
  if (donutChart) {
    donutChart.updateOptions({
      chart: { foreColor: fore },
      tooltip: { theme: tooltipTheme },
      legend: { labels: { colors: fore } },
      stroke: { colors: [cssVar('--bg-card')] },
    }, false, false);
  }
}

// ===== Date Picker =====
function initDatePicker() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  flatpickrInstance = flatpickr(dateRangeInput, {
    mode: 'range',
    enableTime: true,
    time_24hr: true,
    dateFormat: 'd.m.Y H:i',
    locale: typeof flatpickr !== 'undefined' && flatpickr.l10ns && flatpickr.l10ns.ro ? 'ro' : 'default',
    defaultDate: [yesterday, now],
    maxDate: 'today',
  });

  loadDataBtn.addEventListener('click', () => {
    const dates = flatpickrInstance.selectedDates;
    if (dates.length === 2) {
      fetchData(dates[0], dates[1]);
    }
  });

  errorRetry.addEventListener('click', () => {
    if (lastFetchFrom && lastFetchTo) fetchData(lastFetchFrom, lastFetchTo);
  });
}

// ===== Table Toggle =====
function initTableToggle() {
  tableToggle.addEventListener('click', () => {
    const isOpen = tableWrap.classList.toggle('open');
    tableToggle.querySelector('.toggle-arrow').classList.toggle('rotated');
    tableToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });
}

// ===== Data Fetching =====
function loadLast24Hours() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  fetchData(yesterday, now);
}

function buildApiUrl(from, to) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${API_BASE}/${from.getFullYear()}/${pad(from.getMonth() + 1)}/${pad(from.getDate())}/${pad(from.getHours())}/${pad(from.getMinutes())}/${to.getFullYear()}/${pad(to.getMonth() + 1)}/${pad(to.getDate())}/${pad(to.getHours())}/${pad(to.getMinutes())}`;
}

async function fetchData(from, to) {
  // Cancel any in-flight request
  if (abortController) abortController.abort();
  abortController = new AbortController();
  lastFetchFrom = from;
  lastFetchTo = to;

  clearError();
  showLoading(true);
  loadDataBtn.disabled = true;
  announce('Se încarcă datele...');

  const url = buildApiUrl(from, to);

  try {
    const resp = await fetch(url, { signal: abortController.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    rawData = parseXml(text);

    if (rawData.length === 0) {
      showError('Nu s-au găsit date pentru intervalul selectat.');
      showLoading(false);
      loadDataBtn.disabled = false;
      return;
    }

    updateStats();
    renderMainChart();
    renderDonutChart();
    renderSupplyDemandChart();
    renderTable();
  } catch (err) {
    if (err.name === 'AbortError') return; // Intentional cancellation
    console.error('Fetch error:', err);
    showError('Eroare la încărcarea datelor. Verificați conexiunea.', true);
    announce('Eroare la încărcarea datelor.');
  } finally {
    showLoading(false);
    loadDataBtn.disabled = false;
  }
}

// ===== Error Banner =====
function showError(msg, retryable = false) {
  errorMessage.textContent = msg;
  errorRetry.hidden = !retryable;
  errorBanner.hidden = false;
}

function clearError() {
  errorBanner.hidden = true;
}

function announce(msg) {
  // Briefly clear then set to ensure re-announcement if same message
  liveAnnouncer.textContent = '';
  requestAnimationFrame(() => { liveAnnouncer.textContent = msg; });
}

function parseXml(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');

  // Parse timestamps from <series><value xid="N">datetime</value>
  const seriesValues = doc.querySelectorAll('series > value');
  const timestamps = {};
  seriesValues.forEach(v => {
    const xid = v.getAttribute('xid');
    const raw = v.textContent.trim(); // "2026-03-10 14:08:43"
    if (raw) {
      timestamps[xid] = new Date(raw.replace(' ', 'T')).getTime();
    }
  });

  const xids = Object.keys(timestamps).sort((a, b) => timestamps[a] - timestamps[b]);
  if (xids.length === 0) return [];

  // Initialize data rows keyed by xid
  const rowMap = {};
  xids.forEach(xid => {
    rowMap[xid] = { _timestamp: timestamps[xid] };
  });

  // Parse each <graph title="..."> and its <value xid="N">
  const graphs = doc.querySelectorAll('graphs > graph');
  graphs.forEach(graph => {
    const rawTitle = graph.getAttribute('title');
    const key = normalizeTitle(rawTitle);
    const values = graph.querySelectorAll('value');
    values.forEach(v => {
      const xid = v.getAttribute('xid');
      if (rowMap[xid]) {
        const num = parseFloat(v.textContent.trim());
        rowMap[xid][key] = isNaN(num) ? 0 : num;
      }
    });
  });

  return xids.map(xid => rowMap[xid]);
}

// ===== Stats =====
function updateStats() {
  if (rawData.length === 0) return;
  const latest = rawData[rawData.length - 1];

  const production = latest[PRODUCTION_KEY] || 0;
  const consumption = latest[CONSUMPTION_KEY] || 0;
  const sold = latest['Sold'] || 0;

  const renewableTotal = RENEWABLE_KEYS.reduce((sum, k) => sum + (latest[k] || 0), 0);
  const totalSources = SOURCE_KEYS.reduce((sum, k) => sum + Math.max(0, latest[k] || 0), 0);
  const renewablePct = totalSources > 0 ? (renewableTotal / totalSources * 100) : 0;

  animateValue('statProduction', production);
  animateValue('statConsumption', consumption);
  animateValue('statRenewables', renewablePct, 1);
  animateValue('statExport', sold);

  // Color the export/import card based on flow direction
  const exportCard = document.querySelector('.stat-card:nth-child(4)');
  exportCard.classList.toggle('is-import',    sold < 0);
  exportCard.classList.toggle('is-exporting', sold >= 0);

  // Announce summary to screen readers after animation settles
  setTimeout(() => {
    const fmt = (n, d = 0) => n.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    announce(
      `Date încărcate. Producție: ${fmt(production)} MW, Consum: ${fmt(consumption)} MW, ` +
      `Regenerabile: ${fmt(renewablePct, 1)}%, Sold export: ${fmt(sold)} MW.`
    );
  }, 900);
}

function animateValue(id, target, decimals = 0) {
  const el = document.getElementById(id);
  const fmt = (n) => n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = fmt(target);
    return;
  }

  const start = parseFloat(el.textContent) || 0;
  const duration = 800;
  const startTime = performance.now();

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = start + (target - start) * eased;
    el.textContent = fmt(current);
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ===== Loading =====
function showLoading(visible) {
  loadingOverlay.classList.toggle('visible', visible);
  loadingOverlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

// ===== Charts Common =====
// Read directly from CSS tokens — no hardcoded values.
function chartForeColor()    { return cssVar('--text-muted'); }
function chartGridColor()    { return cssVar('--border'); }
function chartTooltipTheme() { return getTheme() === 'dark' ? 'dark' : 'light'; }

// ===== Main Stacked Area Chart =====
function renderMainChart() {
  const timestamps = rawData.map(d => d._timestamp);
  const series = SOURCE_KEYS.map(key => ({
    name: SERIES_CONFIG[key].label,
    data: rawData.map(d => Math.max(0, d[key] || 0)),
  }));

  // Reuse existing instance — just push new data and x-axis
  if (mainChart) {
    mainChart.updateOptions({ series, xaxis: { categories: timestamps } }, false, true);
    return;
  }

  const container = $('#mainChart');
  container.innerHTML = '';
  // Batch CSS var reads — avoids repeated getComputedStyle calls
  const fore = chartForeColor();
  const grid = chartGridColor();
  const colors = SOURCE_KEYS.map(key => seriesColor(key));

  mainChart = new ApexCharts(container, {
    chart: {
      type: 'area',
      height: 400,
      stacked: true,
      foreColor: fore,
      toolbar: { show: true, tools: { download: true, selection: true, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } },
      zoom: { enabled: true },
      animations: { enabled: true, easing: 'easeinout', speed: 600 },
      fontFamily: 'Inter, sans-serif',
    },
    series,
    colors,
    xaxis: {
      type: 'datetime',
      categories: timestamps,
      labels: { datetimeUTC: false, format: 'HH:mm' },
      axisBorder: { color: grid },
      axisTicks: { color: grid },
    },
    yaxis: {
      title: { text: 'MW' },
      labels: { formatter: (v) => v.toFixed(0) },
    },
    grid: { borderColor: grid, strokeDashArray: 3 },
    stroke: { curve: 'smooth', width: 1 },
    fill: { type: 'solid', opacity: 0.7 },
    tooltip: {
      theme: chartTooltipTheme(),
      x: { format: 'dd MMM HH:mm' },
      y: { formatter: (v) => v.toFixed(0) + ' MW' },
    },
    legend: { position: 'top', horizontalAlign: 'center', fontSize: '12px' },
    dataLabels: { enabled: false },
  });
  mainChart.render();
}

// ===== Donut Chart =====
function renderDonutChart() {
  const latest = rawData[rawData.length - 1];
  const labels = [], values = [], colors = [];

  SOURCE_KEYS.forEach(key => {
    const val = Math.max(0, latest[key] || 0);
    if (val > 0) {
      labels.push(SERIES_CONFIG[key].label);
      values.push(val);
      colors.push(seriesColor(key));
    }
  });

  // Reuse existing instance — update labels/colors then series
  if (donutChart) {
    donutChart.updateOptions({ labels, colors }, false, false);
    donutChart.updateSeries(values, true);
    return;
  }

  const container = $('#donutChart');
  container.innerHTML = '';
  // Batch CSS var reads for initial render
  const fore = chartForeColor();

  donutChart = new ApexCharts(container, {
    chart: {
      type: 'donut',
      height: 380,
      foreColor: fore,
      fontFamily: 'Inter, sans-serif',
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
    },
    series: values,
    labels,
    colors,
    stroke: { colors: [cssVar('--bg-card')], width: 2 },
    plotOptions: {
      pie: {
        donut: {
          size: '55%',
          labels: {
            show: true,
            name: { show: true, fontSize: '14px', color: fore },
            value: { show: true, fontSize: '20px', fontWeight: 700, color: fore, formatter: (v) => parseFloat(v).toFixed(0) + ' MW' },
            total: {
              show: true,
              label: 'Total',
              color: fore,
              formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0).toFixed(0) + ' MW',
            },
          },
        },
      },
    },
    legend: { position: 'bottom', fontSize: '12px', labels: { colors: fore } },
    tooltip: { theme: chartTooltipTheme(), y: { formatter: (v) => v.toFixed(0) + ' MW' } },
    dataLabels: {
      enabled: true,
      formatter: (val) => val.toFixed(1) + '%',
      style: { fontSize: '11px', fontWeight: 600 },
      dropShadow: { enabled: false },
    },
  });
  donutChart.render();
}

// ===== Supply vs Demand Chart =====
function renderSupplyDemandChart() {
  const timestamps = rawData.map(d => d._timestamp);
  const series = [
    { name: 'Producție (debitată)', data: rawData.map(d => d[PRODUCTION_KEY] || 0) },
    { name: 'Consum (cerută)',      data: rawData.map(d => d[CONSUMPTION_KEY] || 0) },
  ];

  // Reuse existing instance — just push new data and x-axis
  if (supplyDemandChart) {
    supplyDemandChart.updateOptions({ series, xaxis: { categories: timestamps } }, false, true);
    return;
  }

  const container = $('#supplyDemandChart');
  container.innerHTML = '';
  // Batch CSS var reads for initial render
  const fore = chartForeColor();
  const grid = chartGridColor();

  supplyDemandChart = new ApexCharts(container, {
    chart: {
      type: 'area',
      height: 380,
      foreColor: fore,
      toolbar: { show: true },
      zoom: { enabled: true },
      animations: { enabled: true, easing: 'easeinout', speed: 600 },
      fontFamily: 'Inter, sans-serif',
    },
    series,
    colors: [seriesColor(PRODUCTION_KEY), seriesColor(CONSUMPTION_KEY)],
    xaxis: {
      type: 'datetime',
      categories: timestamps,
      labels: { datetimeUTC: false, format: 'HH:mm' },
      axisBorder: { color: grid },
      axisTicks: { color: grid },
    },
    yaxis: {
      title: { text: 'MW' },
      labels: { formatter: (v) => v.toFixed(0) },
      min: (min) => Math.floor(min * 0.95),
    },
    grid: { borderColor: grid, strokeDashArray: 3 },
    stroke: { curve: 'smooth', width: 3 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, type: 'vertical', opacityFrom: 0.25, opacityTo: 0.02 },
    },
    tooltip: {
      theme: chartTooltipTheme(),
      x: { format: 'dd MMM HH:mm' },
      y: { formatter: (v) => v.toFixed(0) + ' MW' },
    },
    legend: { position: 'top', fontSize: '12px' },
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 5 } },
  });
  supplyDemandChart.render();
}

// ===== Data Table =====

// Update sort indicators on existing <th> elements without rebuilding the header.
// Only re-renders the tbody — called on every sort interaction.
function sortTable() {
  $('#tableHeader').querySelectorAll('th').forEach(th => {
    const col = th.getAttribute('data-col');
    const active = sortColumn === col;
    th.className = active ? (sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
    th.setAttribute('aria-sort', active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
  });
  renderTableBody();
}

// Renders only the <tbody> rows. Called by renderTable() and sortTable().
function renderTableBody() {
  let sorted = [...rawData];
  if (sortColumn) {
    sorted.sort((a, b) => {
      const va = sortColumn === 'Ora' ? a._timestamp : (a[sortColumn] ?? 0);
      const vb = sortColumn === 'Ora' ? b._timestamp : (b[sortColumn] ?? 0);
      if (va < vb) return sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  $('#tableBody').innerHTML = sorted.map(row => {
    const cells = TABLE_COLUMNS.map(col => {
      if (col === 'Ora') {
        const d = new Date(row._timestamp);
        const pad = n => String(n).padStart(2, '0');
        return `<td>${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}</td>`;
      }
      const val = row[col];
      return `<td>${val != null ? val.toFixed(0) : '—'}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  }).join('');
}

// Full table render — called once per data load.
// Rebuilds the header (with event listeners) then delegates to renderTableBody().
function renderTable() {
  const thead = $('#tableHeader');

  thead.innerHTML = TABLE_COLUMNS.map(col => {
    const active = sortColumn === col;
    const cls = active ? (sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
    const ariaSort = active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th data-col="${col}" class="${cls}" aria-sort="${ariaSort}" tabindex="0">${TABLE_COLUMN_LABELS[col] || col}</th>`;
  }).join('');

  thead.querySelectorAll('th').forEach(th => {
    const handleSort = () => {
      const col = th.getAttribute('data-col');
      if (sortColumn === col) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = col;
        sortDirection = 'asc';
      }
      sortTable(); // only updates indicators + tbody, not the full header
    };
    th.addEventListener('click', handleSort);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(); }
    });
  });

  renderTableBody();
}
