from __future__ import annotations

import base64
import json
import os
import tempfile
from typing import Any, Iterable
from pathlib import Path

import ee


_EE_INITIALIZED = False


def init_ee_from_env() -> None:
    """
    Initialize Earth Engine using a GCP Service Account.

    Required env vars:
      - GEE_SERVICE_ACCOUNT (e.g. xxx@project-id.iam.gserviceaccount.com)
      - GEE_JSON_KEY_PATH (path to the JSON key file)
    """
    global _EE_INITIALIZED
    if _EE_INITIALIZED:
        return

    service_account = os.getenv("GEE_SERVICE_ACCOUNT")
    json_key_path = os.getenv("GEE_JSON_KEY_PATH")
    json_key_content = os.getenv("GEE_JSON_KEY_CONTENT")
    json_key_b64 = os.getenv("GEE_JSON_KEY_B64")

    if not service_account:
        raise RuntimeError(
            "Missing Earth Engine env var. Set GEE_SERVICE_ACCOUNT."
        )

    key_file_path: str | None = None

    # Local dev: file path.
    if json_key_path:
        key_file_path = json_key_path

    # Render-friendly: raw JSON in an env var.
    elif json_key_content:
        content = json_key_content
        # If Render saved the JSON as a single line with escaped newlines,
        # convert them back to real newlines before writing to disk.
        if "\\n" in content and "\n" not in content:
            content = content.replace("\\n", "\n")

        # Validate JSON to catch truncation early.
        json.loads(content)

        fd, tmp_path = tempfile.mkstemp(prefix="gee-key-", suffix=".json")
        os.close(fd)
        Path(tmp_path).write_text(content, encoding="utf-8")
        key_file_path = tmp_path

    # Render-friendly: base64 of the JSON.
    elif json_key_b64:
        decoded = base64.b64decode(json_key_b64)
        fd, tmp_path = tempfile.mkstemp(prefix="gee-key-", suffix=".json")
        os.close(fd)
        Path(tmp_path).write_bytes(decoded)
        key_file_path = tmp_path

    else:
        raise RuntimeError(
            "Missing Earth Engine JSON key. Provide one of: "
            "GEE_JSON_KEY_PATH, GEE_JSON_KEY_CONTENT, or GEE_JSON_KEY_B64."
        )

    credentials = ee.ServiceAccountCredentials(service_account, key_file_path)
    ee.Initialize(credentials)
    _EE_INITIALIZED = True


def _close_ring_lonlat(points_lonlat: list[list[float]]) -> list[list[float]]:
    if len(points_lonlat) < 3:
        raise ValueError("Polygon ROI must have at least 3 points.")

    first = points_lonlat[0]
    last = points_lonlat[-1]
    if first[0] != last[0] or first[1] != last[1]:
        return points_lonlat + [first]
    return points_lonlat


def roi_polygon_from_latlon(roi_latlon: Iterable[dict[str, float]]) -> ee.Geometry:
    """
    Convert [{lat, lon}, ...] into ee.Geometry.Polygon with [lon, lat] ring coordinates.
    """
    points_lonlat: list[list[float]] = []
    for p in roi_latlon:
        lat = float(p["lat"])
        lon = float(p["lon"])
        points_lonlat.append([lon, lat])

    ring = _close_ring_lonlat(points_lonlat)
    return ee.Geometry.Polygon([ring])


