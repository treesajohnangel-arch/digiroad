// Citizen-facing pieces: complaint tracking, privacy notice, nearest-segment lookup,
// plain-language road explainer, and English/Malayalam text for the complaint form.
import React, { useState } from 'react';
import { API_BASE, Health, Segment, useApp } from './state';

export type Lang = 'en' | 'ml';

// Malayalam strings: have a native speaker review before public launch.
export const T = {
  en: {
    title: 'Report a road issue', kicker: 'Citizen feedback', name: 'Your name', contact: 'Contact number',
    segment: 'Road segment', locate: 'Use my location', locating: 'Finding your location…',
    located: (n: string, m: number) => `Nearest segment: ${n} (${m} m away)`,
    locateFail: 'Could not get your location. Choose the segment from the list.',
    pinHint: 'Or tap the map where the problem is.',
    photo: 'Photo (optional)', photoRemove: 'Remove photo', photoFail: 'Could not read this image. Try another photo.',
    category: 'Issue category', severity: 'Severity', description: 'Description', descHint: 'Location and condition',
    consent: 'I agree that DigiRoad stores my name and contact number to follow up on this complaint, as described in the',
    privacy: 'privacy notice', cancel: 'Cancel', submit: 'Submit complaint', lang: 'മലയാളം',
    services: 'Citizen services', safeQ: 'Is this road safe?',
    trackTitle: 'Track my complaint', trackIntro: 'Enter the complaint number you got after submitting, for example 27.',
    trackLabel: 'Complaint number', track: 'Track', looking: 'Looking…', lookupFail: 'Lookup failed.',
    segLabel: 'Segment', statusLabel: 'Status', reported: 'Reported', repaired: 'Repaired', patching: 'Patching', fullRepair: 'Full repair',
    status: {
      nil: 'Received. Waiting for an engineer to review it.',
      'under process': 'Under progress. A repair crew has been assigned.',
      repaired: 'Repaired.',
    } as Record<string, string>,
    fixedQ: 'Is the road fixed?', fixedYes: 'Yes, it is fixed', fixedNo: 'No, still damaged', yourFeedback: 'Your feedback:',
    thanksYes: 'Thank you for confirming the repair.', thanksNo: 'Thank you. Engineers will see that the road is not fixed.',
    feedbackFail: 'Feedback could not be saved.',
    plain: {
      Good: 'Safe and smooth. Normal driving, no special care needed.',
      Fair: 'Usable, with some cracks. Drive normally but watch for small rough patches.',
      Poor: 'Worn surface with cracks and bumps. Slow down, especially two-wheelers and at night.',
      'Very Poor': 'Badly damaged: potholes and broken surface likely. Drive slowly, keep distance, avoid in heavy rain if you can.',
    } as Record<Health, string>,
    privacyTitle: 'Privacy notice',
    privacyBody: [
      ['What we collect.', 'When you sign in: your Google name and email. When you report a road issue: your name, contact number, the road segment, your description, and any photo you add.'],
      ['Why.', 'Only to verify reports, contact you about the repair, and plan road maintenance. We do not sell or share your details. Road condition data is published as open data without any personal details.'],
      ['Who sees it.', 'Your name and number are visible only to DigiRoad administrators. Other users see the complaint without your identity. Photos are stored at a hard-to-guess web link, and anyone with that link can see them, so avoid faces and number plates.'],
      ['How long.', 'Your name and contact number are deleted automatically 180 days after the complaint is repaired. The complaint text, photo and repair record are kept for maintenance history.'],
      ['Your choices.', 'You can ask us to correct or delete your details at any time through the municipal road office. Giving your name and number is your choice; we ask for your consent each time.'],
    ],
    privacyDraft: 'This notice is a draft and should be reviewed for the Digital Personal Data Protection Act, 2023 before public launch.',
  },
  ml: {
    title: 'റോഡ് പ്രശ്നം റിപ്പോർട്ട് ചെയ്യുക', kicker: 'പൗരന്മാരുടെ പരാതി', name: 'നിങ്ങളുടെ പേര്', contact: 'ഫോൺ നമ്പർ',
    segment: 'റോഡ് ഭാഗം', locate: 'എന്റെ സ്ഥാനം ഉപയോഗിക്കുക', locating: 'സ്ഥാനം കണ്ടെത്തുന്നു…',
    located: (n: string, m: number) => `ഏറ്റവും അടുത്ത ഭാഗം: ${n} (${m} മീ. അകലെ)`,
    locateFail: 'സ്ഥാനം ലഭിച്ചില്ല. പട്ടികയിൽ നിന്ന് റോഡ് ഭാഗം തിരഞ്ഞെടുക്കുക.',
    pinHint: 'അല്ലെങ്കിൽ പ്രശ്നമുള്ള സ്ഥലത്ത് മാപ്പിൽ തൊടുക.',
    photo: 'ഫോട്ടോ (ഐച്ഛികം)', photoRemove: 'ഫോട്ടോ നീക്കുക', photoFail: 'ഈ ചിത്രം വായിക്കാനായില്ല. മറ്റൊരു ഫോട്ടോ ശ്രമിക്കുക.',
    category: 'പ്രശ്നത്തിന്റെ തരം', severity: 'ഗൗരവം', description: 'വിവരണം', descHint: 'സ്ഥലവും അവസ്ഥയും',
    consent: 'ഈ പരാതിയുടെ തുടർനടപടിക്കായി എന്റെ പേരും ഫോൺ നമ്പറും DigiRoad സൂക്ഷിക്കുന്നതിന് ഞാൻ സമ്മതിക്കുന്നു. വിശദാംശങ്ങൾ:',
    privacy: 'സ്വകാര്യതാ അറിയിപ്പ്', cancel: 'റദ്ദാക്കുക', submit: 'പരാതി സമർപ്പിക്കുക', lang: 'English',
    services: 'പൗര സേവനങ്ങൾ', safeQ: 'ഈ റോഡ് സുരക്ഷിതമാണോ?',
    trackTitle: 'എന്റെ പരാതി ട്രാക്ക് ചെയ്യുക', trackIntro: 'പരാതി സമർപ്പിച്ചപ്പോൾ ലഭിച്ച നമ്പർ നൽകുക, ഉദാഹരണം 27.',
    trackLabel: 'പരാതി നമ്പർ', track: 'നോക്കുക', looking: 'തിരയുന്നു…', lookupFail: 'പരാതി കണ്ടെത്താനായില്ല.',
    segLabel: 'റോഡ് ഭാഗം', statusLabel: 'നില', reported: 'റിപ്പോർട്ട് ചെയ്തത്', repaired: 'നന്നാക്കിയത്', patching: 'പാച്ചിംഗ്', fullRepair: 'പൂർണ്ണ അറ്റകുറ്റപ്പണി',
    status: {
      nil: 'ലഭിച്ചു. എഞ്ചിനീയറുടെ പരിശോധനയ്ക്കായി കാത്തിരിക്കുന്നു.',
      'under process': 'നടപടിയിലാണ്. അറ്റകുറ്റപ്പണി സംഘത്തെ നിയോഗിച്ചു.',
      repaired: 'നന്നാക്കി.',
    } as Record<string, string>,
    fixedQ: 'റോഡ് നന്നാക്കിയോ?', fixedYes: 'അതെ, നന്നാക്കി', fixedNo: 'ഇല്ല, ഇപ്പോഴും കേടാണ്', yourFeedback: 'നിങ്ങളുടെ പ്രതികരണം:',
    thanksYes: 'റോഡ് നന്നാക്കിയെന്ന് സ്ഥിരീകരിച്ചതിന് നന്ദി.', thanksNo: 'നന്ദി. റോഡ് നന്നാക്കിയിട്ടില്ലെന്ന് എഞ്ചിനീയർമാർ കാണും.',
    feedbackFail: 'പ്രതികരണം സൂക്ഷിക്കാനായില്ല.',
    plain: {
      Good: 'സുരക്ഷിതവും സുഗമവുമാണ്. സാധാരണ പോലെ ഓടിക്കാം.',
      Fair: 'ഉപയോഗിക്കാം, ചില വിള്ളലുകളുണ്ട്. സാധാരണ പോലെ ഓടിക്കുക, ചെറിയ കുഴികൾ ശ്രദ്ധിക്കുക.',
      Poor: 'പ്രതലം തേഞ്ഞിരിക്കുന്നു, വിള്ളലുകളും കുലുക്കവുമുണ്ട്. വേഗം കുറയ്ക്കുക, പ്രത്യേകിച്ച് ഇരുചക്രവാഹനങ്ങളും രാത്രിയിലും.',
      'Very Poor': 'ഗുരുതരമായി തകർന്നിരിക്കുന്നു: കുഴികളും പൊട്ടിയ പ്രതലവും ഉണ്ടാകാം. പതുക്കെ ഓടിക്കുക, അകലം പാലിക്കുക, കനത്ത മഴയിൽ കഴിയുമെങ്കിൽ ഒഴിവാക്കുക.',
    } as Record<Health, string>,
    privacyTitle: 'സ്വകാര്യതാ അറിയിപ്പ്',
    privacyBody: [
      ['ഞങ്ങൾ ശേഖരിക്കുന്നത്.', 'സൈൻ ഇൻ ചെയ്യുമ്പോൾ: നിങ്ങളുടെ Google പേരും ഇമെയിലും. റോഡ് പ്രശ്നം റിപ്പോർട്ട് ചെയ്യുമ്പോൾ: നിങ്ങളുടെ പേര്, ഫോൺ നമ്പർ, റോഡ് ഭാഗം, വിവരണം, നിങ്ങൾ ചേർക്കുന്ന ഫോട്ടോ.'],
      ['എന്തിന്.', 'റിപ്പോർട്ടുകൾ പരിശോധിക്കാനും അറ്റകുറ്റപ്പണിയെക്കുറിച്ച് നിങ്ങളെ ബന്ധപ്പെടാനും റോഡ് പരിപാലനം ആസൂത്രണം ചെയ്യാനും മാത്രം. നിങ്ങളുടെ വിവരങ്ങൾ ഞങ്ങൾ വിൽക്കുകയോ പങ്കിടുകയോ ചെയ്യുന്നില്ല. റോഡ് അവസ്ഥാ വിവരങ്ങൾ വ്യക്തിഗത വിവരങ്ങളില്ലാതെ ഓപ്പൺ ഡാറ്റയായി പ്രസിദ്ധീകരിക്കുന്നു.'],
      ['ആർക്ക് കാണാം.', 'നിങ്ങളുടെ പേരും നമ്പറും DigiRoad അഡ്മിനിസ്ട്രേറ്റർമാർക്ക് മാത്രമേ കാണാനാകൂ. മറ്റ് ഉപയോക്താക്കൾ നിങ്ങളുടെ പേരില്ലാതെ പരാതി കാണും. ഫോട്ടോകൾ ഊഹിക്കാൻ പ്രയാസമുള്ള ഒരു വെബ് ലിങ്കിൽ സൂക്ഷിക്കുന്നു; ആ ലിങ്ക് ഉള്ള ആർക്കും അവ കാണാം. അതിനാൽ മുഖങ്ങളും വാഹന നമ്പർ പ്ലേറ്റുകളും ഒഴിവാക്കുക.'],
      ['എത്ര കാലം.', 'പരാതി പരിഹരിച്ച് 180 ദിവസത്തിന് ശേഷം നിങ്ങളുടെ പേരും ഫോൺ നമ്പറും സ്വയം ഇല്ലാതാക്കും. പരാതിയുടെ വിവരണവും ഫോട്ടോയും അറ്റകുറ്റപ്പണി രേഖയും പരിപാലന ചരിത്രത്തിനായി സൂക്ഷിക്കും.'],
      ['നിങ്ങളുടെ തിരഞ്ഞെടുപ്പുകൾ.', 'മുനിസിപ്പൽ റോഡ് ഓഫീസ് വഴി ഏത് സമയത്തും നിങ്ങളുടെ വിവരങ്ങൾ തിരുത്താനോ ഇല്ലാതാക്കാനോ ആവശ്യപ്പെടാം. പേരും നമ്പറും നൽകുന്നത് നിങ്ങളുടെ ഇഷ്ടമാണ്; ഓരോ തവണയും ഞങ്ങൾ നിങ്ങളുടെ സമ്മതം ചോദിക്കും.'],
    ],
    privacyDraft: 'ഈ അറിയിപ്പ് ഒരു കരട് മാത്രമാണ്; പൊതു ലോഞ്ചിന് മുമ്പ് ഡിജിറ്റൽ വ്യക്തിഗത ഡാറ്റാ സംരക്ഷണ നിയമം, 2023 പ്രകാരം പരിശോധിക്കണം.',
  },
};

