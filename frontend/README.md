# Inventory Frontend

Next.js frontend for the Electrical Installation Inventory & Sales system.

## Requirements

- Node.js 20.19+
- The backend running at `http://localhost:3000` (see `inventory-backend/README.md`)

## Setup

```bash
npm install
```

Create `.env.local` (optional — defaults to `http://localhost:3000`):

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_CURRENCY_SYMBOL=ETB
```

## Run

```bash
npm run dev     # development server on http://localhost:3001
npm run build   # production build (generates the PWA service worker)
npm run start   # serve the production build
```

## Stack

- Next.js 16 (App Router)
- React 19
- Tailwind CSS 4
- Recharts (charts)
- next-pwa (PWA + browser push notifications)

## Structure

- `app/` — pages and components (`/login`, `/dashboard/*`)
- `context/AuthContext.tsx` — client auth state
- `lib/api.ts` — axios client with JWT interceptor
- `lib/i18n.ts` + `lib/locales/` — localization (in progress)
- `worker/index.ts` — service worker (push + caching)
