
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

## Demo video

https://github.com/user-attachments/assets/173a1445-7be7-4cf0-9acd-abdc9185b8a9

https://github.com/user-attachments/assets/983013fc-e4e3-420f-bef6-4cb453ba43d5

## How it works (chatbot flow)

- **UI (Next.js App Router)**: the main chat UI lives in `src/widgets/chat/ChatLayout.tsx` (sidebar) and `src/widgets/chat/ChatView.tsx` (messages + composer).
- **Auth & sessions (Supabase)**: the client keeps an auth session and sends `Authorization: Bearer <access_token>` to protected API routes.
- **Chats & messages (DB)**: chats and messages are stored in Supabase Postgres (`supabase/schema.sql`) with RLS enabled.
- **Streaming answers (SSE)**:
  - On send, the client calls `POST /api/chats/:chatId/messages` with `{ content, images, documents, stream: true }`.
  - The server responds with **Server-Sent Events** (`text/event-stream`) and emits `delta` chunks while the model is generating.
  - The client appends deltas to the last assistant message and shows a typing indicator; `AbortController` powers **Stop generating**.
- **Images**:
  - Images are first uploaded via `POST /api/uploads` → stored in Supabase Storage and returned as a signed URL.
  - For OpenAI-compatible providers (e.g. Together/Qwen) the server converts image URLs into `image_url` message parts so the model can actually "see" them.
- **Documents (.txt/.md/.pdf/.docx)**:
  - Documents are uploaded via `POST /api/uploads`.
  - Then the client calls `POST /api/documents/extract` (with the signed URL) to extract text on the server.
  - Extracted text is sent together with the message as additional context so the model can analyze the document.
- **Provider selection**:
  - If `OPENAI_API_KEY` is set → uses OpenAI-compatible `/chat/completions` (streaming supported).
  - Else if `OLLAMA_BASE_URL` + `OLLAMA_MODEL` are set → uses Ollama.

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
- **Document text extraction**
  - `POST /api/documents/extract`
- **Anonymous quota**
  - `GET /api/anonymous/usage`
  - `POST /api/anonymous/usage`

## Notes on security

- **No API keys are hardcoded** in the repo; everything is via `.env.local`.
- `SUPABASE_SERVICE_ROLE_KEY` is **server-only** and must never be exposed to the client.
- Client requests authenticate via `Authorization: Bearer <access_token>` header.
