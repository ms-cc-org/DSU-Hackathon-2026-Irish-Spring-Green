# CropShield

**County-level heat and soil-resilience decision support for Iowa corn and soybeans.**

CropShield helps agricultural extension specialists and soil-conservation partners decide where to prioritize outreach when heat and drought conditions threaten crop performance. It combines observed daily weather, weekly drought conditions, and county soil-water-storage capacity into an interactive county map and statewide report.

> **Current status:** CropShield calculates a transparent advisory-priority score from observed conditions through a defined advisory date. It is not a forecast of future weather or an exact crop-yield-loss prediction.

## The user

Our primary users are:

- Agricultural and crop extension specialists
- Soil-conservation and resilience-planning staff

They need to decide which Iowa counties should receive the earliest heat-stress outreach and which counties deserve longer-term soil-resilience planning attention.

## The problem

Heat and drought do not affect every county equally. Extension teams have limited time and need a defensible way to identify counties where observed heat, drought duration, and lower soil-water-storage capacity indicate greater need for outreach.

The challenge is to make those signals useful without overstating what county-level historical data can prove. A county score must show its inputs, its data date, and its limitations.

## Questions we answer

1. Which Iowa counties have the highest observed heat-and-moisture stress through the advisory date?
2. Which counties have experienced the most D2+ drought weeks or the most severe drought conditions so far?
3. Which counties have lower available soil-water storage and may have less buffering capacity during dry periods?
4. How do heat-risk and soil-resilience priorities differ for corn and soybeans?
5. Does the transparent weighted score improve upon a simple `days with tmax ≥ 35°C` baseline on unseen historical years? *(Validation is the next analysis step; the UI does not claim this result until it is measured.)*

## Directions selected

CropShield combines two hackathon directions:

| Direction | Decision supported | What CropShield provides |
|---|---|---|
| Heat-Stress Advisory | When and where to warn corn and soybean growers about heat | A county heat-and-moisture score built from weather, drought, and soil context |
| Soil & Crop Resilience Planning | Where to prioritize soil-resilience outreach before drought conditions intensify | A soil-water-storage map, low/medium/high storage groups, and historical drought-resilience analysis |

## Our solution

The React dashboard has two views:

- **Overview** — an interactive Iowa county map with Corn/Soybeans, season, heat-risk/soil-storage, and priority filters. Selecting a county shows its observed heat days, D2+ drought weeks, maximum drought severity, available soil-water storage, score, and recommended outreach level.
- **State Report** — separate statewide heat-stress and soil-resilience summaries, including the priority-county lists for each perspective.

The dashboard reads the generated advisory table at:

```text
web/public/data/county_heat_advisory.csv
```

## How the heat advisory works

The advisory uses only conditions observed through a crop-specific decision date:

| Crop | Season start | Advisory date |
|---|---|---|
| Corn | May 1 | July 15 |
| Soybeans | May 1 | August 1 |

For each Iowa county, crop, and year, the notebook calculates:

- `hot35_days_to_date` — days with county-average maximum temperature at or above 35°C
- `d2plus_weeks_to_date` — weeks where D2, D3, or D4 drought covered more than 1% of the county
- `max_drought_severity_to_date` — worst observed drought category on the project’s 0–5 scale
- `aws_100cm_mm` — static available soil-water storage in the top 100 cm
- `soil_storage_group` — Iowa storage tercile: `LOW`, `MEDIUM`, or `HIGH`

### Weighted score: `weighted_v1`

Each component is normalized to 0–1 and capped to prevent one measure from overwhelming the score.

```text
Heat exposure = min(hot35_days_to_date / 8, 1)

Drought duration = min(d2plus_weeks_to_date / 6, 1)

Drought severity = min(max(max_drought_severity_to_date − 2, 0) / 3, 1)

Drought stress = 0.65 × drought duration + 0.35 × drought severity

Soil vulnerability = 1.0 for LOW storage, 0.5 for MEDIUM, 0.0 for HIGH

Heat Risk Score = 100 × (
  0.60 × heat exposure
  + 0.30 × drought stress
  + 0.10 × soil vulnerability
)
```

