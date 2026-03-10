# Romanian Electricity Grid Dashboard

A modern, interactive dashboard for monitoring Romania's national electricity grid in real time. Data is sourced from Transelectrica's public API.

![Dark theme](https://img.shields.io/badge/theme-dark%20%2F%20light-blue)

## Features

- **Live data** from the national grid (~15 min intervals)
- **Stacked area chart** showing the full energy mix over time
- **Donut chart** with the current generation breakdown by source
- **Supply vs. Demand** line chart highlighting surplus/deficit
- **Stat cards** with animated counters (production, consumption, renewables %, export)
- **Dark / Light theme** with localStorage persistence
- **Date range picker** for historical data
- **Sortable data table** (collapsible)
- Fully responsive — works on mobile

## Quick Start with Docker Compose

```yaml
services:
  ro-grid:
    image: ghcr.io/bogdanr/ro-grid:latest
    ports:
      - "3000:3000"
    restart: unless-stopped
```

```sh
docker compose up -d
```

Then open http://localhost:3000

## Run Locally (no Docker)

Requires Node.js 18+.

```sh
git clone git@github.com:bogdanr/ro-grid.git
cd ro-grid
node server.js
```

Open http://localhost:3000

## How It Works

The app is four files — `index.html`, `style.css`, `app.js`, and `server.js`. The Node server does two things:

1. Serves the static frontend
2. Proxies `/api/*` requests to Transelectrica's XML endpoint (to avoid browser CORS restrictions)

All chart rendering happens client-side using [ApexCharts](https://apexcharts.com/). No database, no build step.

## Energy Sources Tracked

| Source | Color |
|---|---|
| Nuclear | 🟢 Green |
| Hydro | 🔵 Blue |
| Wind | 🔵 Cyan |
| Solar | 🟡 Amber |
| Hydrocarbons | 🟣 Purple |
| Coal | ⚫ Gray |
| Biomass | 🟢 Lime |
| Storage | 🩷 Pink |

## License

See [LICENSE](LICENSE).
