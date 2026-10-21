import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Health = 'Very Poor' | 'Poor' | 'Fair' | 'Good';

export type Segment = {
  id: string;
  name: string;
  cracking: number;
  raveling: number;
  rutting: number;
  patching: number;
  iri: number;
  pci: number;
  health: Health;
  coords: [number, number][];
};

export type Complaint = {
  id: string;
  citizen: string;
  contact: string;
  segmentId: string;
  category: string;
  severity: string;
  description: string;
  status: 'nil' | 'Under Progress' | 'Repaired';
  created: string;
  repairedAt?: string;
  repairType?: 'PATCHING' | 'FULL_RESURFACING';
};

type ApiComplaint = {
  complaint_id: string;
  segment_id: string;
  complaint_heading?: string | null;
  description?: string;
  status?: string | null;
  created_at?: string | null;
  repaired_at?: string | null;
  repair_type?: string | null;
  citizen_name?: string | null;
  contact?: string | null;
  severity?: string | null;
};

export function normalizeStatus(st?: string | null): 'nil' | 'Under Progress' | 'Repaired' {
  const s = (st || '').trim().toLowerCase();
  if (s === 'repaired') return 'Repaired';
  if (s === 'under process' || s === 'under_process' || s === 'under progress') return 'Under Progress';
  return 'nil';
}

export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

function fromApiComplaint(row: ApiComplaint): Complaint {
  return {
    id: String(row.complaint_id),
    citizen: row.citizen_name || 'Resident',
    contact: row.contact || '',
    segmentId: row.segment_id,
    category: row.complaint_heading || 'Road complaint',
    severity: row.severity || 'Medium',
    description: row.description || '',
    status: normalizeStatus(row.status),
    created: row.created_at ? new Date(row.created_at).toLocaleString() : '—',
    repairedAt: row.repaired_at || undefined,
    repairType: ['PATCHING', 'FULL_RESURFACING'].includes(String(row.repair_type || '').toUpperCase())
      ? String(row.repair_type).toUpperCase() as Complaint['repairType'] : undefined,
  };
}

export type RepairActionPayload = {
  complaintId: string;
  repairType: 'PATCHING' | 'FULL_RESURFACING';
  patchLength?: number;
  patchWidth?: number;
  notes?: string;
};

export type TrendPoint = {
  date: string;
  fullDate: string;
  pci: number;
  health: Health;
  event?: string;
};

export const defaultSegments: Segment[] = [
  {
    id: 'MDR47-S01',
    name: 'Vembayam - Pallipuram Road (MDR47 S01)',
    cracking: 22.48,
    raveling: 8.59,
    rutting: 4.2,
    patching: 0.29,
    iri: 1.98,
    pci: 47,
    health: 'Very Poor',
    coords: [
      [8.6281, 76.9242],
      [8.6225, 76.9160],
    ],
  },
  {
    id: 'MDR47-S02',
    name: 'Vembayam - Pallipuram Road (MDR47 S02)',
    cracking: 26.97,
    raveling: 8.59,
    rutting: 5.1,
    patching: 0.36,
    iri: 2.04,
    pci: 40,
    health: 'Very Poor',
    coords: [
      [8.6225, 76.9160],
      [8.6170, 76.9079],
    ],
  },
  {
    id: 'MDR47-S03',
    name: 'Vembayam - Pallipuram Road (MDR47 S03)',
    cracking: 33.12,
    raveling: 8.59,
    rutting: 6.3,
    patching: 0.45,
    iri: 2.06,
    pci: 30,
    health: 'Very Poor',
    coords: [
      [8.6170, 76.9079],
      [8.6115, 76.8998],
    ],
  },
];

