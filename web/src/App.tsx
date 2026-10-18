import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer } from 'react-leaflet'
import type { Layer, PathOptions } from 'leaflet'
import type { FeatureCollection, Polygon } from 'geojson'
import './App.css'

type CountyProperties = { fips: string; county_name: string; state_alpha: string }
type MapMode = 'heat' | 'soil'
type PriorityFilter = 'all' | 'high' | 'watch'
type County = CountyProperties & {
  crop: 'CORN' | 'SOYBEAN'; year: number; asOfDate: string; heatRisk: number; soilPriority: number
  hotDays: number; heatBurden: number; heatStreak: number; droughtWeeks: number; dryStreak: number; waterStorage: number
}

const DEMO_YEAR = 2023

function stableNumber(seed: string, label: string, min: number, max: number) {
  let hash = 0
  for (const character of `${seed}-${label}`) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return min + (hash % (max - min + 1))
}

function buildCounty(properties: CountyProperties): County {
  const waterStorage = stableNumber(properties.fips, 'storage', 75, 218)
  const heatRisk = Number((stableNumber(properties.fips, 'risk', 12, 91) / 100).toFixed(2))
  const droughtWeeks = stableNumber(properties.fips, 'drought', 0, 7)
  return {
    ...properties, crop: 'CORN', year: DEMO_YEAR, asOfDate: '2023-08-01', heatRisk,
    // Soil priority is a display placeholder: lower available water storage and longer drought raise priority.
    soilPriority: Math.min(.95, Number((((218 - waterStorage) / 143) * .72 + droughtWeeks / 7 * .28).toFixed(2))),
    hotDays: stableNumber(properties.fips, 'hot-days', 2, 15),
    heatBurden: Number((stableNumber(properties.fips, 'burden', 42, 254) / 10).toFixed(1)),
    heatStreak: stableNumber(properties.fips, 'streak', 1, 8), droughtWeeks,
    dryStreak: stableNumber(properties.fips, 'dry-streak', 4, 22), waterStorage,
  }
}

function scoreFor(county: County, mode: MapMode) { return mode === 'heat' ? county.heatRisk : county.soilPriority }
function riskColor(score: number) { return `hsl(${Math.max(8, 120 - score * 112)} 48% 43%)` }
function priorityLabel(score: number) { return score >= .7 ? 'High priority' : score >= .4 ? 'Watch' : 'Lower priority' }
function actionText(score: number) { return score >= .7 ? 'Contact growers this week.' : score >= .4 ? 'Monitor the next weekly update.' : 'Continue routine monitoring.' }

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric-card"><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>
}

