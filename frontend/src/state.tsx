import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

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
    repairType: row.repair_type === 'PATCHING' || row.repair_type === 'FULL_RESURFACING' ? row.repair_type : undefined,
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
  setRole: (r: 'public' | 'admin') => void;
  user: { name: string; email: string };
  authToken: string | null;
  loggedIn: boolean;
  login: (name: string, email: string, token?: string) => void;
  logout: () => void;
  users: string[];
  signup: (name: string, email: string, password: string) => boolean;
  segments: Segment[];
  setSegments: React.Dispatch<React.SetStateAction<Segment[]>>;
  complaints: Complaint[];
  addComplaint: (c: Omit<Complaint, 'id' | 'status' | 'created'>) => Promise<void>;
  markUnderProcess: (id: string) => Promise<boolean>;
  repair: (id: string) => void;
  executeRepair: (payload: RepairActionPayload) => Promise<boolean>;
  trendLogs: Record<string, TrendPoint[]>;
  toast: string;
  notify: (s: string) => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<'public' | 'admin'>('admin');
  const [user, setUser] = useState({ name: 'Demo Administrator', email: 'admin@digiroad.gov' });
  const [authToken, setAuthToken] = useState<string | null>('demo-admin-token');
  const [loggedIn, setLoggedIn] = useState(true);
  const [users, setUsers] = useState(['engineer@digiroad.local', 'admin@digiroad.gov']);
  const [segmentsList, setSegmentsList] = useState<Segment[]>(defaultSegments);
  const [complaints, setComplaints] = useState<Complaint[]>(seed);
  const [trendLogs, setTrendLogs] = useState<Record<string, TrendPoint[]>>({});
  const [toast, setToast] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/complaints').then(res => (res.ok ? res.json() : null)),
      fetch('/api/home/map-data').then(res => (res.ok ? res.json() : null)),
    ])
      .then(([apiComplaints, mapData]) => {
        if (!alive) return;
        if (Array.isArray(apiComplaints) && apiComplaints.length > 0) {
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
    return () => {
      alive = false;
    };
  }, []);

  const notify = (s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(''), 3500);
  };

  const markUnderProcess = async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/complaints/${encodeURIComponent(id)}/under-process`, {
        method: 'PATCH',
      });
      if (res.ok) {
        setComplaints(prev =>
          prev.map(c => (c.id === id ? { ...c, status: 'Under Progress' } : c))
        );
        notify(`Complaint #${id} updated to Under Process · Now active on Home`);
        return true;
      }
    } catch (err) {
      console.warn('API update under-process failed, applying locally:', err);
    }
    setComplaints(prev =>
      prev.map(c => (c.id === id ? { ...c, status: 'Under Progress' } : c))
    );
    notify(`Complaint #${id} updated to Under Process · Now active on Home`);
    return true;
  };

  const addComplaint = async (form: Omit<Complaint, 'id' | 'status' | 'created'>) => {
    try {
      const res = await fetch('/api/complaints/generate', {
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
        return;
      }
    } catch (err) {
      console.warn('API generate complaint failed, storing locally:', err);
    }

    const fallbackC: Complaint = {
      ...form,
      id: `CMP-${Math.floor(2400 + Math.random() * 500)}`,
      status: 'nil',
      created: 'Just now',
    };
    setComplaints(prev => [fallbackC, ...prev]);
    notify('Complaint submitted with status nil · Awaiting admin review');
  };

  const executeRepair = async (payload: RepairActionPayload): Promise<boolean> => {
    const comp = complaints.find(c => c.id === payload.complaintId);
    const targetSegment = segmentsList.find(s => s.id === comp?.segmentId) || segmentsList[0];

    let newPci = 100;
    let newHealth: Health = 'Good';
    let newCracking = 0.0;
    let newRaveling = 0.0;
    let newRutting = 0.0;
    let newPatching = 0.0;
    let newIri = 1.2;

    // Try calling backend API
    let apiSuccess = false;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch('/api/admin/repair', {
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
        const m = data.segment_metrics;
        if (m) {
          newPci = Math.round(m.pci_score);
          newHealth = m.road_health as Health;
          newCracking = m.cracking_pct;
          newRaveling = m.raveling_pct;
          newRutting = m.rut_depth_mm;
          newPatching = m.patching_pct;
          newIri = m.iri_m_km;
          apiSuccess = true;
        }
      }
    } catch {
      apiSuccess = false;
    }

    // Deterministic formula calculation reducing cracking, rutting, patching, and IRI
    if (!apiSuccess) {
      if (payload.repairType === 'PATCHING') {
        const pLen = payload.patchLength || 10.0;
        const pWid = payload.patchWidth || 3.0;
        const deltaArea = pLen * pWid;
        const totalArea = 1000.0 * 7.0; // Standard 1km x 7m carriageway
        const deltaPatchingPct = (deltaArea / totalArea) * 100.0;

        // Patching distress is restored and reduced
        newPatching = Math.max(0.0, targetSegment.patching * (1.0 - deltaPatchingPct / 100.0));
        const deltaCrackingPct = deltaPatchingPct / 1.3;
        newCracking = Math.max(0.0, targetSegment.cracking - deltaCrackingPct);
        newRaveling = Math.max(0.0, targetSegment.raveling * (1.0 - deltaPatchingPct / 100.0));
        const deltaRutting = targetSegment.rutting * (0.8 * (deltaPatchingPct / 100.0));
        newRutting = Math.max(0.0, targetSegment.rutting - deltaRutting);

        const a1 = 0.005;
        const a4 = 0.003;
        const a2 = 0.002;
        const deltaIri = -(a1 * deltaCrackingPct + a4 * deltaRutting + a2 * (targetSegment.patching - newPatching));
        newIri = Math.max(1.2, targetSegment.iri + deltaIri);

        const deduct =
          newCracking * 0.4 +
          newRaveling * 0.3 +
          newRutting * 1.5 +
          newPatching * 0.2 +
          (newIri - 1.2) * 8.0;

        newPci = Math.round(Math.max(0, Math.min(100, 100 - deduct)));
        newHealth = classifyHealth(newPci);
      } else {
        newCracking = 0.0;
        newRaveling = 0.0;
        newRutting = 0.0;
        newPatching = 0.0;
        newIri = 1.2;
        newPci = 100;
        newHealth = 'Good';
      }
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
            repairedAt: new Date().toISOString(),
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

    const actionText = payload.repairType === 'PATCHING' ? 'Patching completed' : 'Full resurfacing completed';
    notify(`${actionText} for ${targetSegment.name} · New PCI: ${newPci} (${newHealth})`);
    return true;
  };

  const repair = (id: string) => {
    executeRepair({ complaintId: id, repairType: 'FULL_RESURFACING' });
  };

  const value = useMemo<AppState>(
    () => ({
      role,
      setRole,
      user,
      authToken,
      loggedIn,
      login: (name, email, token) => {
        setUser({ name, email });
        if (token) setAuthToken(token);
        setLoggedIn(true);
      },
      logout: () => {
        setLoggedIn(false);
        setAuthToken(null);
      },
      users,
      signup: (name, email, _password) => {
        if (users.includes(email.toLowerCase())) return false;
        setUsers(v => [...v, email.toLowerCase()]);
        setUser({ name, email });
        setLoggedIn(true);
        return true;
      },
      segments: segmentsList,
      setSegments: setSegmentsList,
      complaints,
      addComplaint,
      markUnderProcess,
      repair,
      executeRepair,
      trendLogs,
      toast,
      notify,
    }),
    [role, user, authToken, loggedIn, users, segmentsList, complaints, trendLogs, toast]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppStateProvider missing');
  return v;
}
