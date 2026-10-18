import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer } from 'react-leaflet'
import type { Layer, PathOptions } from 'leaflet'
import type { FeatureCollection, Polygon } from 'geojson'
import cornSoilPriorityCsv from '../../data/ia_corn_priority_map.csv?raw'
import soybeanSoilPriorityCsv from '../../data/ia_soybeans_priority_map-2.csv?raw'
import './App.css'

type CountyProperties = { fips: string; county_name: string; state_alpha: string }
type Crop = 'CORN' | 'SOYBEANS'
type PriorityFilter = 'all' | 'high' | 'watch'
type SoilPriorityFilter = 'all' | 'high' | 'medium' | 'lower'
type Page = 'overview' | 'soil-resilience' | 'state-report' | 'simulator'
type SimulatorInput = { hotDays: number; droughtWeeks: number; maxDroughtSeverity: number; soilGroupIndex: number }
type County = CountyProperties & {
  crop: Crop; year: number; asOfDate: string; weatherThroughDate: string; droughtThroughDate: string; dataMode: string
  heatRisk: number; riskLevel: string; hotDays: number; droughtWeeks: number; maxDroughtSeverity: number
  waterStorage: number; soilStorageGroup: string; soilPriority: number; advisoryAction: string; formulaVersion: string
}
type SoilPriorityCounty = CountyProperties & {
  crop: Crop; priority: string; waterStorage: number; meanDroughtAnomaly: number; droughtYears: number
  observations: number; lowStorage: boolean; largeDroughtLosses: boolean
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

function parseSoilPriorityCsv(csv: string, crop: Crop): SoilPriorityCounty[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/)
  const columns = splitCsvLine(header)
  return lines.filter(Boolean).map((line) => {
    const row = Object.fromEntries(columns.map((column, index) => [column, splitCsvLine(line)[index] ?? '']))
    return {
      fips: row.fips.padStart(5, '0'), county_name: row.county_name_x || row.county_name_y, state_alpha: row.state_alpha,
      crop, priority: row.priority, waterStorage: Number(row.aws_100cm_mm), meanDroughtAnomaly: Number(row.mean_drought_anomaly),
      droughtYears: Number(row.drought_years), observations: Number(row.observations),
      lowStorage: row.low_storage.toLowerCase() === 'true', largeDroughtLosses: row.large_drought_losses.toLowerCase() === 'true',
    }
  })
}

function riskColor(score: number) { return `hsl(${Math.max(8, 120 - score * 112)} 48% 43%)` }
function actionText(score: number) { return score >= .6 ? 'Prioritize extension outreach' : score >= .35 ? 'Monitor next weekly update' : 'Continue routine monitoring' }
function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="metric-card"><p>{label}</p><strong>{value}</strong><span>{detail}</span></article> }

const soilGroups = ['HIGH', 'MEDIUM', 'LOW'] as const

function soilPriorityFor(group: string) {
  return group === 'LOW' ? 1 : group === 'MEDIUM' ? .5 : 0
}

function riskLevelFor(score: number) {
  return score >= .6 ? 'HIGH' : score >= .35 ? 'WATCH' : 'LOW'
}

function soilPriorityKey(priority: string): Exclude<SoilPriorityFilter, 'all'> {
  if (priority.toLowerCase().startsWith('high')) return 'high'
  if (priority.toLowerCase().startsWith('medium')) return 'medium'
  return 'lower'
}

