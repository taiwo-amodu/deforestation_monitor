import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { FeatureGroup, LayersControl, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { EditControl } from 'react-leaflet-draw'

type LatLon = { lat: number; lon: number }

type AnalyzeResponse = {
  map_url: string
  hectares_impacted: number
  primary_location: { lat: number; lon: number }
  confidence_score: number
  tif_url?: string | null
  png_url?: string | null
}

/** Earth Engine tiles render above the basemap; fit map to ROI after each successful analyze. */
function MapAnalysisHelpers({
  roiPoints,
  zoomToRoiKey,
}: {
  roiPoints: LatLon[]
  zoomToRoiKey: string | null
}) {
  const map = useMap()

  useEffect(() => {
    const name = 'geeTiles'
    if (!map.getPane(name)) {
      map.createPane(name)
      const el = map.getPane(name)
      if (el) el.style.zIndex = '250'
    }
  }, [map])

  useEffect(() => {
    if (!zoomToRoiKey || roiPoints.length < 3) return
    const b = L.latLngBounds(roiPoints.map((p) => [p.lat, p.lon] as L.LatLngTuple))
    if (!b.isValid()) return
    map.fitBounds(b, { padding: [48, 48], maxZoom: 16, animate: true })
  }, [map, zoomToRoiKey, roiPoints])

  return null
}

function App() {
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''
  const analyzeUrl = apiBaseUrl
    ? `${apiBaseUrl.replace(/\/$/, '')}/analyze`
    : '/analyze'

  const currentYear = new Date().getFullYear()
  const availableYears = useMemo(() => {
    const years: number[] = []
    for (let y = 2017; y <= currentYear; y++) years.push(y)
    return years
  }, [currentYear])

  const [baselineYear, setBaselineYear] = useState<number>(2024)
  const [comparisonYear, setComparisonYear] = useState<number>(
    Math.min(2025, currentYear),
  )

  const [roiPoints, setRoiPoints] = useState<LatLon[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalyzeResponse | null>(null)

  const [progressOpen, setProgressOpen] = useState(false)
  const [progressStage, setProgressStage] = useState<string>('')
  const progressTimeoutsRef = useRef<number[]>([])

  const featureGroupRef = useRef<L.FeatureGroup>(null)

  function clearProgressTimeouts() {
    progressTimeoutsRef.current.forEach((t) => window.clearTimeout(t))
    progressTimeoutsRef.current = []
  }

  function startProgress() {
    clearProgressTimeouts()
    setProgressStage('Validating ROI...')
    setProgressOpen(true)

    const stages: Array<{ afterMs: number; text: string }> = [
      { afterMs: 900, text: 'Obtaining area of interest...' },
      { afterMs: 2100, text: 'Computing SAR (Sentinel-1 VH)...' },
      { afterMs: 3800, text: 'Computing NDVI (Sentinel-2)...' },
      { afterMs: 5600, text: 'Fusing masks (SAR drop AND NDVI drop)...' },
      { afterMs: 7500, text: 'Preparing deforestation visualization...' },
    ]

    for (const s of stages) {
      const t = window.setTimeout(() => setProgressStage(s.text), s.afterMs)
      progressTimeoutsRef.current.push(t)
    }
  }

  useEffect(() => {
    return () => clearProgressTimeouts()
  }, [])

  function extractPolygonLatLon(layer: L.Layer): LatLon[] {
    const anyLayer = layer as any
    if (!anyLayer?.getLatLngs) return []

    const latlngs = anyLayer.getLatLngs()
    // Polygon with holes comes as: [outerRing, hole1, hole2, ...]
    const ring: L.LatLng[] = Array.isArray(latlngs?.[0]) ? latlngs[0] : latlngs
    return (ring ?? []).map((p) => ({ lat: p.lat, lon: p.lng }))
  }

  function normalizeForRequest(points: LatLon[]): LatLon[] {
    // Ensure polygon is closed on the backend (backend also closes, but keep it tidy).
    if (points.length < 3) return points
    const first = points[0]
    const last = points[points.length - 1]
    const closed =
      first.lat === last.lat && first.lon === last.lon
        ? points
        : [...points, { lat: first.lat, lon: first.lon }]
    return closed
  }

  async function handleAnalyze() {
    setError(null)
    setLoading(true)
    setResult(null)
    startProgress()

    try {
      if (roiPoints.length < 3) {
        throw new Error('Draw a polygon ROI on the map first.')
      }

      const payload = {
        roi: normalizeForRequest(roiPoints),
        baseline_start: `${baselineYear}-01-01`,
        baseline_end: `${baselineYear}-12-31`,
        comparison_start: `${comparisonYear}-01-01`,
        comparison_end: `${comparisonYear}-12-31`,
      }

      const res = await fetch(analyzeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail ?? 'Analysis request failed.')
      }

      const json = (await res.json()) as AnalyzeResponse
      setResult(json)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
      clearProgressTimeouts()
      setProgressStage('Finalizing...')
      window.setTimeout(() => setProgressOpen(false), 450)
    }
  }

  function handleClearROI() {
    setError(null)
    setResult(null)
    setRoiPoints([])
    featureGroupRef.current?.clearLayers()
  }

  // Keep Leaflet defaults stable (avoids icon issues on some builds).
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  })

  return (
    <div className="mc-app">
      <aside className="mc-sidebar">
        <div className="mc-brand">
          <img
            className="mc-titleLogo"
            src="/logo-tree.png"
            alt=""
            width={48}
            height={48}
            decoding="async"
          />
          <h1 className="mc-title">Deforestation Monitor</h1>
        </div>
        <div className="mc-subtitle">
          SAR + NDVI fusion over an area you draw on the map.
        </div>

        <section className="mc-guide" aria-label="Quick guide">
          <div className="mc-guideTitle">Quick guide</div>
          <ul className="mc-guideList">
            <li>Pan/zoom to your area.</li>
            <li>Polygon tool on the map (top-right); double-click to close the shape.</li>
            <li>Pick Baseline year and Comparison year.</li>
            <li>Click Analyze — red overlay shows fused deforestation.</li>
            <li>Clear removes the shape; use layer control to switch basemap.</li>
          </ul>
        </section>

        <section className="mc-section">
          <div className="mc-controlsTitle">Deforestation Analysis</div>
          <div className="mc-row">
            <div className="mc-field">
              <div className="mc-label">Baseline Period</div>
              <select
                className="mc-select"
                value={baselineYear}
                onChange={(e) => setBaselineYear(Number(e.target.value))}
              >
                {availableYears.map((y) => (
                  <option value={y} key={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="mc-field">
              <div className="mc-label">Comparison Period</div>
              <select
                className="mc-select"
                value={comparisonYear}
                onChange={(e) => setComparisonYear(Number(e.target.value))}
              >
                {availableYears.map((y) => (
                  <option value={y} key={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mc-actions">
            <button
              className="mc-btn mc-btnPrimary"
              onClick={handleAnalyze}
              disabled={loading || roiPoints.length < 3}
            >
              {loading ? 'Analyzing...' : 'Analyze'}
            </button>
            <button
              className="mc-btn"
              onClick={handleClearROI}
              disabled={loading || roiPoints.length < 3}
            >
              Clear
            </button>
          </div>

          {error && <div className="mc-error">{error}</div>}
        </section>

        {result && (
          <section className="mc-card" aria-live="polite">
            <div className="mc-downloadSection mc-downloadSection--only">
                <div className="mc-downloadTitle">Download Deforestation Map</div>
                <div className="mc-downloadRow">
                  <button
                    type="button"
                    className="mc-downloadBtn"
                    onClick={() => result.png_url && window.open(result.png_url, '_blank')}
                    disabled={!result.png_url}
                    aria-disabled={!result.png_url}
                  >
                    PNG
                  </button>
                  <button
                    type="button"
                    className="mc-downloadBtn"
                    onClick={() => result.tif_url && window.open(result.tif_url, '_blank')}
                    disabled={!result.tif_url}
                    aria-disabled={!result.tif_url}
                  >
                    GeoTIFF
                  </button>
                </div>
                <div className="mc-downloadHint">
                  GeoTIFF/PNG exports are best-effort from Earth Engine (large ROIs may fail).
                </div>
              </div>
          </section>
        )}
      </aside>

      <div className="mc-mapWrap">
        <MapContainer
          className="mc-map"
          center={[0, 0]}
          zoom={2}
          scrollWheelZoom={true}
        >
          <MapAnalysisHelpers
            roiPoints={roiPoints}
            zoomToRoiKey={result?.map_url ?? null}
          />
          <LayersControl position="topright" collapsed={true}>
            <LayersControl.BaseLayer name="OSM Streets">
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Satellite" checked={true}>
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye"
              />
            </LayersControl.BaseLayer>
          </LayersControl>

          <FeatureGroup ref={featureGroupRef}>
            <EditControl
              position="topright"
              onCreated={(e) => {
                const latlon = extractPolygonLatLon(e.layer)
                setRoiPoints(latlon)
              }}
              onEdited={(e) => {
                const layers = e.layers
                ;(layers as any).eachLayer((layer: L.Layer) => {
                  const latlon = extractPolygonLatLon(layer)
                  setRoiPoints(latlon)
                })
              }}
              onDeleted={() => {
                setRoiPoints([])
              }}
              draw={{
                polygon: {
                  shapeOptions: {
                    color: '#00f5ff',
                    weight: 2,
                    fillColor: '#00f5ff',
                    fillOpacity: 0.08,
                  },
                },
                polyline: false,
                rectangle: false,
                circle: false,
                marker: false,
                circlemarker: false,
              }}
              edit={{
                edit: false,
                remove: true,
              }}
            />
          </FeatureGroup>

          {result?.map_url && (
            <TileLayer
              key={result.map_url}
              url={result.map_url}
              pane="geeTiles"
              opacity={0.78}
              maxZoom={22}
              maxNativeZoom={18}
            />
          )}
        </MapContainer>

        {roiPoints.length < 3 && (
          <p className="mc-drawHint">
            Click to start drawing area for deforestation analysis.
          </p>
        )}

        <div className="mc-legend">
          <div className="mc-legendRow">
            <div className="mc-legendSwatch" aria-hidden="true" />
            <div className="mc-legendCopy">
              <div>Red overlay = Deforested Area.</div>
              {result ? (
                <div className="mc-legendHectares">
                  Hectares Impacted: {result.hectares_impacted.toFixed(2)}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {progressOpen && (
        <div className="mc-modalOverlay" role="dialog" aria-modal="true">
          <div className="mc-modal">
            <div className="mc-spinner" aria-hidden="true" />
            <div className="mc-modalStage">{progressStage}</div>
            <div className="mc-modalHint">
              Earth Engine processing can take a few moments.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
