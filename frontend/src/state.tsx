import React, { createContext, useContext, useMemo, useState } from 'react';

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
  status: 'Under Progress' | 'Repaired';
  created: string;
  repairedAt?: string;
  repairType?: 'PATCHING' | 'FULL_RESURFACING';
};

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
    id: 'SEG-101',
    name: 'Kazhakkoottam Main Road',
    cracking: 22.4,
    raveling: 14.8,
    rutting: 5.2,
    patching: 0.8,
    iri: 4.2,
    pci: 34,
    health: 'Very Poor',
    coords: [
      [8.5682, 76.8737],
      [8.5695, 76.8794],
      [8.5708, 76.8858],
      [8.5717, 76.8912],
    ],
  },
  {
    id: 'SEG-102',
    name: 'Mangalapuram Junction Road',
    cracking: 13.2,
    raveling: 8.1,
    rutting: 3.4,
    patching: 0.5,
    iri: 3.1,
    pci: 61,
    health: 'Fair',
    coords: [
      [8.6078, 76.8768],
      [8.6014, 76.8815],
      [8.5955, 76.8864],
      [8.5906, 76.8928],
    ],
  },
  {
    id: 'SEG-103',
    name: 'Technopark Access Road',
    cracking: 4.6,
    raveling: 2.8,
    rutting: 1.1,
    patching: 0.2,
    iri: 1.7,
    pci: 86,
    health: 'Good',
    coords: [
      [8.5579, 76.8788],
      [8.5625, 76.8821],
      [8.5662, 76.8842],
      [8.5702, 76.8859],
    ],
  },
];

const seed: Complaint[] = [
  {
    id: 'CMP-2418',
    citizen: 'Anjali Nair',
    contact: '••••• 4821',
    segmentId: 'SEG-101',
    category: 'Pothole',
    severity: 'High',
    description: 'Deep pothole near the bus stop is forcing two-wheelers into traffic.',
    status: 'Under Progress',
    created: 'Today, 09:42',
  },
  {
    id: 'CMP-2416',
    citizen: 'R. Suresh',
    contact: '••••• 7104',
    segmentId: 'SEG-102',
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
    segmentId: 'SEG-103',
    category: 'Drainage',
    severity: 'Low',
    description: 'Water collects along the curb after heavy rain.',
    status: 'Repaired',
    created: '12 Oct, 11:06',
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
  addComplaint: (c: Omit<Complaint, 'id' | 'status' | 'created'>) => void;
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
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(true);
  const [users, setUsers] = useState(['engineer@digiroad.local', 'admin@digiroad.gov']);
  const [segmentsList, setSegmentsList] = useState<Segment[]>(defaultSegments);
  const [complaints, setComplaints] = useState<Complaint[]>(seed);
  const [trendLogs, setTrendLogs] = useState<Record<string, TrendPoint[]>>({});
  const [toast, setToast] = useState('');

  const notify = (s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(''), 3500);
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

    // Fallback deterministic formula calculation if API not reachable
    if (!apiSuccess) {
      if (payload.repairType === 'PATCHING') {
        const pLen = payload.patchLength || 10.0;
        const pWid = payload.patchWidth || 3.0;
        const deltaArea = pLen * pWid;
        const totalArea = 1000.0 * 7.0; // Standard 1km x 7m carriageway
        const deltaPatchingPct = (deltaArea / totalArea) * 100.0;

        newPatching = Math.min(100.0, targetSegment.patching + deltaPatchingPct);
        const deltaCrackingPct = deltaPatchingPct / 1.3;
        newCracking = Math.max(0.0, targetSegment.cracking - deltaCrackingPct);
        newRaveling = Math.max(0.0, targetSegment.raveling * (1.0 - deltaPatchingPct / 100.0));
        const deltaRutting = targetSegment.rutting * (0.8 * (deltaPatchingPct / 100.0));
        newRutting = Math.max(0.0, targetSegment.rutting - deltaRutting);

        const a1 = 0.005;
        const a4 = 0.003;
        const a2 = 0.002;
        const deltaIri = -(a1 * deltaCrackingPct + a4 * deltaRutting) + a2 * deltaPatchingPct;
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
            repairedAt: 'Just now',
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
      addComplaint: c => {
        setComplaints(v => [
          {
            ...c,
            id: `CMP-${Math.floor(2400 + Math.random() * 500)}`,
            status: 'Under Progress',
            created: 'Just now',
          },
          ...v,
        ]);
        notify('Complaint submitted · Municipal team notified');
      },
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
