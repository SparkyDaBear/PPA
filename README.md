# PPA Curator Workbench

This repository publishes the public GitHub Pages explorer for the Proteomics Perturbation Atlas.

The site is now structured as a static Astro application. The build reads the generated JSON bundle from `export/` and emits routes for the overview, ontology browser, project browser, term detail pages, and PXD detail pages.

## Data Flow

The public site is driven by JSON exported from the private PerturbationAtlas repository. The export bundle is written to `export/` and may be regenerated from the private repo with:

```bash
python src/analysis/export_public_site_bundle.py
```

By default the exporter reads per-PXD `metadata.json` files from `/scratch/ims86/pride_downloads/Standardized`, where each project lives in its own folder such as `PXD001061/metadata.json`.

## Astro Build

Install dependencies and run the public site locally from this repository root:

```bash
npm install
npm run dev
```

Build for GitHub Pages with:

```bash
npm run build
```

The Astro source lives under `src/`. The main routes are:

- `/` overview
- `/terms/` ontology index
- `/ontology-tree/` interactive ontology tree
- `/search/` federated search UI (backend-powered)
- `/terms/[curie]/` term detail
- `/projects/` project index
- `/projects/[pxd]/` PXD detail
- `/about/` data model and release notes

## Federated Search UI Configuration

The `/search/` route is a browser client for a separate backend service. Set the API base URL at build time:

```bash
PUBLIC_FEDERATED_SEARCH_API_URL=https://your-api-host.example.com npm run build
```

If `PUBLIC_FEDERATED_SEARCH_API_URL` is unset, the search page stays visible but disables API calls.

The older single-file shell remains in the repository as a legacy reference, but the Astro app is now the source of truth for the public site.