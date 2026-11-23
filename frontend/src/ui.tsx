import React, { useState, useMemo, useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Command,
  Eye,
  EyeOff,
  Layers3,
  LogOut,
  MapPin,
  Menu,
  Play,
  Plus,
  Route as RouteIcon,
  Search,
  Send,
  Shield,
  TrendingUp,
  Wrench,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CircleMarker, MapContainer, TileLayer, Polyline, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import { API_BASE, Complaint, ComplaintForm, Health, Segment, classifyHealth, useApp } from './state';
import { LangToggle, PrivacyNotice, T as TXT, TrackComplaint, ASSUMED_PCI, assumedPci, inPlannerArea, metersBetween, nearestSegment, rankRoutes, roadInPlainWords, shrinkPhoto, suggestFromDetection, type Detection } from './citizen';
import { exifGps } from './exifGps';
import type { PlannedRoute, RouteCandidate } from './citizen';
import photoCredits from './photoCredits.json';

// No @types/leaflet in this project, so react-leaflet props are cast (same as LeafletMap below).
const OSM_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
} as React.ComponentProps<typeof TileLayer>;
const mapAt = (center: [number, number], zoom: number, extra: Record<string, unknown> = {}) =>
  ({ center, zoom, maxZoom: 19, className: 'leaflet', ...extra }) as React.ComponentProps<typeof MapContainer>;
const dotAt = (center: [number, number], fillColor: string) =>
  ({ center, radius: 8, pathOptions: { color: '#17233b', fillColor, fillOpacity: 1, weight: 3 } }) as React.ComponentProps<typeof CircleMarker>;

const hc = (h: Health) => h.toLowerCase().replace(' ', '-');
const color = (h: Health) =>
({
  'Very Poor': '#800000',
  Poor: '#DC2626',
  Fair: '#D97706',
  Good: '#16A34A',
}[h] || '#16A34A');

function App() {
  const { loggedIn } = useApp();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={loggedIn ? <Shell /> : <Navigate to="/login" replace />}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home" element={<Home />} />
        <Route path="simulations" element={<Simulations />} />
        <Route path="trends" element={<Trends />} />
        <Route path="admin" element={<Admin />} />
      </Route>
    </Routes>
  );
}

