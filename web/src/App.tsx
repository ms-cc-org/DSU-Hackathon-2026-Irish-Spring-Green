import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer } from 'react-leaflet'
import type { Layer, PathOptions } from 'leaflet'
import type { FeatureCollection, Polygon } from 'geojson'
import './App.css'

type CountyProperties = { fips: string; county_name: string; state_alpha: string }
type Crop = 'CORN' | 'SOYBEANS'
type MapMode = 'heat' | 'soil'
type PriorityFilter = 'all' | 'high' | 'watch'
type Page = 'overview' | 'state-report'
type County = CountyProperties & {
  crop: Crop; year: number; asOfDate: string; weatherThroughDate: string; droughtThroughDate: string; dataMode: string
  heatRisk: number; riskLevel: string; hotDays: number; droughtWeeks: number; maxDroughtSeverity: number
  waterStorage: number; soilStorageGroup: string; soilPriority: number; advisoryAction: string; formulaVersion: string
}

function splitCsvLine(line: string) {
  const values: string[] = []; let value = ''; let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1 } else quoted = !quoted
    } else if (character === ',' && !quoted) { values.push(value); value = '' } else value += character
  }
  values.push(value)
  return values
}

function parseAdvisoryCsv(csv: string): County[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/)
  const columns = splitCsvLine(header)
  return lines.filter(Boolean).map((line) => {
    const row = Object.fromEntries(columns.map((column, index) => [column, splitCsvLine(line)[index] ?? '']))
    return {
      fips: row.fips, county_name: row.county_name, state_alpha: row.state_alpha,
      crop: row.crop as Crop, year: Number(row.year), asOfDate: row.as_of_date,
      weatherThroughDate: row.weather_through_date, droughtThroughDate: row.drought_through_date, dataMode: row.data_mode,
      heatRisk: Number(row.heat_risk_score) / 100, riskLevel: row.risk_level,
      hotDays: Number(row.hot35_days_to_date), droughtWeeks: Number(row.d2plus_weeks_to_date),
      maxDroughtSeverity: Number(row.max_drought_severity_to_date), waterStorage: Number(row.aws_100cm_mm),
      soilStorageGroup: row.soil_storage_group, soilPriority: Number(row.soil_vulnerability_component),
      advisoryAction: row.advisory_action, formulaVersion: row.formula_version,
    }
  })
}

function scoreFor(county: County, mode: MapMode) { return mode === 'heat' ? county.heatRisk : county.soilPriority }
function riskColor(score: number) { return `hsl(${Math.max(8, 120 - score * 112)} 48% 43%)` }
function actionText(score: number) { return score >= .6 ? 'Prioritize extension outreach' : score >= .35 ? 'Monitor next weekly update' : 'Continue routine monitoring' }
function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="metric-card"><p>{label}</p><strong>{value}</strong><span>{detail}</span></article> }

