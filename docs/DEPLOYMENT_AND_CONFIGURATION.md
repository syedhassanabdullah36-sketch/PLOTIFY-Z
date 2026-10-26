# Plotify — Deployment & Configuration Guide

**Application:** Plotify — AI-Powered Architectural Intelligence  
**Architecture:** Single-Page Application (SPA) on React 19 + TypeScript + Vite + Tailwind CSS v4  
**Current Release Version:** v1.0.0-rc1  
**Target Environments:** Development, Staging / Preview, Production  

---

## 1. Environment Configurations

| Setting | Development | Staging / Preview | Production | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **PORT** | `3000` | Cloud Run / Container Port | Standard HTTPS (443 / 80) | Port 3000 enforced for dev |
| **HOST** | `0.0.0.0` | `0.0.0.0` | Container / Ingress Host | Binds to all interfaces |
| **Data Persistence** | Browser `localStorage` | Browser `localStorage` | Browser `localStorage` (Isolated) | Client-side zero-leak storage |
| **Build Mode** | `development` (HMR off) | `production` (`vite build`) | `production` (`vite build`) | Minified ES modules |
| **Source Maps** | Inline / Enabled | Disabled for security | Disabled | Eliminates bundle leakage |
| **API Proxy** | Server-side `/api/*` | Server-side `/api/*` | Server-side `/api/*` | Zero client-side API secrets |

### Environment Variables Validation
Plotify adheres to strict client-side credential protection:
- **No API secrets or backend database credentials may be exposed in client code (`VITE_...`).**
- Any future AI features or proxy calls run server-side via Express routes without exposing keys in frontend bundles.
- See `.env.example` for baseline port and host defaults.

---

## 2. Build & Verification Commands

All release candidates must pass the complete verification pipeline before deployment:

```bash
# 1. Static Type Checking & Linting
npm run lint

# 2. Complete 12-Discipline Verification Suite
npm test

# 3. Production Compilation & Asset Bundling
npm run build

# 4. Preview Built Artifacts Locally
npm run preview
```

### Build Artifacts
Running `npm run build` produces the `dist/` directory containing:
- `dist/index.html`: Entry point with strict Content Security Policy (CSP).
- `dist/assets/*.js`: Code-split ES modules (React, Three.js, Lucide).
- `dist/assets/*.css`: Tailwind CSS v4 utility classes.

---

## 3. Deployment Targets & Infrastructure

Plotify can be served from any modern static asset CDN or containerized web server:

### Option A: Static CDN Hosting (Recommended for Client-Side SPA)
- **Targets:** Cloudflare Pages, Vercel, AWS S3 + CloudFront, Google Cloud Storage + Cloud CDN.
- **Routing:** All non-asset routes must rewrite to `/index.html` (Single Page Application fallback).
- **HTTP Headers:**
  - `Content-Security-Policy`: Matches CSP in `index.html`.
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Cache-Control: public, max-age=31536000, immutable` for hashed assets in `/assets/`.
  - `Cache-Control: no-cache` for `index.html`.

### Option B: Containerized Cloud Run / Node.js Host
- Run via standard Node 22 / Express static file server serving `/dist`.
- Container memory threshold: 512MB RAM minimum (1GB recommended for Three.js 3D rendering clients).

---

## 4. Rollback & Recovery Procedures

If a deployment exhibits regressions:
1. **Immediate CDN Rollback:** In Cloudflare Pages or Cloud Run, re-point the active release tag to the previous stable release commit.
2. **Local Client Data Preservation:**
   - Plotify versions and projects are stored in the client's browser `localStorage`.
   - Reverting the web application bundle does **not** corrupt or wipe existing client projects, provided the schema migrations in `src/services/storage.ts` remain backward-compatible.
3. **Disaster Recovery:** If user encounters an issue, they can export their project as JSON before clearing browser cache.