| Score | Priority label | Suggested action |
|---:|---|---|
| 0–34 | Low | Continue routine monitoring |
| 35–59 | Watch | Monitor the next weekly update |
| 60–100 | High | Prioritize extension outreach |

These are transparent prototype weights, not learned model coefficients. The application displays the underlying inputs so users can understand why a county was flagged.

## Data sources

| Source | Used for |
|---|---|
| NOAA ACIS daily county weather | Daily maximum temperature and precipitation; calculates heat-day counts through the advisory date |
| U.S. Drought Monitor weekly county data | D2+ duration and maximum drought severity through the advisory date |
| USDA NRCS SSURGO | Static county available soil-water storage (`aws_100cm_mm`) |
| USDA NASS county yield data | Historical yield anomalies used for retrospective analysis and future validation |
| Iowa county GeoJSON | Dashboard map boundaries |

The included historical panels span 2000–2025. The source-pull scripts can refresh daily weather and weekly drought panels with 2026 observations.

## Run the project

### Prerequisites

- Python 3.11 or newer
- Node.js 20 or newer
- npm

### 1. Create and activate a Python environment

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows PowerShell:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

### 2. Generate the advisory data

Open and run every cell in:

```text
notebooks/build_heat_advisory_df.ipynb
```

You can launch Jupyter from the repository root with:

```bash
jupyter lab
```

The notebook writes both analysis outputs and the dashboard data file:

```text
data/derived/county_heat_advisory.csv
data/derived/county_heat_advisory.parquet
web/public/data/county_heat_advisory.csv
```

The final path is what the React app loads. Re-run the notebook whenever the formula or source data changes, then refresh the browser.

### 3. Run the React dashboard

In a second terminal:

```bash
cd web
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

To create a production build instead:

```bash
npm run build
```

### Optional: refresh 2026 weather and drought observations

The pull scripts use cached historical files and fetch missing 2026 source data after their `YEAR_END` setting is updated to `2026`.

```bash
./.venv/bin/python src/build/ACIS_data_pull.py
./.venv/bin/python src/build/USDM_data_pull.py
```

Then set the advisory notebook’s replay range to include 2026:

```python
REPLAY_YEARS = list(range(2000, 2027))
```

Run the notebook again. It marks 2026 rows as `data_mode = "current"`; 2000–2025 rows remain `historical_replay`.

## Project structure

```text
├── notebooks/
│   ├── build_heat_advisory_df.ipynb  # Creates county-level advisory rows
│   └── soil_resilience.ipynb         # Soil-storage and historical drought-resilience analysis
├── data/
│   ├── processed/acis/               # Daily weather panel
│   ├── processed/drought/            # Weekly Drought Monitor panel
│   ├── processed/soil/               # Static county soil properties
│   └── derived/                      # Generated advisory exports
├── src/build/
│   ├── ACIS_data_pull.py             # Refresh daily weather data
│   └── USDM_data_pull.py             # Refresh weekly drought data
└── web/
    ├── public/data/                  # Map boundaries and dashboard CSV
    └── src/                          # React + TypeScript dashboard
```

## Limitations and responsible use

- CropShield is a county-level planning tool, not a field-level agronomic diagnosis.
- The heat-risk score uses observed conditions through the advisory date. It does not predict future heat, drought, or exact yield loss.
- Soil-water storage is a static county context measure; it does not represent a field’s current soil moisture.
- The score is a transparent weighted prototype. It must be tested against held-out 2019–2025 outcomes before it is described as outperforming the `extreme_heat_days` baseline.
- Use the score alongside crop stage, irrigation access, local scouting, and extension expertise before recommending action to growers.

## Next validation step

To evaluate the heat rule, define a historical poor-yield outcome, choose formula thresholds on 2000–2018, freeze them, then compare the weighted score with the `hot35_days_to_date` baseline on 2019–2025. Report at least:

- Hit rate
- False-alarm rate
- Precision
- Number of county-crop-years flagged

This separation between observed advisory inputs and later yield outcomes prevents using end-of-season information in a current-season decision.


