"""
FastAPI router exposing the RoadWise damage detector.

Mount in your app (e.g. backend/app/main.py):
    from app.ml.fastapi_router import router as damage_router
    app.include_router(damage_router)

POST /api/damage/detect   (multipart field "file")  ->  {"detections": [...], "image": {...}}
"""
import io
from functools import lru_cache

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image, ImageOps, UnidentifiedImageError

from .roadwise_detector import RoadDamageDetector

router = APIRouter(prefix="/api/damage", tags=["damage-detection"])
MAX_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


@lru_cache(maxsize=1)
def get_detector() -> RoadDamageDetector:
    return RoadDamageDetector()   # loaded once, on first request


@router.post("/detect")
async def detect_damage(
    file: UploadFile = File(...),
    conf: float = Query(0.25, ge=0.05, le=0.95),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, "Upload a JPEG, PNG or WebP image.")
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image larger than 10 MB.")
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()                       # reject corrupt / non-image payloads
        img = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "File is not a readable image.")

    img = ImageOps.exif_transpose(img).convert("RGB")
    detections = await run_in_threadpool(get_detector().detect, img, conf)
    return {
        "detections": detections,
        "image": {"width": img.width, "height": img.height},
        "model": "RoadWise YOLOv8n (RDD2022 India) - advisory only",
    }
