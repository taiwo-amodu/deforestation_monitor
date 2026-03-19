# SAR Deforestation Analyzer (FastAPI + Earth Engine)

## Setup

1. Create `backend/.env` (copy from `.env.example`) and set:
   - `GEE_SERVICE_ACCOUNT`
   - `GEE_JSON_KEY_PATH`

2. Install dependencies:
   - `pip install -r requirements.txt`

## Run

From `backend/`:

```bash
uvicorn app.main:app --reload --port 8000
```

## API

`POST /analyze`

Request body:

```json
{
  "roi": [{ "lat": 0.0, "lon": 0.0 }, { "lat": 0.0, "lon": 0.1 }, { "lat": 0.1, "lon": 0.0 }],
  "baseline_start": "2024-01-01",
  "baseline_end": "2024-12-31",
  "comparison_start": "2025-01-01",
  "comparison_end": "2025-12-31"
}
```

Response includes:
- `map_url` (tile URL template to overlay in Leaflet)
- `hectares_impacted`
- `primary_location` (`lat`, `lon`)
- `confidence_score` (0-100)