function App() {
  const [advisoryRows, setAdvisoryRows] = useState<County[]>([])
  const [boundaries, setBoundaries] = useState<FeatureCollection<Polygon, CountyProperties> | null>(null)
  const [loadError, setLoadError] = useState('')
  const [selectedFips, setSelectedFips] = useState('19153')
  const [selectedYear, setSelectedYear] = useState(2026)
  const [searchTerm, setSearchTerm] = useState('')
  const [mapMode, setMapMode] = useState<MapMode>('heat')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [crop, setCrop] = useState<Crop>('CORN')
  const [page, setPage] = useState<Page>('overview')

  useEffect(() => {
    Promise.all([fetch('/data/counties.geojson'), fetch('/data/county_heat_advisory.csv')])
      .then(async ([mapResponse, advisoryResponse]) => {
        if (!mapResponse.ok || !advisoryResponse.ok) throw new Error('Could not load dashboard data.')
        const mapData = await mapResponse.json() as FeatureCollection<Polygon, CountyProperties>
        const advisoryData = await advisoryResponse.text()
        setBoundaries({ ...mapData, features: mapData.features.filter((feature) => feature.properties.state_alpha === 'IA') })
        setAdvisoryRows(parseAdvisoryCsv(advisoryData))
      })
      .catch((error) => { console.error(error); setLoadError('The advisory data could not be loaded.') })
  }, [])

  const availableYears = useMemo(() => [...new Set(advisoryRows.map((row) => row.year))].sort((a, b) => b - a), [advisoryRows])
  const counties = useMemo(() => advisoryRows.filter((row) => row.year === selectedYear && row.crop === crop), [advisoryRows, selectedYear, crop])
  useEffect(() => { if (availableYears.length && !availableYears.includes(selectedYear)) setSelectedYear(availableYears[0]) }, [availableYears, selectedYear])
  useEffect(() => { if (counties.length && !counties.some((county) => county.fips === selectedFips)) setSelectedFips(counties[0].fips) }, [counties, selectedFips])

  const selectedCounty = counties.find((county) => county.fips === selectedFips) ?? counties[0]
  const countyByFips = useMemo(() => new Map(counties.map((county) => [county.fips, county])), [counties])
  const filteredCounties = counties.filter((county) => {
    const score = scoreFor(county, mapMode)
    return priorityFilter === 'all' || (priorityFilter === 'high' ? score >= .6 : score >= .35 && score < .6)
  })
  const searchResults = counties.filter((county) => county.county_name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 5)
  const heatPriority = counties.filter((county) => county.riskLevel === 'HIGH').sort((a, b) => b.heatRisk - a.heatRisk)
  const soilPriority = counties.filter((county) => county.soilStorageGroup === 'LOW').sort((a, b) => a.waterStorage - b.waterStorage)
  const averageHeat = counties.length ? Math.round(counties.reduce((sum, county) => sum + county.heatRisk, 0) / counties.length * 100) : 0
  const averageSoil = counties.length ? Math.round(counties.reduce((sum, county) => sum + county.soilPriority, 0) / counties.length * 100) : 0
  const droughtCount = counties.filter((county) => county.droughtWeeks >= 3).length
  const lowStorageCount = soilPriority.length
  const medianStorage = counties.length ? [...counties].sort((a, b) => a.waterStorage - b.waterStorage)[Math.floor(counties.length / 2)].waterStorage : 0
  const stateRecord = counties[0]

  const countyStyle = (feature: any): PathOptions => {
    const county = countyByFips.get(feature?.properties?.fips)
    if (!county) return { fillColor: '#cbd5c0' }
    const score = scoreFor(county, mapMode)
    const shown = filteredCounties.some((visible) => visible.fips === county.fips)
    return { fillColor: riskColor(score), fillOpacity: shown ? (county.fips === selectedCounty?.fips ? .9 : .67) : .12, color: county.fips === selectedCounty?.fips ? '#183018' : '#f7f8f4', weight: county.fips === selectedCounty?.fips ? 2.5 : 1 }
  }

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand-mark">CS</div><div className="brand-copy"><strong>CropShield</strong><span>Decision support</span></div><nav aria-label="Main navigation"><button className={`nav-link ${page === 'overview' ? 'active' : ''}`} onClick={() => setPage('overview')}>Overview</button><button className={`nav-link ${page === 'state-report' ? 'active' : ''}`} onClick={() => setPage('state-report')}>State report</button></nav><div className="sidebar-note">{stateRecord?.dataMode === 'current' ? 'Current advisory' : 'Historical replay'}<br /><strong>{selectedYear || 'Loading'} season</strong></div></aside>
    <section className="dashboard">
      <header className="topbar"><div><p className="eyebrow">IOWA · {crop}</p><h1>{page === 'overview' ? 'Heat & Drought Priorities' : 'Iowa State Report'}</h1><p className="subtitle">{page === 'overview' ? 'Observed weather, drought, and soil signals for extension outreach.' : 'Separate heat-stress and soil-resilience priorities for statewide planning.'}</p></div><div className="freshness"><span>{stateRecord?.dataMode === 'current' ? 'Current advisory date' : 'Historical replay date'}</span><strong>{stateRecord?.asOfDate ?? 'Loading…'}</strong><small>Weather through {stateRecord?.weatherThroughDate ?? '—'} · drought through {stateRecord?.droughtThroughDate ?? '—'}</small></div></header>
      {loadError && <p className="load-error">{loadError}</p>}
      {page === 'overview' ? <Overview mapMode={mapMode} setMapMode={setMapMode} priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} crop={crop} setCrop={setCrop} selectedYear={selectedYear} setSelectedYear={setSelectedYear} availableYears={availableYears} boundaries={boundaries} countyByFips={countyByFips} countyStyle={countyStyle} selectedCounty={selectedCounty} selectedFips={selectedFips} setSelectedFips={setSelectedFips} searchTerm={searchTerm} setSearchTerm={setSearchTerm} searchResults={searchResults} /> : <StateReport heatPriority={heatPriority} soilPriority={soilPriority} averageHeat={averageHeat} averageSoil={averageSoil} droughtCount={droughtCount} lowStorageCount={lowStorageCount} medianStorage={medianStorage} formulaVersion={stateRecord?.formulaVersion ?? '—'} />}
    </section>
  </main>
}