function Login() {
  const { login } = useApp();
  const nav = useNavigate();
  const [busy, B] = useState(false);
  const [error, Xe] = useState('');

  // Back from Google: Supabase puts the tokens in the URL hash.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get('access_token');
    const hashError = hash.get('error_description');
    if (!accessToken && !hashError) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (hashError) { Xe(hashError); return; }
    B(true);
    fetch(`${API_BASE}/api/auth/google/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken, refresh_token: hash.get('refresh_token') }),
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Google sign-in failed.');
        login(data.user?.full_name || data.user?.email, data.user?.email, data.access_token, data.role === 'admin' ? 'admin' : 'public', data.refresh_token);
        nav('/home');
      })
      .catch(err => Xe(err instanceof Error ? err.message : 'Google sign-in failed.'))
      .finally(() => B(false));
  }, [login, nav]);

  const googleSignIn = () => {
    window.location.href = `${API_BASE}/api/auth/google?redirect_to=${encodeURIComponent(`${window.location.origin}/login`)}`;
  };

  return (
    <main className="login login-revealed ix">
      <section className="login-visual" style={{ backgroundImage: `url(${PHOTOS.wayanad})` }}>
        <span className="ix-logo">
          <span className="ix-logo-mark" aria-hidden="true" />
          <span>DIGIROAD<small>Road health</small></span>
        </span>
        <div className="login-visual-copy">
          <small className="caption">Thiruvananthapuram · Kerala</small>
          <h1>
            Every road
            <br />
            measured
          </h1>
          <p>Pavement condition, decay forecasts and citizen repair reports for the MDR47 corridor, in one place.</p>
        </div>
      </section>
      <section className="login-right">
        <div className="auth">
          <small className="caption">Road health workspace</small>
          <h2>Sign in to DigiRoad</h2>
          <p>Use your Google account. New users get an account automatically.</p>
          <button type="button" className="google-btn" onClick={googleSignIn} disabled={busy}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/>
              <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/>
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/>
            </svg>
            Continue with Google
          </button>
          {busy && <p className="auth-note">Signing you in…</p>}
          {error && <div className="error">{error}</div>}
        </div>
      </section>
    </main>
  );
}

// Kerala road photography in public/img (credits in photoCredits.json, shown in the footer).
const PHOTOS = {
  wayanad: '/img/wayanad-pass.jpg',
  hairpin: '/img/attappadi-hairpin.jpg',
  mdr: '/img/mdr-thrissur.jpg',
  rural: '/img/rural-road.jpg',
  forest: '/img/idukki-forest.jpg',
  tvmStreet: '/img/tvm-street.jpg',
  nh66: '/img/nh66-kochi.jpg',
  sh59: '/img/sh59-elappara.jpg',
  construction: '/img/kollam-construction.jpg',
  traffic: '/img/tvm-mg-road.jpg',
  ghat: '/img/ghat-road.jpg',
  avenue: '/img/tree-avenue.jpg',
};

const NAV_LINKS: [string, string][] = [
  ['/home', 'Overview'],
  ['/simulations', 'Simulations'],
  ['/trends', 'Trends'],
  ['/repaired', 'Repairs'],
  ['/track', 'Track complaint'],
  ['/route', 'Route planner'],
  ['/admin', 'Admin'],
];

const Corridor3D = React.lazy(() => import('./Corridor3D'));
const Map3D = React.lazy(() => import('./Map3D'));

// Fades and lifts any [data-reveal] element into view once, as it scrolls in.
function useReveal(deps: unknown[]) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.in)'));
    if (!('IntersectionObserver' in window)) {
      els.forEach(el => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }),
      { threshold: 0.12 }
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// 3D tilt toward the pointer; pair with the .tilt class.
function tilt(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`);
  el.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 10}deg`);
}
function untilt(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.setProperty('--rx', '0deg');
  e.currentTarget.style.setProperty('--ry', '0deg');
}

function Shell() {
  const { role, user, logout, toast, segments } = useApp();
  const nav = useNavigate();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  useReveal([location.pathname, segments.length]);
  useEffect(() => setMenu(false), [location.pathname]);

  const avgPci = useMemo(() => {
    if (!segments.length) return 0;
    const sum = segments.reduce((acc, s) => acc + s.pci, 0);
    return (sum / segments.length).toFixed(1);
  }, [segments]);

  const signOut = () => {
    logout();
    nav('/login');
  };

  return (
    <div className={`shell ix ${menu ? 'menu-open' : ''}`}>
      <div className="ix-utility">
        <span className="ix-tag"><RouteIcon size={14} /> Kerala PWD · MDR47 corridor</span>
        <div>
          <span>Thiruvananthapuram, Kerala</span>
          <span>{user.name} · {role === 'admin' ? 'Admin' : 'Public'}</span>
          <button onClick={signOut}>Log out</button>
        </div>
      </div>
      <header className="ix-head">
        <NavLink to="/home" className="ix-logo">
          <span className="ix-logo-mark" aria-hidden="true" />
          <span>DIGIROAD<small>Road health</small></span>
        </NavLink>
        <nav className="ix-links" aria-label="Primary">
          {NAV_LINKS.map(([to, label]) => (
            <NavLink key={to} to={to}>{label}</NavLink>
          ))}
        </nav>
        <div className="ix-actions">
          <NavLink to="/trends" className="ix-btn outline">Condition reports</NavLink>
          <button className="ix-menu-btn" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-label="Menu">
            {menu ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
      <div className="ix-menu" aria-hidden={!menu}>
        <nav>
          {NAV_LINKS.map(([to, label]) => (
            <NavLink key={to} to={to}>{label}<ChevronRight size={22} /></NavLink>
          ))}
        </nav>
        <div className="ix-menu-foot">
          <span>{user.name} · {role === 'admin' ? 'Admin' : 'Public'}</span>
          <button className="ix-btn outline" onClick={signOut}>Log out</button>
        </div>
      </div>
      <main className="main">
        <div className="content">
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/simulations" element={<Simulations />} />
            <Route path="/trends" element={<Trends />} />
            <Route path="/repaired" element={<RepairHistory />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/track" element={<TrackComplaint />} />
            <Route path="/route" element={<RoutePlanner />} />
            <Route path="/privacy" element={<PrivacyNotice />} />
          </Routes>
        </div>
        <footer className="ix-foot">
          <div className="ix-foot-grid">
            <div>
              <span className="ix-logo">
                <span className="ix-logo-mark" aria-hidden="true" />
                <span>DIGIROAD<small>Road health</small></span>
              </span>
              <p>Pavement condition, decay forecasts and citizen repair reports for Kerala's roads, starting with the MDR47 corridor.</p>
            </div>
            <div>
              <h4>Corridor</h4>
              <span>Vembayam – Pallipuram Road (MDR47)</span>
              <span>Thiruvananthapuram, Kerala</span>
              <span>Network PCI {avgPci} / 100 · {segments.length} segments</span>
            </div>
            <div>
              <h4>Workspace</h4>
              {NAV_LINKS.map(([to, label]) => (
                <NavLink key={to} to={to}>{label}</NavLink>
              ))}
            </div>
            <div>
              <h4>Open data</h4>
              <a href={`${API_BASE}/api/home/export.csv`}>Segment health (CSV)</a>
              <a href={`${API_BASE}/api/home/map-data`} target="_blank" rel="noreferrer">Segment health (GeoJSON)</a>
              <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">API documentation</a>
              <NavLink to="/privacy">Privacy notice</NavLink>
            </div>
            <div>
              <h4>Back to top</h4>
              <button className="ix-btn outline" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                Top <ArrowUpRight size={16} />
              </button>
            </div>
          </div>
          <details className="ix-credits">
            <summary>Photo credits</summary>
            <ul>
              {photoCredits.map(c => (
                <li key={c.file}>
                  <a href={c.source} target="_blank" rel="noreferrer">{c.title}</a> · {c.author || 'Wikimedia Commons'} · {c.license}
                </li>
              ))}
            </ul>
          </details>
          <div className="ix-foot-base">
            <span>© {new Date().getFullYear()} DigiRoad · MDR47 road health workspace</span>
            <span>Map data © OpenStreetMap contributors · Photos via Wikimedia Commons</span>
          </div>
        </footer>
      </main>
      {toast && (
        <div className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <div className="kicker">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function HealthTag({ h }: { h: Health }) {
  return (
    <span className={`health ${hc(h)}`}>
      <i className="dot" />
      {h}
    </span>
  );
}

const HERO_SLIDES = [
  {
    img: PHOTOS.wayanad,
    title: ['Every kilometre', 'measured'],
    text: 'Live Pavement Condition Index scores for every segment of the MDR47 corridor, updated from field data, weather and traffic.',
    cta: ['Open the 3D corridor', '#corridor-3d'],
  },
  {
    img: PHOTOS.hairpin,
    title: ['From hairpin', 'to highway'],
    text: "Kerala's roads face monsoon rain, steep ghats and heavy traffic. DigiRoad forecasts how each surface will age before it fails.",
    cta: ['Run a decay simulation', '/simulations'],
  },
  {
    img: PHOTOS.tvmStreet,
    title: ['Built for', 'Thiruvananthapuram'],
    text: 'Residents report potholes and drainage problems. Engineers follow every complaint from first report to finished repair.',
    cta: ['See the condition map', '#corridor-map'],
  },
];

function Home() {
  const { complaints, addComplaint, segments, liveData } = useApp();
  const [selected, Sel] = useState<Segment | null>(null);
  const [query, Q] = useState('');
  const [modal, Modal] = useState(false);
  const [bot, BotOpen] = useState(false);
  const [slide, setSlide] = useState(0);
  const rail = React.useRef<HTMLDivElement>(null);
  const navTo = useNavigate();

  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);

  const fresh = complaints.filter(c => c.status === 'nil');
  const under = complaints.filter(c => c.status === 'Under Progress');
  const done = complaints.filter(c => c.status === 'Repaired');
  const results = segments.filter(
    s => s.name.toLowerCase().includes(query.toLowerCase()) || s.id.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setSlide(i => (i + 1) % HERO_SLIDES.length), 7000);
    return () => window.clearInterval(t);
  }, [slide]);

  const avgPci = useMemo(() => {
    if (!segments.length) return '0.0';
    return (segments.reduce((acc, s) => acc + s.pci, 0) / segments.length).toFixed(1);
  }, [segments]);

  const worst = [...segments].sort((a, b) => a.pci - b.pci)[0];
  const segPhotos = [PHOTOS.rural, PHOTOS.forest, PHOTOS.sh59, PHOTOS.nh66, PHOTOS.ghat];
  const go = (href: string) => (href.startsWith('#') ? document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' }) : navTo(href));
  const scrollRail = (dir: number) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.8, behavior: 'smooth' });

  const services = [
    {
      img: PHOTOS.mdr,
      title: 'Condition monitoring',
      text: 'Each segment is scored on the Pavement Condition Index from cracking, raveling, rutting, patching and roughness, then mapped in colour.',
      label: 'View the live map',
      href: '#corridor-map',
    },
    {
      img: PHOTOS.avenue,
      title: 'Decay simulation',
      text: 'Weather and traffic drive a deterioration model that forecasts how each road will age, so repairs land before the surface fails.',
      label: 'Run a simulation',
      href: '/simulations',
    },
    {
      img: PHOTOS.traffic,
      title: 'Citizen repair loop',
      text: 'Residents report potholes, drainage and surface damage. Engineers track each complaint from report to repair, in the open.',
      label: 'Report an issue',
      href: 'report',
    },
  ];

  return (
    <>
      <section className="ix-hero" aria-roledescription="carousel">
        {HERO_SLIDES.map((s, i) => (
          <div key={s.img} className={`ix-slide ${i === slide ? 'on' : ''}`} aria-hidden={i !== slide}>
            <div className="ix-slide-img" style={{ backgroundImage: `url(${s.img})` }} />
            <div className="ix-slide-copy">
              <h1>{s.title[0]}<br />{s.title[1]}</h1>
              <p>{s.text}</p>
              <button className="ix-btn light" tabIndex={i === slide ? 0 : -1} onClick={() => go(s.cta[1])}>
                {s.cta[0]}
              </button>
            </div>
          </div>
        ))}
        <div className="ix-hero-arrows">
          <button aria-label="Previous slide" onClick={() => setSlide(i => (i + HERO_SLIDES.length - 1) % HERO_SLIDES.length)}>
            <ArrowLeft size={20} />
          </button>
          <button aria-label="Next slide" onClick={() => setSlide(i => (i + 1) % HERO_SLIDES.length)}>
            <ArrowRight size={20} />
          </button>
        </div>
        <div className="ix-hero-dots">
          {HERO_SLIDES.map((s, i) => (
            <button key={s.img} className={i === slide ? 'on' : ''} aria-label={`Slide ${i + 1}`} onClick={() => setSlide(i)} />
          ))}
        </div>
      </section>

      <section className="ix-intro">
        <h2 className="ix-dash" data-reveal>When roads fail, Kerala should know first</h2>
        <div data-reveal>
          <p>
            DigiRoad watches the Vembayam – Pallipuram Road in Thiruvananthapuram segment by segment. It combines live
            condition scores, weather-driven decay forecasts and citizen reports so road teams know where to act first.
          </p>
          <p>
            Every number on this page comes from the live database: pavement distress readings, the decay model and the
            complaints residents file.
          </p>
          <div className="ix-intro-actions">
            <button className="ix-btn" onClick={() => go('#corridor-3d')}>Open the 3D corridor <ArrowRight size={16} /></button>
            <button className="ix-btn" onClick={() => Modal(true)}>Report an issue <ArrowRight size={16} /></button>
          </div>
        </div>
      </section>

      <section className="ix-stats" data-reveal>
        <div><small>Segments monitored</small><b>{segments.length}</b></div>
        <div><small>Average PCI</small><b>{liveData ? avgPci : '…'}<i>/100</i></b>{!liveData && <span className="ix-stat-note">Loading live values</span>}</div>
        <div>
          <small>Complaints submitted</small>
          <b>{complaints.length}</b>
          <span className="ix-stat-note">{fresh.length} new · {under.length} in progress · {complaints.filter(c => c.status === 'Repaired').length} repaired</span>
        </div>
        <div><small>Needs attention</small><b>{liveData && worst ? worst.id : '…'}</b>{liveData && worst && <span className="ix-stat-note">PCI {worst.pci} · {worst.health}</span>}</div>
      </section>

      <section className="ix-dark ix-3d" id="corridor-3d">
        <div className="ix-3d-head" data-reveal>
          <h2 className="ix-dash light">The corridor in 3D</h2>
          <p>
            The real shape of MDR47, raised from the map. Road colour shows condition and each pillar's height is its PCI.
            Drag to turn the model, click a road or pillar to open that segment.
          </p>
          <div className="ix-3d-legend">
            {(['Very Poor', 'Poor', 'Fair', 'Good'] as Health[]).map(h => (
              <span key={h}><i className={`dot ${hc(h)}`} />{h}</span>
            ))}
          </div>
        </div>
        <React.Suspense fallback={<div className="corridor-3d loading">Loading 3D model…</div>}>
          <Corridor3D segments={segments} onPick={Sel} />
        </React.Suspense>
      </section>

      <section className="ix-rail-section">
        <div className="ix-rail-head" data-reveal>
          <h2>Monitored segments</h2>
          <div className="ix-rail-nav">
            <span>Open a segment</span>
            <button aria-label="Scroll left" onClick={() => scrollRail(-1)}><ArrowLeft size={18} /></button>
            <button aria-label="Scroll right" onClick={() => scrollRail(1)}><ArrowRight size={18} /></button>
          </div>
        </div>
        <div className="ix-rail" ref={rail}>
          {segments.map((s, i) => (
            <button key={s.id} className="ix-card tilt" onClick={() => Sel(s)} onMouseMove={tilt} onMouseLeave={untilt}>
              <span className="ix-card-img" style={{ backgroundImage: `url(${segPhotos[i % segPhotos.length]})` }}>
                <HealthTag h={s.health} />
              </span>
              <span className="ix-card-title">Segment {s.id.split('-').pop()} · {s.name.replace(/\s*\(.*\)\s*$/, '')}</span>
              <span className="ix-card-meta">PCI {s.pci} · IRI {s.iri} m/km · Cracking {s.cracking}% · Rutting {s.rutting} mm</span>
              <span className="ix-card-code">{s.id}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="ix-split ix-dark">
        <div className="ix-split-img" style={{ backgroundImage: `url(${PHOTOS.construction})` }} />
        <div className="ix-split-copy" data-reveal>
          <h2 className="ix-dash light">Repairs planned from evidence, not guesswork</h2>
          <p>
            Patching or full resurfacing, the decision follows the data. DigiRoad records each repair against the segment
            and recomputes its condition, so the next budget starts from what actually happened on the road.
          </p>
          <p>Open complaints, repairs under way and finished work all sit in one tracker that residents can follow.</p>
          <NavLink to="/repaired" className="ix-btn outline">See repair history</NavLink>
        </div>
      </section>

      <section className="map-section ix-map" id="corridor-map" data-reveal>
        <div className="section-head">
          <h2 className="ix-dash">Live condition map</h2>
          <div className="searchbox">
            <Search size={15} />
            <input id="road-search" placeholder="Search segments" value={query} onChange={e => Q(e.target.value)} />
            {query && (
              <div className="results">
                {results.map(s => (
                  <button
                    key={s.id}
                    onClick={() => {
                      Sel(s);
                      Q('');
                    }}
                  >
                    {s.name}
                    <HealthTag h={s.health} />
                  </button>
                ))}
                {!results.length && <small>No matching road segments</small>}
              </div>
            )}
          </div>
        </div>
        <div className="map-wrap">
          <React.Suspense fallback={<div className="map3d loading">Loading 3D map…</div>}>
            <Map3D
              selected={selected}
              onSelect={Sel}
              segments={segments}
              fallback={<LeafletMap selected={selected} onSelect={Sel} segments={segments} />}
            />
          </React.Suspense>
          <div className="map-location">
            <MapPin size={14} /> Pothencode <small>8.62° N · 76.91° E</small>
          </div>
          <div className="legend">
            <b>Road condition</b>
            {(['Very Poor', 'Poor', 'Fair', 'Good'] as Health[]).map(h => (
              <span key={h}>
                <i className={`dot ${hc(h)}`} />
                {h}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="ix-services">
        {services.map(s => (
          <article key={s.title} className="ix-service tilt" onMouseMove={tilt} onMouseLeave={untilt} data-reveal>
            <div className="ix-service-img" style={{ backgroundImage: `url(${s.img})` }} />
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            <button className="ix-btn" onClick={() => (s.href === 'report' ? Modal(true) : go(s.href))}>{s.label}</button>
          </article>
        ))}
      </section>

      <section className="complaints ix-complaints" data-reveal>
        <div className="section-title">
          <h2 className="ix-dash">Complaints tracker <small>{complaints.length}</small></h2>
          <button className="ix-btn" onClick={() => Modal(true)}>
            Submit a complaint <Plus size={15} />
          </button>
        </div>
        <div className="tables tables-3">
          <ComplaintTable
            title="New reports"
            entries={fresh}
            empty="No new reports"
            onSelectComplaint={setSelectedComplaint}
          />
          <ComplaintTable
            title="Under progress"
            entries={under}
            empty="No complaints in progress"
            onSelectComplaint={setSelectedComplaint}
          />
          <ComplaintTable
            title="Repaired"
            entries={done}
            empty="Repairs will appear here"
            onSelectComplaint={setSelectedComplaint}
          />
        </div>
      </section>

      <section className="ix-cta" style={{ backgroundImage: `url(${PHOTOS.sh59})` }}>
        <div className="ix-cta-inner" data-reveal>
          <h2>Seen a pothole on MDR47?</h2>
          <p>Report it in under a minute. You can follow it until the repair is done.</p>
          <div className="ix-cta-actions">
            <button className="ix-btn light" onClick={() => Modal(true)}>Report an issue</button>
            <button className="ix-btn outline light" onClick={() => BotOpen(true)}>Ask PaveBot</button>
          </div>
        </div>
      </section>
      <button className="bot-fab" onClick={() => BotOpen(true)}>
        <Bot size={19} /> Ask PaveBot <i />
      </button>
      {modal && <ComplaintModal close={() => Modal(false)} submit={addComplaint} />}
      {selected && <SegmentModal segment={selected} close={() => Sel(null)} />}
      {selectedComplaint && <ComplaintDetailModal complaint={selectedComplaint} close={() => setSelectedComplaint(null)} />}
      {bot && <PaveBot close={() => BotOpen(false)} />}
    </>
  );
}


function MapLines({
  selected,
  onSelect,
  segments,
}: {
  selected: Segment | null;
  onSelect: (s: Segment) => void;
  segments: Segment[];
}) {
  const map = useMap();
  const fitted = React.useRef(false);
  React.useEffect(() => {
    if (selected) map.flyToBounds(selected.coords, { padding: [55, 55], duration: 0.7 });
  }, [selected, map]);
  React.useEffect(() => {
    // Open on the whole corridor once real coordinates arrive.
    const all = segments.flatMap(s => s.coords);
    if (fitted.current || all.length < 2) return;
    map.fitBounds(all, { padding: [40, 40] });
    fitted.current = true;
  }, [segments, map]);
  React.useEffect(() => {
    // Wheel zoom only after the map is clicked, so scrolling the page never gets trapped.
    const on = () => map.scrollWheelZoom.enable();
    const off = () => map.scrollWheelZoom.disable();
    map.on('click', on);
    map.on('mouseout', off);
    return () => {
      map.off('click', on);
      map.off('mouseout', off);
    };
  }, [map]);

  return (
    <>
      {segments.map(s => (
        <React.Fragment key={s.id}>
          <Polyline positions={s.coords} pathOptions={{ color: '#17233b', weight: 11, opacity: 1 }} />
          <Polyline
            positions={s.coords}
            pathOptions={{
              color: color(s.health),
              weight: selected?.id === s.id ? 7 : 5,
              opacity: 1,
              lineCap: 'round',
              lineJoin: 'round',
            }}
            eventHandlers={{ click: () => onSelect(s) }}
          />
        </React.Fragment>
      ))}
    </>
  );
}

function LeafletMap({
  selected,
  onSelect,
  segments,
}: {
  selected: Segment | null;
  onSelect: (s: Segment) => void;
  segments: Segment[];
}) {
  const [tilesFailed, fail] = useState(false);
  const tileStats = React.useRef({ ok: 0, err: 0 });
  const mapProps = { center: [8.6262, 76.9105], zoom: 15, maxZoom: 19, scrollWheelZoom: false, zoomControl: false, className: 'leaflet' } as React.ComponentProps<
    typeof MapContainer
  >;
  const tileProps = {
    // Official OSM tile server (the a/b/c subdomains are deprecated).
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    eventHandlers: {
      tileload: () => {
        tileStats.current.ok += 1;
        fail(false);
      },
      // Show the fallback only when tiles fail outright, not on one dropped tile.
      tileerror: () => {
        tileStats.current.err += 1;
        if (tileStats.current.ok === 0 && tileStats.current.err >= 4) fail(true);
      },
    },
  } as React.ComponentProps<typeof TileLayer>;

  return (
    <MapContainer {...mapProps}>
      <TileLayer {...tileProps} />
      <ZoomControl position="topright" />
      <MapLines selected={selected} onSelect={onSelect} segments={segments} />
      {tilesFailed && (
        <div className="map-fallback">
          <div className="fallback-grid" />
          <RoadFallback />
          <b>Local map view</b>
          <span>Map tiles unavailable · road condition overlay remains interactive</span>
        </div>
      )}
    </MapContainer>
  );
}

function RoadFallback() {
  return (
    <svg className="fallback-roads" viewBox="0 0 700 300" preserveAspectRatio="none" aria-label="Schematic road map">
      <path d="M-20 90 C170 75 210 205 375 160 S530 105 730 195" stroke="#DC2626" />
      <path d="M40 310 C110 220 150 155 225 -20" stroke="#D97706" />
      <path d="M320 310 C380 210 450 115 650 -20" stroke="#16A34A" />
    </svg>
  );
}

type Priority = NonNullable<Complaint['priority']>;
// Priority badges reuse the severity colour classes.
const PRIORITY_CLASS: Record<Priority, string> = { P1: 'critical', P2: 'high', P3: 'medium', P4: 'low' };
const PRIORITY_WORD: Record<Priority, string> = { P1: 'Urgent', P2: 'High', P3: 'Normal', P4: 'Low' };

function PrioritySelect({ c }: { c: Complaint }) {
  const { setPriority } = useApp();
  return (
    <span className="priority-select" onClick={e => e.stopPropagation()}>
      <select
        aria-label={`Priority for complaint ${c.id}`}
        value={c.priority || ''}
        onChange={e => setPriority(c.id, e.target.value as Priority)}
      >
        {!c.priority && <option value="">No priority</option>}
        {(Object.keys(PRIORITY_WORD) as Priority[]).map(p => (
          <option key={p} value={p}>{p} · {PRIORITY_WORD[p]}</option>
        ))}
      </select>
      <small>{c.prioritySource === 'admin' ? 'Set by admin' : 'Automatic'}</small>
    </span>
  );
}

function ComplaintTable({
  title,
  entries,
  empty,
  onSelectComplaint,
}: {
  title: string;
  entries: Complaint[];
  empty: string;
  onSelectComplaint?: (c: Complaint) => void;
}) {
  const { segments } = useApp();
  return (
    <div className="complaint-table">
      <div className="table-heading">
        <span>{title}</span>
        <b>{entries.length}</b>
      </div>
      {entries.length ? (
        entries.map(c => (
          <div
            className="complaint-row clickable"
            key={c.id}
            onClick={() => onSelectComplaint?.(c)}
            title="Click to view complaint details"
          >
            <span className="complaint-icon">
              <AlertTriangle size={16} />
            </span>
            <div className="complaint-main">
              <b>
                {c.category}
                <i className={`severity ${c.severity.toLowerCase()}`}>{c.severity}</i>
                {c.priority && <i className={`severity ${PRIORITY_CLASS[c.priority]}`} title={`Priority: ${PRIORITY_WORD[c.priority]}`}>{c.priority}</i>}
              </b>
              <small>
                {c.id} · {segments.find(s => s.id === c.segmentId)?.name || c.segmentId}
              </small>
              <p>{c.description}</p>
            </div>
            <time>{c.created}</time>
          </div>
        ))
      ) : (
        <div className="empty">{empty}</div>
      )}
    </div>
  );
}

function SegmentModal({ segment: s, close }: { segment: Segment; close: () => void }) {
  const { lang } = useApp();
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="kicker">Segment condition · {s.id}</div>
            <h2>{s.name}</h2>
          </div>
          <button className="icon-close" onClick={close} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-health">
          <span>Current road health</span>
          <HealthTag h={s.health} />
          <b>
            {s.pci}
            <small>PCI score</small>
          </b>
        </div>
        <div className="plain-words" role="note" lang={lang}>
          <b>{TXT[lang].safeQ}</b>
          <p>{roadInPlainWords(s.health, lang)}</p>
        </div>
        <div className="metric-grid">
          {[
            ['Cracking', s.cracking + '%'],
            ['Raveling', s.raveling + '%'],
            ['Rut depth', (s.rutting || 0) + ' mm'],
            ['Patching', (s.patching || 0) + '%'],
            ['IRI', s.iri + ' m/km'],
            ['PCI score', s.pci + '/100'],
          ].map(([k, v]) => (
            <div key={k}>
              <small>{k}</small>
              <b>{v}</b>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          Live segment readings
          <button className="secondary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ComplaintModal({
  close,
  submit,
}: {
  close: () => void;
  submit: (c: ComplaintForm) => Promise<boolean>;
}) {
  const { segments, lang, authToken } = useApp();
  const t = TXT[lang];
  const [scan, setScan] = useState<{ state: 'idle' | 'busy' | 'done' | 'fail'; found?: Detection[]; size?: { width: number; height: number } }>({ state: 'idle' });
  const [form, F] = useState({
    citizen: '',
    contact: '',
    segmentId: segments[0]?.id || 'SEG-101',
    category: 'Pothole',
    severity: 'Medium',
    description: '',
    consent: false,
    website: '',
    photo: '',
  });
  const [where, setWhere] = useState('');
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [nearId, setNearId] = useState(''); // segment nearest the user's location or pin, drawn in blue
  const [photoError, setPhotoError] = useState('');

  function set(k: keyof typeof form, v: string | boolean) {
    F(f => ({ ...f, [k]: v }));
  }

  // Map tap or GPS fix: pick the nearest surveyed segment.
  function pick(lat: number, lng: number) {
    setPin([lat, lng]);
    const hit = nearestSegment(lat, lng, segments);
    if (!hit) { setWhere(t.locateFail); return; }
    set('segmentId', hit.segment.id);
    setNearId(hit.segment.id);
    setWhere(t.located(hit.segment.name, hit.meters));
  }

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setPhotoError('');
    setScan({ state: 'idle' });
    if (!file) return;
    try {
      const [photo, gps] = await Promise.all([shrinkPhoto(file), file.arrayBuffer().then(exifGps)]);
      set('photo', photo);
      if (gps) {
        pick(gps[0], gps[1]);
        setWhere(w => `${t.fromPhoto} ${w}`);
      } else if (!pin) {
        setWhere(t.photoNoGps);
      }
    } catch {
      setPhotoError(t.photoFail);
    }
  }

  // Send the shrunk photo to the damage model; the top detection pre-fills category and severity.
  async function detect() {
    setScan({ state: 'busy' });
    try {
      const body = new FormData();
      body.append('file', await (await fetch(form.photo)).blob(), 'photo.jpg');
      // conf 0.15: on real phone photos the model scores clear potholes around 0.2, below its 0.25 default.
      const res = await fetch(`${API_BASE}/api/damage/detect?conf=0.15`, {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        body,
      });
      if (!res.ok) throw new Error(`detect ${res.status}`);
      const data: { detections: Detection[]; image: { width: number; height: number } } = await res.json();
      setScan({ state: 'done', found: data.detections, size: data.image });
      const top = data.detections[0];
      if (top) {
        const s = suggestFromDetection(top.label);
        set('category', s.category);
        set('severity', s.severity);
      }
    } catch {
      setScan({ state: 'fail' });
    }
  }

  function locate() {
    if (!navigator.geolocation) { setWhere(t.locateFail); return; }
    setWhere(t.locating);
    navigator.geolocation.getCurrentPosition(
      pos => pick(pos.coords.latitude, pos.coords.longitude),
      () => setWhere(t.locateFail),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (await submit(form)) close();
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal form-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="complaint-title" lang={lang}>
        <div className="modal-head">
          <div>
            <div className="kicker">{t.kicker}</div>
            <h2 id="complaint-title">{t.title}</h2>
          </div>
          <LangToggle />
          <button className="icon-close" onClick={close} aria-label="Close">
            <X />
          </button>
        </div>
        <form onSubmit={send} className="complaint-form">
          <div className="form-two">
            <label>
              {t.name}
              <input required autoComplete="name" value={form.citizen} onChange={e => set('citizen', e.target.value)} />
            </label>
            <label>
              {t.contact}
              <input required type="tel" autoComplete="tel" value={form.contact} onChange={e => set('contact', e.target.value)} />
            </label>
          </div>
          <label>
            {t.segment}
            <select value={form.segmentId} onChange={e => set('segmentId', e.target.value)}>
              {segments.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="locate-row">
            <button type="button" className="secondary" onClick={locate}>
              <MapPin size={15} /> {t.locate}
            </button>
            {where && <small aria-live="polite">{where}</small>}
          </div>
          <div className="pin-map">
            <MapContainer {...mapAt(pin || segments[0]?.coords[0] || [8.6262, 76.9105], 15, { scrollWheelZoom: false })}>
              <TileLayer {...OSM_TILES} />
              {segments.map(s => (
                <Polyline
                  key={`${s.id}-${s.id === nearId}`}
                  positions={s.coords}
                  pathOptions={s.id === nearId
                    ? { color: '#0073cf', weight: 9, opacity: 1 }
                    : { color: color(s.health), weight: form.segmentId === s.id ? 7 : 4 }}
                />
              ))}
              {pin && <CircleMarker {...dotAt(pin, '#fff')} />}
              <MapClicks onClick={pick} />
              <PanTo point={pin} />
            </MapContainer>
            <small>{t.pinHint}</small>
          </div>
          <div className="form-two">
            <label>
              {t.category}
              <select value={form.category} onChange={e => set('category', e.target.value)}>
                {['Pothole', 'Surface damage', 'Cracking', 'Drainage', 'Road marking', 'Other'].map(o => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              {t.severity}
              <select value={form.severity} onChange={e => set('severity', e.target.value)}>
                {['Low', 'Medium', 'High', 'Critical'].map(o => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t.description}
            <textarea
              required
              maxLength={400}
              rows={4}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder={t.descHint}
            />
          </label>
          <label>
            {t.photo}
            <input type="file" accept="image/jpeg,image/png,image/*" onChange={pickPhoto} />
          </label>
          {photoError && <div className="error" role="alert">{photoError}</div>}
          {form.photo && (
            <div className="photo-preview">
              <div className="detect-frame">
                <img src={form.photo} alt={t.photo} />
                {scan.found && scan.size && scan.found.map((d, i) => {
                  const { width: w, height: h } = scan.size!;
                  const [x1, y1, x2, y2] = d.box;
                  return (
                    <div key={i} className="detect-box" style={{ left: `${(x1 / w) * 100}%`, top: `${(y1 / h) * 100}%`, width: `${((x2 - x1) / w) * 100}%`, height: `${((y2 - y1) / h) * 100}%` }}>
                      <span>{d.label} {Math.round(d.confidence * 100)}%</span>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="secondary" onClick={detect} disabled={scan.state === 'busy'}>
                <Search size={15} /> {scan.state === 'busy' ? t.detecting : t.detect}
              </button>
              <button type="button" className="secondary" onClick={() => { set('photo', ''); setScan({ state: 'idle' }); }}>{t.photoRemove}</button>
            </div>
          )}
          {(scan.state === 'done' || scan.state === 'fail') && (
            <div className="detect-result" aria-live="polite">
              <b>
                {scan.state === 'fail'
                  ? t.detectFail
                  : scan.found?.length
                    ? t.detectFound(scan.found[0].label, Math.round(scan.found[0].confidence * 100))
                    : t.detectNone}
              </b>
              <small>{t.detectAdvice}</small>
            </div>
          )}
          {/* Honeypot: hidden from people and screen readers; bots that fill it are rejected. */}
          <input className="hp-field" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={e => set('website', e.target.value)} name="website" />
          <label className="consent">
            <input type="checkbox" required checked={form.consent} onChange={e => set('consent', e.target.checked)} />
            <span>{t.consent} <a href="/privacy" target="_blank" rel="noreferrer">{t.privacy}</a>.</span>
          </label>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={close}>
              {t.cancel}
            </button>
            <button className="primary">
              <Send size={15} /> {t.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MapClicks({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e: { latlng: { lat: number; lng: number } }) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function PanTo({ point }: { point: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.panTo(point);
  }, [point, map]);
  return null;
}

type OsrmStep = { name?: string; ref?: string; geometry: { coordinates: [number, number][] } };
type OsrmRoute = { distance: number; duration: number; legs: { steps: OsrmStep[] }[] };

// One colour per route, so the map lines match the list.
const ROUTE_COLORS = ['#0073cf', '#9333ea', '#ea580c', '#0d9488', '#db2777', '#4d7c0f', '#b45309', '#475569'];

// Route planner: collect every distinct route A to B, score each over its whole length (measured PCI on
// surveyed segments, assumed PCI by road class elsewhere) and show them all, highest PCI first.
// OSRM often returns only one route, so extra candidates go through each surveyed segment and through points
// either side of the straight line.
// shortcut: public OSRM demo server (light use only, no SLA); self-host OSRM or use a paid router before heavy traffic.
function RoutePlanner() {
  const { segments } = useApp();
  const [a, setA] = useState<[number, number] | null>(null);
  const [b, setB] = useState<[number, number] | null>(null);
  const [routes, setRoutes] = useState<PlannedRoute[]>([]);
  const [chosen, setChosen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function osrm(points: [number, number][], alternatives: boolean): Promise<RouteCandidate[]> {
    const where = points.map(([lat, lng]) => `${lng},${lat}`).join(';');
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${where}?alternatives=${alternatives}&steps=true&overview=false&geometries=geojson`);
    const body = await res.json();
    if (!res.ok || body.code !== 'Ok') throw new Error(body.message || `Routing failed (${res.status})`);
    return body.routes.map((r: OsrmRoute) => {
      const parts = r.legs.flatMap(leg => leg.steps).map(st => ({
        path: st.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
        road: st.ref || st.name || '',
        assumed: assumedPci(st.ref || '', st.name || ''),
      }));
      return { path: parts.flatMap(pt => pt.path), parts, km: r.distance / 1000, minutes: Math.round(r.duration / 60) };
    });
  }

  async function plan(from: [number, number], to: [number, number]) {
    setBusy(true); setError(''); setRoutes([]); setChosen(0);
    const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const perp: [number, number] = [-(to[1] - from[1]), to[0] - from[0]];
    const vias: [number, number][] = [
      ...segments.filter(s => s.coords.length).map(s => s.coords[Math.floor(s.coords.length / 2)]),
      ...[0.2, -0.2, 0.45, -0.45].map(k => [mid[0] + perp[0] * k, mid[1] + perp[1] * k] as [number, number]),
    ];
    const results = await Promise.allSettled([osrm([from, to], true), ...vias.map(v => osrm([from, v, to], false))]);
    const found = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    if (found.length) {
      setRoutes(rankRoutes(found, segments));
    } else {
      const fail = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
      setError(fail?.reason instanceof TypeError ? 'Routing service not reachable. Check your connection and try again.' : fail?.reason?.message || 'No route found.');
    }
    setBusy(false);
  }

  function reset() {
    setA(null); setB(null); setRoutes([]); setError(''); setChosen(0);
  }

  function pick(lat: number, lng: number) {
    if (!inPlannerArea([lat, lng])) { setError('Pick a point inside Thiruvananthapuram district. Road condition is only estimated there.'); return; }
    if (!a || b) { reset(); setA([lat, lng]); return; }
    if (metersBetween(a, [lat, lng]) < 20) return; // second tap on the start point
    setB([lat, lng]);
    void plan(a, [lat, lng]);
  }

  return (
    <>
      <Heading
        eyebrow="Route planner · road condition"
        title="Compare routes by road condition"
        description="Tap the map to set the start (A), then the destination (B). Every route found is shown with its PCI score; the highest is the smoothest."
      />
      <div className="route-layout">
        <div className="map-wrap route-map">
          <MapContainer {...mapAt(segments[0]?.coords[0] || [8.6262, 76.9105], 14)}>
            <TileLayer {...OSM_TILES} />
            {segments.map(s => (
              <Polyline key={s.id} positions={s.coords} pathOptions={{ color: color(s.health), weight: 4, opacity: 0.6 }} />
            ))}
            {/* Chosen route drawn last so it sits on top. */}
            {routes.map((r, i) => ({ r, i })).sort((x, y) => Number(x.i === chosen) - Number(y.i === chosen)).map(({ r, i }) => (
              <Polyline
                key={i}
                positions={r.path}
                pathOptions={{ color: ROUTE_COLORS[i % ROUTE_COLORS.length], weight: i === chosen ? 8 : 5, opacity: i === chosen ? 1 : 0.55 }}
                eventHandlers={{ click: () => setChosen(i) }}
              />
            ))}
            {a && <CircleMarker {...dotAt(a, '#16A34A')} />}
            {b && <CircleMarker {...dotAt(b, '#DC2626')} />}
            <MapClicks onClick={pick} />
          </MapContainer>
        </div>
        <div className="route-list" aria-live="polite">
          {!a && <p>Tap the map to set the start point (A).</p>}
          {a && !b && <p>Now tap the destination (B).</p>}
          {busy && <p>Finding all routes…</p>}
          {error && <div className="error" role="alert">{error}</div>}
          {routes.length > 0 && (
            <p>{routes.length === 1 ? 'Only one route exists between these points.' : `${routes.length} routes found, highest PCI first.`}</p>
          )}
          {routes.map((r, i) => (
            <button
              key={i}
              type="button"
              className={`route-card ${i === chosen ? 'chosen' : ''}`}
              style={{ borderLeftColor: ROUTE_COLORS[i % ROUTE_COLORS.length] }}
              onClick={() => setChosen(i)}
              aria-pressed={i === chosen}
            >
              <b>{i === 0 ? 'Route 1 · smoothest' : `Route ${i + 1}`}</b>
              <span className="route-pci">PCI {r.pci} · {classifyHealth(r.pci)}</span>
              <span>{r.km.toFixed(1)} km · about {r.minutes} min{r.roads.length ? ` · via ${r.roads.join(', ')}` : ''}</span>
              <span className="route-basis">
                {r.measuredPct}% measured{r.uses.length ? ` (${r.uses.join(', ')})` : ''} · {100 - r.measuredPct}% assumed
              </span>
            </button>
          ))}
          {a && <button className="secondary" onClick={reset}>Start again</button>}
          <small className="route-note">
            Measured PCI comes from DigiRoad surveys. Other roads use an assumed PCI by road class:
            NH {ASSUMED_PCI.NH}, SH {ASSUMED_PCI.SH}, MDR {ASSUMED_PCI.MDR}, other roads {ASSUMED_PCI.local}.
            Routing © OSRM, map data © OpenStreetMap contributors.
          </small>
        </div>
      </div>
    </>
  );
}