const seed: Complaint[] = [
  {
    id: 'CMP-2418',
    citizen: 'Anjali Nair',
    contact: '••••• 4821',
    segmentId: 'MDR47-S01',
    category: 'Pothole',
    severity: 'High',
    description: 'Deep pothole near the bus stop is forcing two-wheelers into traffic.',
    status: 'nil',
    created: 'Today, 09:42',
  },
  {
    id: 'CMP-2416',
    citizen: 'R. Suresh',
    contact: '••••• 7104',
    segmentId: 'MDR47-S02',
    category: 'Surface damage',
    severity: 'Medium',
    description: 'Loose aggregate and surface wear at the junction approach.',
    status: 'Under Progress',
    created: 'Yesterday, 16:18',
  },
  {
    id: 'CMP-2397',
    citizen: 'Meera Das',
    contact: '••••• 2360',
    segmentId: 'MDR47-S03',
    category: 'Drainage',
    severity: 'Low',
    description: 'Water collects along the curb after heavy rain.',
    status: 'Repaired',
    created: '12 Oct, 11:06',
    repairedAt: '2026-10-12T11:06:00Z',
    repairType: 'FULL_RESURFACING',
  },
];

export function classifyHealth(pci: number): Health {
  if (pci >= 85) return 'Good';
  if (pci >= 60) return 'Fair';
  if (pci >= 40) return 'Poor';
  return 'Very Poor';
}