type OverviewProps = { mapMode: MapMode; setMapMode: (mode: MapMode) => void; priorityFilter: PriorityFilter; setPriorityFilter: (filter: PriorityFilter) => void; crop: Crop; setCrop: (crop: Crop) => void; selectedYear: number; setSelectedYear: (year: number) => void; availableYears: number[]; boundaries: FeatureCollection<Polygon, CountyProperties> | null; countyByFips: Map<string, County>; countyStyle: (feature: any) => PathOptions; selectedCounty?: County; selectedFips: string; setSelectedFips: (fips: string) => void; searchTerm: string; setSearchTerm: (term: string) => void; searchResults: County[] }

function Overview(props: OverviewProps) {
  return <><section className="filter-bar" aria-label="Overview controls"><div className="field"><label>Crop</label><div className="segmented"><button className={props.crop === 'CORN' ? 'selected' : ''} onClick={() => props.setCrop('CORN')}>Corn</button><button className={props.crop === 'SOYBEANS' ? 'selected' : ''} onClick={() => props.setCrop('SOYBEANS')}>Soybeans</button></div></div><div className="field"><label htmlFor="season">Season</label><select id="season" value={props.selectedYear} onChange={(event) => props.setSelectedYear(Number(event.target.value))}>{props.availableYears.map((year) => <option key={year}>{year}</option>)}</select></div><div className="field"><label>Map lens</label><div className="segmented"><button className={props.mapMode === 'heat' ? 'selected' : ''} onClick={() => props.setMapMode('heat')}>Heat risk</button><button className={props.mapMode === 'soil' ? 'selected' : ''} onClick={() => props.setMapMode('soil')}>Soil storage</button></div></div><div className="field"><label>Priority filter</label><div className="segmented"><button className={props.priorityFilter === 'all' ? 'selected' : ''} onClick={() => props.setPriorityFilter('all')}>All</button><button className={props.priorityFilter === 'high' ? 'selected' : ''} onClick={() => props.setPriorityFilter('high')}>High</button><button className={props.priorityFilter === 'watch' ? 'selected' : ''} onClick={() => props.setPriorityFilter('watch')}>Watch</button></div></div></section>
    <section className="overview-search"><label htmlFor="county-search">Find a county on the map</label><div className="finder-controls"><input id="county-search" value={props.searchTerm} onChange={(event) => props.setSearchTerm(event.target.value)} placeholder="Search Iowa counties…" />{props.searchTerm && <div className="search-results">{props.searchResults.map((county) => <button key={county.fips} onClick={() => { props.setSelectedFips(county.fips); props.setSearchTerm('') }}>{county.county_name}</button>)}</div>}</div></section>
    <section className="overview-workspace"><article className="panel map-panel"><div className="panel-heading"><div><p className="eyebrow">PRIORITY MAP</p><h2>{props.mapMode === 'heat' ? 'County heat-risk outlook' : 'County soil-resilience priority'}</h2></div><div className="legend"><span>Lower</span><i /><span>Higher</span></div></div><div className="map-frame"><MapContainer center={[42.05, -93.5]} zoom={7} scrollWheelZoom={false} aria-label="Iowa county priority map"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{props.boundaries && <GeoJSON data={props.boundaries} key={`${props.mapMode}-${props.priorityFilter}-${props.selectedFips}-${props.selectedYear}-${props.crop}`} style={props.countyStyle} onEachFeature={(feature: any, layer: Layer) => { const county = props.countyByFips.get(feature.properties?.fips); if (!county) return; layer.bindTooltip(`${county.county_name}: ${Math.round(scoreFor(county, props.mapMode) * 100)}% ${props.mapMode === 'heat' ? 'heat risk' : 'soil priority'}`); layer.on('click', () => props.setSelectedFips(county.fips)) }} />}</MapContainer></div><p className="panel-footnote">Scores come from the loaded advisory CSV. Click a county to update its observed-condition details.</p></article><article className="panel county-snapshot">{props.selectedCounty ? <CountySnapshot county={props.selectedCounty} mapMode={props.mapMode} /> : <p>Loading county data…</p>}</article></section></>
}

