# Security Architecture

## Critical Security Rule: API Routes Only

This application follows a **strict security pattern** to protect database credentials:

### ✅ CORRECT: Use API Routes
```typescript
// ✅ Frontend component (app/(tabs)/tasks.tsx)
import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';

export default function TasksScreen() {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    // Fetch from our API route, NOT directly from database
    fetch('/api/tasks')
      .then(res => res.json())
      .then(data => setTasks(data));
  }, []);

  return (
    <View>
      {tasks.map(task => <Text key={task.id}>{task.title}</Text>)}
    </View>
  );
}
```

```typescript
// ✅ API Route (app/api/tasks+api.ts)
import { ExpoRequest, ExpoResponse } from 'expo-router/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: ExpoRequest) {
  // Database access happens here, server-side only
  const rows = await sql`SELECT * FROM tasks`;
  return ExpoResponse.json(rows);
}
```

### ❌ INCORRECT: Direct Database Access
```typescript
// ❌ NEVER DO THIS in a React Native component
import { neon } from '@neondatabase/serverless';

export default function TasksScreen() {
  // ❌ This exposes database credentials to the client!
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`SELECT * FROM tasks`;
  // ...
}
```

## Why This Matters

1. **Client-Side Code is Public**: React Native components are bundled and sent to users' devices. Any code there can be inspected.

2. **Environment Variables**: When you use `process.env.DATABASE_URL` in client-side code, the actual connection string gets bundled into the JavaScript.

3. **API Routes are Server-Side**: Code in `app/api/*+api.ts` runs on the server (Vercel) and never gets sent to the client.

## Implementation Checklist

- [ ] All database operations are in `app/api/*+api.ts` files
- [ ] React Native components only use `fetch()` to call API routes
- [ ] No `import { neon } from '@neondatabase/serverless'` in components
- [ ] Environment variables only accessed in API routes
- [ ] `.env.local` is in `.gitignore` (already done)

## API Route Examples

### GET Request
```typescript
// app/api/users+api.ts
import { ExpoRequest, ExpoResponse } from 'expo-router/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: ExpoRequest) {
  const rows = await sql`SELECT * FROM users`;
  return ExpoResponse.json(rows);
}
```

### POST Request
```typescript
// app/api/tasks+api.ts
import { ExpoRequest, ExpoResponse } from 'expo-router/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function POST(request: ExpoRequest) {
  const body = await request.json();
  const rows = await sql`
    INSERT INTO tasks (title)
    VALUES (${body.title})
    RETURNING *
  `;
  return ExpoResponse.json(rows[0]);
}
```

### Dynamic Routes
```typescript
// app/api/tasks/[id]+api.ts
import { ExpoRequest, ExpoResponse } from 'expo-router/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: ExpoRequest) {
  const { id } = request.expoUrl.params;
  const rows = await sql`SELECT * FROM tasks WHERE id = ${id}`;
  return ExpoResponse.json(rows[0]);
}
```

## Vercel Environment Variables

Provision Neon via the Vercel Marketplace to have this injected automatically:

```bash
vercel integration add neon
vercel env pull .env.local
```

Required variable:
- `DATABASE_URL` — Neon Postgres connection string

This is **only accessible from API routes**, not from React Native components.
