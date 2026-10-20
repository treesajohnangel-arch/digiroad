from typing import Optional, List
from pydantic import BaseModel


class PCIDatapoint(BaseModel):
    date: str
    pci_score: float


class MetricBoxSummary(BaseModel):
    segment_id: str
    selected_date: str
    pci_score: float
    iri_m_km: float
    cracking_pct: float
    raveling_pct: float
    patching_pct: float


class TrendResponse(BaseModel):
    segment_id: Optional[str] = None
    target_date: str
    effective_target_date: Optional[str] = None
    start_date: Optional[str] = None
    interval_days: int = 7
    datapoints_count: int = 0
    summary: Optional[MetricBoxSummary] = None
    data: List[PCIDatapoint] = []


__all__ = [
    "PCIDatapoint",
    "MetricBoxSummary",
    "TrendResponse",
]