function CountySnapshot({ county, mapMode }: { county: County; mapMode: MapMode }) {
  const score = scoreFor(county, mapMode)
  return <><div className="panel-heading"><div><p className="eyebrow">SELECTED COUNTY</p><h2>{county.county_name}</h2><span className="county-code">FIPS {county.fips} · {county.state_alpha}</span></div><span className="table-context">{county.riskLevel}</span></div><div className="risk-hero"><span>{mapMode === 'heat' ? 'Heat-risk score' : 'Soil-vulnerability score'}</span><strong>{Math.round(score * 100)}%</strong><div className="progress"><i style={{ width: `${Math.round(score * 100)}%` }} /></div><p>{mapMode === 'heat' ? 'Weighted score from observed heat, drought, and soil conditions.' : 'Static soil-water-storage vulnerability category.'}</p></div><div className="county-metrics"><MetricCard label="35°C days" value={String(county.hotDays)} detail="to advisory date" /><MetricCard label="D2+ drought" value={`${county.droughtWeeks} wk`} detail="to advisory date" /><MetricCard label="Max drought" value={String(county.maxDroughtSeverity)} detail="project scale: 0–5" /><MetricCard label="Soil storage" value={`${Math.round(county.waterStorage)} mm`} detail={`${county.soilStorageGroup} storage group`} /></div><div className="recommendation"><p className="eyebrow">SUGGESTED OUTREACH</p><strong>{county.advisoryAction || actionText(score)}</strong><p>Formula: {county.formulaVersion}. Use alongside local crop-stage and field observations.</p></div></>
}

function StateReport({ heatPriority, soilPriority, averageHeat, averageSoil, droughtCount, lowStorageCount, medianStorage, formulaVersion }: { heatPriority: County[]; soilPriority: County[]; averageHeat: number; averageSoil: number; droughtCount: number; lowStorageCount: number; medianStorage: number; formulaVersion: string }) {
  return <><section className="state-intro panel"><p className="eyebrow">STATEWIDE BRIEFING</p><h2>Two complementary outreach lenses</h2><p>Heat metrics use the calculated advisory score. Soil metrics use the available soil-water-storage grouping included in the same advisory data.</p></section><section className="report-section heat-report"><div className="report-heading"><div><p className="eyebrow">HEAT STRESS</p><h2>Near-term heat outreach</h2></div><span>Observed conditions</span></div><section className="summary-grid" aria-label="Heat stress statewide metrics"><MetricCard label="Priority counties" value={String(heatPriority.length)} detail="High weighted heat-risk score" /><MetricCard label="Average heat risk" value={`${averageHeat}%`} detail="Across Iowa counties" /><MetricCard label="Drought pressure" value={String(droughtCount)} detail="Counties with 3+ D2+ weeks" /><MetricCard label="Heat threshold" value="35°C" detail="Observed-day baseline" /></section><PriorityTable title="Heat-stress priority counties" counties={heatPriority} mode="heat" /></section><section className="report-section soil-report"><div className="report-heading"><div><p className="eyebrow">SOIL RESILIENCE</p><h2>Soil-water-storage context</h2></div><span>Static soil context</span></div><section className="summary-grid" aria-label="Soil resilience statewide metrics"><MetricCard label="Low-storage counties" value={String(lowStorageCount)} detail="Lowest storage tercile" /><MetricCard label="Average vulnerability" value={`${averageSoil}%`} detail="Low / medium / high group score" /><MetricCard label="Median soil storage" value={`${Math.round(medianStorage)} mm`} detail="Available water, 0–100 cm" /><MetricCard label="Drought pressure" value={String(droughtCount)} detail="Counties with 3+ D2+ weeks" /></section><PriorityTable title="Low soil-water-storage counties" counties={soilPriority} mode="soil" /></section><section className="method-strip"><div><p className="eyebrow">FORMULA STATUS</p><strong>Transparent weighted advisory score</strong></div><div><span>Heat weight</span><strong>60%</strong></div><div><span>Drought weight</span><strong>30%</strong></div><div><span>Soil weight</span><strong>10%</strong></div><p>Formula version: {formulaVersion}. Historical validation should compare this rule against the ≥35°C-days baseline.</p></section></>
}

function PriorityTable({ title, counties, mode }: { title: string; counties: County[]; mode: MapMode }) {
  return <article className="panel priority-table"><div className="panel-heading"><h3>{title}</h3><span className="table-context">Top {Math.min(counties.length, 8)}</span></div><div className="table-wrap"><table><thead><tr><th>Rank</th><th>County</th><th>Priority</th><th>35°C days</th><th>D2+ weeks</th><th>Soil storage</th></tr></thead><tbody>{counties.slice(0, 8).map((county, index) => <tr key={county.fips}><td>{index + 1}</td><td><strong>{county.county_name}</strong></td><td><span className="score-dot" style={{ background: riskColor(scoreFor(county, mode)) }} />{Math.round(scoreFor(county, mode) * 100)}%</td><td>{county.hotDays}</td><td>{county.droughtWeeks}</td><td>{Math.round(county.waterStorage)} mm</td></tr>)}</tbody></table>{counties.length === 0 && <p className="empty-table">No counties meet this current priority threshold.</p>}</div></article>
}

export default App