/** Great-circle distance in metres between two [lat, lng] points. */
export function metersBetween(a: [number, number], b: [number, number]): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Metres from a point to the closest spot on a polyline (flat projection: accurate over a few km). */
function metersToLine(lat: number, lng: number, coords: [number, number][]): number {
  if (coords.length === 1) return metersBetween([lat, lng], coords[0]);
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1][1] - lng) * kx, ay = (coords[i - 1][0] - lat) * ky;
    const dx = (coords[i][1] - lng) * kx - ax, dy = (coords[i][0] - lat) * ky - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** Nearest segment to a GPS point, by distance to each segment's polyline. */
export function nearestSegment(lat: number, lng: number, segments: Segment[]): { segment: Segment; meters: number } | null {
  let best: { segment: Segment; meters: number } | null = null;
  for (const s of segments) {
    if (!s.coords.length) continue;
    const m = metersToLine(lat, lng, s.coords);
    if (!best || m < best.meters) best = { segment: s, meters: Math.round(m) };
  }
  return best;
}

// Area where unsurveyed roads get an assumed PCI (Thiruvananthapuram district). Outside it the planner does not rank.
export const PLANNER_AREA = { south: 8.15, north: 8.95, west: 76.65, east: 77.3 };
export const inPlannerArea = ([lat, lng]: [number, number]) =>
  lat >= PLANNER_AREA.south && lat <= PLANNER_AREA.north && lng >= PLANNER_AREA.west && lng <= PLANNER_AREA.east;

