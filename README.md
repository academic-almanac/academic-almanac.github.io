# Academic Atlas — v1 static mockup

One clean, filterable overview of academic opportunities for PhD researchers:
**conferences**, **journal special issues**, and **summer schools / PhD courses**,
scoped to Information Systems, Entrepreneurship/Management, Finance/Economics.

## Run it

Open `index.html` in a browser. That's it — no build step, no server, no dependencies
(Google Fonts loads from CDN; the app falls back to system fonts offline).

## Structure

| File | Role |
|---|---|
| `data.js` | **All data.** Schema documented at the top of the file. Swap this file for real/scraped data in v2 — the UI never needs to change. |
| `app.js` | Presentation: hash routing, dashboard, filterable cluster views, detail panels, countdown ticker. |
| `styles.css` | Design system (tokens at the top) + layout. |
| `index.html` | Static shell: header, nav, footer. Views render into `#app`. |

## Conventions

- Data and presentation stay strictly separated — never hard-code listing content in `app.js`.
- Every item must have a `submitUrl` that points at the actual submission/registration
  system, not a homepage.
- Deadlines are ISO dates; sorting is always soonest-first.
- New disciplines/regions/filters: extend `data.js` + the config block at the top of `app.js`.

## Deliberately out of scope in v1

Backend, scraping, auth, database, calendar export, job-market cluster
(stubbed in the UI where cheap). See the disabled buttons marked "v2".