type AppState = {
  role: 'public' | 'admin';
  user: { name: string; email: string };
  authToken: string | null;
  loggedIn: boolean;
  login: (name: string, email: string, token: string, role: 'public' | 'admin') => void;
  logout: () => void;
  segments: Segment[];
  setSegments: React.Dispatch<React.SetStateAction<Segment[]>>;
  complaints: Complaint[];
  recentRepairIds: string[];
  archivedRepairIds: string[];
  refreshRepairBuckets: () => Promise<void>;
  addComplaint: (c: Omit<Complaint, 'id' | 'status' | 'created'>) => Promise<boolean>;
  markUnderProcess: (id: string) => Promise<boolean>;
  repair: (id: string) => void;
  executeRepair: (payload: RepairActionPayload) => Promise<boolean>;
  trendLogs: Record<string, TrendPoint[]>;
  toast: string;
  notify: (s: string) => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<'public' | 'admin'>(() => window.sessionStorage.getItem('digiroad-role') === 'admin' ? 'admin' : 'public');
  const [user, setUser] = useState(() => {
    try { return JSON.parse(window.sessionStorage.getItem('digiroad-user') || '{"name":"","email":""}'); }
    catch { return { name: '', email: '' }; }
  });
  const [authToken, setAuthToken] = useState<string | null>(() => window.sessionStorage.getItem('digiroad-token'));
  const [loggedIn, setLoggedIn] = useState(() => Boolean(window.sessionStorage.getItem('digiroad-token')));
  const [segmentsList, setSegmentsList] = useState<Segment[]>(defaultSegments);
  const [complaints, setComplaints] = useState<Complaint[]>(seed);
  const [recentRepairIds, setRecentRepairIds] = useState<string[]>([]);
  const [archivedRepairIds, setArchivedRepairIds] = useState<string[]>(seed.filter(c => c.status === 'Repaired').map(c => c.id));
  const [trendLogs, setTrendLogs] = useState<Record<string, TrendPoint[]>>({});
  const [toast, setToast] = useState('');

  const refreshRepairBuckets = useCallback(async () => {
    if (!authToken) return;
    const headers = { Authorization: `Bearer ${authToken}` };
    try {
      const [recentRes, historyRes] = await Promise.all([
        fetch(`${API_BASE}/api/complaints/repaired/recent`, { headers }),
        fetch(`${API_BASE}/api/complaints/repaired/history`, { headers }),
      ]);
      if (!recentRes.ok || !historyRes.ok) throw new Error('Could not load repair history');
      const [recentRows, historyRows] = await Promise.all([recentRes.json(), historyRes.json()]) as [ApiComplaint[], ApiComplaint[]];
      const recent = recentRows.map(fromApiComplaint);
      const history = historyRows.map(fromApiComplaint);
      setRecentRepairIds(recent.map(c => c.id));
      setArchivedRepairIds(history.map(c => c.id));
      setComplaints(prev => {
        const byId = new Map(prev.map(c => [c.id, c]));
        [...recent, ...history].forEach(c => byId.set(c.id, c));
        return [...byId.values()];
      });
    } catch (error) {
      console.warn('Repair history refresh failed:', error);
    }
  }, [authToken]);

  useEffect(() => {
    if (!authToken || !loggedIn) return;
    let alive = true;
    const headers = { Authorization: `Bearer ${authToken}` };
    Promise.all([
      fetch(`${API_BASE}/api/complaints`, { headers }).then(res => (res.ok ? res.json() : null)),
      fetch(`${API_BASE}/api/home/map-data`).then(res => (res.ok ? res.json() : null)),
    ])
      .then(([apiComplaints, mapData]) => {
        if (!alive) return;
        if (Array.isArray(apiComplaints)) {
          const apiRows = (apiComplaints as ApiComplaint[]).map(fromApiComplaint);
          setComplaints(apiRows);
        }
        if (mapData && mapData.features && mapData.features.length) {
          const segs: Segment[] = mapData.features.map((f: any) => {
            const p = f.properties || {};
            const rawCoords = f.geometry?.coordinates || [];
            const coords = rawCoords.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
            return {
              id: p.segment_id,
              name: p.road_name || p.segment_id,
              cracking: Number((p.cracking_pct || 0).toFixed(2)),
              raveling: Number((p.raveling_pct || 0).toFixed(2)),
              rutting: Number((p.rut_depth_mm || 0).toFixed(2)),
              patching: Number((p.patching_pct || 0).toFixed(2)),
              iri: Number((p.iri_m_km || 1.2).toFixed(2)),
              pci: Math.round(p.pci_score || 0),
              health: (p.road_health as Health) || classifyHealth(p.pci_score || 0),
              coords: coords.length ? coords : [[8.6281, 76.9242], [8.6225, 76.9160]],
            };
          });
          if (segs.length) setSegmentsList(segs);
        }
      })
      .catch(() => {});
    void refreshRepairBuckets();
    return () => {
      alive = false;
    };
  }, [authToken, loggedIn, refreshRepairBuckets]);

  const notify = (s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(''), 3500);
  };

  const markUnderProcess = async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/complaints/${encodeURIComponent(id)}/under-process`, {
        method: 'PATCH',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      if (res.ok) {
        setComplaints(prev =>
          prev.map(c => (c.id === id ? { ...c, status: 'Under Progress' } : c))
        );
        notify(`Complaint #${id} updated to Under Process · Now active on Home`);
        return true;
      }
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Status update failed (${res.status})`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update complaint status.');
      return false;
    }
  };

  const addComplaint = async (form: Omit<Complaint, 'id' | 'status' | 'created'>): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/complaints/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segment_id: form.segmentId,
          complaint_heading: form.category,
          description: form.description,
          citizen_name: form.citizen,
          contact: form.contact,
          severity: form.severity,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const newC = fromApiComplaint(data);
        newC.citizen = form.citizen;
        newC.contact = form.contact;
        newC.severity = form.severity;
        newC.status = 'nil';
        setComplaints(prev => [newC, ...prev]);
        notify('Complaint submitted with status nil · Awaiting admin review');
        return true;
      }
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Complaint submission failed (${res.status})`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Complaint could not be saved.');
      return false;
    }
  };

  const executeRepair = async (payload: RepairActionPayload): Promise<boolean> => {
    const comp = complaints.find(c => c.id === payload.complaintId);
    const targetSegment = segmentsList.find(s => s.id === comp?.segmentId);
    if (!comp || !targetSegment) {
      notify('Repair was not saved: complaint or road segment could not be found.');
      return false;
    }

    let newPci = 100;
    let newHealth: Health = 'Good';
    let newCracking = 0.0;
    let newRaveling = 0.0;
    let newRutting = 0.0;
    let newPatching = 0.0;
    let newIri = 1.2;

    let repairTimestamp: string | undefined;
    let databasePersisted = false;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch(`${API_BASE}/api/admin/repair`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          complaint_id: payload.complaintId,
          repair_type: payload.repairType,
          segment_id: targetSegment.id,
          patch_length_m: payload.patchLength,
          patch_width_m: payload.patchWidth,
          notes: payload.notes,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        databasePersisted = data.database_persisted === true;
        const m = data.segment_metrics;
        if (m) {
          newPci = Math.round(m.pci_score);
          newHealth = m.road_health as Health;
          newCracking = m.cracking_pct;
          newRaveling = m.raveling_pct;
          newRutting = m.rut_depth_mm;
          newPatching = m.patching_pct;
          newIri = m.iri_m_km;
          repairTimestamp = data.updated_at;
        } else {
          throw new Error('Repair response did not include updated road metrics.');
        }
      } else {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Repair request failed (${res.status}).`);
      }
    } catch (error) {
      console.error('Repair API failed:', error);
      notify(error instanceof Error ? error.message : 'Repair could not be saved.');
      return false;
    }

    if (!repairTimestamp) {
      notify('Repair was not saved: the server returned no repair timestamp.');
      return false;
    }

    // 1. Update segment in state instantly
    setSegmentsList(prev =>
      prev.map(s => {
        if (s.id === targetSegment.id) {
          return {
            ...s,
            cracking: Number(newCracking.toFixed(2)),
            raveling: Number(newRaveling.toFixed(2)),
            rutting: Number(newRutting.toFixed(2)),
            patching: Number(newPatching.toFixed(2)),
            iri: Number(newIri.toFixed(2)),
            pci: newPci,
            health: newHealth,
          };
        }
        return s;
      })
    );

    // 2. Update complaint status to Repaired instantly
    setComplaints(prev =>
      prev.map(c => {
        if (c.id === payload.complaintId) {
          return {
            ...c,
            status: 'Repaired',
            repairType: payload.repairType,
            repairedAt: repairTimestamp,
          };
        }
        return c;
      })
    );

    // 3. Log time-series event for Trends page
    const fullDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const logItem: TrendPoint = {
      date: new Date().toISOString().slice(5, 10),
      fullDate: `${fullDate} ${timeStr}`,
      pci: newPci,
      health: newHealth,
      event: payload.repairType === 'PATCHING' ? 'Patching Applied' : 'Full Resurfacing Executed',
    };

    setTrendLogs(prev => ({
      ...prev,
      [targetSegment.id]: [...(prev[targetSegment.id] || []), logItem],
    }));

    await refreshRepairBuckets();

    const actionText = payload.repairType === 'PATCHING' ? 'Patching completed' : 'Full resurfacing completed';
    notify(`${actionText} for ${targetSegment.name} · New PCI: ${newPci} (${newHealth})${databasePersisted ? '' : ' · development memory only'}`);
    return true;
  };

  const repair = (id: string) => {
    executeRepair({ complaintId: id, repairType: 'FULL_RESURFACING' });
  };

  const value = useMemo<AppState>(
    () => ({
      role,
      user,
      authToken,
      loggedIn,
      login: (name, email, token, assignedRole) => {
        setUser({ name, email });
        setAuthToken(token);
        setRole(assignedRole);
        window.sessionStorage.setItem('digiroad-user', JSON.stringify({ name, email }));
        window.sessionStorage.setItem('digiroad-role', assignedRole);
        window.sessionStorage.setItem('digiroad-token', token);
        setLoggedIn(true);
      },
      logout: () => {
        setLoggedIn(false);
        setAuthToken(null);
        setRole('public');
        window.sessionStorage.removeItem('digiroad-token');
        window.sessionStorage.removeItem('digiroad-role');
        window.sessionStorage.removeItem('digiroad-user');
      },
      segments: segmentsList,
      setSegments: setSegmentsList,
      complaints,
      recentRepairIds,
      archivedRepairIds,
      refreshRepairBuckets,
      addComplaint,
      markUnderProcess,
      repair,
      executeRepair,
      trendLogs,
      toast,
      notify,
    }),
    [role, user, authToken, loggedIn, segmentsList, complaints, recentRepairIds, archivedRepairIds, refreshRepairBuckets, trendLogs, toast]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppStateProvider missing');
  return v;
}