// Assumed PCI for roads not yet surveyed, by road class. Assumptions only: replace with survey data as it arrives.
export const ASSUMED_PCI = { NH: 75, SH: 65, MDR: 55, local: 50 };
export function assumedPci(ref: string, name: string): number {
  const r = `${ref} ${name}`.toUpperCase();
  // OSM refs come as "NH66", "NH 66" or "SH1"; names as "National Highway 66".
  if (/\bNH\s*\d|\bNH\b|NATIONAL HIGHWAY/.test(r)) return ASSUMED_PCI.NH;
  if (/\bSH\s*\d|\bSH\b|STATE HIGHWAY/.test(r)) return ASSUMED_PCI.SH;
  if (/\bMDR\s*\d|\bMDR\b|MAJOR DISTRICT/.test(r)) return ASSUMED_PCI.MDR;
  return ASSUMED_PCI.local;
}

/** One stretch of a route on one road (an OSRM step). */
export type RoutePart = { path: [number, number][]; road: string; assumed: number };
export type RouteCandidate = { path: [number, number][]; km: number; minutes: number; parts: RoutePart[] };

/**
 * Score a route over its whole length: measured PCI where it runs within 40 m of a surveyed segment,
 * assumed PCI (by road class) elsewhere, weighted by length.
 */
