# SAR Deforestation Analyzer (FastAPI + Earth Engine)

## Setup

1. Create `backend/.env` (copy from `.env.example`) and set:
   - `GEE_SERVICE_ACCOUNT`
   - Provide the JSON key using one of:
     - `GEE_JSON_KEY_PATH` (local/dev file path), or
     - `GEE_JSON_KEY_CONTENT` (paste JSON into an env var), or
     - `GEE_JSON_KEY_B64` (base64 of the JSON key file; recommended for Render)

2. Install dependencies:
   - `pip install -r requirements.txt`

## Render (deploy)

In the Render dashboard (or use the repo `render.yaml` as a blueprint):

| Setting | Value |
|--------|--------|
| **Root Directory** | `backend` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT` |

`$PORT` is correct: Render injects it at runtime (do not hard-code a port). If Root Directory is empty, the start command fails because `app` is not on `PYTHONPATH`.

Set `GEE_SERVICE_ACCOUNT` and `GEE_JSON_KEY_B64` (or another key option) under **Environment**.

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

