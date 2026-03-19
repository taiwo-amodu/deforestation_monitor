from __future__ import annotations

from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool

from .gee import detect_deforestation, init_ee_from_env, roi_polygon_from_latlon
from .schemas import AnalyzeRequest, AnalyzeResponse


load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env", override=False)

app = FastAPI(title="SAR Deforestation Analyzer", version="0.1.0")

origins_env = os.getenv("CORS_ALLOW_ORIGINS")
if origins_env:
    origins = [o.strip() for o in origins_env.split(",") if o.strip()]
else:
    # Default to permissive CORS to make Vite/Vercel integrations work out-of-the-box.
    origins = ["*"]

allow_credentials = False if origins == ["*"] else True

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    # Initialize Earth Engine once.
    init_ee_from_env()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    try:
        roi = roi_polygon_from_latlon(
            [{"lat": p.lat, "lon": p.lon} for p in payload.roi]
        )

        result = await run_in_threadpool(
            detect_deforestation,
            roi,
            payload.baseline_start.isoformat(),
            payload.baseline_end.isoformat(),
            payload.comparison_start.isoformat(),
            payload.comparison_end.isoformat(),
        )
        return AnalyzeResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Earth Engine analysis failed: {e}")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

