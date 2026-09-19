# Postaryx Internal Analysis

A private library for the HTML reports our team produces — product analysis, market research,
competitor work and experiments. Drop an HTML file into a folder (or upload it from the browser)
and it appears on the dashboard — there is no list to maintain by hand.

**The folders are the source of truth.** A small SQLite database sits behind them as the
catalogue: it is built by scanning the folders, and it keeps what a folder cannot (stable report
URLs, view counts, upload history). Delete it and it rebuilds itself on the next start.

---

## 1. How to run it on your computer

Requires [Node.js](https://nodejs.org) 18 or newer (`node -v` to check).

```bash
cd analysis-html-postaryx
npm install     # once
npm start
```

Then open **http://localhost:4000**.

Other useful commands:

```bash
npm run dev                 # auto-restarts when the source changes
PORT=5000 npm start         # run on a different port
REPORTS_DIR=/srv/reports npm start   # read reports from somewhere else
```

---

## 2. Where to put new HTML reports

Two ways, and they end up in exactly the same place:

- **Upload from the browser** — click **Upload a report** in the sidebar (or the button on the
  dashboard). Pick an existing category or create a new one, drop the HTML file in, optionally fill
  in name/author/date/tags, and it is saved into the reports folder and listed immediately.
- **Copy files into the folder** — drop them into `reports/` with your file manager, a synced
  folder or git. Nothing else is needed.

Either way the layout is the same. **The folder name becomes the category.**

> `reports/` is gitignored: report content belongs on the server, not in the repo. The folder is
> created automatically on first start, and in production `REPORTS_DIR` should point outside the
> checkout entirely (see *Connecting it to analysis.postaryx.com*).

```
reports/
├── Product Analysis/          ← category
│   ├── Competitor Analysis.html   ← report
│   ├── User Feedback.html
│   └── assets/                    ← images/CSS used by the reports
│       └── share-of-voice.svg
├── Market Research/
│   ├── Market Size.html
│   ├── Trend Analysis.html
│   └── Trend Analysis.json        ← optional metadata
└── Experiments/
    ├── Experiment 1.html
    └── Experiment 2.html
```

Rules worth knowing:

- Any `.html` / `.htm` file anywhere under `reports/` is picked up, including sub-folders.
- An HTML file placed directly in `reports/` shows up under **Uncategorized**.
- Files and folders starting with `.` are ignored.
- Anything that is not HTML (images, CSS, fonts, JS, PDFs) is **served but not listed**, so
  reports can reference their own assets with relative paths such as `assets/chart.png`.

### Optional report information

If it exists it is shown; if not, the file name is used. Three ways to provide it:

**A. `<meta>` tags inside the HTML file** (easiest — keeps the report self-contained):

```html
<title>Instagram Competitor Analysis</title>
<meta name="author"      content="Marketing Team">
<meta name="date"        content="September 2026">
<meta name="tags"        content="Competitor, Social Media">
<meta name="description" content="Where we stand against the three closest competitors.">
```

**B. A sidecar JSON file** next to the report — `Trend Analysis.html` → `Trend Analysis.json`:

```json
{
  "title": "Market Trend Analysis 2026",
  "author": "Research Team",
  "date": "July 2026",
  "tags": ["Trends", "Market Research"],
  "description": "Three signals moving the category this year.",
  "order": 2
}
```

**C. Nothing.** The title falls back to `<title>`, then the first `<h1>`, then the file name, and
the description falls back to the first lines of the report.

Editing tags in the browser writes to option B. An explicit `"tags": []` in the sidecar means
"this report has no tags" and overrides any `<meta name="tags">` left in the HTML.

Sidecar JSON wins over `<meta>` tags, which win over the file name.

### Uploading from the browser

`/upload` writes straight into `reports/`, so an uploaded report is indistinguishable from one
copied in by hand:

- Multiple files at once, drag-and-drop or file picker.
- `.html` / `.htm` reports, plus the assets a report needs (`png jpg jpeg gif svg webp avif ico
  css js json csv pdf txt woff woff2 ttf`). Anything else is rejected and nothing is written.
  Assets are saved **next to** the report, so `<img src="chart.png">` keeps working.
- Up to 40 files per upload, 25 MB each.
- Choose an existing category, create a new one (the folder is created for you), or leave it
  uncategorized.
- The optional fields — including **tags**, entered as chips — are written to a sidecar JSON
  file, so **the uploaded HTML is never modified**. Tags can be changed later from the report's
  **Manage → Edit tags** menu.
- A name clash is saved as `name-2.html` unless you tick *Replace a file with the same name*.
- File names and category names are sanitised, so an upload can never write outside `reports/`.

### Optional category information

Put a `_category.json` in a category folder to rename it or describe it on the dashboard:

```json
{
  "name": "Product Analysis",
  "description": "How our product performs and where competitors are moving.",
  "order": 1
}
```

`order` controls the position in the sidebar (lower first); folders without it are sorted
alphabetically after the ones that have it.

---

## 3. How the system finds new reports

There is no manual registration step:

1. The server walks `reports/` recursively and compares each file against the catalogue
   (`src/lib/library.js`).
2. A file that is **new or changed** (different size or modification time) is parsed for
   `<title>` and `<meta>` tags plus any sidecar JSON, and written into the database.
   Unchanged files are skipped entirely, so a large library stays fast.
3. A file that has **disappeared** is removed from the catalogue, and a category with nothing
   left in it goes with it.
4. The walk runs at most once every **2 seconds** (`SCAN_CACHE_MS`); pages themselves are served
   from the database. In practice: **add a file, refresh the page, it is there.**
5. The **Rescan folder** button in the sidebar (and `POST /api/refresh`) forces an immediate
   sync and reports what changed. Uploads sync automatically, which is how the upload page can
   link you straight to the new report.

A report keeps its URL for as long as the file keeps its path: slugs are assigned once, on first
sight, and stored — so a link you pasted into Slack keeps working after a re-scan, a restart, or
an edit to the file.

Deleting or renaming a file removes or updates it the same way.

### Managing a report

Every report card has a **⋯** menu in its top-right corner (always visible on touch devices,
on hover elsewhere), and the report viewer has the same options under **Manage** in its top bar:

| Action | What happens |
| --- | --- |
| **Edit tags…** | Add, rename and remove tags as chips. Saved to the sidecar JSON — the HTML is never touched. |
| **Rename…** | Changes the **name shown in the library**, saved to the sidecar JSON. Tick *Also rename the file on disk* to rename the file as well (the extension is kept and the sidecar follows). |
| **Move to…** | Moves the file into another category, or a new one you name there. An emptied folder is tidied up. |
| **Delete…** | Moves the file to the trash after a confirmation dialog (see below). |

A renamed report keeps its file name unless you ask for it to change, and the new display name
lives in the sidecar JSON — so it survives a reload, a restart, a re-scan, and even a deleted
database, which is rebuilt from the files.

Rename and move **keep the report's URL, its view count and its history**: the catalogue row
follows the file rather than being recreated, so a link already pasted into Slack still works
after someone reorganises the folders.

Each action opens a dialog with a live preview of the resulting path and a Cancel button; `Esc`
or a click outside cancels. Nothing is written until you confirm.

The dialogs are rendered once per page and filled in from whichever report's menu was used
(`manageDialogs()` in `src/views/pages.js`, driven by `public/js/app.js`), so the dashboard,
category pages and viewer all share one implementation.

### Deleting a report

Open the report and press **Delete** in the top bar. A confirmation dialog names the report and
the exact file, and nothing happens until you press **Yes, delete it** — *No, keep it*, `Esc` or a
click outside all cancel.

**Deleting does not erase the file.** It is moved, together with its sidecar metadata file, into a
timestamped folder under `data/trash/`:

```
data/trash/2026-09-19T16-41-15-343Z/Experiments/upload-test.html
```

To undo a deletion, move the file back into `reports/` — the next scan picks it up again:

```bash
mv "data/trash/2026-09-19T16-41-15-343Z/Experiments/upload-test.html" "reports/Experiments/"
```

Every deletion is recorded in the `deletions` table (`GET /api/deletions`) with the title, the
original path and where the file went, so nothing disappears without a trace. Emptying the trash
is a deliberate `rm -rf data/trash/*` — the app never does it for you.

### Opening a report

Clicking a report opens `/r/<slug>`: a thin Postaryx header (back link, author, date, tags,
"Open original") with the untouched report below it in an iframe. The report is served byte-for-byte
from `/files/...`, so its own CSS, images, inline SVG charts and scripts all keep working —
nothing is rewritten or sanitised.

---

## Running with Docker (recommended for the server)

Nothing but Docker is needed on the host - no Node.js, no build tools. The image carries the app;
your reports and database stay on the host as mounted volumes.

```bash
docker compose up -d --build     # build and start
```

Then open **http://localhost:4000**.

| Task | Command |
| --- | --- |
| Build | `docker compose build` |
| Start (rebuild if needed) | `docker compose up -d --build` |
| Stop | `docker compose down` |
| Stop and remove volumes' contents | never needed - the data is in `./reports` and `./data` |
| Logs (follow) | `docker compose logs -f` |
| Last 100 log lines | `docker compose logs --tail=100` |
| Status and health | `docker compose ps` |
| Restart | `docker compose restart` |
| Shell inside the container | `docker compose exec app sh` |
| Update to the latest code | `git pull && docker compose up -d --build` |

### What is mounted where

| Host | Container | Holds |
| --- | --- | --- |
| `./reports` | `/storage/reports` | The HTML reports - the source of truth. **Back this up.** |
| `./data` | `/storage/data` | `library.db` (the catalogue) and `trash/` (deleted reports) |

Both are created on first start if missing. Nothing is written inside the image, so
`docker compose down` and rebuilds never lose data.

### Environment

Set in `docker-compose.yml`; override per host with a `.env` file next to it:

| Variable | Default | Notes |
| --- | --- | --- |
| `REPORTS_DIR` | `/storage/reports` | Inside the container; change the volume, not this |
| `DB_PATH` | `/storage/data/library.db` | `TRASH_DIR` follows it unless set explicitly |
| `APP_PORT` | `4000` | Host port to publish |
| `BIND_ADDR` | `127.0.0.1` | Localhost only. Set `0.0.0.0` to expose on the network |
| `SCAN_CACHE_MS` | `2000` | How long a folder scan is reused |

The default binding is deliberate: with Cloudflare Tunnel running on the same host, the app never
needs to listen on a public interface. If you put it on `0.0.0.0`, make sure something in front
is doing authentication - the app has none of its own.

### Notes

- The container runs as the unprivileged `node` user (uid 1000). If your host folders are owned
  by another user, run `sudo chown -R 1000:1000 ./reports ./data` once.
- Run a single container. SQLite tolerates concurrent readers, but two instances scanning and
  writing the same catalogue can race.
- Health is checked through the app's own `/healthz`; `docker compose ps` shows it.
- Adding reports by hand still works - drop files into `./reports` on the host and they appear.

## 4. Connecting it to analysis.postaryx.com

The app is a plain HTTP server on one port, so any of these work. The recommended route needs
**no open inbound ports**:

### Option A — Cloudflare Tunnel (recommended)

On the machine that will host the tool (a small VPS or an office server):

```bash
# 1. Run the app permanently (Docker keeps it up across reboots)
docker compose up -d --build

# 2. Install cloudflared and log in to the Postaryx Cloudflare account
cloudflared tunnel login
cloudflared tunnel create postaryx-analysis

# 3. Point the subdomain at the tunnel (creates the DNS record for you)
cloudflared tunnel route dns postaryx-analysis analysis.postaryx.com

# 4. Map the hostname to the local app, then run it as a service
#    ~/.cloudflared/config.yml
#    tunnel: postaryx-analysis
#    credentials-file: /root/.cloudflared/<tunnel-id>.json
#    ingress:
#      - hostname: analysis.postaryx.com
#        service: http://localhost:4000
#      - service: http_status:404
sudo cloudflared service install
```

Then turn on **Cloudflare Access** (Zero Trust → Access → Applications) for
`analysis.postaryx.com` and allow only `@postaryx.com` email addresses. That gives the whole tool
company-only login without writing any auth code — which is why the app has no login screen yet.

### Option B — Server with a public IP

Run the app on port 4000, put Nginx or Caddy in front of it on 443, and add an `A`/`AAAA` record
for `analysis` in Cloudflare DNS (proxied, orange cloud). Example Nginx block:

```nginx
server {
  server_name analysis.postaryx.com;
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Keep the reports folder on that server (a synced folder, a network share or a git repo of reports);
everything in it becomes visible to anyone who can reach the site, so keep Access in front of it.

---

## Branding

The dashboard uses the Postaryx logo files in `public/logos/`:

| Where | Light theme | Dark theme |
| --- | --- | --- |
| Sidebar wordmark | `02_Postaryx_Main_Logo_Light.svg` | `01_Postaryx_Main_Logo_Dark.svg` |
| Report viewer icon | `08_..._App_Icon_Light_Transparent.svg` | `07_..._App_Icon_Dark_Transparent.svg` |
| Browser tab | `favicon.ico` + `favicon.png` | same |

An external SVG cannot be recoloured by CSS, so both variants are in the page and one is hidden
per theme (`img.on-light` / `img.on-dark` in `styles.css`). The interface palette is taken from
the logo files themselves — `#191712` ink, `#F7F6F3` paper, `#C2410C` accent, `#E6E3DD` rules —
so swapping a logo and the `:root` tokens in `public/css/styles.css` is all a rebrand needs.

## The database

A single SQLite file at `data/library.db` (`better-sqlite3`, no server to run, nothing to
configure). It is **gitignored and disposable** — everything in it except the counters is derived
from the reports folder.

| Table | Holds |
| --- | --- |
| `reports` | One row per HTML file: path, title, author, date, tags, description, size, mtime, search text, slug, view count |
| `categories` | One row per folder: name, description, order, slug |
| `uploads` | What was uploaded, when, into which category (with an `uploaded_by` column waiting for the login feature) |
| `deletions` | What was deleted, when, and where in the trash the file now sits (`deleted_by` likewise) |
| `settings` | Small key/value bits such as the last sync time |

Why a database and not just the folder scan:

- Pages are answered by SQL instead of re-reading every file, and search is a single indexed query.
- Report URLs are stable, because slugs are stored rather than recomputed.
- It holds things a folder cannot: view counts, upload history, and the tables that logins and
  permissions will need.

What it deliberately does **not** do: store report content. The HTML files are never copied into
the database — back up `reports/`, not `data/`. If `data/library.db` is deleted, the next start
rebuilds the whole catalogue from the folders; only view counts and upload history are lost.

## Project layout

```
src/
├── server.js            Express app, static mounts, error handling
├── config.js            Ports, paths, cache window, site name
├── lib/
│   ├── db.js            SQLite connection and schema
│   ├── library.js       Syncs reports/ into the catalogue, then answers queries
│   ├── metadata.js      Reads <meta> tags, sidecar JSON, _category.json
│   ├── uploads.js       Validates and writes uploaded files
│   ├── trash.js         Moves deleted reports to data/trash/
│   ├── organize.js      Renames and moves reports inside reports/
│   └── slugify.js       Stable URL slugs
├── routes/
│   ├── pages.js         /  /upload  /c/:category  /r/:report
│   ├── upload.js        /api/upload
│   └── api.js           /api/reports  /api/categories  /api/refresh  /api/status
│                        PATCH and DELETE /api/reports/:slug
└── views/               Server-rendered HTML (no build step)
public/                  Dashboard CSS, JS
├── favicon.ico / .png   Browser tab icon
└── logos/               Postaryx logo set (wordmark + app icons, per theme)
data/                    SQLite catalogue + trash (created automatically, gitignored)
reports/                 ← your HTML reports live here
```

### JSON API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/reports?q=` | Every report, or the ones matching a search |
| `POST /api/upload` | Multipart upload: `files[]`, `category`, `newCategory`, `overwrite`, and the optional `title` / `author` / `date` / `tags` / `description` |
| `GET /api/categories` | Categories with their reports |
| `POST /api/refresh` | Force an immediate sync; returns what changed |
| `GET /api/uploads?limit=` | Upload history, newest first |
| `PATCH /api/reports/:slug` | Change the display name (`title`), the file name (`name`), the category (`category` / `newCategory`) or the tags (`tags`) |
| `DELETE /api/reports/:slug` | Move a report to the trash; returns where it went |
| `GET /api/deletions?limit=` | Deletion history, newest first |
| `GET /api/status` | Folder path, counts, last scan time |
| `GET /healthz` | Uptime check for Cloudflare/monitoring |

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4000` | Port to listen on |
| `HOST` | `0.0.0.0` | Interface to bind |
| `REPORTS_DIR` | `./reports` | Where the reports live |
| `DB_PATH` | `./data/library.db` | Where the SQLite catalogue is kept |
| `TRASH_DIR` | next to `DB_PATH` | Where deleted reports are moved |
| `SCAN_CACHE_MS` | `2000` | How long a folder scan is reused |

---

## Where the next features will go

The code is deliberately split so the planned work drops in without a rewrite:

- **Login / SSO** — put Cloudflare Access in front first (no code). For in-app sessions, add an
  auth middleware in `src/server.js` before the route mounts. Until then, remember that **anyone
  who can reach the site can upload**, which is fine behind Access and not fine on the open
  internet, and **anyone who can reach it can delete** (recoverably, from the trash folder).
- **Employee permissions** — add `users` and `permissions` tables next to the existing ones in
  `src/lib/db.js`, then filter in `getLibrary()` / `getCategory()` per request and gate
  `POST /api/upload` the same way. The `uploads.uploaded_by` column is already there to fill in.
- **Better search** — `searchReports()` in `src/lib/library.js` is the single place to change.
  SQLite ships with FTS5, so indexing the full text of each report is a new table plus a changed
  query, not a new dependency.
- **Cloud storage** — `syncLibrary()` in `src/lib/library.js` is the only code that reads the
  filesystem; point it at S3 or Drive and the catalogue, pages and search are unchanged.
- **AI-generated reports** — write the generated HTML into a folder under `reports/` and it
  appears like any other report.
