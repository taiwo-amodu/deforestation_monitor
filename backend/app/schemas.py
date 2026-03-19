from __future__ import annotations

from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field, conlist


class LatLon(BaseModel):
    lat: float
    lon: float


class AnalyzeRequest(BaseModel):
    # Polygon ROI in WGS84 coordinates, specified as [{lat, lon}, ...]
    # Leaflet provides coordinates in [lat, lon], but we still transmit them
    # explicitly so the backend can convert to Earth Engine's [lon, lat].
    roi: conlist(LatLon, min_length=3)

    baseline_start: date
    baseline_end: date
    comparison_start: date
    comparison_end: date


class AnalyzeResponse(BaseModel):
    map_url: str = Field(..., description="Leaflet-compatible tile URL template from GEE")
    hectares_impacted: float
    primary_location: LatLon
    confidence_score: float
    tif_url: Optional[str] = Field(None, description="Best-effort GeoTIFF download URL from GEE")
    png_url: Optional[str] = Field(None, description="Best-effort PNG preview download URL from GEE")

