import os
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from google import genai
from google.genai import types

from app.services.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(tags=["PaveBot Chat"])

# Citizen identity fields never leave the backend through the chatbot (endpoint is public).
PII_FIELDS = {"citizen_name", "contact", "email", "phone", "phone_number", "user_id", "created_by", "reporter_id"}
PAGE_SIZE = 1000
MAX_ROWS_PER_TABLE = 50000
TIMESTAMP_FIELDS = ("evaluation_timestamp", "execution_timestamp", "updated_at", "created_at")
METRIC_FIELDS = ("pci_score", "iri_m_km", "cracking_pct", "raveling_pct", "patching_pct", "pothole_pct", "rut_depth_mm")


# ---------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------
class ChatMessage(BaseModel):
    role: str = Field(..., description="Role of message sender: 'user' or 'assistant'")
    content: str = Field(..., description="Text content of the message")


class ChatRequest(BaseModel):
    message: str = Field(..., description="User query or message")
    history: List[ChatMessage] = Field(default_factory=list, description="Conversation history")


class ChatResponse(BaseModel):
    reply: str = Field(..., description="Assistant reply message")
    history: List[ChatMessage] = Field(..., description="Updated conversation history")


# ---------------------------------------------------------
# Database snapshot: every row of every road/complaint table
# ---------------------------------------------------------
def _fetch_all_rows(table: str) -> List[Dict[str, Any]]:
    """Read a whole table, paging past Supabase's 1000-row response cap."""
    rows: List[Dict[str, Any]] = []
    start = 0
    while start < MAX_ROWS_PER_TABLE:
        res = supabase.table(table).select("*").range(start, start + PAGE_SIZE - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return rows


def _row_time(row: Dict[str, Any]) -> str:
    for field in TIMESTAMP_FIELDS:
        if row.get(field):
            return str(row[field])
    return ""


def _num(value: Any) -> Optional[float]:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _strip_pii(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in row.items() if k not in PII_FIELDS}


def _summarize_evaluations(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Per segment: row count, date range, first/latest full rows, and monthly metric averages."""
    by_segment: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_segment[str(row.get("segment_id") or "unknown")].append(row)

    summary: Dict[str, Any] = {}
    for seg_id, seg_rows in sorted(by_segment.items()):
        seg_rows.sort(key=_row_time)
        monthly: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
        for row in seg_rows:
            month = _row_time(row)[:7] or "undated"
            for field in METRIC_FIELDS:
                value = _num(row.get(field))
                if value is not None:
                    monthly[month][field].append(value)
        summary[seg_id] = {
            "row_count": len(seg_rows),
            "first_date": _row_time(seg_rows[0]),
            "latest_date": _row_time(seg_rows[-1]),
            "first_row": seg_rows[0],
            "latest_row": seg_rows[-1],
            "monthly_averages": {
                month: {
                    field: {"avg": round(sum(v) / len(v), 2), "min": min(v), "max": max(v)}
                    for field, v in fields.items()
                }
                for month, fields in sorted(monthly.items())
            },
        }
    return summary


def _summarize_complaints(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    def norm_status(row: Dict[str, Any]) -> str:
        return str(row.get("status") or "nil").strip().lower()

    per_segment: Dict[str, Counter] = defaultdict(Counter)
    for row in rows:
        per_segment[str(row.get("segment_id") or "unknown")][norm_status(row)] += 1
    return {
        "total": len(rows),
        "by_status": dict(Counter(norm_status(r) for r in rows)),
        "by_severity": dict(Counter(str(r.get("severity") or "unknown") for r in rows)),
        "by_category": dict(Counter(str(r.get("complaint_heading") or "unknown") for r in rows)),
        "by_segment_and_status": {seg: dict(c) for seg, c in sorted(per_segment.items())},
    }


async def fetch_database_snapshot() -> Dict[str, Any]:
    """
    Load the full DigiRoad dataset from Supabase: road_segments, dynamic_road_evaluations,
    historic_road_evaluations and user_complaints (citizen identity removed), plus summaries.
    Never substitutes invented data: failures are reported in `database_status`.
    """
    snapshot: Dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "database_status": "ok",
        "errors": {},
    }

    if supabase is None:
        snapshot["database_status"] = "unavailable: Supabase client is not configured"
        return snapshot

    tables = ("road_segments", "dynamic_road_evaluations", "historic_road_evaluations", "user_complaints")

    def _sync_fetch() -> Dict[str, Any]:
        data: Dict[str, Any] = {}
        for table in tables:
            try:
                data[table] = _fetch_all_rows(table)
            except Exception as e:
                logger.warning("PaveBot failed to read %s: %s", table, e)
                snapshot["errors"][table] = str(e)
                data[table] = []
        return data

    try:
        data = await asyncio.wait_for(asyncio.to_thread(_sync_fetch), timeout=25.0)
    except Exception as e:
        logger.warning("PaveBot database snapshot failed: %s", e)
        snapshot["database_status"] = f"unavailable: {e}"
        return snapshot

    complaints = [_strip_pii(r) for r in data["user_complaints"]]
    complaints.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    dynamic_rows = data["dynamic_road_evaluations"]
    historic_rows = data["historic_road_evaluations"]

    snapshot["row_counts"] = {table: len(data[table]) for table in tables}
    snapshot["road_segments"] = data["road_segments"]
    snapshot["dynamic_road_evaluations_summary"] = _summarize_evaluations(dynamic_rows)
    # Small tables go in whole; large ones are represented by the per-segment summary above.
    if len(dynamic_rows) <= 300:
        snapshot["dynamic_road_evaluations"] = sorted(dynamic_rows, key=_row_time)
    snapshot["historic_road_evaluations_summary"] = _summarize_evaluations(historic_rows)
    snapshot["user_complaints_summary"] = _summarize_complaints(complaints)
    snapshot["user_complaints"] = complaints
    if snapshot["errors"]:
        snapshot["database_status"] = "partial: some tables could not be read"
    return snapshot


# ---------------------------------------------------------
# System instruction
# ---------------------------------------------------------
def build_system_instruction(snapshot_data: Dict[str, Any]) -> str:
    snapshot_json = json.dumps(snapshot_data, default=str, separators=(",", ":"))

    return f"""You are "PaveBot", the Pavement Management System (PMS) copilot of the DigiRoad platform.
You serve road engineers, planners and citizens for the Vembayam - Pallipuram Road (MDR47) corridor in
Thiruvananthapuram, Kerala, split into segments MDR47-S01, MDR47-S02 and MDR47-S03 (about 1 km each).

## How to answer
1. Answer every part of the question completely. Give exact figures from the dataset (PCI, IRI, distress
   percentages, rut depth, dates, complaint counts and IDs), name the segment, and state the date of the data.
2. Base every factual claim about roads or complaints on the DATASET below. Compute totals, averages,
   rankings, comparisons and trends from it yourself. Never invent segments, readings or complaints.
3. If the dataset lacks what is asked, or `database_status` is not "ok", say so plainly and say what is missing.
4. After the facts, add a short engineering interpretation and a recommended action when relevant.
5. Map loose names to IDs: "segment 1", "S1", "first segment" -> MDR47-S01, and so on.
6. Handle typos and informal phrasing without comment. Answer in the user's language.
7. Format for a narrow plain-text chat panel: short paragraphs and "-" bullet lists. Do not use markdown
   tables, headings, or ** bold markers.

## Data meaning
- road_segments: master record per segment (name, chainage, coordinates, baseline condition).
- dynamic_road_evaluations: current/latest computed condition per segment. Its `latest_row` per segment in
  the summary is the CURRENT condition; prefer it over road_segments for "now" questions.
- historic_road_evaluations: past evaluations over time. Use `monthly_averages`, `first_row` and
  `latest_row` for trends, deterioration rate and history questions.
- user_complaints: citizen complaints (identities removed). Statuses: "nil" = new/pending,
  "under process" = repair in progress, "repaired" = closed. Use `user_complaints_summary` for counts.

## Domain knowledge
- PCI (0-100) health bands used by DigiRoad: >= 85 Good, 70-84.99 Fair, 55-69.99 Poor, < 55 Very Poor.
  If a row has `road_health`, report that value.
- IRI (m/km): < 2.0 smooth, 2.0-4.0 moderate roughness, > 4.0 rough.
- Distresses: cracking (fatigue/alligator, longitudinal, transverse), rutting (wheel-path depressions),
  potholes (moisture plus traffic), raveling (aggregate loss), patching (past repair areas).
- Interventions: PCI 70-85 preventive maintenance (crack sealing, fog seal, micro-surfacing);
  PCI 40-69 rehabilitation (milling and HMA overlay, deep patching, cold in-place recycling);
  PCI < 40 full reconstruction. Monsoon rainfall, heavy traffic and delayed repair speed up decay;
  delaying repair until reconstruction can cost 4-5x more.
- For what-if or forecast questions, extrapolate from the historic trend in the dataset and say it is an estimate.

## DATASET (live from Supabase, generated {snapshot_data.get("generated_at")})
{snapshot_json}
"""


# ---------------------------------------------------------
# Database tools: Gemini calls these only when a question needs live data
# ---------------------------------------------------------
def _norm_segment(segment_id: str) -> str:
    """'s1', 'segment 2', 'MDR47 S03' -> 'MDR47-S01' etc. Empty string means all segments."""
    digits = "".join(ch for ch in (segment_id or "") if ch.isdigit())
    if not digits:
        return ""
    num = int(digits[-2:]) if len(digits) > 2 else int(digits)  # 'MDR47 S03' -> last two digits
    return f"MDR47-S{num:02d}"


def get_current_road_condition(segment_id: str = "") -> Dict[str, Any]:
    """Current condition of MDR47 road segments from dynamic_road_evaluations: PCI, road health, IRI,
    cracking, rutting, raveling, patching, potholes, plus segment details (name, chainage, length, width).

    Args:
        segment_id: Segment like "MDR47-S01", "S2" or "segment 3". Leave empty for all segments.
    """
    if supabase is None:
        return {"error": "Database is not configured."}
    sid = _norm_segment(segment_id)
    try:
        dyn = supabase.table("dynamic_road_evaluations").select("*")
        seg = supabase.table("road_segments").select("*")
        if sid:
            dyn, seg = dyn.eq("segment_id", sid), seg.eq("segment_id", sid)
        return {"current_condition": dyn.execute().data or [], "segments": seg.execute().data or []}
    except Exception as e:
        logger.warning("PaveBot tool get_current_road_condition failed: %s", e)
        return {"error": f"Could not read current condition: {e}"}


def get_condition_history(segment_id: str = "", last_n_records: int = 12) -> Dict[str, Any]:
    """Past evaluations from historic_road_evaluations, for trends, deterioration rate and
    "how has PCI changed" questions. Returns monthly averages plus the most recent records.

    Args:
        segment_id: Segment like "MDR47-S01" or "S2". Leave empty for all segments.
        last_n_records: How many recent raw records per segment to include (max 30).
    """
    if supabase is None:
        return {"error": "Database is not configured."}
    sid = _norm_segment(segment_id)
    n = max(1, min(int(last_n_records or 12), 30))
    try:
        rows: List[Dict[str, Any]] = []
        start = 0
        while start < MAX_ROWS_PER_TABLE:
            q = supabase.table("historic_road_evaluations").select("*")
            if sid:
                q = q.eq("segment_id", sid)
            batch = q.range(start, start + PAGE_SIZE - 1).execute().data or []
            rows.extend(batch)
            if len(batch) < PAGE_SIZE:
                break
            start += PAGE_SIZE
    except Exception as e:
        logger.warning("PaveBot tool get_condition_history failed: %s", e)
        return {"error": f"Could not read history: {e}"}
    summary = _summarize_evaluations(rows)
    for seg_summary in summary.values():
        seg_summary.pop("first_row", None)
    by_seg: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in sorted(rows, key=_row_time):
        by_seg[str(row.get("segment_id"))].append(row)
    return {
        "summary_by_segment": summary,
        "recent_records": {seg: seg_rows[-n:] for seg, seg_rows in by_seg.items()},
    }


def get_complaints(status: str = "", segment_id: str = "") -> Dict[str, Any]:
    """Citizen complaints from user_complaints (identities removed) with counts by status, severity and
    category. Status values: "nil" = new, "under process" = repair in progress, "repaired" = closed.

    Args:
        status: Filter: "nil", "under process" or "repaired". Leave empty for all.
        segment_id: Segment like "MDR47-S01". Leave empty for all.
    """
    if supabase is None:
        return {"error": "Database is not configured."}
    try:
        rows = [_strip_pii(r) for r in _fetch_all_rows("user_complaints")]
    except Exception as e:
        logger.warning("PaveBot tool get_complaints failed: %s", e)
        return {"error": f"Could not read complaints: {e}"}
    sid = _norm_segment(segment_id)
    wanted = (status or "").strip().lower()
    if sid:
        rows = [r for r in rows if str(r.get("segment_id")) == sid]
    if wanted:
        rows = [r for r in rows if str(r.get("status") or "nil").strip().lower() == wanted]
    rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    return {"summary": _summarize_complaints(rows), "complaints": rows[:50]}


PAVEBOT_TOOLS = [get_current_road_condition, get_condition_history, get_complaints]

CHAT_SYSTEM_INSTRUCTION = """You are PaveBot, the friendly assistant of DigiRoad, a road-health website for the
Vembayam - Pallipuram Road (MDR47) in Thiruvananthapuram, Kerala. The road has three ~1 km segments:
MDR47-S01, MDR47-S02 and MDR47-S03.

How to answer:
- Talk naturally, like a helpful expert. Answer any question, including general ones (greetings, how roads
  decay, what PCI means, maintenance methods, how to use the site) from your own knowledge without tools.
- When a question needs DigiRoad's actual numbers (current scores, which road is worst, history/trends,
  complaints, what repair a segment needs), call the tools first and answer only from what they return.
  Never invent readings, dates or complaint details. If a tool returns an error or no data, say so.
- Give exact figures as returned (do not round them), name the segment, and mention the data date.
- For maintenance advice, combine the live scores with the guidance below and explain why.
- Website features: Overview (map, scores, complaints tracker), Simulations, Trends, Repairs (history),
  Admin (complaint status and repairs), "Submit a complaint" to report a road problem.
- Reply in the user's language. Keep it concise for a narrow chat panel: short paragraphs and "-" bullets.
  No markdown tables, headings or ** bold.

Domain guidance:
- PCI 0-100 bands used by DigiRoad: >= 85 Good, 70-84.99 Fair, 55-69.99 Poor, < 55 Very Poor.
  If a record has road_health, report that value.
- IRI (m/km): < 2.0 smooth, 2.0-4.0 moderate roughness, > 4.0 rough.
- Interventions: PCI >= 85 routine maintenance; 70-85 preventive (crack sealing, fog seal, micro-surfacing);
  55-70 rehabilitation (patching, thin overlay); 40-55 milling and HMA overlay, deep patching;
  < 40 reconstruction or full resurfacing. Monsoon rain, heavy traffic and drainage problems speed up decay;
  delaying repair until reconstruction can cost 4-5x more.
- For forecasts, extrapolate from the history tool's trend and say it is an estimate.
"""


# ---------------------------------------------------------
# Gemini call with model fallback
# ---------------------------------------------------------
_working_model: Optional[str] = None  # last model that answered; tried first next time
_discovered_models: Optional[List[str]] = None  # flash models this API key can use (listed once per process)
_SKIP_MODEL_WORDS = ("image", "tts", "live", "audio", "embedding", "exp", "thinking", "native")


def _discover_models(client: genai.Client) -> List[str]:
    """Flash models usable for chat, stable before preview, newest first. Cached after the first call."""
    global _discovered_models
    if _discovered_models is None:
        try:
            names = [
                (m.name or "").removeprefix("models/")
                for m in client.models.list()
                if "generateContent" in (getattr(m, "supported_actions", None) or [])
            ]
        except Exception as e:
            logger.warning("PaveBot could not list models: %s", e)
            return []
        names = [n for n in names if "flash" in n and not any(w in n for w in _SKIP_MODEL_WORDS)]
        _discovered_models = sorted(names, key=lambda n: ("preview" in n, "lite" not in n, [-ord(ch) for ch in n]))
        logger.info("PaveBot models available: %s", _discovered_models)
    return _discovered_models


def _thinking_for(model_name: str) -> Optional[types.ThinkingConfig]:
    """Minimal thinking keeps chat replies fast."""
    if "gemini-2.5" in model_name:
        return types.ThinkingConfig(thinking_budget=0)
    if "gemini-3" in model_name:
        return types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)
    return None


def _generate_reply(client: genai.Client, contents: List[types.Content], config: types.GenerateContentConfig) -> str:
    """Ask up to 4 models at once and return the first answer, so one overloaded model cannot stall the chat."""
    global _working_model
    candidates: List[str] = []
    for name in [_working_model or "", os.getenv("GEMINI_MODEL", "")] + _discover_models(client):
        if name and name not in candidates:
            candidates.append(name)
    candidates = candidates[:5]  # working model + up to 4 to race
    errors: List[str] = []

    def attempt(model_name: str) -> str:
        model_config = config.model_copy(update={"thinking_config": _thinking_for(model_name)})
        try:
            try:
                response = client.models.generate_content(model=model_name, contents=contents, config=model_config)
            except Exception as e:
                if "thinking" not in str(e).lower():
                    raise
                response = client.models.generate_content(model=model_name, contents=contents, config=config)
        except Exception as e:
            if "404" in str(e) and _discovered_models and model_name in _discovered_models:
                _discovered_models.remove(model_name)  # retired model: stop trying it
            raise
        text = (response.text or "").strip() if response else ""
        if not text:
            raise RuntimeError("empty reply")
        return text

    def record_failure(name: str, e: Exception) -> None:
        errors.append(f"{name}: {str(e)[:160]}")
        logger.warning("PaveBot model %s failed: %s", name, e)

    # Known-good model alone first: racing every request would burn the free quota 4x faster.
    if _working_model:
        name = candidates.pop(0)
        try:
            return attempt(name)
        except Exception as e:
            record_failure(name, e)
            _working_model = None

    pool = ThreadPoolExecutor(max_workers=len(candidates) or 1)
    futures = {pool.submit(attempt, name): name for name in candidates}
    try:
        for future in as_completed(futures):
            name = futures[future]
            try:
                text = future.result()
            except Exception as e:
                record_failure(name, e)
                continue
            _working_model = name
            return text
    finally:
        pool.shutdown(wait=False, cancel_futures=True)  # don't wait for slower models
    raise RuntimeError("; ".join(errors) or "No model returned a reply.")


# ---------------------------------------------------------
# API Route: POST /api/chat
# ---------------------------------------------------------
@router.post("/api/chat", response_model=ChatResponse, status_code=status.HTTP_200_OK)
@router.post("/chat", response_model=ChatResponse, status_code=status.HTTP_200_OK)
async def chat_endpoint(request: ChatRequest) -> ChatResponse:
    """PaveBot: natural conversation; reads live Supabase data through tools only when a question needs it."""
    user_msg = request.message.strip()
    if not user_msg:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message content cannot be empty.")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "your-gemini-api-key":
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="GEMINI_API_KEY is not configured on the server.")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    config = types.GenerateContentConfig(
        system_instruction=f"{CHAT_SYSTEM_INSTRUCTION}\nToday's date: {today}.",
        temperature=0.4,
        tools=PAVEBOT_TOOLS,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(maximum_remote_calls=4),
    )

    contents = [
        types.Content(role="model" if m.role == "assistant" else "user", parts=[types.Part.from_text(text=m.content)])
        for m in request.history[-20:]
    ]
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=user_msg)]))

    try:
        reply_text = await asyncio.wait_for(
            asyncio.to_thread(_generate_reply, genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=20000)), contents, config),
            timeout=50.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="PaveBot took too long to answer. Please try again.")
    except Exception as e:
        logger.error("PaveBot generation failed: %s", e)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Gemini API generation error: {e}")

    updated_history = list(request.history)
    updated_history.append(ChatMessage(role="user", content=user_msg))
    updated_history.append(ChatMessage(role="assistant", content=reply_text))
    return ChatResponse(reply=reply_text, history=updated_history)
