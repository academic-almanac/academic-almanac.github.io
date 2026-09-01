# Academic Almanac

One forward-looking overview for PhD researchers: conferences, calls for papers,
calls for special issues, PhD courses and summer schools, plus grants, jobs and
workshops — every deadline in one place.

Live: https://dejanzafirev.github.io/academic-atlas/

## How it works

Static site, no build step, no dependencies. `index.html` loads `js/app.js`,
which fetches `data.json` at runtime and renders everything client-side.

    content.xlsx  (OneDrive, one tab per category, 29 columns)
        |  scripts/generate.py
        v
    data.json  ->  committed here  ->  GitHub Pages

`content.xlsx` is the master and is deliberately **not** tracked here — it is
binary, unmergeable, and lives in the shared OneDrive folder. Only the generated
`data.json` is committed. Expired entries stop showing on the site but remain in
the Excel.

## Files

| File | Role |
|---|---|
| `data.json` | All listings, generated from the Excel. Never hand-edit. |
| `js/app.js` | Rendering, filtering, submission horizon, saved items, ICS export. |
| `css/style.css` | Styles. |
| `index.html` | Static shell. |

## Local preview

`fetch()` is blocked on `file://`, so serve the folder over http:

    python -m http.server 8000

then open http://localhost:8000
