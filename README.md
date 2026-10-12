# Rack Power Planner & Audit

Rack-ийн тэжээл төлөвлөх, аудит хийх энгийн вэб хэрэгсэл.
A small web tool to plan and audit rack power: draw the rack, connect PSUs to A/B PDUs, and get a clear conclusion for normal operation and for loss of a feed.

Everything runs in the browser. No login, no server, and no data is uploaded (it is stored in IndexedDB).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 43 tests: calculations, failover, placement, import/export, i18n
npm run build    # static files in dist/
```

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` tests, builds and publishes the app on every push to `main`.
One-time setup: repository **Settings → Pages → Source: GitHub Actions**.
The site is then served at `https://<user>.github.io/<repo>/`.

## How to use (Энгийн горим)

1. **Алхамаар тохируулах:** rack name and size, then PDUs (A/B), then devices, then PSU → outlet, then check.
2. **Төхөөрөмж нэмэх:** pick a model or a custom device, enter **consumption** (measured or estimated) and the PSUs.
3. **Сонгосон төхөөрөмж:** click a device in the rack to edit it, or drag it to move it.
4. **Дүгнэлт:** one-line verdict, what to fix, and what information is missing. **Тайлан** prints an A4 report (or saves it as PDF).

Switch to **Нарийвчилсан** for PDU banks/phases, UPS/branch/source topology, power tables, policy thresholds, what-if previews and the full findings list. **EN** switches the language.

A demo project with synthetic numbers loads on first start. Its expected results are: 2200 W typical / 3150 W design, 5.03 A per feed, and on loss of one feed 14.42 A (above the 12.8 A planning limit, below the 16 A hard limit).

## Key rules the tool follows

- PSU wattage is capacity, not consumption: 2 × 800 W PSUs do not mean 1600 W.
- Unknown is never 0. Missing power, ratings or topology gives **Тодорхойгүй**, never Pass, and totals become a "known subtotal".
- A measured typical value is never used as the design/peak value.
- A published *usable* PDU rating is not derated by 80% again. The 80% planning limit is an editable site policy, not a universal rule.
- A/B feeds count as independent only when they have different branch/UPS/source records.
- UPS runtime is never derived from nameplate numbers.

## Code layout

| Folder | Contents |
| --- | --- |
| `src/domain` | Types, factories, demo project |
| `src/engine` | Pure calculations: electrical formulas, device load, limits, failure scenarios, rack placement |
| `src/audit` | Rule engine, conclusion, coverage, headroom |
| `src/catalog` | Device and PDU templates |
| `src/persistence` | IndexedDB, JSON/CSV export, import validation |
| `src/components` | React UI (rack SVG, panels, wizard, report) |
| `src/i18n` | Mongolian (default) and English text |

Stack: React 19, TypeScript, Vite, Tailwind CSS 4, Zustand + Immer, idb-keyval, Vitest.

## Catalog provenance

The manufacturer websites (Dell, HPE, Eaton, Schneider and others) could not be reached from the build environment on 2026-10-12. Because of that:

- every device model is an **unverified template**: the name and a U-height hint only, with power, PSU, size and weight left blank ("Мэдээлэл шаардлагатай");
- the Eaton PDUMV16HV and APC AP8853 entries carry headline values from the project brief and are marked **unverified**;
- generic PDU presets are editable planning templates, not standards.

You can add verified data yourself in Нарийвчилсан → Бодлого → Каталог, with the source URL recorded.

## Known limitations

- No live SNMP/Redfish monitoring and no vendor data scraping.
- Inrush, transients and full vendor redundancy behaviour are always reported as needing manufacturer guidance.
- Built and checked for desktop browsers. A mobile Rack/Settings tab switch exists but was not polished.
- Photos are stored only on the local device. Plain JSON export carries photo metadata only; use **Bundle** export to move photos.
- This tool gives planning findings and audit evidence. It is not a Tier, TIA-942 or electrical compliance certificate.
