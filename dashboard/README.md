# Engineering Team Dashboard

A full-screen wall display for a touchscreen TV, laid out as three swipeable pages.

**Page 1 -- Overview:** meeting takeaways and team updates pulled straight out of
folders, and the date/time with calendar and agenda -- each running the full
height of the wall.
**Page 2 -- Projects:** a full-screen Kanban board with owners, priority, due
dates, health and progress.
**Page 3 -- Area Coverage:** a full-screen board of who is covering which area
today; drag an engineer between areas with a finger.

Swipe left and right to move between them, or tap **Overview** / **Projects** /
**Coverage** in the bottom bar. A scrolling world-news ticker runs across all pages.

Everything updates by itself. Drop a Word doc in a folder and it is on the wall a
second later — nobody has to touch the TV.

![Layout](docs/layout.svg)

---

## What's on screen

| Section | Where its content comes from |
|---|---|
| **Area Coverage** (page 2) | `data\coverage\coverage.yaml` — engineer cards you drag between area columns. Saved to disk and mirrored to any other screen showing the dashboard. |
| **Team Meeting Takeaways** | Every `.docx` / `.pdf` / `.md` / `.txt` in `data\meeting-takeaways`. Newest first, auto-rotating. |
| **Team Updates** | Same, from `data\team-updates`. One file per project or per person works well. |
| **Project Tracking** | `data\projects\projects.yaml` — a Kanban board with owners, priority, due dates, health and progress. |
| **Date / time / calendar** | The clock, a month grid, and the next few events from your calendar's ICS link. Use **‹ ›** to change month (**Today** returns), tap ⤢ for a full-screen month, or tap any day for its schedule. |
| **News ticker** | RSS world-news feeds, refreshed every 10 minutes. |

---

## Setup on Windows

**Requirements:** Windows 10 or 11, and Python 3.11+.
If you don't have Python: `winget install --id Python.Python.3.12 --source winget`
(or grab it from python.org and tick *Add python.exe to PATH*).

1. Copy this `dashboard` folder onto the PC driving the TV.
2. Double-click **`Install.bat`**.
   It builds a private virtual environment, installs the dependencies, creates
   `dashboard.env`, and registers a task so the wall comes back on its own after
   a reboot. No admin rights, nothing installed machine-wide.
3. Open **`dashboard.env`** in Notepad and set at least:
   - `DASHBOARD_TZ` — your timezone, e.g. `America/New_York`
   - `CALENDAR_ICS_URLS` — your calendar's ICS link (optional; see below)
4. Double-click **`Start Dashboard.bat`**.

The server starts hidden and a dedicated Edge window opens full-screen on the TV.

On a fresh install the `data\` folders start empty, so `Install.bat` seeds them
with the examples in `samples\` — the wall looks alive on first run. It only
ever seeds a folder that is empty, so it never overwrites real content.

### Updating to a new build

Unzip the new build over the `dashboard` folder and run `Start Dashboard.bat`.

**Your content is safe.** The `data\` folder — the project board, everything the
team has posted — and your `dashboard.env` are yours; they live only on this
machine and are never part of a build, so an update cannot overwrite them. A
build only replaces the program (the `backend\`, `frontend\`, `windows\` and
`samples\` folders). You do not need to re-run `Install.bat` unless a release
note says a new dependency was added.

**Everyday controls**

| Action | How |
|---|---|
| Start it | `Start Dashboard.bat`, or the *Team Dashboard* desktop shortcut |
| Change page | Swipe left/right, tap **Overview** / **Projects** / **Coverage**, or press `←` `→` (or `1` / `2` / `3`) |
| Minimise, close, or shut down | Tap the **power icon** at the right of the bottom bar |
| Leave kiosk mode by keyboard | `Ctrl+W` or `Alt+F4` on the TV |
| Stop the server from a terminal | `windows\Stop-Dashboard.ps1` |
| Run windowed while setting up | `Start Dashboard.bat -Windowed` |
| Server only, no browser | `Start Dashboard.bat -NoBrowser` |
| Remove it | `windows\Uninstall-Dashboard.ps1` (your `data\` folder is kept) |

Logs land in `dashboard.log` and `dashboard.stdout.log` next to the app.

### The drop page -- how the team posts (recommended)

Set `DASHBOARD_HOST=0.0.0.0` in `dashboard.env` and restart. Anyone on the
office network then opens **`http://<tv-pc-name>:8770/drop`** in any browser,
picks a destination, drags a file in, and it is on the wall within a second.

