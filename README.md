# DigiRoad

DigiRoad tracks pavement condition on the Vembayam–Pallipuram Road (MDR47), Thiruvananthapuram, and links it to citizen complaints and repairs.

Three surveyed 1 km segments (MDR47-S01, S02, S03) each get a Pavement Condition Index (PCI, 0–100). A weekly simulation ages every segment using live weather and traffic. Citizens report defects, engineers record repairs, and the PCI updates straight away.

## Features

- **Condition maps:** a 3D MapLibre map where you hover a segment to raise it and click it for details, a 2D Leaflet fallback, and a three.js corridor model.
- **Weekly deterioration model:** a mechanistic–empirical model of cracking, ravelling, rutting, patching and roughness (IRI), giving a PCI and a health band:
  - Good: 85 and above
  - Fair: 70 and above
  - Poor: 55 and above
  - Very Poor: below 55
- **Citizen complaints:**
  - choose the location with a map pin or "use my location"; the nearest segment is highlighted in blue
  - attach a photo, then track the complaint to repair and answer "Is the road fixed?"
  - English and Malayalam
  - offline outbox, so the app works as a PWA without signal
- **Repairs:** admins record patching (by patch area) or full resurfacing, and the segment's PCI is recalculated in one database transaction.
- **Route planner:** tap A and B. Every distinct route is ranked by length-weighted PCI, using measured PCI on surveyed segments and assumed PCI by road class elsewhere (NH 75, SH 65, MDR 55, other 50).
- **Trends:** PCI history in 7-day steps, with dates in IST.
- **PaveBot:** a Gemini assistant that answers from the live database.
- **Safety and privacy:**
  - JWT auth with citizen, engineer and admin roles
  - 5 complaints per user per hour, plus a honeypot field
  - a consent checkbox
  - contact details removed 180 days after repair

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 18, TypeScript, Vite, react-leaflet, MapLibre GL, three.js |
| Backend | Python, FastAPI, APScheduler, httpx, PyJWT |
| Data | Supabase (PostgreSQL, Auth, Storage) |
| External | Open-Meteo (weather), TomTom Traffic Flow, OSRM (routing), OpenFreeMap tiles, Google Gemini |
| Hosting | Render, kept awake by an UptimeRobot monitor that pings every 5 minutes |

## Repository layout

```
backend/
  app/
    api/            REST routers (home, complaints, admin, simulations, trends, chat)
    services/       decay model, simulations, weather, traffic, Supabase client
    scheduler.py    weekly job, Mondays 03:17 IST, plus a catch-up at startup
  migrations/       SQL to run in Supabase
  run_historical_sim.py   one-time history backfill (2022-10-01 to 2026-10-12)
frontend/
  src/              React app (ui.tsx, citizen.tsx, Map3D.tsx, state.tsx)
  public/           PWA manifest, service worker, icon
  dist/             production build (committed)
```

## Run locally

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows; on macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Create `backend/.env`. It is ignored by git, so never commit it.

```
SUPABASE_URL=...
SUPABASE_KEY=...
SUPABASE_JWT_SECRET=...
GEMINI_API_KEY=...
TOMTOM_API_KEY=...          # optional; traffic factor defaults to 1.0
OPENWEATHER_API_KEY=...     # optional; fallback when Open-Meteo fails
```

Run the SQL files in `backend/migrations/` in the Supabase SQL editor, oldest first.

### Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build        # writes dist/
```

Set `VITE_API_BASE_URL` to the backend URL, for example `http://localhost:8000`.

## Weekly simulation

- **When it runs:** the scheduler runs inside the backend and fires every Monday at 03:17 IST.
- **What each run does:** for every segment it takes a 7-day step, writes the new state to `dynamic_road_evaluations`, and appends the step to `historic_road_evaluations`.
- **Missed runs:** if the service was asleep, the backend runs the job at startup whenever the last evaluation is 7 or more days old.

## Live site

https://digiroad-1.onrender.com