function App() {
  const [counties, setCounties] = useState<County[]>([])
  const [boundaries, setBoundaries] = useState<FeatureCollection<Polygon, CountyProperties> | null>(null)
  const [selectedFips, setSelectedFips] = useState('19153')
  const [searchTerm, setSearchTerm] = useState('')
  const [mapMode, setMapMode] = useState<MapMode>('heat')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [crop, setCrop] = useState<'CORN' | 'SOYBEAN'>('CORN')

  useEffect(() => {
    const loadMapData = async () => {
    try {
      // 1. Fetch the static map boundaries
      const geoResponse = await fetch('/data/counties.geojson');
      const geoData: FeatureCollection<Polygon, CountyProperties> = await geoResponse.json();
      const iowaFeatures = geoData.features.filter((f) => f.properties.state_alpha === 'IA');
      setBoundaries({ ...geoData, features: iowaFeatures });

      // 2. Fetch the live predictions from your FastAPI backend
      const apiResponse = await fetch(`http://localhost:8000/api/counties?crop=${crop}&year=${DEMO_YEAR}`);
      const apiCounties: County[] = await apiResponse.json();
      
      // 3. Update the dashboard state with the real data
      setCounties(apiCounties);
      
    } catch (error) {
      console.error('Could not load county data:', error);
    }
  };

  loadMapData();
}, [crop]);

  const selectedCounty = counties.find((county) => county.fips === selectedFips) ?? counties[0]
  const countyByFips = useMemo(() => new Map(counties.map((county) => [county.fips, county])), [counties])
  const visibleCounties = counties.filter((county) => {
    const score = scoreFor(county, mapMode)
    return priorityFilter === 'all' || (priorityFilter === 'high' ? score >= .7 : score >= .4 && score < .7)
  })
  const topCounties = [...visibleCounties].sort((a, b) => scoreFor(b, mapMode) - scoreFor(a, mapMode)).slice(0, 6)
  const highCount = counties.filter((county) => county.heatRisk >= .7).length
  const averageRisk = counties.length ? Math.round(counties.reduce((total, county) => total + county.heatRisk, 0) / counties.length * 100) : 0
  const droughtCount = counties.filter((county) => county.droughtWeeks >= 3).length
  const lowStorageCount = counties.filter((county) => county.waterStorage < 125).length
  const searchResults = counties.filter((county) => county.county_name.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 5)

  const countyStyle = (feature: any): PathOptions => {
    const county = countyByFips.get(feature?.properties?.fips)
    if (!county) return { fillColor: '#cbd5c0' }
    const score = scoreFor(county, mapMode)
    const matchesFilter = priorityFilter === 'all' || (priorityFilter === 'high' ? score >= .7 : score >= .4 && score < .7)
    return { fillColor: riskColor(score), fillOpacity: matchesFilter ? (county.fips === selectedCounty?.fips ? .9 : .67) : .12, color: county.fips === selectedCounty?.fips ? '#183018' : '#f7f8f4', weight: county.fips === selectedCounty?.fips ? 2.5 : 1 }
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand-mark">CS</div><div className="brand-copy"><strong>CropShield</strong><span>Decision support</span></div>
      <nav aria-label="Main navigation"><a className="nav-link active" href="#overview">Overview</a><a className="nav-link" href="#priority-map">Priority map</a><a className="nav-link" href="#county-report">County report</a><a className="nav-link" href="#method">Method</a></nav>
      <div className="sidebar-note">Historical replay<br /><strong>2023 season</strong></div>
    </aside>

    <section className="dashboard" id="overview">
      <header className="topbar">
        <div><p className="eyebrow">IOWA · {crop}</p><h1>Heat &amp; Drought Priorities</h1><p className="subtitle">Identify where extension outreach can have the greatest impact.</p></div>
        <div className="freshness"><span>Advisory / replay date</span><strong>August 1, 2023</strong><small>Demo data · not a live advisory</small></div>
      </header>

      <section className="filter-bar" aria-label="Overview controls">
        <div className="field"><label htmlFor="crop">Crop</label><select id="crop" value={crop} onChange={(event) => setCrop(event.target.value as 'CORN' | 'SOYBEAN')}><option>CORN</option><option>SOYBEAN</option></select></div>
        <div className="field"><label>Map lens</label><div className="segmented"><button className={mapMode === 'heat' ? 'selected' : ''} onClick={() => setMapMode('heat')}>Heat risk</button><button className={mapMode === 'soil' ? 'selected' : ''} onClick={() => setMapMode('soil')}>Soil storage</button></div></div>
        <div className="field"><label>Priority filter</label><div className="segmented"><button className={priorityFilter === 'all' ? 'selected' : ''} onClick={() => setPriorityFilter('all')}>All</button><button className={priorityFilter === 'high' ? 'selected' : ''} onClick={() => setPriorityFilter('high')}>High</button><button className={priorityFilter === 'watch' ? 'selected' : ''} onClick={() => setPriorityFilter('watch')}>Watch</button></div></div>
      </section>

      <section className="summary-grid" aria-label="Season summary">
        <MetricCard label="Priority counties" value={String(highCount)} detail="High heat-risk counties" />
        <MetricCard label="Average heat risk" value={`${averageRisk}%`} detail="Across Iowa counties" />
        <MetricCard label="Drought pressure" value={String(droughtCount)} detail="Counties with 3+ D2+ weeks" />
        <MetricCard label="Low soil storage" value={String(lowStorageCount)} detail="Below 125 mm at 100 cm" />
      </section>

      <section className="workspace">
        <article className="panel map-panel" id="priority-map">
          <div className="panel-heading"><div><p className="eyebrow">PRIORITY MAP</p><h2>{mapMode === 'heat' ? 'County heat-risk outlook' : 'County soil-resilience priority'}</h2></div><div className="legend"><span>Lower</span><i /><span>Higher</span></div></div>
          <div className="map-frame"><MapContainer center={[42.05, -93.5]} zoom={7} scrollWheelZoom={false} aria-label="Iowa county priority map"><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{boundaries && <GeoJSON data={boundaries} key={`${mapMode}-${priorityFilter}-${selectedCounty?.fips}`} style={countyStyle} onEachFeature={(feature: any, layer: Layer) => { const county = countyByFips.get(feature.properties?.fips); if (!county) return; layer.bindTooltip(`${county.county_name}: ${Math.round(scoreFor(county, mapMode) * 100)}% ${mapMode === 'heat' ? 'heat risk' : 'soil priority'}`); layer.on('click', () => setSelectedFips(county.fips)) }} />}</MapContainer></div>
          <p className="panel-footnote">Click a county to open its report. County scores are deterministic mock values until analytics outputs are connected.</p>
        </article>
        <article className="panel county-panel" id="county-report">{selectedCounty && <CountyReport county={selectedCounty} mapMode={mapMode} />}</article>
      </section>

      <section className="bottom-grid">
        <article className="panel priority-table"><div className="panel-heading"><div><p className="eyebrow">OUTREACH QUEUE</p><h2>Priority counties</h2></div><span className="table-context">{mapMode === 'heat' ? 'Heat risk' : 'Soil priority'}</span></div><div className="table-wrap"><table><thead><tr><th>Rank</th><th>County</th><th>Score</th><th>Drought</th><th>Soil storage</th><th>Action</th></tr></thead><tbody>{topCounties.map((county, index) => <tr key={county.fips} className={county.fips === selectedCounty?.fips ? 'current-row' : ''} onClick={() => setSelectedFips(county.fips)}><td>{index + 1}</td><td><strong>{county.county_name}</strong></td><td><span className="score-dot" style={{ background: riskColor(scoreFor(county, mapMode)) }} />{Math.round(scoreFor(county, mapMode) * 100)}%</td><td>{county.droughtWeeks} wk</td><td>{county.waterStorage} mm</td><td>{actionText(scoreFor(county, mapMode))}</td></tr>)}</tbody></table></div></article>
        <article className="panel finder-panel"><p className="eyebrow">COUNTY FINDER</p><h2>Explore a county</h2><p className="finder-copy">Search to jump to a county on the map and open its advisory summary.</p><div className="finder-controls"><label htmlFor="county-search">Search Iowa county</label><input id="county-search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Start typing a county name…" />{searchTerm && <div className="search-results">{searchResults.map((county) => <button key={county.fips} onClick={() => { setSelectedFips(county.fips); setSearchTerm('') }}>{county.county_name}</button>)}</div>}</div></article>
      </section>

      <section className="method-strip" id="method"><div><p className="eyebrow">METHOD &amp; VALIDATION</p><strong>Heat rule compared against the ≥35°C-days baseline</strong></div><div><span>Train</span><strong>2000–2018</strong></div><div><span>Held out</span><strong>2019–2025</strong></div><div><span>Report</span><strong>Hit rate + false alarms</strong></div><p>Connect your teammates’ actual evaluation values here; do not invent performance metrics.</p></section>
    </section>
  </main>
}

function CountyReport({ county, mapMode }: { county: County; mapMode: MapMode }) {
  const score = scoreFor(county, mapMode), percentage = Math.round(score * 100)
  const drivers = mapMode === 'heat' ? [`${county.hotDays} days at or above 35°C`, `${county.heatBurden} weighted heat-burden points`, `${county.droughtWeeks} weeks with D2+ drought`] : [`${county.waterStorage} mm available water storage`, `${county.droughtWeeks} weeks with D2+ drought`, `${county.dryStreak}-day maximum dry streak`]
  return <><div className="panel-heading"><div><p className="eyebrow">SELECTED COUNTY</p><h2>{county.county_name}</h2><span className="county-code">FIPS {county.fips} · {county.state_alpha}</span></div><span className={`risk-pill ${priorityLabel(score).toLowerCase().replace(' ', '-')}`}>{priorityLabel(score)}</span></div>
    <div className="risk-hero"><span>{mapMode === 'heat' ? 'Heat-risk score' : 'Soil-priority score'}</span><strong>{percentage}%</strong><div className="progress"><i style={{ width: `${percentage}%` }} /></div><p>{mapMode === 'heat' ? 'Use this score to prioritize a conversation—not as a stand-alone forecast.' : 'Higher priority indicates less soil-water buffering during drought conditions.'}</p></div>
    <section className="why-section"><p className="eyebrow">WHY THIS COUNTY?</p><ul>{drivers.map((driver) => <li key={driver}>{driver}</li>)}</ul></section>
    <div className="county-metrics"><MetricCard label="35°C days" value={String(county.hotDays)} detail="to advisory date" /><MetricCard label="Heat burden" value={String(county.heatBurden)} detail="weighted exposure" /><MetricCard label="D2+ drought" value={`${county.droughtWeeks} wk`} detail="to advisory date" /><MetricCard label="Soil storage" value={`${county.waterStorage} mm`} detail="0–100 cm context" /></div>
    <div className="recommendation"><p className="eyebrow">SUGGESTED OUTREACH</p><strong>{actionText(score)}</strong><p>Review crop stage, irrigation access, and local reports with growers before making a recommendation.</p></div>
  </>
}

export default App