No file share to map, no login, nothing to install. The dashboard prints this
address on itself, under Team Updates, so nobody has to be told it twice.

Hand out `docs/Team-Dashboard-One-Pager.pdf` -- a single printable page
covering posting, what reads well on a wall, the project board and the
area-coverage board. Pin one by the TV, email the rest.

**What the drop page accepts:** `.docx`, `.pdf`, `.md`, `.txt`, up to 25 MB.
Filenames are rebuilt from safe characters, path traversal is refused, and a
repeat filename is kept alongside the original rather than overwriting it.

**Trust model:** uploads are allowed from the LAN because that is the entire
point; a posted document is additive and reversible. The endpoints that stop
the wall or rewrite the project board stay loopback-only, so a browser at
someone's desk can post files but cannot move cards or shut the display down.
There is no authentication, so keep this on a trusted network.

### Letting the team drop files from their own desks

By default the dashboard reads the `data\` folder beside the app. Point it at a
share instead and everyone can update the wall without walking over to it — set
these in `dashboard.env`:

```
TAKEAWAYS_DIR=\\fileserver\team\dashboard\meeting-takeaways
UPDATES_DIR=\\fileserver\team\dashboard\team-updates
PROJECTS_DIR=\\fileserver\team\dashboard\projects
```

The watcher handles UNC paths and SMB shares. If the share is briefly
unreachable the panel keeps showing what it last read.

### Viewing it from another machine

Set `DASHBOARD_HOST=0.0.0.0` in `dashboard.env`, restart, and open
`http://<tv-pc-name>:8770/` from any browser on the LAN. Handy for checking the
board from your desk. Windows Firewall will prompt once — allow it on the
private network only.

There is no authentication, so keep it on a trusted network.

---

## Filling in the content

### Meeting takeaways and team updates

Drop files in the folder. That's the whole workflow.

- **Word** (`.docx`) — headings, bullets, and tables are picked up.
  A `Heading 1` at the top becomes the card title.
- **PDF** — text is extracted and headings/bullets are inferred from the layout.
  Scanned PDFs need OCR first; this reads text, not pictures of text.
- **Markdown** / **plain text** — `#` headings and `-` bullets render as you'd expect.

Files are ordered newest-first and the panel cycles through them every 25
seconds (`ROTATION_SECONDS`). Touch a panel to hold it — rotation resumes on its
own after 90 seconds. The `‹ ›` buttons page manually, and `⤢` blows the panel
up full-screen for a closer read.

### Project board

Edit `data\projects\projects.yaml`. The header comment in that file documents
every field; the short version:

```yaml
board:
  name: Engineering Delivery
  columns: [Backlog, In Progress, Blocked, In Review, Done]

projects:
  - id: INF-114
    title: Proxmox cluster HA failover
    owner: Kevin Caughman
    status: In Progress
    priority: high
    progress: 65
    due: 2026-08-14
    tags: [infra, proxmox]
    milestones:
      - name: Live migration smoke test
        due: 2026-08-14
        done: false
```

Only `title` is required. Everything else has a sensible fallback:

- **Health** (on-track / at-risk / off-track) is derived from the due date and
  progress unless you set it explicitly. Past due, or blocked, reads off-track;
  under a week out with less than 75% done reads at-risk.
- **Progress** falls back to the share of completed milestones, then to the
  column.
- **Status** accepts what people actually type — `wip`, `qa`, `on hold`,
  `shipped` all land in the right column.

Cards sort most-urgent-first inside each column: overdue, then priority, then
due date. You can split projects across several `.yaml`/`.json` files in the
folder; they merge into one board.

