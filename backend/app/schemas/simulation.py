from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class SimulationRunInput(BaseModel):
    segment_id: str = Field(..., description="Unique identifier for the road segment to simulate")
    days: int = Field(..., gt=0, le=3650, description="Number of future days to simulate (e.g. 30, 90, 365)")
    traffic_multiplier: Optional[float] = Field(
        1.0, ge=0.1, le=5.0, description="Traffic volume multiplier (1.0 = normal, >1.0 = heavy traffic)"
    )
    weather_severity: Optional[float] = Field(
        1.0, ge=0.5, le=3.0, description="Weather severity factor (1.0 = average, >1.0 = high monsoon/heat)"
    )
    daily_precipitation_mm: Optional[float] = Field(
        None, ge=0.0, le=500.0, description="Optional daily rainfall override in millimeters"
    )
    point_lat: Optional[float] = Field(
        None, description="Optional latitude coordinate for live TomTom traffic flow analysis"
    )
    point_lon: Optional[float] = Field(
        None, description="Optional longitude coordinate for live TomTom traffic flow analysis"
    )
    maintenance_applied: Optional[bool] = Field(
        False, description="Whether routine preventive maintenance is scheduled during the period"
    )


class SimulationDayMetric(BaseModel):
    day: int
    date: Optional[str] = None
    cumulative_esal_msa: Optional[float] = None
    cracking_pct: float
    raveling_pct: float
    patching_pct: float
    iri_m_km: float
    pothole_pct: float
    rut_depth_mm: Optional[float] = 0.0
    pci_score: float
    road_health: str
    color: str = "#10B981"
    color_hex: str = "#10B981"


class SimulationResult(BaseModel):
    segment_id: str
    days: int
    initial_pci: float
    final_pci: float
    initial_health: str
    final_health: str
    traffic_multiplier_applied: float = 1.0
    final_state: Dict[str, Any]
    forecast: List[SimulationDayMetric]
    projected_decay_timeline: List[SimulationDayMetric]


class SimulationStepTriggerInput(BaseModel):
    segment_id: str = Field(..., description="Unique identifier for the road segment to simulate")
    traffic_multiplier: Optional[float] = Field(
        1.0, ge=0.1, le=5.0, description="Traffic volume multiplier (1.0 = normal, >1.0 = heavy traffic)"
    )
    rainfall_mm: Optional[float] = Field(
        None, ge=0.0, le=500.0, description="Optional accumulated rainfall override in millimeters"
    )
    max_temp: Optional[float] = Field(
        None, ge=-20.0, le=60.0, description="Optional average maximum temperature in Celsius"
    )
    force_delta_t_days: Optional[float] = Field(
        None, gt=0.0, le=365.0, description="Optional override for elapsed delta_t in fractional days"
    )


class BatchSimulationTriggerInput(BaseModel):
    traffic_multiplier: Optional[float] = Field(
        1.0, ge=0.1, le=5.0, description="Traffic volume multiplier for all segments"
    )
    rainfall_mm: Optional[float] = Field(
        None, ge=0.0, le=500.0, description="Optional accumulated rainfall override in millimeters"
    )
    max_temp: Optional[float] = Field(
        None, ge=-20.0, le=60.0, description="Optional average maximum temperature in Celsius"
    )
    force_delta_t_days: Optional[float] = Field(
        None, gt=0.0, le=365.0, description="Optional override for elapsed delta_t in fractional days"
    )
