// ===== Configuration =====
const API_BASE = '/api/statistics/stream/xml';

const SERIES_CONFIG = {
  'Carbune':          { label: 'Cărbune',        color: '#6b7280', group: 'source' },
  'Hidrocarburi':     { label: 'Hidrocarburi',    color: '#8b5cf6', group: 'source' },
  'Hidro':            { label: 'Hidro',           color: '#3b82f6', group: 'source' },
  'Nuclear':          { label: 'Nuclear',         color: '#22c55e', group: 'source' },
  'Eolian':           { label: 'Eolian',          color: '#06b6d4', group: 'source' },
  'Fotovoltaic':      { label: 'Fotovoltaic',     color: '#f59e0b', group: 'source' },
  'Biomasa':          { label: 'Biomasă',         color: '#84cc16', group: 'source' },
  'Stocare':          { label: 'Stocare',         color: '#ec4899', group: 'source' },
  'Sold':             { label: 'Sold export',     color: '#ef4444', group: 'meta' },
  'Putere debitată':  { label: 'Producție',       color: '#8b5cf6', group: 'meta' },
  'Putere cerută':    { label: 'Consum',          color: '#f97316', group: 'meta' },
};

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

// ===== State =====
let rawData = [];
let mainChart = null;
let donutChart = null;
let supplyDemandChart = null;
let flatpickrInstance = null;
let sortColumn = null;
let sortDirection = 'asc';

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const themeToggle = $('#themeToggle');
const loadDataBtn = $('#loadData');
const dateRangeInput = $('#dateRange');
const loadingOverlay = $('#loadingOverlay');
const tableToggle = $('#tableToggle');
const tableWrap = $('#tableWrap');

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
    updateFlatpickrTheme();
  });
}

function getTheme() {
  return document.documentElement.getAttribute('data-theme');
}

function updateChartsTheme() {
  const isDark = getTheme() === 'dark';
  const opts = {
    chart: { foreColor: isDark ? '#94a3b8' : '#64748b' },
    tooltip: { theme: isDark ? 'dark' : 'light' },
    grid: { borderColor: isDark ? '#334155' : '#e2e8f0' },
  };

  if (mainChart) mainChart.updateOptions(opts, false, false);
  if (supplyDemandChart) supplyDemandChart.updateOptions(opts, false, false);
  if (donutChart) {
    donutChart.updateOptions({
      chart: { foreColor: isDark ? '#94a3b8' : '#64748b' },
      tooltip: { theme: isDark ? 'dark' : 'light' },
      legend: { labels: { colors: isDark ? '#94a3b8' : '#64748b' } },
      stroke: { colors: [isDark ? '#1e293b' : '#ffffff'] },
    }, false, false);
  }
}

function updateFlatpickrTheme() {
  // Flatpickr theme is handled via CSS overrides on [data-theme]
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
    maxDate: now,
  });

  loadDataBtn.addEventListener('click', () => {
    const dates = flatpickrInstance.selectedDates;
    if (dates.length === 2) {
      fetchData(dates[0], dates[1]);
    }
  });
}

