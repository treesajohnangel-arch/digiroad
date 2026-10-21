import React, { useState, useMemo, useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
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
import { MapContainer, TileLayer, Polyline, ZoomControl, useMap } from 'react-leaflet';
import { Complaint, Health, Segment, useApp } from './state';

const hc = (h: Health) => h.toLowerCase().replace(' ', '-');
const isRecentRepair = (complaint: Complaint) => {
  if (complaint.status !== 'Repaired') return false;
  const timestamp = complaint.repairedAt ? Date.parse(complaint.repairedAt) : Date.parse(complaint.created);
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 7 * 24 * 60 * 60 * 1000;
};
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

function Brand() {
  return (
    <div className="brand">
      <LogoMark />
      <b>DIGIROAD</b>
    </div>
  );
}

function LogoMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 100 68" aria-hidden="true">
      <defs>
        <linearGradient id="roadmark" x1="15%" y1="90%" x2="90%" y2="10%">
          <stop offset="0" stopColor="#176d72" />
          <stop offset="1" stopColor="#18c4c5" />
        </linearGradient>
      </defs>
      <path d="M8 62c0-15 7-27 22-37C42 17 49 12 49 4" />
      <path d="M29 62c0-12 6-21 17-29C58 24 63 15 64 7" />
      <path d="M50 62c1-9 7-15 18-20 9-4 16-10 21-18" />
      <path d="M69 62c6-6 14-9 24-10" />
    </svg>
  );
}