> The first install copies `samples\projects\projects.yaml` into
> `data\projects\` as a starting point. After that the file is yours — edit it
> freely, or manage the board entirely from the touchscreen. Updates never
> touch it. To start over from the example, delete your `data\projects\`
> contents and re-run `Install.bat`.

#### Moving cards on the TV

The board is not read-only. On the display itself:

| Gesture | What happens |
|---|---|
| **Tap a card** | Opens its detail sheet: full description, every milestone, tags, and buttons to move it to any other column. |
| **Tick a milestone** | Writes `done: true` back to the YAML. Progress recalculates from the milestone count unless you set `progress:` explicitly. |
| **Set progress by count** | Type or tap in **Complete** and **Total**; the percentage and "remaining" follow, and reaching the total moves the card to **Done** on its own. Written back as `total:` / `complete:`. |
| **Change the due date** | Pick a date (touch or keyboard) in the date field; **Clear** removes it. |
| **Press and hold a card, then drag** | Lifts the card and drops it in another column. |

Changes are written straight back into `projects.yaml`, so the file stays the
source of truth and the wall never drifts from it. Specifically:

- **Your comments survive.** Writing uses a round-trip YAML parser, so the
  schema notes at the top of the file and any comments you add are preserved
  exactly. Formatting and quoting stay as you wrote them.
- **Hand edits win.** If the file changed on disk since the dashboard read it --
  someone saving in Notepad, or a `git pull` -- the write is refused and a
  message appears on screen rather than overwriting their work.
- **Only the display can write.** The endpoints are refused for any non-loopback
  client, so a screen watching from someone's desk is read-only.

Dates are written back in your file's own style -- `due: 2026-08-14`, unquoted,
not turned into a string.

The hold before a drag is deliberate: without it, every attempt to scroll a
column would start a drag instead. A quick flick scrolls; a hold lifts.

### Calendar

Paste one or more ICS URLs into `CALENDAR_ICS_URLS`, comma-separated.

- **Google Calendar** → Settings → your calendar → *Secret address in iCal format*
- **Outlook / Microsoft 365** → Settings → Calendar → Shared calendars → *Publish a calendar* → ICS link

**Multiple calendars.** List several, comma-separated — the wall merges them
into one month grid and agenda, gives each calendar its own colour, and shows
a small legend so you can tell them apart. Label each one with `Name = URL` so
the legend reads well:

```
CALENDAR_ICS_URLS=Team = https://.../team.ics, On-call = https://.../oncall.ics
```

Without a label, the calendar's own published name is used, falling back to its
host. Every event carries a coloured left edge in the agenda, the day sheet and
the expanded month view.

Recurring events are expanded locally, so the wall shows the next real
occurrence. Leave it blank for a clean month grid with no events.

> The secret ICS link grants read access to that calendar to anyone who has it.
> Keep `dashboard.env` off shared drives and out of version control.

### News ticker

`NEWS_FEEDS` takes any comma-separated list of RSS/Atom URLs. Duplicate wire
stories are collapsed. If the network drops, the last good pull stays on screen
and the timestamp on the right turns amber rather than the ticker going blank.

---

## Area coverage

Page 3 is the daily coverage board: each engineer is a card, each area is a
column. Drag a card to the area that person is covering today and the change
saves itself; any other screen showing the dashboard updates within a second.

- Areas and engineers both come from `data\coverage\coverage.yaml`, which
  documents itself at the top. Edit the file to add or rename either.
- Anyone off today: leave their `area` blank, or drag their card to the
  **Off / Unassigned** column. An unrecognised area also lands there, with a
  note under the board so a typo is not silent.
- The coverage page gets the whole screen. A finger dragging a card **moves**
  it rather than changing page -- nobody should flip the page mid-drag -- so use
  the **‹ Overview** button in the header, the page buttons in the bottom bar,
  or the `←` key to go back.

## Closing the dashboard

The power icon at the right of the bottom bar opens a sheet with three choices:

| Choice | What happens |
|---|---|
| **Minimise** | The window hides. Server and browser both keep running; reopen from the taskbar. |
| **Close the display** | The kiosk window closes cleanly. The server stays up, so `Start Dashboard.bat` reopens it in a second. |
| **Shut everything down** | Window closes and the server stops. Next start does the full launch. |

The icon only appears on the display machine itself. The endpoints behind it are
refused for any non-loopback client, so nobody browsing the wall from their desk
can shut it down -- and the launcher passes `--no-proxy-headers` so that check
reads the real socket, not a header a client can set.

---

## How it works

```
Windows PC on the TV
├─ python -m uvicorn backend.app:app     hidden background process
│   ├─ watchdog        folder change → SSE push → panel repaints
│   ├─ SSE /api/stream one connection per screen, auto-reconnects
│   └─ polls RSS every 10 min, ICS every 15 min
└─ Edge --kiosk http://localhost:8770    dedicated profile, own window
```

The frontend is plain ES modules and CSS — no build step, no npm, nothing to
compile. Edit a file in `frontend\` and reload the TV.

| Path | What it is |
|---|---|
| `backend\app.py` | Routes, SSE fan-out, write endpoints |
| `backend\config.py` | Every environment variable |
| `backend\sources\documents.py` | Word / PDF / Markdown → renderable blocks |
| `backend\sources\projects.py` | YAML → board model, health and progress rules |
| `backend\sources\coverage.py` | YAML → area-coverage board, read and write |
| `backend\sources\news.py` | Feed fetching, dedupe, failure handling |
| `backend\sources\agenda.py` | ICS parsing and recurrence expansion |
| `backend\watcher.py` | Debounced filesystem watching |
| `frontend\js\*.js` | One module per panel |
| `frontend\css\dashboard.css` | The whole stylesheet |

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/state` | Everything at once — what a fresh screen loads |
| `GET /api/stream` | Server-sent events; pushes `content` updates per channel |
| `GET /api/takeaways`, `/api/updates`, `/api/projects`, `/api/coverage`, `/api/news`, `/api/agenda` | Individual panels |
| `POST /api/coverage/{engineer}/area` | Reassign an engineer to an area (loopback only) |
| `GET /api/health` | Liveness, plus how many screens are connected |