export function scoreRoute(parts: RoutePart[], segments: Segment[]) {
  let total = 0;
  let measured = 0;
  let weighted = 0;
  const uses = new Set<string>();
  const roads = new Map<string, number>();
  for (const part of parts) {
    for (let i = 1; i < part.path.length; i++) {
      const d = metersBetween(part.path[i - 1], part.path[i]);
      total += d;
      const hit = nearestSegment((part.path[i - 1][0] + part.path[i][0]) / 2, (part.path[i - 1][1] + part.path[i][1]) / 2, segments);
      if (hit && hit.meters <= 40) {
        measured += d;
        weighted += d * hit.segment.pci;
        uses.add(hit.segment.id);
      } else {
        weighted += d * part.assumed;
      }
      if (part.road) roads.set(part.road, (roads.get(part.road) || 0) + d);
    }
  }
  return {
    pci: total ? Math.round(weighted / total) : ASSUMED_PCI.local,
    measuredPct: total ? Math.round((100 * measured) / total) : 0,
    uses: [...uses],
    roads: [...roads].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name]) => name),
  };
}

export type PlannedRoute = RouteCandidate & ReturnType<typeof scoreRoute>;

/** Share of route a's points that lie within 25 m of route b. */
function overlap(a: [number, number][], b: [number, number][]): number {
  const step = Math.max(1, Math.floor(a.length / 40)); // sample about 40 points to keep it fast
  let near = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += step, n++) if (metersToLine(a[i][0], a[i][1], b) <= 25) near++;
  return n ? near / n : 0;
}

/**
 * Compare all candidate routes to the same destination: drop detours over 2x the shortest and near-duplicates,
 * score each over its whole length, and rank highest PCI first (shorter first on a tie).
 */
export function rankRoutes(candidates: RouteCandidate[], segments: Segment[]): PlannedRoute[] {
  if (!candidates.length) return [];
  const shortest = Math.min(...candidates.map(c => c.km));
  const kept: RouteCandidate[] = [];
  for (const c of [...candidates].sort((x, y) => x.km - y.km)) {
    if (c.km > 2 * shortest) continue;
    if (kept.some(k => overlap(c.path, k.path) >= 0.9 && overlap(k.path, c.path) >= 0.9)) continue;
    kept.push(c);
  }
  return kept
    .map(c => ({ ...c, ...scoreRoute(c.parts, segments) }))
    .sort((x, y) => y.pci - x.pci || x.km - y.km);
}

