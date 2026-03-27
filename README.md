
# ChatBot Clone (Demo)

Stack:
- **Client-side**: Next.js (App Router) + React + **TanStack Query**
- **UI**: Tailwind v4 + shadcn-style components (Radix primitives)
- **Server-side**: Next.js Route Handlers (`app/api/*`)
- **Database/Auth/Storage**: Supabase
- **Realtime**: Socket.IO (optional, separate server)
- **Deploy**: Vercel (Next.js) + Render/Railway (Socket.IO, optional)

## Quick start

Install deps:

```bash
npm i
```

Create env file:

```bash
cp .env.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; required for API routes that use admin)
- `OPENAI_API_KEY` (server-only; optional, enables real AI replies)
- or **OpenAI-compatible provider**: `OPENAI_BASE_URL` + `OPENAI_MODEL` (with `OPENAI_API_KEY`)
- or **Ollama** (server-only): `OLLAMA_BASE_URL` + `OLLAMA_MODEL`
- (optional) `NEXT_PUBLIC_SOCKET_URL` (e.g. `http://localhost:4001`)

Apply DB schema in Supabase:
- Open Supabase SQL editor
- Run `supabase/schema.sql`

Run dev server:

```bash
npm run dev
```

Optional realtime (Socket.IO server):

```bash
npm run dev:socket
```

## API endpoints (demo checklist)

All endpoints are under `src/app/api` and use correct HTTP verbs:
- **Auth**
  - `POST /api/auth/signup`
- **Chats**
  - `GET /api/chats`
  - `POST /api/chats`
  - `PATCH /api/chats/:chatId`
  - `DELETE /api/chats/:chatId`
- **Messages**
  - `GET /api/chats/:chatId/messages`
  - `POST /api/chats/:chatId/messages`
- **Uploads**
  - `POST /api/uploads` (multipart)
- **Anonymous quota**
  - `GET /api/anonymous/usage`
  - `POST /api/anonymous/usage`

## Notes on security

- **No API keys are hardcoded** in the repo; everything is via `.env.local`.
- `SUPABASE_SERVICE_ROLE_KEY` is **server-only** and must never be exposed to the client.
- Client requests authenticate via `Authorization: Bearer <access_token>` header.
