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

## Regenerating data.json

    python scripts/generate.py                 # validate + write data.json
    python scripts/generate.py --dry-run       # validate only, write nothing
    python scripts/generate.py --keep-expired  # include past listings too

Needs `openpyxl` (`pip install openpyxl`). Columns are matched by header name,
so column order may change but header text may not. Validation follows the
workbook's own `Legend & rules` and `Field Guide` sheets: **errors block the
write, warnings do not.** Listings whose dates have all passed are dropped from
`data.json` but stay in the Excel — that is what makes the site forward-looking.
Output is sorted nearest submission deadline first.

## Adding scraped or emailed listings

`scripts/ingest.py` is the "integrate" step: it appends reviewed candidate
records to the Excel master.

    python scripts/ingest.py candidates.jsonl            # review, writes nothing
    python scripts/ingest.py candidates.jsonl --write     # append to the workbook

**Review is the default** — nothing touches the workbook without `--write`, and
`--write` takes a timestamped backup first. Candidates may be `.jsonl`, `.json`
or `.csv`, using either the Excel header names or the data.json names; see
`scripts/candidates.example.jsonl`.

Every candidate is validated with exactly the rules `generate.py` enforces, so a
row that ingests will not break the build. Rows with errors are skipped. Rows
that look like something already listed — same link, same acronym + deadline, or
a near-identical title in the same category — are skipped as duplicates, which
makes re-running a weekly scrape safe.

Appended rows get the next unused id, today's `posted_date`, `verified = no`
(scraped data is unverified until a human checks it) and the `--author` value.

The full loop:

    scrapers / email  ->  candidates.jsonl
                          ingest.py            (review, then --write)
                          content.xlsx
                          generate.py
                          data.json  ->  commit  ->  push  ->  Pages

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
