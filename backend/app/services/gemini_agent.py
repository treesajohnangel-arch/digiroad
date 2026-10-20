import logging
from typing import Dict, Any, List, Optional
from app.config import settings

logger = logging.getLogger(__name__)


def query_road_segment_condition(segment_id: str) -> Dict[str, Any]:
    """Retrieve the current health, PCI score, and distress metrics for a road segment."""
    # Mock data / Supabase lookup fallback
    return {
        "segment_id": segment_id,
        "pci_score": 78.5,
        "iri_m_km": 2.1,
        "cracking_pct": 8.5,
        "raveling_pct": 5.2,
        "patching_pct": 3.0,
        "pothole_pct": 1.2,
        "road_health": "Fair",
        "last_inspection": "2026-08-15",
    }


def query_active_complaints_summary() -> Dict[str, Any]:
    """Retrieve summary counts of road complaints by status."""
    return {
        "pending": 12,
        "under_process": 5,
        "repaired": 34,
        "critical_priority_segments": ["SEG-004", "SEG-019"],
    }


tools_registry = [query_road_segment_condition, query_active_complaints_summary]


async def run_gemini_agent(user_message: str, chat_history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    """
    Executes a conversation turn with the Gemini AI assistant using the google-genai SDK
    with tool-calling capabilities for road maintenance analytics.
    """
    api_key = settings.GEMINI_API_KEY

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    # Build prompt or history with tools
    system_instruction = (
        "You are DigiRoad AI, an intelligent infrastructure and pavement management assistant. "
        "You assist municipal engineers and citizens in analyzing road conditions, understanding "
        "PCI deterioration models, and managing maintenance complaints."
    )

    candidate_models = [
        getattr(settings, "GEMINI_MODEL", "gemini-3.8-flash"),
        "gemini-flash-lite-latest",
        "gemini-2.5-flash-lite",
        "gemini-flash-latest",
    ]
    seen = set()
    model_list = [m for m in candidate_models if not (m in seen or seen.add(m))]

    last_error = None
    for model_name in model_list:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=user_message,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    tools=tools_registry,
                    temperature=0.2,
                ),
            )

            reply_text = response.text if (hasattr(response, "text") and response.text) else ""
            return {
                "response": reply_text,
                "tool_calls": [
                    call.name for call in getattr(response, "function_calls", []) or []
                ],
            }
        except Exception as e:
            last_error = e
            logger.warning(f"Error running Gemini agent with {model_name}: {e}. Retrying with next model...")
            continue

    logger.error(f"Error executing Gemini agent across all models: {last_error}", exc_info=True)
    return {
        "response": f"Encountered an issue running the Gemini assistant: {str(last_error)}",
        "tool_calls": [],
    }
