import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
// Copy of backend/app/data/road_geometry.json ([lon, lat]); keep both in sync.
import roadGeometry from './roadGeometry.json';

// Road-snapped [lat, lon] path for a segment, so the map is right even before the API answers.
const snappedCoords = (id: keyof typeof roadGeometry): [number, number][] =>
  roadGeometry[id].map(([lon, lat]) => [lat, lon] as [number, number]);

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
  photoUrl?: string;
  priority?: 'P1' | 'P2' | 'P3' | 'P4';
  prioritySource?: 'auto' | 'admin';
  lat?: number; // exact damage location, when the reporter set a pin, GPS fix or photo geotag
  lng?: number;
};

export type ComplaintForm = Omit<Complaint, 'id' | 'status' | 'created' | 'photoUrl' | 'priority' | 'prioritySource'> & { consent: boolean; website: string; photo: string };

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
  photo_url?: string | null;
  priority?: string | null;
  priority_source?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export function normalizeStatus(st?: string | null): 'nil' | 'Under Progress' | 'Repaired' {
  const s = (st || '').trim().toLowerCase();
  if (s === 'repaired') return 'Repaired';
  if (s === 'under process' || s === 'under_process' || s === 'under progress') return 'Under Progress';
  return 'nil';
}

export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  'https://digiroad-2.onrender.com'
).replace(/\/+$/, '');

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
    photoUrl: row.photo_url || undefined,
    priority: ['P1', 'P2', 'P3', 'P4'].includes(row.priority || '') ? row.priority as Complaint['priority'] : undefined,
    prioritySource: row.priority_source === 'admin' ? 'admin' : 'auto',
    lat: row.latitude ?? undefined,
    lng: row.longitude ?? undefined,
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
    coords: snappedCoords('MDR47-S01'),
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
    coords: snappedCoords('MDR47-S02'),
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
    coords: snappedCoords('MDR47-S03'),
  },
];

// Same bands as the backend decay model (app/services/decay_model.py: calculate_road_health).
export function classifyHealth(pci: number): Health {
  if (pci >= 85) return 'Good';
  if (pci >= 70) return 'Fair';
  if (pci >= 55) return 'Poor';
  return 'Very Poor';
}

type AppState = {
  role: 'public' | 'admin';
  user: { name: string; email: string };
  authToken: string | null;
  loggedIn: boolean;
  login: (name: string, email: string, token: string, role: 'public' | 'admin', refreshToken?: string | null) => void;
  logout: () => void;
  segments: Segment[];
  setSegments: React.Dispatch<React.SetStateAction<Segment[]>>;
  complaints: Complaint[];
  recentRepairIds: string[];
  archivedRepairIds: string[];
  refreshRepairBuckets: () => Promise<void>;
  liveData: boolean; // true once road values have loaded from dynamic_road_evaluations
  addComplaint: (c: ComplaintForm) => Promise<boolean>;
  markUnderProcess: (id: string) => Promise<boolean>;
  setPriority: (id: string, priority: NonNullable<Complaint['priority']>) => Promise<boolean>;
  repair: (id: string) => void;
  executeRepair: (payload: RepairActionPayload) => Promise<boolean>;
  trendLogs: Record<string, TrendPoint[]>;
  toast: string;
  notify: (s: string) => void;
  lang: 'en' | 'ml';
  setLang: (l: 'en' | 'ml') => void;
};