function soilPriorityColor(priority: string) {
  const key = soilPriorityKey(priority)
  return key === 'high' ? '#b74638' : key === 'medium' ? '#d6a03d' : '#5a934d'
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

function calculateScenarioScore(input: SimulatorInput) {
  const heatExposure = Math.min(input.hotDays / 8, 1)
  const droughtDuration = Math.min(input.droughtWeeks / 6, 1)
  const droughtSeverity = Math.min(Math.max(input.maxDroughtSeverity - 2, 0) / 3, 1)
  const droughtStress = .65 * droughtDuration + .35 * droughtSeverity
  const soilVulnerability = soilPriorityFor(soilGroups[input.soilGroupIndex])
  return .6 * heatExposure + .3 * droughtStress + .1 * soilVulnerability
}

function App() {
  const [advisoryRows, setAdvisoryRows] = useState<County[]>([])
  const [boundaries, setBoundaries] = useState<FeatureCollection<Polygon, CountyProperties> | null>(null)
  const [loadError, setLoadError] = useState('')
  const [selectedFips, setSelectedFips] = useState('19153')
  const [selectedYear, setSelectedYear] = useState(2026)
  const [searchTerm, setSearchTerm] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [soilPriorityFilter, setSoilPriorityFilter] = useState<SoilPriorityFilter>('all')
  const [crop, setCrop] = useState<Crop>('CORN')
  const [page, setPage] = useState<Page>('overview')
  const [simulatorInput, setSimulatorInput] = useState<SimulatorInput | null>(null)
  const [simulatedCounty, setSimulatedCounty] = useState<County | null>(null)

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

  const soilPriorityRows = useMemo(() => [
    ...parseSoilPriorityCsv(cornSoilPriorityCsv, 'CORN'),
    ...parseSoilPriorityCsv(soybeanSoilPriorityCsv, 'SOYBEANS'),
  ], [])
  const availableYears = useMemo(() => [...new Set(advisoryRows.map((row) => row.year))].sort((a, b) => b - a), [advisoryRows])
  const counties = useMemo(() => advisoryRows.filter((row) => row.year === selectedYear && row.crop === crop), [advisoryRows, selectedYear, crop])
  const soilCounties = useMemo(() => soilPriorityRows.filter((row) => row.crop === crop), [soilPriorityRows, crop])
  useEffect(() => { if (availableYears.length && !availableYears.includes(selectedYear)) setSelectedYear(availableYears[0]) }, [availableYears, selectedYear])
  useEffect(() => { if (counties.length && !counties.some((county) => county.fips === selectedFips)) setSelectedFips(counties[0].fips) }, [counties, selectedFips])

  const selectedCounty = counties.find((county) => county.fips === selectedFips) ?? counties[0]
  useEffect(() => {
    if (!selectedCounty) return
    setSimulatorInput({
      hotDays: selectedCounty.hotDays,
      droughtWeeks: selectedCounty.droughtWeeks,
      maxDroughtSeverity: selectedCounty.maxDroughtSeverity,
      soilGroupIndex: Math.max(0, soilGroups.indexOf(selectedCounty.soilStorageGroup as typeof soilGroups[number])),
    })
    setSimulatedCounty(null)
  }, [selectedCounty?.fips, selectedCounty?.crop, selectedCounty?.year])

  const countyByFips = useMemo(() => new Map(counties.map((county) => [county.fips, county])), [counties])
  const mapCountyByFips = useMemo(() => {
    const map = new Map(countyByFips)
    if (page === 'simulator' && simulatedCounty) map.set(simulatedCounty.fips, simulatedCounty)
    return map
  }, [countyByFips, page, simulatedCounty])
  const mapCounties = useMemo(() => counties.map((county) => mapCountyByFips.get(county.fips) ?? county), [counties, mapCountyByFips])
  const visibleCounty = page === 'simulator' && simulatedCounty?.fips === selectedCounty?.fips ? simulatedCounty : selectedCounty
  const filteredCounties = mapCounties.filter((county) => {
    const score = county.heatRisk
    return priorityFilter === 'all' || (priorityFilter === 'high' ? score >= .6 : score >= .35 && score < .6)
  })
  const searchResults = counties.filter((county) => county.county_name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 5)
  const heatPriority = counties.filter((county) => county.riskLevel === 'HIGH').sort((a, b) => b.heatRisk - a.heatRisk)
  const averageHeat = counties.length ? Math.round(counties.reduce((sum, county) => sum + county.heatRisk, 0) / counties.length * 100) : 0
  const droughtCount = counties.filter((county) => county.droughtWeeks >= 3).length
  const stateRecord = counties[0]

  const testScenario = () => {
    if (!selectedCounty || !simulatorInput) return
    const soilStorageGroup = soilGroups[simulatorInput.soilGroupIndex]
    const heatRisk = calculateScenarioScore(simulatorInput)
    setSimulatedCounty({
      ...selectedCounty,
      hotDays: simulatorInput.hotDays,
      droughtWeeks: simulatorInput.droughtWeeks,
      maxDroughtSeverity: simulatorInput.maxDroughtSeverity,
      soilStorageGroup,
      soilPriority: soilPriorityFor(soilStorageGroup),
      heatRisk,
      riskLevel: riskLevelFor(heatRisk),
      advisoryAction: actionText(heatRisk),
    })
  }

  const countyStyle = (feature: any): PathOptions => {
    const county = mapCountyByFips.get(feature?.properties?.fips)
    if (!county) return { fillColor: '#cbd5c0' }
    const score = county.heatRisk
    const shown = filteredCounties.some((visible) => visible.fips === county.fips)
    return { fillColor: riskColor(score), fillOpacity: shown ? (county.fips === selectedCounty?.fips ? .9 : .67) : .12, color: county.fips === selectedCounty?.fips ? '#183018' : '#f7f8f4', weight: county.fips === selectedCounty?.fips ? 2.5 : 1 }
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand-mark">CS</div><div className="brand-copy"><strong>CropShield</strong><span>Decision support</span></div>
      <nav aria-label="Main navigation">
        <button className={`nav-link ${page === 'overview' ? 'active' : ''}`} onClick={() => setPage('overview')}>Overview</button>
        <button className={`nav-link ${page === 'soil-resilience' ? 'active' : ''}`} onClick={() => setPage('soil-resilience')}>Soil Resilience</button>
        <button className={`nav-link ${page === 'simulator' ? 'active' : ''}`} onClick={() => setPage('simulator')}>Stress Simulator</button>
        <button className={`nav-link ${page === 'state-report' ? 'active' : ''}`} onClick={() => setPage('state-report')}>State Report</button>
      </nav>
      <div className="sidebar-note">{page === 'soil-resilience' ? <>Historical county context<br /><strong>Not year-specific</strong></> : <>{stateRecord?.dataMode === 'current' ? 'Current advisory' : 'Historical replay'}<br /><strong>{selectedYear || 'Loading'} season</strong></>}</div>
    </aside>
    <section className="dashboard">
      <header className="topbar"><div><p className="eyebrow">IOWA · {crop}</p><h1>{page === 'overview' ? 'Heat & Drought Priorities' : page === 'soil-resilience' ? 'Soil Resilience' : page === 'simulator' ? 'Stress Simulator' : 'Iowa State Report'}</h1><p className="subtitle">{page === 'overview' ? 'Observed weather, drought, and soil signals for extension outreach.' : page === 'soil-resilience' ? 'Crop-specific historical drought outcomes and soil-water-storage context for outreach planning.' : page === 'simulator' ? 'Test drought and soil scenarios without changing the underlying advisory record.' : 'Separate heat-stress and soil-resilience priorities for statewide planning.'}</p></div><div className="freshness">{page === 'soil-resilience' ? <><span>Data scope</span><strong>Static county profile</strong><small>Historical planning context · no seasonal forecast</small></> : <><span>{stateRecord?.dataMode === 'current' ? 'Current advisory date' : 'Historical replay date'}</span><strong>{stateRecord?.asOfDate ?? 'Loading…'}</strong><small>Weather through {stateRecord?.weatherThroughDate ?? '—'}</small></>}</div></header>
      {loadError && <p className="load-error">{loadError}</p>}
      {page === 'state-report' ? <StateReport crop={crop} setCrop={setCrop} heatPriority={heatPriority} averageHeat={averageHeat} droughtCount={droughtCount} soilCounties={soilCounties} formulaVersion={stateRecord?.formulaVersion ?? '—'} /> : page === 'soil-resilience' ? <SoilResilience counties={soilCounties} crop={crop} setCrop={setCrop} boundaries={boundaries} selectedFips={selectedFips} setSelectedFips={setSelectedFips} searchTerm={searchTerm} setSearchTerm={setSearchTerm} priorityFilter={soilPriorityFilter} setPriorityFilter={setSoilPriorityFilter} /> : <Overview priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} crop={crop} setCrop={setCrop} selectedYear={selectedYear} setSelectedYear={setSelectedYear} availableYears={availableYears} boundaries={boundaries} countyByFips={mapCountyByFips} countyStyle={countyStyle} selectedCounty={visibleCounty} selectedFips={selectedFips} setSelectedFips={setSelectedFips} searchTerm={searchTerm} setSearchTerm={setSearchTerm} searchResults={searchResults} simulator={page === 'simulator' && simulatorInput ? { input: simulatorInput, setInput: (input) => { setSimulatorInput(input); setSimulatedCounty(null) }, onTest: testScenario, tested: Boolean(simulatedCounty), observedCounty: selectedCounty } : undefined} />}
    </section>
  </main>
}

type SimulatorProps = { input: SimulatorInput; setInput: (input: SimulatorInput) => void; onTest: () => void; tested: boolean; observedCounty?: County }
type OverviewProps = { priorityFilter: PriorityFilter; setPriorityFilter: (filter: PriorityFilter) => void; crop: Crop; setCrop: (crop: Crop) => void; selectedYear: number; setSelectedYear: (year: number) => void; availableYears: number[]; boundaries: FeatureCollection<Polygon, CountyProperties> | null; countyByFips: Map<string, County>; countyStyle: (feature: any) => PathOptions; selectedCounty?: County; selectedFips: string; setSelectedFips: (fips: string) => void; searchTerm: string; setSearchTerm: (term: string) => void; searchResults: County[]; simulator?: SimulatorProps }

function Overview(props: OverviewProps) {
  return <><section className="filter-bar" aria-label="Overview controls"><div className="field"><label>Crop</label><div className="segmented"><button className={props.crop === 'CORN' ? 'selected' : ''} onClick={() => props.setCrop('CORN')}>Corn</button><button className={props.crop === 'SOYBEANS' ? 'selected' : ''} onClick={() => props.setCrop('SOYBEANS')}>Soybeans</button></div></div><div className="field"><label htmlFor="season">Season</label><select id="season" value={props.selectedYear} onChange={(event) => props.setSelectedYear(Number(event.target.value))}>{props.availableYears.map((year) => <option key={year}>{year}</option>)}</select></div><div className="field"><label>Priority filter</label><div className="segmented"><button className={props.priorityFilter === 'all' ? 'selected' : ''} onClick={() => props.setPriorityFilter('all')}>All</button><button className={props.priorityFilter === 'high' ? 'selected' : ''} onClick={() => props.setPriorityFilter('high')}>High</button><button className={props.priorityFilter === 'watch' ? 'selected' : ''} onClick={() => props.setPriorityFilter('watch')}>Watch</button></div></div></section>
    <section className="overview-search"><label htmlFor="county-search">Find a county on the map</label><div className="finder-controls"><input id="county-search" value={props.searchTerm} onChange={(event) => props.setSearchTerm(event.target.value)} placeholder="Search Iowa counties…" />{props.searchTerm && <div className="search-results">{props.searchResults.map((county) => <button key={county.fips} onClick={() => { props.setSelectedFips(county.fips); props.setSearchTerm('') }}>{county.county_name}</button>)}</div>}</div></section>
    <section className="overview-workspace"><article className="panel map-panel"><div className="panel-heading"><div><p className="eyebrow">{props.simulator ? 'SCENARIO MAP' : 'PRIORITY MAP'}</p><h2>County heat-risk outlook</h2></div><div className="legend"><span>Lower</span><i /><span>Higher</span></div></div><div className="map-frame"><MapContainer center={[42.05, -93.5]} zoom={7} scrollWheelZoom={false} aria-label="Iowa county heat-risk map"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{props.boundaries && <GeoJSON data={props.boundaries} key={`heat-${props.priorityFilter}-${props.selectedFips}-${props.selectedYear}-${props.crop}-${props.selectedCounty?.heatRisk ?? 0}`} style={props.countyStyle} onEachFeature={(feature: any, layer: Layer) => { const county = props.countyByFips.get(feature.properties?.fips); if (!county) return; layer.bindTooltip(`${county.county_name}: ${Math.round(county.heatRisk * 100)}% heat risk`); layer.on('click', () => props.setSelectedFips(county.fips)) }} />}</MapContainer></div><p className="panel-footnote">{props.simulator ? 'Test updates only the selected county’s scenario color; it does not change the loaded advisory data.' : 'Scores come from the loaded advisory CSV. Click a county to update its observed-condition details.'}</p></article><article className="panel county-snapshot">{props.selectedCounty ? <CountySnapshot county={props.selectedCounty} simulator={props.simulator} /> : <p>Loading county data…</p>}</article></section></>
}

function CountySnapshot({ county, simulator }: { county: County; simulator?: SimulatorProps }) {
  const score = county.heatRisk
  return <><div className="panel-heading"><div><p className="eyebrow">SELECTED COUNTY</p><h2>{county.county_name}</h2><span className="county-code">FIPS {county.fips} · {county.state_alpha}</span></div><span className="table-context">{county.riskLevel}</span></div><div className="risk-hero"><span>{simulator?.tested ? 'Tested heat-risk score' : 'Heat-risk score'}</span><strong>{Math.round(score * 100)}%</strong><div className="progress"><i style={{ width: `${Math.round(score * 100)}%` }} /></div><p>{simulator?.tested ? 'Scenario result calculated with the adjusted heat, drought, and soil inputs.' : 'Weighted score from observed heat, drought, and soil conditions.'}</p></div><div className="county-metrics"><MetricCard label="35°C days" value={String(county.hotDays)} detail="to advisory date" /><MetricCard label="D2+ drought" value={`${county.droughtWeeks} wk`} detail="to advisory date" /><MetricCard label="Max drought" value={String(county.maxDroughtSeverity)} detail="project scale: 0–5" /><MetricCard label="Soil storage" value={`${Math.round(county.waterStorage)} mm`} detail={`${county.soilStorageGroup} storage group`} /></div>{simulator && <SimulatorControls county={county} simulator={simulator} />}{!simulator && <div className="recommendation"><p className="eyebrow">SUGGESTED OUTREACH</p><strong>{county.advisoryAction || actionText(score)}</strong><p>Formula: {county.formulaVersion}. Use alongside local crop-stage and field observations.</p></div>}</>
}

function SimulatorControls({ county, simulator }: { county: County; simulator: SimulatorProps }) {
  const { input, setInput, onTest, tested, observedCounty } = simulator
  const observedRisk = observedCounty ? Math.round(observedCounty.heatRisk * 100) : Math.round(county.heatRisk * 100)
  const testedRisk = Math.round(county.heatRisk * 100)
  const currentSoilGroup = soilGroups[input.soilGroupIndex]
  return <section className="simulator-controls" aria-label="Stress simulator controls">
    <div className="simulator-heading"><div><p className="eyebrow">ADJUST SCENARIO</p><h3>Test heat, drought, and soil stress</h3></div><span>Scenario only</span></div>
    <p className="simulator-copy">Adjust the county’s observed conditions, then test the fixed 60% heat / 30% drought / 10% soil rule. This is a planning scenario, not a weather forecast.</p>
    <label className="range-control" htmlFor="hot-days"><span>35°C days <strong>{input.hotDays} days</strong></span><input id="hot-days" type="range" min="0" max="20" step="1" value={input.hotDays} onChange={(event) => setInput({ ...input, hotDays: Number(event.target.value) })} /><small>0 days <b>8+ reaches the formula cap</b> 20 days</small></label>
    <label className="range-control" htmlFor="drought-weeks"><span>D2+ drought weeks <strong>{input.droughtWeeks} wk</strong></span><input id="drought-weeks" type="range" min="0" max="12" step="1" value={input.droughtWeeks} onChange={(event) => setInput({ ...input, droughtWeeks: Number(event.target.value) })} /><small>0 weeks <b>6+ reaches the formula cap</b> 12 weeks</small></label>
    <label className="range-control" htmlFor="drought-severity"><span>Maximum drought severity <strong>{input.maxDroughtSeverity}</strong></span><input id="drought-severity" type="range" min="0" max="5" step="1" value={input.maxDroughtSeverity} onChange={(event) => setInput({ ...input, maxDroughtSeverity: Number(event.target.value) })} /><small>0 · None <b>Project scale</b> 5 · Exceptional</small></label>
    <label className="range-control" htmlFor="soil-group"><span>Soil-storage group <strong>{currentSoilGroup}</strong></span><input id="soil-group" type="range" min="0" max="2" step="1" value={input.soilGroupIndex} onChange={(event) => setInput({ ...input, soilGroupIndex: Number(event.target.value) })} /><small>High storage <b>Medium</b> Low storage</small></label>
    <button className="test-button" type="button" onClick={onTest}>Test</button>
    <div className={`scenario-result ${tested ? 'visible' : ''}`} aria-live="polite">{tested ? <><span>Observed {observedRisk}%</span><strong>Tested scenario: {testedRisk}%</strong><span>{county.hotDays} 35°C days · {county.riskLevel} priority · selected county recolored on the heat map</span></> : <span>Set scenario values, then select Test to update this county’s heat-risk score and map color.</span>}</div>
  </section>
}

type SoilResilienceProps = {
  counties: SoilPriorityCounty[]; crop: Crop; setCrop: (crop: Crop) => void
  boundaries: FeatureCollection<Polygon, CountyProperties> | null; selectedFips: string; setSelectedFips: (fips: string) => void
  searchTerm: string; setSearchTerm: (term: string) => void; priorityFilter: SoilPriorityFilter; setPriorityFilter: (filter: SoilPriorityFilter) => void
}

function SoilResilience(props: SoilResilienceProps) {
  const countyByFips = useMemo(() => new Map(props.counties.map((county) => [county.fips, county])), [props.counties])
  const selectedCounty = countyByFips.get(props.selectedFips) ?? props.counties[0]
  const visibleCounties = props.counties.filter((county) => props.priorityFilter === 'all' || soilPriorityKey(county.priority) === props.priorityFilter)
  const visibleFips = useMemo(() => new Set(visibleCounties.map((county) => county.fips)), [visibleCounties])
  const searchResults = props.counties.filter((county) => county.county_name.toLowerCase().includes(props.searchTerm.toLowerCase())).slice(0, 5)
  const highCount = props.counties.filter((county) => soilPriorityKey(county.priority) === 'high').length
  const mediumCount = props.counties.filter((county) => soilPriorityKey(county.priority) === 'medium').length
  const lowStorageCount = props.counties.filter((county) => county.lowStorage).length
  const lossCount = props.counties.filter((county) => county.largeDroughtLosses).length

  useEffect(() => {
    if (props.counties.length && !countyByFips.has(props.selectedFips)) props.setSelectedFips(props.counties[0].fips)
  }, [countyByFips, props.counties, props.selectedFips, props.setSelectedFips])

  const mapStyle = (feature: any): PathOptions => {
    const county = countyByFips.get(feature?.properties?.fips)
    if (!county) return { fillColor: '#cbd5c0' }
    const selected = county.fips === selectedCounty?.fips
    const shown = visibleFips.has(county.fips)
    return {
      fillColor: soilPriorityColor(county.priority),
      fillOpacity: shown ? (selected ? .9 : .68) : .12,
      color: selected ? '#183018' : '#f7f8f4',
      weight: selected ? 2.5 : 1,
    }
  }

  return <>
    <section className="filter-bar soil-filter-bar" aria-label="Soil resilience controls">
      <div className="field"><label>Crop</label><div className="segmented"><button className={props.crop === 'CORN' ? 'selected' : ''} onClick={() => props.setCrop('CORN')}>Corn</button><button className={props.crop === 'SOYBEANS' ? 'selected' : ''} onClick={() => props.setCrop('SOYBEANS')}>Soybeans</button></div></div>
      <div className="field"><label>Priority filter</label><div className="segmented"><button className={props.priorityFilter === 'all' ? 'selected' : ''} onClick={() => props.setPriorityFilter('all')}>All</button><button className={props.priorityFilter === 'high' ? 'selected' : ''} onClick={() => props.setPriorityFilter('high')}>High</button><button className={props.priorityFilter === 'medium' ? 'selected' : ''} onClick={() => props.setPriorityFilter('medium')}>Medium</button><button className={props.priorityFilter === 'lower' ? 'selected' : ''} onClick={() => props.setPriorityFilter('lower')}>Lower</button></div></div>
      <p className="static-data-note">Historical county context · not a yearly forecast or soil-risk score</p>
    </section>
    <section className="summary-grid soil-summary-grid" aria-label="Soil resilience historical metrics">
      <MetricCard label="High-priority counties" value={String(highCount)} detail="Crop-specific outreach label" />
      <MetricCard label="Medium-priority counties" value={String(mediumCount)} detail="Crop-specific outreach label" />
      <MetricCard label="Low-storage counties" value={String(lowStorageCount)} detail="Static soil-water-storage flag" />
      <MetricCard label="Large drought losses" value={String(lossCount)} detail="Historical pattern observed" />
    </section>
    <section className="overview-search"><label htmlFor="soil-county-search">Find a county on the map</label><div className="finder-controls"><input id="soil-county-search" value={props.searchTerm} onChange={(event) => props.setSearchTerm(event.target.value)} placeholder="Search Iowa counties…" />{props.searchTerm && <div className="search-results">{searchResults.map((county) => <button key={county.fips} onClick={() => { props.setSelectedFips(county.fips); props.setSearchTerm('') }}>{county.county_name}</button>)}</div>}</div></section>
    <section className="overview-workspace">
      <article className="panel map-panel"><div className="panel-heading"><div><p className="eyebrow">SOIL-RESILIENCE MAP</p><h2>County outreach priorities</h2></div><div className="priority-legend"><span><i className="high" />High</span><span><i className="medium" />Medium</span><span><i className="lower" />Lower</span></div></div><div className="map-frame"><MapContainer center={[42.05, -93.5]} zoom={7} scrollWheelZoom={false} aria-label="Iowa county soil-resilience priority map"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{props.boundaries && <GeoJSON data={props.boundaries} key={`soil-resilience-${props.crop}-${props.priorityFilter}-${props.selectedFips}`} style={mapStyle} onEachFeature={(feature: any, layer: Layer) => { const county = countyByFips.get(feature.properties?.fips); if (!county) return; layer.bindTooltip(`${county.county_name}: ${county.priority}`); layer.on('click', () => props.setSelectedFips(county.fips)) }} />}</MapContainer></div><p className="panel-footnote">County color comes directly from the selected crop’s historical <code>priority</code> label. It is not calculated from a soil-risk score.</p></article>
      <article className="panel county-snapshot">{selectedCounty ? <SoilCountySnapshot county={selectedCounty} /> : <p>Loading soil-resilience data…</p>}</article>
    </section>
  </>
}

function SoilCountySnapshot({ county }: { county: SoilPriorityCounty }) {
  const key = soilPriorityKey(county.priority)
  return <><div className="panel-heading"><div><p className="eyebrow">SELECTED COUNTY</p><h2>{county.county_name}</h2><span className="county-code">FIPS {county.fips} · {county.state_alpha}</span></div><span className={`soil-priority-pill ${key}`}>{county.priority}</span></div><div className={`soil-priority-hero ${key}`}><span>Soil-resilience outreach priority</span><strong>{county.priority}</strong><p>Assigned from the crop-specific historical priority map; this is not a model probability.</p></div><div className="county-metrics soil-county-metrics"><MetricCard label="Soil water storage" value={`${Math.round(county.waterStorage)} mm`} detail="Available water, 0–100 cm" /><MetricCard label="Mean drought anomaly" value={formatSignedPercent(county.meanDroughtAnomaly)} detail="Average yield anomaly in drought years" /><MetricCard label="Drought years" value={String(county.droughtYears)} detail="Historical drought-year records" /><MetricCard label="Large drought losses" value={county.largeDroughtLosses ? 'Yes' : 'No'} detail="Historical pattern observed" /><MetricCard label="Low soil storage" value={county.lowStorage ? 'Yes' : 'No'} detail="County storage flag" /><MetricCard label="Data coverage" value={`${county.observations} yr`} detail="Historical observations" /></div><div className="recommendation"><p className="eyebrow">HOW TO USE THIS</p><strong>{key === 'high' ? 'Prioritize pre-season soil-resilience outreach.' : key === 'medium' ? 'Include in planned drought-preparedness outreach.' : 'Maintain routine resilience outreach.'}</strong><p>Use alongside local field conditions, conservation goals, and extension specialist judgment.</p></div></>
}

function StateReport({ crop, setCrop, heatPriority, averageHeat, droughtCount, soilCounties, formulaVersion }: { crop: Crop; setCrop: (crop: Crop) => void; heatPriority: County[]; averageHeat: number; droughtCount: number; soilCounties: SoilPriorityCounty[]; formulaVersion: string }) {
  const highSoilCount = soilCounties.filter((county) => soilPriorityKey(county.priority) === 'high').length
  const mediumSoilCount = soilCounties.filter((county) => soilPriorityKey(county.priority) === 'medium').length
  const lowStorageCount = soilCounties.filter((county) => county.lowStorage).length
  const largeLossCount = soilCounties.filter((county) => county.largeDroughtLosses).length
  const medianStorage = soilCounties.length ? [...soilCounties].sort((a, b) => a.waterStorage - b.waterStorage)[Math.floor(soilCounties.length / 2)].waterStorage : 0

  return <><section className="state-intro panel"><p className="eyebrow">STATEWIDE BRIEFING</p><h2>Two complementary outreach lenses</h2><p>Heat metrics use the selected season’s advisory data. Soil-resilience priorities come directly from the crop-specific historical priority map—no soil score is calculated here.</p><div className="report-crop-control"><span>Report crop</span><div className="segmented"><button className={crop === 'CORN' ? 'selected' : ''} onClick={() => setCrop('CORN')}>Corn</button><button className={crop === 'SOYBEANS' ? 'selected' : ''} onClick={() => setCrop('SOYBEANS')}>Soybeans</button></div></div></section><section className="report-section heat-report"><div className="report-heading"><div><p className="eyebrow">HEAT STRESS</p><h2>Near-term heat outreach</h2></div><span>Observed conditions</span></div><section className="summary-grid" aria-label="Heat stress statewide metrics"><MetricCard label="Priority counties" value={String(heatPriority.length)} detail="High weighted heat-risk score" /><MetricCard label="Average heat risk" value={`${averageHeat}%`} detail="Across Iowa counties" /><MetricCard label="Drought pressure" value={String(droughtCount)} detail="Counties with 3+ D2+ weeks" /><MetricCard label="Heat threshold" value="35°C" detail="Observed-day baseline" /></section><PriorityTable title="Heat-stress priority counties" counties={heatPriority} /></section><section className="report-section soil-report"><div className="report-heading"><div><p className="eyebrow">SOIL RESILIENCE</p><h2>Historical resilience outreach</h2></div><span>Crop-specific historical data</span></div><section className="summary-grid" aria-label="Soil resilience statewide metrics"><MetricCard label="High-priority counties" value={String(highSoilCount)} detail="Source priority label" /><MetricCard label="Medium-priority counties" value={String(mediumSoilCount)} detail="Source priority label" /><MetricCard label="Low-storage counties" value={String(lowStorageCount)} detail="Static capacity flag" /><MetricCard label="Large drought losses" value={String(largeLossCount)} detail="Historical pattern observed" /></section><section className="soil-report-context"><span>State median water storage</span><strong>{Math.round(medianStorage)} mm</strong><p>Available water storage, 0–100 cm. Priority labels and historical drought outcomes are from the selected crop’s priority-map CSV.</p></section><SoilPriorityTable counties={soilCounties} /></section><section className="method-strip"><div><p className="eyebrow">METHODS STATUS</p><strong>Separate heat and soil-resilience evidence</strong></div><div><span>Heat formula</span><strong>60 / 30 / 10</strong></div><div><span>Soil priority</span><strong>Source label</strong></div><div><span>Soil score</span><strong>Not used</strong></div><p>Heat formula version: {formulaVersion}. Soil data is historical planning context, not a soil-risk model or seasonal forecast.</p></section></>
}

function PriorityTable({ title, counties }: { title: string; counties: County[] }) {
  return <article className="panel priority-table"><div className="panel-heading"><h3>{title}</h3><span className="table-context">Top {Math.min(counties.length, 8)}</span></div><div className="table-wrap"><table><thead><tr><th>Rank</th><th>County</th><th>Heat risk</th><th>35°C days</th><th>D2+ weeks</th><th>Soil storage</th></tr></thead><tbody>{counties.slice(0, 8).map((county, index) => <tr key={county.fips}><td>{index + 1}</td><td><strong>{county.county_name}</strong></td><td><span className="score-dot" style={{ background: riskColor(county.heatRisk) }} />{Math.round(county.heatRisk * 100)}%</td><td>{county.hotDays}</td><td>{county.droughtWeeks}</td><td>{Math.round(county.waterStorage)} mm</td></tr>)}</tbody></table>{counties.length === 0 && <p className="empty-table">No counties meet this current priority threshold.</p>}</div></article>
}

function SoilPriorityTable({ counties }: { counties: SoilPriorityCounty[] }) {
  const sorted = [...counties].sort((left, right) => {
    const priorityDifference = ['high', 'medium', 'lower'].indexOf(soilPriorityKey(left.priority)) - ['high', 'medium', 'lower'].indexOf(soilPriorityKey(right.priority))
    if (priorityDifference) return priorityDifference
    return Number(right.largeDroughtLosses) - Number(left.largeDroughtLosses)
  })
  return <article className="panel priority-table"><div className="panel-heading"><h3>Historical soil-resilience priorities</h3><span className="table-context">Top {Math.min(sorted.length, 8)}</span></div><div className="table-wrap"><table><thead><tr><th>Rank</th><th>County</th><th>Priority</th><th>Mean drought anomaly</th><th>Drought years</th><th>Water storage</th></tr></thead><tbody>{sorted.slice(0, 8).map((county, index) => <tr key={county.fips}><td>{index + 1}</td><td><strong>{county.county_name}</strong></td><td><span className="score-dot" style={{ background: soilPriorityColor(county.priority) }} />{county.priority}</td><td>{formatSignedPercent(county.meanDroughtAnomaly)}</td><td>{county.droughtYears}</td><td>{Math.round(county.waterStorage)} mm</td></tr>)}</tbody></table></div></article>
}

export default App