function Login() {
  const { login, signup, users } = useApp();
  const nav = useNavigate();
  const [tab, T] = useState<'login' | 'signup'>('login');
  const [name, N] = useState('');
  const [email, E] = useState('');
  const [password, P] = useState('');
  const [confirm, C] = useState('');
  const [show, S] = useState(false);
  const [busy, B] = useState(false);
  const [error, Xe] = useState('');
  const [intro, setIntro] = useState(true);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIntro(false);
      return;
    }
    const timer = window.setTimeout(() => setIntro(false), 1450);
    return () => window.clearTimeout(timer);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    Xe('');
    if (tab === 'signup') {
      if (password !== confirm) {
        Xe('Passwords do not match.');
        return;
      }
      if (users.includes(email.toLowerCase())) {
        window.alert('An account with this email ID already exists. Please login instead.');
        return;
      }
    }
    B(true);
    setTimeout(() => {
      if (tab === 'login' && !users.includes(email.toLowerCase())) {
        Xe('No demo account found. Try admin@digiroad.gov or engineer@digiroad.local.');
        B(false);
        return;
      }
      if (tab === 'signup') {
        if (!signup(name, email, password)) {
          window.alert('An account with this email ID already exists. Please login instead.');
          B(false);
          return;
        }
        login(name, email);
      } else {
        login(email.includes('admin') ? 'Demo Administrator' : 'Demo Engineer', email);
      }
      nav('/home');
      B(false);
    }, 350);
  }

  return (
    <main className={`login ${intro ? 'login-intro-active' : 'login-revealed'}`}>
      {intro && (
        <div className="brand-intro" aria-hidden="true">
          <div className="brand-intro-lockup"><LogoMark /><b>DIGIROAD</b></div>
        </div>
      )}
      <section className="login-left">
        <Brand />
        <div className="hero-copy">
          <h1>
            See the road
            <br />
            beneath the road.
          </h1>
          <p>Street-level condition intelligence for the people who keep a city moving.</p>
          <div className="road-art">
            <div className="art-grid" />
            <svg viewBox="0 0 600 300" preserveAspectRatio="none">
              <path d="M-20 225 C95 220 135 126 250 143 S420 242 620 46" />
              <path className="road-dash" d="M-20 225 C95 220 135 126 250 143 S420 242 620 46" />
              <path className="road-good" d="M-20 225 C95 220 135 126 250 143 S420 242 620 46" />
            </svg>
          </div>
        </div>
      </section>
      <section className="login-right">
        <div className="mobile-brand"><Brand /></div>
        <div className="auth">
          <h2>{tab === 'login' ? 'Welcome back' : 'Create an account'}</h2>
          <p>{tab === 'login' ? 'Sign in to continue to your workspace.' : 'Join the municipal road health workspace.'}</p>
          <div className="tabs">
            <button
              className={tab === 'login' ? 'active' : ''}
              onClick={() => {
                T('login');
                Xe('');
              }}
            >
              Log in
            </button>
            <button
              className={tab === 'signup' ? 'active' : ''}
              onClick={() => {
                T('signup');
                Xe('');
              }}
            >
              Sign up
            </button>
          </div>
          <form onSubmit={submit}>
            {tab === 'signup' && (
              <label>
                Full name
                <input required value={name} onChange={e => N(e.target.value)} placeholder="Your name" />
              </label>
            )}
            <label>
              Email address
              <input type="email" required value={email} onChange={e => E(e.target.value)} placeholder="you@municipality.gov.in" />
            </label>
            <label>
              Password
              <div className="pass">
                <input
                  type={show ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={e => P(e.target.value)}
                  placeholder="At least 6 characters"
                />
                <button type="button" onClick={() => S(!show)}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            {tab === 'signup' && (
              <label>
                Confirm password
                <input
                  type={show ? 'text' : 'password'}
                  required
                  value={confirm}
                  onChange={e => C(e.target.value)}
                  placeholder="Re-enter password"
                />
              </label>
            )}
            {error && <div className="error">{error}</div>}
            <button className="primary wide" disabled={busy}>
              {busy ? 'Working…' : tab === 'login' ? 'Sign in to workspace' : 'Create account'}
              <ChevronRight size={17} />
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Shell() {
  const { role, setRole, user, logout, toast, segments } = useApp();
  const [mobile, M] = useState(false);
  const nav = useNavigate();
  const location = useLocation();

  const avgPci = useMemo(() => {
    if (!segments.length) return 0;
    const sum = segments.reduce((acc, s) => acc + s.pci, 0);
    return (sum / segments.length).toFixed(1);
  }, [segments]);

  return (
    <div className="shell">
      <aside className={`sidebar ${mobile ? 'show' : ''}`}>
        <Brand />
        <div className="tenant">
          <span>TVM</span>
          <div>
            <b>Thiruvananthapuram</b>
            <small>Municipal Corporation</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="side-label">WORKSPACE</div>
        <nav>
          <NavLink to="/home" onClick={() => M(false)}>
            <Layers3 />Home
          </NavLink>
          <NavLink to="/simulations" onClick={() => M(false)}>
            <Activity />Simulations
          </NavLink>
          <NavLink to="/trends" onClick={() => M(false)}>
            <TrendingUp />Trends
          </NavLink>
          <NavLink to="/repaired" onClick={() => M(false)}>
            <Check />Repaired
          </NavLink>
          <NavLink to="/admin" onClick={() => M(false)}>
            <Shield />Admin<ChevronRight className="nav-arrow" />
          </NavLink>
        </nav>
        <div className="network">
          <div className="side-label">NETWORK HEALTH</div>
          <div className="pci-head">
            <span>Overall PCI</span>
            <b>{avgPci}</b>
          </div>
          <div className="pci-bar">
            <i style={{ width: `${Math.min(100, Math.max(0, Number(avgPci)))}%` }} />
          </div>
          <small>
            <i className="dot fair" /> Monitored corridor condition
          </small>
        </div>
        <div className="monitor">
          <div className="side-label">
            MONITORED SEGMENTS <span>0{segments.length}</span>
          </div>
          {segments.map(s => (
            <NavLink to="/home" key={s.id}>
              <i className={`dot ${hc(s.health)}`} />
              <span>{s.name}</span>
              <small>{s.pci}</small>
            </NavLink>
          ))}
        </div>
        <div className="account">
          <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <b>{user.name}</b>
            <small>{role === 'admin' ? 'Network administrator' : 'Field engineer'}</small>
          </div>
          <button
            onClick={() => {
              logout();
              nav('/login');
            }}
            title="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="hamb" onClick={() => M(true)}>
            <Menu />
          </button>
          <span className="breadcrumb">
            Workspace <ChevronRight size={13} /> <b>{location.pathname.split('/')[1] || 'home'}</b>
          </span>
          <div className="top-controls">
            <button className="search-trigger" onClick={() => document.getElementById('road-search')?.focus()}>
              <Search size={15} /> Search segments <kbd><Command size={11} /> K</kbd>
            </button>
            <i className="divider" />
            <small>ROLE</small>
            <button className={`switch ${role === 'admin' ? 'on' : ''}`} onClick={() => setRole(role === 'admin' ? 'public' : 'admin')}>
              <i />
            </button>
            <span className={`role ${role}`}>{role}</span>
            <i className="divider" />
            <span className="avatar small">{user.name[0]}</span>
            <button
              className="logout"
              onClick={() => {
                logout();
                nav('/login');
              }}
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <div className="content">
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/simulations" element={<Simulations />} />
            <Route path="/trends" element={<Trends />} />
            <Route path="/repaired" element={<RepairHistory />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </div>
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

function Home() {
  const { complaints, addComplaint, segments } = useApp();
  const [selected, Sel] = useState<Segment | null>(null);
  const [query, Q] = useState('');
  const [modal, Modal] = useState(false);
  const [bot, BotOpen] = useState(false);

  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);

  const under = complaints.filter(c => c.status === 'Under Progress');
  const done = complaints.filter(isRecentRepair);
  const results = segments.filter(
    s => s.name.toLowerCase().includes(query.toLowerCase()) || s.id.toLowerCase().includes(query.toLowerCase())
  );

  const avgPci = useMemo(() => {
    if (!segments.length) return '0.0';
    return (segments.reduce((acc, s) => acc + s.pci, 0) / segments.length).toFixed(1);
  }, [segments]);

  return (
    <>
      <Heading
        eyebrow="HOME / NETWORK OVERVIEW"
        title="Home"
        description="A live view of pavement condition across the monitored corridor."
        action={
          <button className="secondary" onClick={() => Modal(true)}>
            <Plus size={16} /> Report an issue
          </button>
        }
      />
      <div className="snapshot">
        <div className="snapshot-label">
          <i /> NETWORK SNAPSHOT
        </div>
        <div>
          <span>Segments monitored</span>
          <b>0{segments.length} <small>roads</small></b>
        </div>
        <div>
          <span>Average PCI</span>
          <b>{avgPci} <small>/ 100</small></b>
        </div>
        <div>
          <span>Active complaints</span>
          <b className="amber">{String(under.length).padStart(2, '0')} <small>open</small></b>
        </div>
        <div>
          <span>Last survey</span>
          <b>19 <small>Oct 2026</small></b>
        </div>
      </div>
      <section className="map-section">
        <div className="section-head">
          <div>
            <div className="kicker">SPATIAL CONDITION MODEL</div>
            <h2>Technopark corridor <span>·</span> Thiruvananthapuram, Kerala</h2>
          </div>
          <div className="searchbox">
            <Search size={15} />
            <input id="road-search" placeholder="Find a road segment…" value={query} onChange={e => Q(e.target.value)} />
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
            <kbd>⌘ K</kbd>
          </div>
        </div>
        <div className="map-wrap">
          <LeafletMap selected={selected} onSelect={Sel} segments={segments} />
          <div className="map-location">
            <MapPin size={14} /> KAZHAKKOOTTAM <small>8.57° N · 76.88° E</small>
          </div>
          <div className="legend">
            <b>ROAD CONDITION</b>
            {(['Very Poor', 'Poor', 'Fair', 'Good'] as Health[]).map(h => (
              <span key={h}>
                <i className={`dot ${hc(h)}`} />
                {h}
              </span>
            ))}
          </div>
          <small className="map-credit">© OpenStreetMap contributors · Live condition overlay</small>
        </div>
        <div className="segment-list">
          {segments.map(s => (
            <button className={`segment ${selected?.id === s.id ? 'picked' : ''}`} key={s.id} onClick={() => Sel(s)}>
              <i className={`segment-mark ${hc(s.health)}`} />
              <small>{s.id}</small>
              <span>
                {s.name}
                <small>Dynamic evaluation · PCI {s.pci}</small>
              </span>
              <HealthTag h={s.health} />
              <b className="score">
                {s.pci}
                <small>PCI</small>
              </b>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </section>
      <section className="complaints">
        <div className="section-title">
          <div>
            <div className="kicker">CITIZEN FEEDBACK</div>
            <h2>
              Complaints tracker <small>{String(complaints.length).padStart(2, '0')}</small>
            </h2>
          </div>
          <button className="link-button" onClick={() => Modal(true)}>
            Submit a complaint <Plus size={15} />
          </button>
        </div>
        <div className="tables">
          <ComplaintTable
            title="Under progress"
            entries={under}
            empty="No active complaints (All clear)"
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
  React.useEffect(() => {
    if (selected) map.flyToBounds(selected.coords, { padding: [55, 55], duration: 0.7 });
  }, [selected, map]);

  return (
    <>
      {segments.map(s => (
        <React.Fragment key={s.id}>
          <Polyline positions={s.coords} pathOptions={{ color: '#0b0f17', weight: 11, opacity: 1 }} />
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
  const mapProps = { center: [8.573, 76.882], zoom: 14, zoomControl: false, className: 'leaflet' } as React.ComponentProps<
    typeof MapContainer
  >;
  const tileProps = {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    eventHandlers: { tileerror: () => fail(true) },
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
          <b>LOCAL MAP VIEW</b>
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
        <b>{String(entries.length).padStart(2, '0')}</b>
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
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="kicker">SEGMENT CONDITION / {s.id}</div>
            <h2>{s.name}</h2>
          </div>
          <button className="icon-close" onClick={close}>
            <X />
          </button>
        </div>
        <div className="modal-health">
          <span>Current road health</span>
          <HealthTag h={s.health} />
          <b>
            {s.pci}
            <small>PCI SCORE</small>
          </b>
        </div>
        <div className="metric-grid">
          {[
            ['Cracking', s.cracking + '%'],
            ['Raveling', s.raveling + '%'],
            ['Rut Depth', (s.rutting || 0) + ' mm'],
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
          Dynamic evaluation active
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
  submit: (c: Omit<Complaint, 'id' | 'status' | 'created'>) => void;
}) {
  const { segments } = useApp();
  const [form, F] = useState({
    citizen: '',
    contact: '',
    segmentId: segments[0]?.id || 'SEG-101',
    category: 'Pothole',
    severity: 'Medium',
    description: '',
  });

  function set(k: keyof typeof form, v: string) {
    F(f => ({ ...f, [k]: v }));
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    submit(form);
    close();
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal form-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="kicker">CITIZEN FEEDBACK</div>
            <h2>Report a road issue</h2>
          </div>
          <button className="icon-close" onClick={close}>
            <X />
          </button>
        </div>
        <form onSubmit={send} className="complaint-form">
          <div className="form-two">
            <label>
              Citizen name
              <input required value={form.citizen} onChange={e => set('citizen', e.target.value)} />
            </label>
            <label>
              Contact number
              <input required type="tel" value={form.contact} onChange={e => set('contact', e.target.value)} />
            </label>
          </div>
          <label>
            Road segment
            <select value={form.segmentId} onChange={e => set('segmentId', e.target.value)}>
              {segments.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-two">
            <label>
              Issue category
              <select value={form.category} onChange={e => set('category', e.target.value)}>
                {['Pothole', 'Surface damage', 'Cracking', 'Drainage', 'Road marking', 'Other'].map(o => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              Severity
              <select value={form.severity} onChange={e => set('severity', e.target.value)}>
                {['Low', 'Medium', 'High', 'Critical'].map(o => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Description
            <textarea
              required
              maxLength={400}
              rows={4}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Describe the location and condition…"
            />
          </label>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary">
              <Send size={15} /> Submit complaint
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PaveBot({ close }: { close: () => void }) {
  const { complaints, segments } = useApp();
  const [messages, M] = useState([
    { by: 'bot', text: 'Hello. I’m PaveBot, your local road-health assistant. Ask me about the monitored corridor.' },
  ]);
  const [input, I] = useState('');

  function answer(q: string) {
    const t = q.toLowerCase();
    const sorted = [...segments].sort((a, b) => a.pci - b.pci);
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];

    if (t.includes('attention') || t.includes('worst')) {
      return `${worst.name} needs attention first. PCI is ${worst.pci} (${worst.health}), with ${worst.cracking}% cracking.`;
    }
    if (t.includes('complaint')) {
      return `There are ${complaints.filter(c => c.status === 'Under Progress').length} complaints under progress and ${complaints.filter(c => c.status === 'Repaired').length} repaired.`;
    }
    if (t.includes('good') || t.includes('best')) {
      return `${best.name} is currently in the best condition with a PCI score of ${best.pci} (${best.health}).`;
    }
    return `The corridor has ${segments.length} monitored segments. ${worst.name} has the lowest score (${worst.pci}); ${best.name} is highest (${best.pci}).`;
  }

  function ask(q = input) {
    if (!q.trim()) return;
    M(m => [...m, { by: 'you', text: q }, { by: 'bot', text: answer(q) }]);
    I('');
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
            <p>{m.text}</p>
          </div>
        ))}
      </div>
      <div className="quick-asks">
        <small>QUICK QUESTIONS</small>
        {['Which road needs attention?', 'Show complaint status', 'Which road is in good condition?'].map(q => (
          <button key={q} onClick={() => ask(q)}>
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
        <input value={input} onChange={e => I(e.target.value)} placeholder="Ask about road health…" />
        <button>
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
        eyebrow="PAVEMENT FORECAST / MECHANISTIC MODEL"
        title="Run a simulation"
        description="Forecast pavement degradation taking live segment baseline values into account."
      />
      <div className="control-panel">
        <label>
          SIMULATION DATE
          <div className="date-input">
            <CalendarDays size={16} />
            <input type="date" value={date} onChange={e => D(e.target.value)} />
          </div>
        </label>
        <label>
          ROAD SEGMENT
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
              <span className="kicker">PROJECTED CONDITION / {date}</span>
              <h2>{s.name}</h2>
            </div>
            <span className="model-stamp">MECHANISTIC MODEL · 30 DAY HORIZON</span>
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
              <div className="kicker">PROJECTED DECAY</div>
              <h2>Condition over 30 days</h2>
            </div>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={Array.from({ length: 7 }, (_, i) => ({ day: `Day ${i * 5}`, pci: Math.max(s.pci - i * 0.5, 0) }))}>
                  <defs>
                    <linearGradient id="pciFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6b8f80" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6b8f80" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#26303b" vertical={false} />
                  <XAxis dataKey="day" stroke="#87919b" />
                  <YAxis domain={[0, 100]} stroke="#87919b" />
                  <ChartTooltip contentStyle={{ background: '#131a23', border: '1px solid #303a46', color: '#edf0f1' }} />
                  <Area dataKey="pci" stroke="#80ae9b" fill="url(#pciFill)" />
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
        eyebrow="HISTORICAL CONDITION / PCI"
        title="Road health trends"
        description="Track pavement condition and repair event milestones across the corridor."
      />
      <div className="control-panel trend-controls">
        <label>
          REFERENCE DATE
          <div className="date-input">
            <CalendarDays size={16} />
            <input type="date" value={date} onChange={e => D(e.target.value)} />
          </div>
        </label>
        <label>
          ROAD SEGMENT
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
              PCI HISTORY / {points[0]?.fullDate.toUpperCase()} — {points[points.length - 1]?.fullDate.toUpperCase()}
            </div>
            <h2>Date vs. Pavement Health Index</h2>
          </div>
          <span className="chart-legend">
            <i /> Pavement Condition Index (PCI)
          </span>
        </div>
        <div className="chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points}>
              <CartesianGrid stroke="#26303b" vertical={false} />
              <XAxis dataKey="date" interval={period === '30 days' ? 4 : 14} stroke="#87919b" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} stroke="#87919b" />
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
              <Line dataKey="pci" type="monotone" stroke="#8eb49e" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#8eb49e' }} />
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
  const { complaints, segments } = useApp();
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [filterSegment, setFilterSegment] = useState<string>('all');
  const [viewTab, setViewTab] = useState<'archived' | 'all'>('archived');

  const allRepaired = complaints.filter(c => c.status === 'Repaired');
  const archived = allRepaired.filter(c => !isRecentRepair(c));

  const baseList = viewTab === 'archived' ? archived : allRepaired;
  const filtered = filterSegment === 'all'
    ? baseList
    : baseList.filter(c => c.segmentId === filterSegment);

  return (
    <>
      <Heading
        eyebrow="MAINTENANCE / REPAIR HISTORY"
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
          <option value="all">All Road Corridors</option>
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
          <span>{filtered.length} RECORDS · CLICK TO INSPECT</span>
        </div>
        <div className="admin-columns history-columns">
          <span>COMPLAINT</span><span>ROAD SEGMENT</span><span>REPAIR ACTION</span><span>COMPLETED</span>
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
                <Check size={13} />{c.repairType === 'PATCHING' ? 'Patched' : 'Full resurfacing'}
              </span>
              <span>{c.repairedAt ? new Date(c.repairedAt).toLocaleString() : c.created}</span>
            </div>
          );
        }) : <div className="empty">No repaired complaints match the current filter.</div>}
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

  if (role !== 'admin') {
    return (
      <div className="auth-denied">
        <div className="denied-icon">
          <Shield size={27} />
        </div>
        <span className="kicker">ACCESS RESTRICTED</span>
        <h1>Not authorized to access this page.</h1>
        <p>This workspace area is available to municipal administrators.</p>
        <button className="primary" onClick={() => nav('/home')}>
          Return to Home <ChevronRight size={16} />
        </button>
      </div>
    );
  }

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
    await executeRepair({
      complaintId: patchModalComplaint.id,
      repairType: 'PATCHING',
      patchLength: len,
      patchWidth: wid,
    });
    setSubmitting(false);
    setPatchModalComplaint(null);
  }

  async function handleResurfaceConfirm() {
    if (!resurfaceModalComplaint) return;
    setSubmitting(true);
    await executeRepair({
      complaintId: resurfaceModalComplaint.id,
      repairType: 'FULL_RESURFACING',
    });
    setSubmitting(false);
    setResurfaceModalComplaint(null);
  }

  return (
    <>
      <Heading
        eyebrow="ADMINISTRATION / COMPLAINTS & REPAIR"
        title="Complaint management"
        description="Execute targeted asphalt patching or full road resurfacing to restore pavement condition."
      />
      <div className="admin-stats">
        <div>
          <small>All complaints</small>
          <b>{String(complaints.length).padStart(2, '0')}</b>
        </div>
        <div>
          <small>New / nil</small>
          <b style={{ color: '#94a3b8' }}>{String(nilCount).padStart(2, '0')}</b>
        </div>
        <div>
          <small>Under progress</small>
          <b className="amber">{String(open.length).padStart(2, '0')}</b>
        </div>
        <div>
          <small>Repaired</small>
          <b>{String(done.length).padStart(2, '0')}</b>
        </div>
      </div>

      <div className="admin-table">
        <div className="admin-table-head">
          <b>Complaint register & repair actions</b>
          <span>{complaints.length} RECORDS · CLICK ROW TO VIEW</span>
        </div>
        <div className="admin-columns">
          <span>REPORT</span>
          <span>ROAD SEGMENT</span>
          <span>SEVERITY</span>
          <span>STATUS / ACTIONS</span>
        </div>
        {complaints.map(c => {
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
              <span className={`severity-text ${c.severity.toLowerCase()}`}>{c.severity}</span>
              <div>
                {c.status === 'nil' ? (
                  <div className="repair-status-cell">
                    <span className="status-pill nil">nil</span>
                    <button
                      className="btn-under-process"
                      title="Update status to Under Process"
                      onClick={(e) => {
                        e.stopPropagation();
                        markUnderProcess(c.id);
                      }}
                    >
                      <Play size={11} fill="currentColor" />
                      <span>Under Process</span>
                    </button>
                  </div>
                ) : c.status === 'Under Progress' ? (
                  <div className="repair-status-cell">
                    <span className="status-pill pending">Under Process</span>
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
                          }}><Wrench size={13} />Patched</button>
                          <button onClick={() => {
                            setResurfaceModalComplaint(c);
                            setRepairMenuId(null);
                          }}><RefreshCw size={13} />Full resurface</button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className={`repaired-tag ${c.repairType === 'PATCHING' ? 'patching' : 'resurfacing'}`}>
                    <Check size={13} />
                    {c.repairType === 'PATCHING' ? 'Repaired (Patching)' : 'Repaired (Resurfaced)'}
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
                  ADMINISTRATIVE REPAIR · PATCHING WORKFLOW
                </div>
                <h2>Execute Asphalt Patching</h2>
              </div>
              <button className="icon-close" onClick={() => !submitting && setPatchModalComplaint(null)}>
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
                  <span>REAL-TIME ENGINEERING ESTIMATE</span>
                  <span>1KM CARRIAGEWAY</span>
                </div>
                <div className="calc-preview-grid">
                  <div>
                    <small>Patch Area</small>
                    <b>{patchPreview.area} m²</b>
                  </div>
                  <div>
                    <small>Δ Patching %</small>
                    <b style={{ color: '#f59e0b' }}>+{patchPreview.addedPatchingPct}%</b>
                  </div>
                  <div>
                    <small>Cracking Reduction</small>
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
                  ADMINISTRATIVE REPAIR · FULL RESURFACING
                </div>
                <h2>Confirm Full Resurfacing</h2>
              </div>
              <button className="icon-close" onClick={() => !submitting && setResurfaceModalComplaint(null)}>
                <X />
              </button>
            </div>

            <p style={{ color: '#d0ded8', fontSize: '13px', margin: '14px 0 10px', lineHeight: 1.5 }}>
              Are you sure you want to fully resurface this segment?
            </p>

            <div className="confirm-details">
              <b>Target Segment:</b>{' '}
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
  complaint: c,
  close,
}: {
  complaint: Complaint;
  close: () => void;
}) {
  const { segments, role, markUnderProcess } = useApp();
  const seg = segments.find(s => s.id === c.segmentId);

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal complaint-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="kicker">COMPLAINT DOSSIER · {c.id}</div>
            <h2>{c.category}</h2>
          </div>
          <button className="icon-close" onClick={close} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="detail-status-bar">
          <div className="status-badge-wrap">
            <span className="label">STATUS:</span>
            {c.status === 'nil' ? (
              <span className="status-pill nil">nil</span>
            ) : c.status === 'Under Progress' ? (
              <span className="status-pill pending">Under Process</span>
            ) : (
              <span className={`repaired-tag ${c.repairType === 'PATCHING' ? 'patching' : 'resurfacing'}`}>
                <Check size={13} /> Repaired {c.repairType ? `(${c.repairType === 'PATCHING' ? 'Patching' : 'Resurfacing'})` : ''}
              </span>
            )}
          </div>
          <div className="severity-badge-wrap">
            <span className="label">SEVERITY:</span>
            <span className={`severity-text ${c.severity.toLowerCase()}`}>{c.severity}</span>
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-label">ROAD CORRIDOR / LOCATION</div>
          <div className="detail-card">
            <div className="detail-road-name">
              <MapPin size={16} />
              <b>{seg?.name || c.segmentId}</b>
              <small style={{ color: '#8c989f' }}>({c.segmentId})</small>
            </div>
            {seg && (
              <div className="detail-road-metrics">
                <span>Pavement Health: <b>{seg.health}</b></span>
                <span>Current PCI: <b>{seg.pci} / 100</b></span>
                <span>Cracking: <b>{seg.cracking}%</b></span>
                <span>IRI: <b>{seg.iri} m/km</b></span>
              </div>
            )}
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-label">CITIZEN REPORT DESCRIPTION</div>
          <div className="detail-description-box">
            <p>{c.description}</p>
          </div>
        </div>

        <div className="detail-grid-two">
          <div>
            <small>REPORTED BY</small>
            <b>{c.citizen}</b>
            {c.contact && <span className="detail-sub">{c.contact}</span>}
          </div>
          <div>
            <small>SUBMITTED AT</small>
            <b>{c.created}</b>
          </div>
        </div>

        {c.status === 'Repaired' && (
          <div className="detail-repair-box">
            <div>
              <small>REPAIR ACTION COMPLETED</small>
              <b>{c.repairType === 'PATCHING' ? 'Targeted Asphalt Patching' : 'Full Surface Resurfacing'}</b>
            </div>
            {c.repairedAt && (
              <div>
                <small>COMPLETION DATE</small>
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