---

## Design choices worth knowing

**Dark only.** A white panel on a wall is a lamp pointed at the room. The theme
is a deliberate single look, not a missing feature.

**Colour is doing a job, not decorating.** Series colours come from a palette
validated for colour-blind separation against the exact surface the cards sit
on. Project health always ships as icon + word + colour, so it never depends on
hue alone. The status colours (green/amber/red) are reserved for health and are
never reused as a category colour.

**Sized for distance.** Type scales with the viewport, so the same layout works
on a 43" desk-side panel and a 75" wall. Touch targets are at least 44px.

**Degrades quietly.** Feeds down, share unreachable, a corrupt file in a folder —
each of those affects one panel and says so in small text. Nothing takes the
wall down.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Method not allowed" when moving a card | A server from an older build is still running. `windows\Stop-Dashboard.ps1`, then `Start Dashboard.bat`. Newer builds detect this and restart automatically. |
| "No suitable Python was found" | Install Python 3.11+, tick *Add to PATH*, re-run `Install.bat` |
| Panel stuck on old content | Check the file isn't still open in Word — Word holds a lock and writes a `~$` temp file, which is ignored |
| PDF shows nothing | It's probably a scan. Run OCR on it first |
| Ticker empty, timestamp amber | Network or feed URL problem — check `dashboard.log` |
| Calendar empty | Confirm the ICS link opens in a browser and returns a `.ics` file |
| Kiosk mode ignored | Close all other Edge windows, or just re-run `Start Dashboard.bat` — it uses its own profile |
| TV sleeps | The start script sets the power timeouts, but check Windows Settings → Power |
| Coverage change not sticking | A message appears under the board if the file changed on disk mid-drag; otherwise check `dashboard.log` |

Reset everything without losing content: `windows\Uninstall-Dashboard.ps1` then
`Install.bat`. Your `data\` folder and `dashboard.env` are left alone.

---

## Running it somewhere other than Windows

The backend is plain Python and has no Windows-specific code:

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn backend.app:app --host 0.0.0.0 --port 8770
```

Configure it with the same variables as `dashboard.env`, exported into the
environment. On a Raspberry Pi driving the TV, add a systemd unit and launch
Chromium with `--kiosk http://localhost:8770`.