// Complaints filed without signal wait here (localStorage) and are sent when the connection returns.
const OUTBOX_KEY = 'digiroad-outbox';
const readOutbox = (): Record<string, unknown>[] => {
  try { return JSON.parse(window.localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; }
};
const writeOutbox = (items: Record<string, unknown>[]) => window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<'public' | 'admin'>(() => window.localStorage.getItem('digiroad-role') === 'admin' ? 'admin' : 'public');
  const [user, setUser] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem('digiroad-user') || '{"name":"","email":""}'); }
    catch { return { name: '', email: '' }; }
  });
  const [authToken, setAuthToken] = useState<string | null>(() => window.localStorage.getItem('digiroad-token'));
  const [loggedIn, setLoggedIn] = useState(() => Boolean(window.localStorage.getItem('digiroad-token')));
  const [segmentsList, setSegmentsList] = useState<Segment[]>(defaultSegments);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [recentRepairIds, setRecentRepairIds] = useState<string[]>([]);
  const [archivedRepairIds, setArchivedRepairIds] = useState<string[]>([]);
  const [liveData, setLiveData] = useState(false);
  const [trendLogs, setTrendLogs] = useState<Record<string, TrendPoint[]>>({});
  const [toast, setToast] = useState('');
  const [lang, setLangState] = useState<'en' | 'ml'>(() => window.localStorage.getItem('digiroad-lang') === 'ml' ? 'ml' : 'en');
  const setLang = (l: 'en' | 'ml') => { setLangState(l); window.localStorage.setItem('digiroad-lang', l); };

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

  // Send complaints queued while offline, oldest first. Stops at the first network error or 429 and tries again later.
  const flushOutbox = useCallback(async () => {
    if (!authToken || !navigator.onLine) return;
    let items = readOutbox();
    while (items.length) {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/complaints/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify(items[0]),
        });
      } catch {
        return;
      }
      // Keep it for later on rate limit, expired sign-in or server trouble; drop only if the server rejects the content.
      if (res.status === 429 || res.status === 401 || res.status >= 500) return;
      const body = await res.json().catch(() => ({}));
      setToast(res.ok ? `Offline complaint sent as #${body.complaint_id}.` : `An offline complaint was rejected: ${body.detail || res.status}`);
      window.setTimeout(() => setToast(''), 3500);
      items = items.slice(1);
      writeOutbox(items);
    }
  }, [authToken]);

  // Reload complaints (all users) and live road values (dynamic_road_evaluations) from the backend.
  const refreshAll = useCallback(async () => {
    if (!authToken) return;
    await flushOutbox();
    const headers = { Authorization: `Bearer ${authToken}` };
    await Promise.all([
      fetch(`${API_BASE}/api/complaints`, { headers }).then(res => (res.ok ? res.json() : null)).catch(() => null),
      fetch(`${API_BASE}/api/home/map-data`).then(res => (res.ok ? res.json() : null)).catch(() => null),
    ])
      .then(([apiComplaints, mapData]) => {
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
              cracking: p.cracking_pct ?? 0,
              raveling: p.raveling_pct ?? 0,
              rutting: p.rut_depth_mm ?? 0,
              patching: p.patching_pct ?? 0,
              iri: p.iri_m_km ?? 1.2,
              pci: p.pci_score ?? 0,
              health: (p.road_health as Health) || classifyHealth(p.pci_score || 0),
              coords: coords.length ? coords : [[8.6321, 76.9206], [8.6267, 76.9159]],
            };
          });
          if (segs.length) {
            setSegmentsList(segs);
            setLiveData(true);
          }
        }
      });
    await refreshRepairBuckets();
  }, [authToken, refreshRepairBuckets, flushOutbox]);

  useEffect(() => {
    if (!authToken || !loggedIn) return;
    void refreshAll();
    // Poll so complaints from other users, admin status changes and the weekly road update appear without re-login.
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshAll();
    }, 30000);
    const onFocus = () => void refreshAll();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [authToken, loggedIn, refreshAll]);

  // Keep users signed in across visits: swap the stored refresh token for a fresh access token
  // on load and every 45 minutes (Supabase access tokens last 1 hour).
  useEffect(() => {
    if (!loggedIn) return;
    const renew = async () => {
      const refresh = window.localStorage.getItem('digiroad-refresh');
      if (!refresh) return;
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        if (res.status === 401) {
          // Refresh token revoked or expired: sign out cleanly.
          ['digiroad-token', 'digiroad-role', 'digiroad-user', 'digiroad-refresh'].forEach(k => window.localStorage.removeItem(k));
          setAuthToken(null);
          setLoggedIn(false);
          return;
        }
        if (!res.ok) return; // server waking up: keep current token, try again next tick
        const data = await res.json();
        const nextRole = data.role === 'admin' ? 'admin' : 'public';
        setAuthToken(data.access_token);
        setRole(nextRole);
        window.localStorage.setItem('digiroad-token', data.access_token);
        window.localStorage.setItem('digiroad-role', nextRole);
        if (data.refresh_token) window.localStorage.setItem('digiroad-refresh', data.refresh_token);
      } catch {
        /* offline: try again next tick */
      }
    };
    void renew();
    const timer = window.setInterval(renew, 45 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [loggedIn]);

  const NETWORK_MSG = 'Server not reachable (it may be waking up or redeploying). Wait 30 seconds and try again.';

  const notify = (s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(''), 3500);
  };

  const markUnderProcess = async (id: string): Promise<boolean> => {
    const send = () => fetch(`${API_BASE}/api/complaints/${encodeURIComponent(id)}/under-process`, {
      method: 'PATCH',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    });
    try {
      let retried = false;
      let res: Response;
      try {
        res = await send();
      } catch (err) {
        if (!(err instanceof TypeError)) throw err;
        // Network drop (Render cold start / redeploy): the move is idempotent, so retry once.
        await new Promise(r => window.setTimeout(r, 4000));
        retried = true;
        res = await send();
      }
      // 409 after a retry means the first attempt already moved it.
      if (res.ok || (retried && res.status === 409)) {
        setComplaints(prev =>
          prev.map(c => (c.id === id ? { ...c, status: 'Under Progress' } : c))
        );
        notify(`Complaint #${id} moved to Under progress`);
        return true;
      }
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Status update failed (${res.status})`);
    } catch (err) {
      notify(err instanceof TypeError ? NETWORK_MSG : err instanceof Error ? err.message : 'Could not update complaint status.');
      void refreshAll();
      return false;
    }
  };

  // Admin override of the automatic priority.
  const setPriority = async (id: string, priority: NonNullable<Complaint['priority']>): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/complaints/${encodeURIComponent(id)}/priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ priority }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Priority update failed (${res.status})`);
      }
      setComplaints(prev => prev.map(c => (c.id === id ? { ...c, priority, prioritySource: 'admin' } : c)));
      notify(`Complaint #${id} set to ${priority}`);
      return true;
    } catch (err) {
      notify(err instanceof TypeError ? NETWORK_MSG : err instanceof Error ? err.message : 'Could not update priority.');
      return false;
    }
  };

  const addComplaint = async (form: ComplaintForm): Promise<boolean> => {
    const payload = {
      segment_id: form.segmentId,
      complaint_heading: form.category,
      description: form.description,
      citizen_name: form.citizen,
      contact: form.contact,
      severity: form.severity,
      consent: form.consent,
      website: form.website,
      photo_base64: form.photo || undefined,
      latitude: form.lat,
      longitude: form.lng,
    };
    const queue = () => {
      try {
        writeOutbox([...readOutbox(), payload]);
        notify('No connection. Complaint saved on this device and will be sent automatically.');
        return true;
      } catch {
        notify('No connection, and this device has no room to store the complaint. Try without the photo.');
        return false;
      }
    };
    if (!navigator.onLine) return queue();
    try {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/api/complaints/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        if (err instanceof TypeError) return queue();
        throw err;
      }
      if (res.ok) {
        const data = await res.json();
        const newC = fromApiComplaint(data);
        newC.citizen = form.citizen;
        newC.contact = form.contact;
        newC.severity = form.severity;
        newC.status = 'nil';
        setComplaints(prev => [newC, ...prev]);
        notify(`Complaint #${newC.id} submitted${newC.priority ? ` (priority ${newC.priority})` : ''}. Use this number on Track complaint to follow it.`);
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
          newPci = m.pci_score;
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
      // No auto-retry here: repeating a patch would apply the formula twice.
      notify(error instanceof TypeError ? NETWORK_MSG : error instanceof Error ? error.message : 'Repair could not be saved.');
      void refreshAll();
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
            cracking: newCracking,
            raveling: newRaveling,
            rutting: newRutting,
            patching: newPatching,
            iri: newIri,
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
      date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(5, 10),
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
      login: (name, email, token, assignedRole, refreshToken) => {
        if (refreshToken) window.localStorage.setItem('digiroad-refresh', refreshToken);
        setUser({ name, email });
        setAuthToken(token);
        setRole(assignedRole);
        window.localStorage.setItem('digiroad-user', JSON.stringify({ name, email }));
        window.localStorage.setItem('digiroad-role', assignedRole);
        window.localStorage.setItem('digiroad-token', token);
        setLoggedIn(true);
      },
      logout: () => {
        setLoggedIn(false);
        setAuthToken(null);
        setRole('public');
        window.localStorage.removeItem('digiroad-token');
        window.localStorage.removeItem('digiroad-role');
        window.localStorage.removeItem('digiroad-user');
        window.localStorage.removeItem('digiroad-refresh');
      },
      segments: segmentsList,
      setSegments: setSegmentsList,
      complaints,
      recentRepairIds,
      archivedRepairIds,
      refreshRepairBuckets,
      liveData,
      addComplaint,
      markUnderProcess,
      setPriority,
      repair,
      executeRepair,
      trendLogs,
      toast,
      notify,
      lang,
      setLang,
    }),
    [role, user, authToken, loggedIn, segmentsList, complaints, recentRepairIds, archivedRepairIds, refreshRepairBuckets, liveData, trendLogs, toast, lang]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppStateProvider missing');
  return v;
}