def detect_deforestation(
    roi: ee.Geometry,
    pre_start: str,
    pre_end: str,
    post_start: str,
    post_end: str,
) -> dict[str, Any]:
    """
    Combine Sentinel-1 (SAR VH) and Sentinel-2 (NDVI) to detect deforestation / forest loss.

    Loss criteria (updated):
      - NDVI threshold crossing: pre_NDVI > 0.5 AND post_NDVI < 0.5
      - SAR drop: SAR_diff < SAR_DROP_DB (default -3.0 dB)
      - Combined: SAR_drop AND NDVI_crossing
    """
    NDVI_THRESHOLD = 0.5
    SAR_DROP_DB = -3.0
    # -------------------------
    # 1) SAR Processing (Sentinel-1 VH)
    # -------------------------
    s1 = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(roi)
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .select(["VH"])
    )

    pre_s1 = s1.filterDate(pre_start, pre_end).median().clip(roi)
    post_s1 = s1.filterDate(post_start, post_end).median().clip(roi)

    sar_diff = post_s1.subtract(pre_s1)  # band: VH
    # Comparisons typically yield pixels masked where false, but we keep it as a mask.
    sar_mask = sar_diff.lt(SAR_DROP_DB).rename("loss")

    # -------------------------
    # 2) Optical Processing (Sentinel-2 NDVI)
    # -------------------------
    def get_ndvi(image: ee.Image) -> ee.Image:
        return image.normalizedDifference(["B8", "B4"]).rename("NDVI")

    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(roi)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
    )

    pre_ndvi = s2.filterDate(pre_start, pre_end).map(get_ndvi).median().clip(roi)
    post_ndvi = s2.filterDate(post_start, post_end).map(get_ndvi).median().clip(roi)

    # Places that were vegetated in the baseline and then dropped below the vegetation threshold.
    ndvi_mask = pre_ndvi.gt(NDVI_THRESHOLD).And(post_ndvi.lt(NDVI_THRESHOLD)).rename("loss")

    # -------------------------
    # 3) Data Fusion (AND)
    # -------------------------
    combined_loss = sar_mask.And(ndvi_mask).selfMask().rename("loss")

    # -------------------------
    # 4) Statistics
    # -------------------------
    pixel_area = ee.Image.pixelArea()

    # Use unmask(0) to avoid "null" when nothing matches.
    sar_area_m2 = (
        sar_mask.unmask(0).multiply(pixel_area).reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=roi,
            scale=10,
            maxPixels=1e9,
        ).get("loss")
    )
    ndvi_area_m2 = (
        ndvi_mask.unmask(0).multiply(pixel_area).reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=roi,
            scale=10,
            maxPixels=1e9,
        ).get("loss")
    )
    loss_area_m2 = (
        combined_loss.unmask(0).multiply(pixel_area).reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=roi,
            scale=10,
            maxPixels=1e9,
        ).get("loss")
    )

    sar_area_m2_num = ee.Number(sar_area_m2)
    ndvi_area_m2_num = ee.Number(ndvi_area_m2)
    loss_area_m2_num = ee.Number(loss_area_m2)

    # Confidence is based on intersection (both masks) relative to union.
    # - intersection area = loss_area_m2_num
    # - union area = area_sar + area_ndvi - intersection
    union_area_m2 = sar_area_m2_num.add(ndvi_area_m2_num).subtract(loss_area_m2_num)
    confidence_score = ee.Number(
        ee.Algorithms.If(union_area_m2.gt(0), loss_area_m2_num.divide(union_area_m2).multiply(100), 0)
    )

    hectares_impacted = loss_area_m2_num.divide(10000)

    # Primary location: centroid of the detected loss area; fallback to ROI centroid.
    try:
        centroid_coords = combined_loss.geometry().centroid(1).coordinates().getInfo()
        primary_location = {"lat": float(centroid_coords[1]), "lon": float(centroid_coords[0])}
    except Exception:
        roi_centroid = roi.centroid(1).coordinates().getInfo()
        primary_location = {"lat": float(roi_centroid[1]), "lon": float(roi_centroid[0])}

    # -------------------------
    # 5) Visualization (Red tile layer)
    # -------------------------
    map_id = combined_loss.getMapId({"palette": ["#FF0000"]})
    tile_url = map_id["tile_fetcher"].url_format

    # -------------------------
    # 6) Best-effort downloads (GeoTIFF + PNG)
    # -------------------------
    tif_url = None
    png_url = None
    try:
        # GeoTIFF: export a 0/1 raster (deforestation mask), unmasked outside loss.
        export_img = combined_loss.unmask(0).toByte().rename("deforestation")
        tif_url = export_img.getDownloadURL(
            {
                "scale": 10,
                "region": roi,
                "format": "GEO_TIFF",
                "crs": "EPSG:4326",
            }
        )
    except Exception:
        tif_url = None

    try:
        # PNG preview: keep mask so non-loss pixels remain transparent.
        png_url = combined_loss.selfMask().getThumbURL(
            {
                "palette": ["#FF0000"],
                "region": roi,
                "scale": 10,
                "format": "png",
                "maxPixels": 1e7,
            }
        )
    except Exception:
        png_url = None

    # Evaluate server-side values.
    return {
        "hectares_impacted": float(hectares_impacted.getInfo() or 0),
        "confidence_score": float(confidence_score.getInfo() or 0),
        "primary_location": primary_location,
        "map_url": tile_url,
        "tif_url": tif_url,
        "png_url": png_url,
    }