/** "Is my road safe?" in everyday words, from the road health band. */
export function roadInPlainWords(h: Health, lang: Lang = 'en'): string {
  return T[lang].plain[h] || T[lang].plain['Very Poor'];
}

/** Shrink a photo in the browser to max 1280 px JPEG, so an upload stays around 200 KB. */
export function shrinkPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unreadable image')); };
    img.src = url;
  });
}

export function LangToggle() {
  const { lang, setLang } = useApp();
  return (
    <button type="button" className="secondary lang-toggle" onClick={() => setLang(lang === 'en' ? 'ml' : 'en')}>
      {T[lang].lang}
    </button>
  );
}

type Tracked = {
  complaint_id: string; segment_id: string; complaint_heading: string; description: string; status: string;
  severity?: string; created_at?: string; repaired_at?: string; repair_type?: string; citizen_feedback?: string;
};

export function TrackComplaint() {
  const { authToken, lang } = useApp();
  const t = T[lang];
  const [id, setId] = useState('');
  const [data, setData] = useState<Tracked | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState('');
  const headers: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  async function look(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setData(null); setThanks(''); setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/complaints/track/${encodeURIComponent(id.trim())}`, { headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Lookup failed (${res.status})`);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.lookupFail);
    } finally {
      setBusy(false);
    }
  }

  async function feedback(fixed: boolean) {
    if (!data) return;
    setError('');
    const res = await fetch(`${API_BASE}/api/complaints/${data.complaint_id}/feedback`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixed }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setError(body.detail || t.feedbackFail); return; }
    setData({ ...data, citizen_feedback: body.citizen_feedback });
    setThanks(fixed ? t.thanksYes : t.thanksNo);
  }

  const status = (data?.status || '').toLowerCase();
  const date = (s: string) => new Date(s).toLocaleString(lang === 'ml' ? 'ml-IN' : 'en-IN');
  return (
    <div className="page citizen-page" lang={lang}>
      <small className="caption">{t.services}</small>
      <LangToggle />
      <h1 className="ix-dash">{t.trackTitle}</h1>
      <p>{t.trackIntro}</p>
      <form className="track-form" onSubmit={look}>
        <label htmlFor="track-id">{t.trackLabel}</label>
        <div>
          <input id="track-id" inputMode="numeric" required value={id} onChange={e => setId(e.target.value)} placeholder="27" />
          <button className="ix-btn" disabled={busy}>{busy ? t.looking : t.track}</button>
        </div>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
      {data && (
        <article className="track-card" aria-live="polite">
          <h2>#{data.complaint_id} · {data.complaint_heading}</h2>
          <p>{data.description}</p>
          <dl>
            <dt>{t.segLabel}</dt><dd>{data.segment_id}</dd>
            <dt>{t.statusLabel}</dt><dd>{t.status[status] || data.status}</dd>
            {data.created_at && (<><dt>{t.reported}</dt><dd>{date(data.created_at)}</dd></>)}
            {data.repaired_at && (<><dt>{t.repaired}</dt><dd>{date(data.repaired_at)}{data.repair_type ? ` · ${data.repair_type === 'PATCHING' ? t.patching : t.fullRepair}` : ''}</dd></>)}
          </dl>
          {status === 'repaired' && !data.citizen_feedback && (
            <div className="track-feedback">
              <b>{t.fixedQ}</b>
              <button className="ix-btn" onClick={() => feedback(true)}>{t.fixedYes}</button>
              <button className="ix-btn outline" onClick={() => feedback(false)}>{t.fixedNo}</button>
            </div>
          )}
          {data.citizen_feedback && <p className="track-done">{t.yourFeedback} {data.citizen_feedback}</p>}
          {thanks && <p className="track-done">{thanks}</p>}
        </article>
      )}
    </div>
  );
}

export function PrivacyNotice() {
  const { lang } = useApp();
  const t = T[lang];
  return (
    <div className="page citizen-page" lang={lang}>
      <small className="caption">{t.services}</small>
      <LangToggle />
      <h1 className="ix-dash">{t.privacyTitle}</h1>
      {t.privacyBody.map(([head, body]) => (
        <p key={head}><b>{head}</b> {body}</p>
      ))}
      <p className="muted">{t.privacyDraft}</p>
    </div>
  );
}