function PaveBot({ close }: { close: () => void }) {
  type ChatMsg = { by: 'bot' | 'you'; text: string; error?: boolean };
  const [messages, M] = useState<ChatMsg[]>([
    { by: 'bot', text: 'Hello. I’m PaveBot, your road-health copilot. I read the live DigiRoad database, so ask me anything about the segments, their condition history, or complaints.' },
  ]);
  const [input, I] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function ask(q = input) {
    const text = q.trim();
    if (!text || busy) return;
    // Greeting and failed turns are UI-only; the model sees the real conversation.
    const history = messages
      .slice(1)
      .filter(m => !m.error)
      .map(m => ({ role: m.by === 'you' ? 'user' : 'assistant', content: m.text }));
    M(m => [...m, { by: 'you', text }]);
    I('');
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.reply) throw new Error(data?.detail || `PaveBot is unavailable (HTTP ${res.status}).`);
      M(m => [...m, { by: 'bot', text: data.reply }]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Network error.';
      M(m => [...m, { by: 'bot', text: `Sorry, I couldn’t answer that. ${detail}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bot-drawer">
      <div className="bot-head">
        <span className="bot-avatar">
          <Bot size={19} />
        </span>
        <div>
          <b>PaveBot</b>
          <small>
            <i /> Local road intelligence
          </small>
        </div>
        <button onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div className="bot-messages">
        {messages.map((m, i) => (
          <div className={`message ${m.by}`} key={i}>
            {m.by === 'bot' && <Bot size={14} />}
            <p style={{ whiteSpace: 'pre-wrap' }}>{m.text}</p>
          </div>
        ))}
        {busy && (
          <div className="message bot">
            <Bot size={14} />
            <p>Reading the database…</p>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="quick-asks">
        <small>Quick questions</small>
        {['Which road needs attention?', 'Show complaint status', 'How has PCI changed over time?'].map(q => (
          <button key={q} onClick={() => ask(q)} disabled={busy}>
            {q}
            <ChevronRight size={14} />
          </button>
        ))}
      </div>
      <form
        className="bot-input"
        onSubmit={e => {
          e.preventDefault();
          ask();
        }}
      >
        <input value={input} onChange={e => I(e.target.value)} placeholder="Ask about road health" />
        <button disabled={busy} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

function Simulations() {
  const { segments } = useApp();
  const [date, D] = useState('2026-10-19');
  const [id, I] = useState(segments[0]?.id || 'SEG-101');
  const [running, R] = useState(false);
  const [result, Res] = useState<Segment | null>(null);

  function run() {
    R(true);
    Res(null);
    setTimeout(() => {
      Res(segments.find(s => s.id === id) || segments[0]);
      R(false);
    }, 600);
  }

  const s = result;

  return (
    <>
      <Heading
        eyebrow="Pavement forecast · mechanistic model"
        title="Run a simulation"
        description="Forecast pavement degradation taking live segment baseline values into account."
      />
      <div className="control-panel">
        <label>
          Simulation date
          <div className="date-input">
            <CalendarDays size={16} />
            <input type="date" value={date} onChange={e => D(e.target.value)} />
          </div>
        </label>
        <label>
          Road segment
          <select value={id} onChange={e => I(e.target.value)}>
            {segments.map(seg => (
              <option key={seg.id} value={seg.id}>
                {seg.name} (PCI {seg.pci})
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={running} onClick={run}>
          {running ? (
            <>
              <span className="spinner" /> Modeling…
            </>
          ) : (
            <>
              <Activity size={16} /> Run Simulation
            </>
          )}
        </button>
      </div>
      {running && (
        <div className="running">
          <div className="pulse-line" />
          <b>Calculating pavement response</b>
          <span>Applying mechanistic decay, traffic ESALs, and weather factors…</span>
        </div>
      )}
      {s && (
        <>
          <div className="result-heading">
            <div>
              <span className="kicker">Projected condition · {date}</span>
              <h2>{s.name}</h2>
            </div>
            <span className="model-stamp">Mechanistic model · 30-day horizon</span>
          </div>
          <div className="result-grid">
            {[
              ['Road name', s.name],
              ['Cracking', `${(s.cracking + 1.2).toFixed(1)}%`],
              ['Raveling', `${(s.raveling + 0.6).toFixed(1)}%`],
              ['IRI', `${(s.iri + 0.15).toFixed(2)} m/km`],
              ['PCI', String(Math.max(s.pci - 3, 0))],
              ['Health status', `${Math.max(s.pci - 3, 0)} / 100`],
            ].map(([k, v], i) => (
              <div className="result-metric" key={k}>
                <small>{k}</small>
                <b>{v}</b>
                {i === 4 && <HealthTag h={s.health} />}
              </div>
            ))}
          </div>
          <div className="chart-panel">
            <div>
              <div className="kicker">Projected decay</div>
              <h2>Condition over 30 days</h2>
            </div>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={Array.from({ length: 7 }, (_, i) => ({ day: `Day ${i * 5}`, pci: Math.max(s.pci - i * 0.5, 0) }))}>
                  <defs>
                    <linearGradient id="pciFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#b5cedb" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#b5cedb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#17233b1a" vertical={false} />
                  <XAxis dataKey="day" stroke="#17233b99" />
                  <YAxis domain={[0, 100]} stroke="#17233b99" />
                  <ChartTooltip contentStyle={{ background: '#131a23', border: '1px solid #303a46', color: '#edf0f1' }} />
                  <Area dataKey="pci" stroke="#17233b" fill="url(#pciFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Trends() {
  const { segments, trendLogs } = useApp();
  const [date, D] = useState('2026-10-19');
  const [id, I] = useState(segments[0]?.id || 'SEG-101');
  const [period, P] = useState<'30 days' | '90 days'>('30 days');

  const s = segments.find(v => v.id === id) || segments[0];

  const points = useMemo(() => {
    const end = new Date(`${date}T12:00:00`);
    const count = period === '30 days' ? 30 : 90;
    const basePoints = Array.from({ length: count }, (_, i) => {
      const day = new Date(end);
      day.setDate(end.getDate() - count + i);
      const drift = (Math.sin(i * 0.49) + Math.cos(i * 0.18)) * 0.7 + i * 0.035;
      return {
        date: day.toISOString().slice(5, 10),
        fullDate: day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        pci: Math.max(0, Math.min(100, Math.round(s.pci - drift))),
      };
    });

    // Add recent repair time-series entries if present
    const customLogs = trendLogs[s.id] || [];
    if (customLogs.length > 0) {
      customLogs.forEach(entry => {
        basePoints.push({
          date: entry.date,
          fullDate: entry.fullDate,
          pci: entry.pci,
        });
      });
    }

    return basePoints;
  }, [date, s.id, s.pci, period, trendLogs]);

  const net = points[points.length - 1].pci - points[0].pci;

  return (
    <>
      <Heading
        eyebrow="Historical condition · PCI"
        title="Road health trends"
        description="Track pavement condition and repair event milestones across the corridor."
      />
      <div className="control-panel trend-controls">
        <label>
          Reference date
          <div className="date-input">
            <CalendarDays size={16} />
            <input type="date" value={date} onChange={e => D(e.target.value)} />
          </div>
        </label>
        <label>
          Road segment
          <select value={id} onChange={e => I(e.target.value)}>
            {segments.map(seg => (
              <option key={seg.id} value={seg.id}>
                {seg.name}
              </option>
            ))}
          </select>
        </label>
        <div className="period-tabs">
          <button className={period === '30 days' ? 'chosen' : ''} onClick={() => P('30 days')}>
            30 days
          </button>
          <button className={period === '90 days' ? 'chosen' : ''} onClick={() => P('90 days')}>
            90 days
          </button>
        </div>
      </div>
      <div className="trend-summary">
        <div>
          <span>Selected segment</span>
          <b>{s.name}</b>
        </div>
        <div>
          <span>Current PCI</span>
          <b>{s.pci} <small>/ 100</small></b>
        </div>
        <div>
          <span>Net score change</span>
          <b className={net < 0 ? 'down' : 'up'}>
            {net < 0 ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />} {net > 0 ? '+' : ''}
            {net.toFixed(1)} pts
          </b>
        </div>
        <div>
          <span>Condition</span>
          <HealthTag h={s.health} />
        </div>
      </div>
      <div className="chart-panel trend-chart">
        <div className="chart-heading">
          <div>
            <div className="kicker">
              PCI history · {points[0]?.fullDate} – {points[points.length - 1]?.fullDate}
            </div>
            <h2>Pavement Condition Index over time</h2>
          </div>
          <span className="chart-legend">
            <i /> Pavement Condition Index (PCI)
          </span>
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points}>
              <CartesianGrid stroke="#17233b1a" vertical={false} />
              <XAxis dataKey="date" interval={period === '30 days' ? 4 : 14} stroke="#17233b99" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} stroke="#17233b99" />
              <ChartTooltip
                content={({ active, payload }) =>
                  active && payload?.[0] ? (
                    <div className="chart-tip">
                      <span>{payload[0].payload.fullDate}</span>
                      <b>{Number(payload[0].value).toFixed(1)} PCI</b>
                    </div>
                  ) : null
                }
              />
              <Line dataKey="pci" type="monotone" stroke="#17233b" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#8eb49e' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="window-note">
          Historical evaluation log for {s.name}. Includes live maintenance and repair event milestones.
        </div>
      </div>
    </>
  );
}

function RepairHistory() {
  const { complaints, segments, archivedRepairIds, refreshRepairBuckets } = useApp();
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [filterSegment, setFilterSegment] = useState<string>('all');
  const [viewTab, setViewTab] = useState<'archived' | 'all'>('all');

  const allRepaired = complaints.filter(c => c.status === 'Repaired');
  React.useEffect(() => { void refreshRepairBuckets(); }, [refreshRepairBuckets]);
  const archived = allRepaired.filter(c => archivedRepairIds.includes(c.id));

  const baseList = viewTab === 'archived' ? archived : allRepaired;
  const filtered = filterSegment === 'all'
    ? baseList
    : baseList.filter(c => c.segmentId === filterSegment);

  return (
    <>
      <Heading
        eyebrow="Maintenance · repair history"
        title="Repaired complaints"
        description="Historical archive of submitted and repaired road complaints across the municipal network."
      />

      <div className="history-filter-bar">
        <div className="history-tabs">
          <button
            className={`history-tab ${viewTab === 'archived' ? 'active' : ''}`}
            onClick={() => setViewTab('archived')}
          >
            Archived (&gt; 7 Days) ({archived.length})
          </button>
          <button
            className={`history-tab ${viewTab === 'all' ? 'active' : ''}`}
            onClick={() => setViewTab('all')}
          >
            All Historical Repairs ({allRepaired.length})
          </button>
        </div>

        <select
          className="history-segment-filter"
          value={filterSegment}
          onChange={e => setFilterSegment(e.target.value)}
        >
          <option value="all">All road corridors</option>
          {segments.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.id})
            </option>
          ))}
        </select>
      </div>

      <div className="admin-table repair-history-table">
        <div className="admin-table-head">
          <b>Repair history register</b>
          <span>{filtered.length} records · select one to inspect</span>
        </div>
        <div className="admin-columns history-columns">
          <span>Complaint</span><span>Road segment</span><span>Repair action</span><span>Completed</span>
        </div>
        {filtered.length ? filtered.map(c => {
          const segment = segments.find(s => s.id === c.segmentId);
          return (
            <div
              className="admin-row history-row clickable"
              key={c.id}
              onClick={() => setSelectedComplaint(c)}
              title="Click to view complaint dossier"
            >
              <div>
                <b>{c.category}</b>
                <small>{c.id} · {c.citizen}</small>
                <p>{c.description}</p>
              </div>
              <span>{segment?.name || c.segmentId}</span>
              <span className={`repaired-tag ${c.repairType === 'PATCHING' ? 'patching' : 'resurfacing'}`}>
                <Check size={13} />{c.repairType === 'PATCHING' ? 'Patching' : 'Full repaired'}
              </span>
              <span>{c.repairedAt ? new Date(c.repairedAt).toLocaleString() : c.created}</span>
            </div>
          );
        }) : <div className="empty">No repaired complaints match this filter</div>}
      </div>

      {selectedComplaint && (
        <ComplaintDetailModal
          complaint={selectedComplaint}
          close={() => setSelectedComplaint(null)}
        />
      )}
    </>
  );
}

function Admin() {
  const { role, complaints, segments, executeRepair, markUnderProcess } = useApp();
  const nav = useNavigate();

  // Dual-action modal states
  const [patchModalComplaint, setPatchModalComplaint] = useState<Complaint | null>(null);
  const [patchLength, setPatchLength] = useState<string>('25');
  const [patchWidth, setPatchWidth] = useState<string>('3.5');
  const [resurfaceModalComplaint, setResurfaceModalComplaint] = useState<Complaint | null>(null);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [repairMenuId, setRepairMenuId] = useState<string | null>(null);

  const nilCount = complaints.filter(c => c.status === 'nil').length;
  const open = complaints.filter(c => c.status === 'Under Progress');
  const done = complaints.filter(c => c.status === 'Repaired');

  const patchTargetSegment = useMemo(() => {
    if (!patchModalComplaint) return null;
    return segments.find(s => s.id === patchModalComplaint.segmentId) || segments[0];
  }, [patchModalComplaint, segments]);

  const patchPreview = useMemo(() => {
    const len = parseFloat(patchLength) || 0;
    const wid = parseFloat(patchWidth) || 0;
    const area = len * wid;
    const totalSegArea = 1000.0 * 7.0; // standard 1km x 7m
    const addedPatchingPct = (area / totalSegArea) * 100.0;
    const crackingReduct = addedPatchingPct / 1.3;
    return {
      area: area.toFixed(1),
      addedPatchingPct: addedPatchingPct.toFixed(2),
      crackingReduct: crackingReduct.toFixed(2),
    };
  }, [patchLength, patchWidth]);

  if (role !== 'admin') {
    return (
      <div className="auth-denied">
        <div className="denied-icon">
          <Shield size={27} />
        </div>
        <span className="kicker">Access restricted</span>
        <h1>Not authorized</h1>
        <p>This workspace area is available to municipal administrators.</p>
        <button className="primary" onClick={() => nav('/home')}>
          Return to Home <ChevronRight size={16} />
        </button>
      </div>
    );
  }

  async function handlePatchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!patchModalComplaint) return;
    const len = parseFloat(patchLength);
    const wid = parseFloat(patchWidth);
    if (!len || len <= 0 || !wid || wid <= 0) {
      window.alert('Please enter valid positive dimensions for patch length and width.');
      return;
    }

    setSubmitting(true);
    const saved = await executeRepair({
      complaintId: patchModalComplaint.id,
      repairType: 'PATCHING',
      patchLength: len,
      patchWidth: wid,
    });
    setSubmitting(false);
    if (saved) setPatchModalComplaint(null);
  }

  async function handleResurfaceConfirm() {
    if (!resurfaceModalComplaint) return;
    setSubmitting(true);
    const saved = await executeRepair({
      complaintId: resurfaceModalComplaint.id,
      repairType: 'FULL_RESURFACING',
    });
    setSubmitting(false);
    if (saved) setResurfaceModalComplaint(null);
  }

  return (
    <>
      <Heading
        eyebrow="Administration · complaints and repairs"
        title="Complaint management"
        description="Execute targeted asphalt patching or full road resurfacing to restore pavement condition."
      />
      <div className="admin-stats">
        <div>
          <small>All complaints</small>
          <b>{complaints.length}</b>
        </div>
        <div>
          <small>New / nil</small>
          <b style={{ color: 'var(--navy-60)' }}>{nilCount}</b>
        </div>
        <div>
          <small>Under progress</small>
          <b className="amber">{open.length}</b>
        </div>
        <div>
          <small>Repaired</small>
          <b>{done.length}</b>
        </div>
      </div>

      <div className="admin-table">
        <div className="admin-table-head">
          <b>Complaint register and repair actions</b>
          <span>{complaints.length} records · select a row to view</span>
        </div>
        <div className="admin-columns">
          <span>Report</span>
          <span>Road segment</span>
          <span>Severity and priority</span>
          <span>Status and actions</span>
        </div>
        {/* Most urgent first; stable sort keeps newest-first within a priority. */}
        {[...complaints].sort((a, b) => (a.priority || 'P9').localeCompare(b.priority || 'P9')).map(c => {
          const seg = segments.find(s => s.id === c.segmentId);
          return (
            <div
              className="admin-row clickable"
              key={c.id}
              onClick={() => setSelectedComplaint(c)}
              title="Click to view full complaint dossier"
            >
              <div>
                <b>{c.category}</b>
                <small>
                  {c.id} · {c.citizen} · {c.created}
                </small>
                <p>{c.description}</p>
              </div>
              <span>
                {seg?.name || c.segmentId}
                {seg && (
                  <small style={{ display: 'block', color: '#8c989f', fontSize: '9px', marginTop: '3px' }}>
                    Current PCI: {seg.pci} ({seg.health})
                  </small>
                )}
              </span>
              <span>
                <span className={`severity-text ${c.severity.toLowerCase()}`}>{c.severity}</span>
                <PrioritySelect c={c} />
              </span>
              <div>
                {c.status === 'nil' ? (
                  <div className="repair-status-cell">
                    <span className="status-pill nil">nil</span>
                    <button
                      className="btn-under-process"
                      title="Move this complaint to Under progress"
                      onClick={(e) => {
                        e.stopPropagation();
                        markUnderProcess(c.id);
                      }}
                    >
                      <Play size={11} fill="currentColor" />
                      <span>Under progress</span>
                    </button>
                  </div>
                ) : c.status === 'Under Progress' ? (
                  <div className="repair-status-cell">
                    <span className="status-pill pending">Under progress</span>
                    <div className="repair-status-menu">
                      <button
                        className="btn-repair repaired-trigger"
                        aria-expanded={repairMenuId === c.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRepairMenuId(repairMenuId === c.id ? null : c.id);
                        }}
                      >
                        <Check size={13} /><span>Repaired</span><ChevronDown size={13} />
                      </button>
                      {repairMenuId === c.id && (
                        <div className="repair-status-options" onClick={e => e.stopPropagation()}>
                          <button onClick={() => {
                            setPatchModalComplaint(c);
                            setPatchLength('25');
                            setPatchWidth('3.5');
                            setRepairMenuId(null);
                          }}><Wrench size={13} />Patching</button>
                          <button onClick={() => {
                            setResurfaceModalComplaint(c);
                            setRepairMenuId(null);
                          }}><RefreshCw size={13} />Full repaired</button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className={`repaired-tag ${c.repairType === 'PATCHING' ? 'patching' : 'resurfacing'}`}>
                    <Check size={13} />
                    {c.repairType === 'PATCHING' ? 'Repaired · Patching' : 'Repaired · Full repaired'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedComplaint && (
        <ComplaintDetailModal
          complaint={selectedComplaint}
          close={() => setSelectedComplaint(null)}
        />
      )}

      {/* 1. Patching Modal */}
      {patchModalComplaint && patchTargetSegment && (
        <div className="modal-backdrop" onClick={() => !submitting && setPatchModalComplaint(null)}>
          <div className="modal patch-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="kicker" style={{ color: '#f59e0b' }}>
                  Administrative repair · patching
                </div>
                <h2>Asphalt patching</h2>
              </div>
              <button className="icon-close" onClick={() => !submitting && setPatchModalComplaint(null)} aria-label="Close">
                <X />
              </button>
            </div>

            <p style={{ color: '#9da7ad', fontSize: '12px', margin: '8px 0 16px' }}>
              Resolving complaint <b>{patchModalComplaint.id}</b> ({patchModalComplaint.category}) on{' '}
              <b>{patchTargetSegment.name}</b>.
            </p>

            <form onSubmit={handlePatchSubmit}>
              <div className="form-two">
                <label>
                  Patch Length (m)
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="1000"
                    required
                    value={patchLength}
                    onChange={e => setPatchLength(e.target.value)}
                    placeholder="e.g. 25.0"
                  />
                </label>
                <label>
                  Patch Width (m)
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="15"
                    required
                    value={patchWidth}
                    onChange={e => setPatchWidth(e.target.value)}
                    placeholder="e.g. 3.5"
                  />
                </label>
              </div>

              {/* Dynamic Calculation Preview */}
              <div className="calc-preview-card amber-glow">
                <div className="calc-preview-title">
                  <span>Engineering estimate</span>
                  <span>1 km carriageway</span>
                </div>
                <div className="calc-preview-grid">
                  <div>
                    <small>Patch area</small>
                    <b>{patchPreview.area} m²</b>
                  </div>
                  <div>
                    <small>Δ Patching %</small>
                    <b style={{ color: '#f59e0b' }}>+{patchPreview.addedPatchingPct}%</b>
                  </div>
                  <div>
                    <small>Cracking reduction</small>
                    <b style={{ color: '#34d399' }}>-{patchPreview.crackingReduct}%</b>
                  </div>
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={submitting}
                  onClick={() => setPatchModalComplaint(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary btn-amber" disabled={submitting}>
                  <Wrench size={14} />
                  {submitting ? 'Updating…' : 'Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Full Resurfacing Confirmation Modal */}
      {resurfaceModalComplaint && (
        <div className="modal-backdrop" onClick={() => !submitting && setResurfaceModalComplaint(null)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="kicker" style={{ color: '#34d399' }}>
                  Administrative repair · full resurfacing
                </div>
                <h2>Full resurfacing</h2>
              </div>
              <button className="icon-close" onClick={() => !submitting && setResurfaceModalComplaint(null)} aria-label="Close">
                <X />
              </button>
            </div>

            <p style={{ color: '#d0ded8', fontSize: '13px', margin: '14px 0 10px', lineHeight: 1.5 }}>
              Are you sure you want to fully resurface this segment?
            </p>

            <div className="confirm-details">
              <b>Target segment:</b>{' '}
              {segments.find(s => s.id === resurfaceModalComplaint.segmentId)?.name || resurfaceModalComplaint.segmentId}
              <br />
              <br />
              This action will reset all pavement distresses to pristine baseline conditions:
              <ul style={{ margin: '8px 0 0', paddingLeft: '18px' }}>
                <li>Cracking, rutting, raveling, patching &rarr; <b>0.0%</b></li>
                <li>International Roughness Index (IRI) &rarr; <b>1.2 m/km</b></li>
                <li>Pavement Condition Index (PCI) &rarr; <b>100.0 (Good)</b></li>
              </ul>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                disabled={submitting}
                onClick={() => setResurfaceModalComplaint(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary btn-green"
                disabled={submitting}
                onClick={handleResurfaceConfirm}
              >
                <RefreshCw size={14} />
                {submitting ? 'Updating…' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ComplaintDetailModal({
  complaint,
  close,
}: {
  complaint: Complaint;
  close: () => void;
}) {
  const { segments, role, markUnderProcess, complaints } = useApp();
  const c = complaints.find(x => x.id === complaint.id) || complaint; // live record, so a priority change shows at once
  const seg = segments.find(s => s.id === c.segmentId);

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal complaint-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="kicker">Complaint · {c.id}</div>
            <h2>{c.category}</h2>
          </div>
          <button className="icon-close" onClick={close} title="Close" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="detail-status-bar">
          <div className="status-badge-wrap">
            <span className="label">Status</span>
            {c.status === 'nil' ? (
              <span className="status-pill nil">nil</span>
            ) : c.status === 'Under Progress' ? (
              <span className="status-pill pending">Under progress</span>
            ) : (
              <span className={`repaired-tag ${c.repairType === 'PATCHING' ? 'patching' : 'resurfacing'}`}>
                <Check size={13} /> Repaired {c.repairType ? `(${c.repairType === 'PATCHING' ? 'Patching' : 'Resurfacing'})` : ''}
              </span>
            )}
          </div>
          <div className="severity-badge-wrap">
            <span className="label">Severity</span>
            <span className={`severity-text ${c.severity.toLowerCase()}`}>{c.severity}</span>
          </div>
          <div className="severity-badge-wrap">
            <span className="label">Priority</span>
            {role === 'admin' ? (
              <PrioritySelect c={c} />
            ) : c.priority ? (
              <span className={`severity-text ${PRIORITY_CLASS[c.priority]}`}>{c.priority} · {PRIORITY_WORD[c.priority]}</span>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-label">Road corridor · location</div>
          <div className="detail-card">
            <div className="detail-road-name">
              <MapPin size={16} />
              <b>{seg?.name || c.segmentId}</b>
              <small style={{ color: '#8c989f' }}>({c.segmentId})</small>
            </div>
            {seg && (
              <div className="detail-road-metrics">
                <span>Pavement health: <b>{seg.health}</b></span>
                <span>Current PCI: <b>{seg.pci} / 100</b></span>
                <span>Cracking: <b>{seg.cracking}%</b></span>
                <span>IRI: <b>{seg.iri} m/km</b></span>
              </div>
            )}
          </div>
        </div>

        {c.photoUrl && (
          <div className="detail-section">
            <div className="detail-label">Photo from the reporter</div>
            <a href={c.photoUrl} target="_blank" rel="noreferrer" className="photo-preview">
              <img src={c.photoUrl} alt={`Photo for complaint ${c.id}`} loading="lazy" />
            </a>
          </div>
        )}

        <div className="detail-section">
          <div className="detail-label">Citizen report</div>
          <div className="detail-description-box">
            <p>{c.description}</p>
          </div>
        </div>

        <div className="detail-grid-two">
          <div>
            <small>Reported by</small>
            <b>{c.citizen}</b>
            {c.contact && <span className="detail-sub">{c.contact}</span>}
          </div>
          <div>
            <small>Submitted</small>
            <b>{c.created}</b>
          </div>
        </div>

        {c.status === 'Repaired' && (
          <div className="detail-repair-box">
            <div>
              <small>Repair action</small>
              <b>{c.repairType === 'PATCHING' ? 'Targeted asphalt patching' : 'Full resurfacing'}</b>
            </div>
            {c.repairedAt && (
              <div>
                <small>Completed</small>
                <b>{new Date(c.repairedAt).toLocaleString()}</b>
              </div>
            )}
          </div>
        )}

        <div className="modal-foot">
          {role === 'admin' && c.status === 'nil' ? (
            <button
              className="primary btn-amber"
              onClick={async () => {
                await markUnderProcess(c.id);
                close();
              }}
            >
              <Play size={13} fill="currentColor" /> Update to Under Process
            </button>
          ) : (
            <span style={{ fontSize: '12px', color: '#8c989f' }}>
              DigiRoad Pavement Management Dossier
            </span>
          )}
          <button className="secondary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AppRoot() {
  return <App />;
}

export default AppRoot;
