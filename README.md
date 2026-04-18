# Les Joyeux Live - Family Organization App

A Progressive Web App built with Expo and Expo Router for family organization and coordination.

## Architecture

### Security-First Design
**CRUCIAL:** This app follows a strict security architecture to protect database credentials:

```
┌─────────────────────────────────────────┐
│  React Native Frontend (Client-Side)   │
│  - Never accesses database directly    │
│  - Only fetches from API routes        │
└─────────────────┬───────────────────────┘
                  │ HTTP Requests
                  ▼
┌─────────────────────────────────────────┐
│  Expo API Routes (Server-Side)         │
│  app/api/*+api.ts                      │
│  - Handle all database operations      │
│  - Access environment variables        │
│  - Keep credentials secure             │
└─────────────────┬───────────────────────┘
                  │ SQL Queries
                  ▼
┌─────────────────────────────────────────┐
│  Neon Postgres (Database)              │
└─────────────────────────────────────────┘
```

### Tech Stack
- **Frontend**: React Native with Expo Router
- **API Layer**: Expo API Routes (`app/api/*+api.ts`)
- **Database**: Neon Postgres via `@neondatabase/serverless` (Vercel Marketplace)
- **Hosting**: Vercel
- **PWA Support**: Native via Expo

## Project Structure
```
app/
├── _layout.tsx           # Root layout
├── (tabs)/              # Tab navigation
│   ├── _layout.tsx
│   └── index.tsx        # Home screen
└── api/                 # API Routes (server-side)
    └── hello+api.ts     # Example API route
```

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   ```bash
   # Provision Neon via the Vercel Marketplace (recommended)
   vercel integration add neon
   vercel env pull .env.local

   # Or manually:
   cp .env.local.example .env.local
   # Add your Neon DATABASE_URL to .env.local
   ```

3. **Run development server**
   ```bash
   npm start
   ```
   Then press `w` for web, `a` for Android, or `i` for iOS.

## Deployment to Vercel

1. **Connect repository to Vercel**
2. **Add environment variables** in Vercel dashboard (Settings → Environment Variables)
3. **Deploy** - Vercel will automatically detect Expo configuration

## API Routes

API routes are defined in `app/api/` with the `+api.ts` suffix:
- Accessed at `/api/{route-name}`
- Run server-side only
- Have access to environment variables
- Handle all database operations

Example:
```typescript
// app/api/tasks+api.ts
import { ExpoRequest, ExpoResponse } from 'expo-router/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: ExpoRequest) {
  const rows = await sql`SELECT * FROM tasks`;
  return ExpoResponse.json(rows);
}
```

## Security Notes

⚠️ **NEVER:**
- Import database clients in React Native components
- Access `process.env.DATABASE_URL` in frontend code
- Commit `.env.local` to version control

✅ **ALWAYS:**
- Use API routes for all database operations
- Keep credentials in environment variables
- Validate inputs in API routes