// ===== Table Toggle =====
function initTableToggle() {
  tableToggle.addEventListener('click', () => {
    tableWrap.classList.toggle('open');
    tableToggle.querySelector('.toggle-arrow').classList.toggle('rotated');
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
  showLoading(true);
  const url = buildApiUrl(from, to);

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    rawData = parseXml(text);

    if (rawData.length === 0) {
      alert('Nu s-au găsit date pentru intervalul selectat.');
      showLoading(false);
      return;
    }

    updateStats();
    renderMainChart();
    renderDonutChart();
    renderSupplyDemandChart();
    renderTable();
  } catch (err) {
    console.error('Fetch error:', err);
    alert('Eroare la încărcarea datelor. Verificați conexiunea.');
  } finally {
    showLoading(false);
  }
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
}

function animateValue(id, target, decimals = 0) {
  const el = document.getElementById(id);
  const start = parseFloat(el.textContent) || 0;
  const duration = 800;
  const startTime = performance.now();

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = start + (target - start) * eased;
    el.textContent = current.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ===== Loading =====
function showLoading(visible) {
  loadingOverlay.classList.toggle('visible', visible);
}

// ===== Charts Common =====
function chartForeColor() {
  return getTheme() === 'dark' ? '#94a3b8' : '#64748b';
}

function chartGridColor() {
  return getTheme() === 'dark' ? '#334155' : '#e2e8f0';
}

function chartTooltipTheme() {
  return getTheme() === 'dark' ? 'dark' : 'light';
}

// ===== Main Stacked Area Chart =====
function renderMainChart() {
  const container = $('#mainChart');
  container.innerHTML = '';

  const timestamps = rawData.map(d => d._timestamp);
  const series = SOURCE_KEYS.map(key => ({
    name: SERIES_CONFIG[key].label,
    data: rawData.map(d => Math.max(0, d[key] || 0)),
  }));
  const colors = SOURCE_KEYS.map(key => SERIES_CONFIG[key].color);

  const options = {
    chart: {
      type: 'area',
      height: 400,
      stacked: true,
      foreColor: chartForeColor(),
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
      axisBorder: { color: chartGridColor() },
      axisTicks: { color: chartGridColor() },
    },
    yaxis: {
      title: { text: 'MW' },
      labels: { formatter: (v) => v.toFixed(0) },
    },
    grid: {
      borderColor: chartGridColor(),
      strokeDashArray: 3,
    },
    stroke: { curve: 'smooth', width: 1 },
    fill: { type: 'solid', opacity: 0.7 },
    tooltip: {
      theme: chartTooltipTheme(),
      x: { format: 'dd MMM HH:mm' },
      y: { formatter: (v) => v.toFixed(0) + ' MW' },
    },
    legend: {
      position: 'top',
      horizontalAlign: 'center',
      fontSize: '12px',
    },
    dataLabels: { enabled: false },
  };

  mainChart = new ApexCharts(container, options);
  mainChart.render();
}

// ===== Donut Chart =====
function renderDonutChart() {
  const container = $('#donutChart');
  container.innerHTML = '';

  const latest = rawData[rawData.length - 1];
  const labels = [];
  const values = [];
  const colors = [];

  SOURCE_KEYS.forEach(key => {
    const val = Math.max(0, latest[key] || 0);
    if (val > 0) {
      labels.push(SERIES_CONFIG[key].label);
      values.push(val);
      colors.push(SERIES_CONFIG[key].color);
    }
  });

  const isDark = getTheme() === 'dark';

  const options = {
    chart: {
      type: 'donut',
      height: 380,
      foreColor: chartForeColor(),
      fontFamily: 'Inter, sans-serif',
      animations: { enabled: true, easing: 'easeinout', speed: 800 },
    },
    series: values,
    labels,
    colors,
    stroke: { colors: [isDark ? '#1e293b' : '#ffffff'], width: 2 },
    plotOptions: {
      pie: {
        donut: {
          size: '55%',
          labels: {
            show: true,
            name: { show: true, fontSize: '14px', color: chartForeColor() },
            value: { show: true, fontSize: '20px', fontWeight: 700, color: chartForeColor(), formatter: (v) => parseFloat(v).toFixed(0) + ' MW' },
            total: {
              show: true,
              label: 'Total',
              color: chartForeColor(),
              formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0).toFixed(0) + ' MW',
            },
          },
        },
      },
    },
    legend: {
      position: 'bottom',
      fontSize: '12px',
      labels: { colors: chartForeColor() },
    },
    tooltip: {
      theme: chartTooltipTheme(),
      y: { formatter: (v) => v.toFixed(0) + ' MW' },
    },
    dataLabels: {
      enabled: true,
      formatter: (val) => val.toFixed(1) + '%',
      style: { fontSize: '11px', fontWeight: 600 },
      dropShadow: { enabled: false },
    },
  };

  donutChart = new ApexCharts(container, options);
  donutChart.render();
}

// ===== Supply vs Demand Chart =====
function renderSupplyDemandChart() {
  const container = $('#supplyDemandChart');
  container.innerHTML = '';

  const timestamps = rawData.map(d => d._timestamp);

  const options = {
    chart: {
      type: 'line',
      height: 380,
      foreColor: chartForeColor(),
      toolbar: { show: true },
      zoom: { enabled: true },
      animations: { enabled: true, easing: 'easeinout', speed: 600 },
      fontFamily: 'Inter, sans-serif',
    },
    series: [
      {
        name: 'Producție (debitată)',
        data: rawData.map(d => d[PRODUCTION_KEY] || 0),
      },
      {
        name: 'Consum (cerută)',
        data: rawData.map(d => d[CONSUMPTION_KEY] || 0),
      },
    ],
    colors: [SERIES_CONFIG[PRODUCTION_KEY].color, SERIES_CONFIG[CONSUMPTION_KEY].color],
    xaxis: {
      type: 'datetime',
      categories: timestamps,
      labels: { datetimeUTC: false, format: 'HH:mm' },
      axisBorder: { color: chartGridColor() },
      axisTicks: { color: chartGridColor() },
    },
    yaxis: {
      title: { text: 'MW' },
      labels: { formatter: (v) => v.toFixed(0) },
    },
    grid: {
      borderColor: chartGridColor(),
      strokeDashArray: 3,
    },
    stroke: { curve: 'smooth', width: 3 },
    fill: {
      type: 'gradient',
      gradient: {
        shade: 'dark',
        type: 'vertical',
        opacityFrom: 0.3,
        opacityTo: 0.05,
      },
    },
    tooltip: {
      theme: chartTooltipTheme(),
      x: { format: 'dd MMM HH:mm' },
      y: { formatter: (v) => v.toFixed(0) + ' MW' },
    },
    legend: {
      position: 'top',
      fontSize: '12px',
    },
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 5 } },
  };

  supplyDemandChart = new ApexCharts(container, options);
  supplyDemandChart.render();
}

// ===== Data Table =====
function renderTable() {
  const thead = $('#tableHeader');
  const tbody = $('#tableBody');

  const columns = ['Ora', ...SOURCE_KEYS, PRODUCTION_KEY, CONSUMPTION_KEY, 'Sold'];
  const columnLabels = {
    'Ora': 'Ora',
    ...Object.fromEntries(Object.entries(SERIES_CONFIG).map(([k, v]) => [k, v.label])),
  };

  // Header
  thead.innerHTML = columns.map((col, i) => {
    let cls = '';
    if (sortColumn === col) cls = sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc';
    return `<th data-col="${col}" class="${cls}">${columnLabels[col] || col}</th>`;
  }).join('');

  // Add sort handlers
  thead.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-col');
      if (sortColumn === col) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = col;
        sortDirection = 'asc';
      }
      renderTable();
    });
  });

  // Sort data
  let sorted = [...rawData];
  if (sortColumn) {
    sorted.sort((a, b) => {
      let va = a[sortColumn];
      let vb = b[sortColumn];
      if (sortColumn === 'Ora') {
        va = a._timestamp;
        vb = b._timestamp;
      }
      if (va < vb) return sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  // Body
  tbody.innerHTML = sorted.map(row => {
    const cells = columns.map(col => {
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
