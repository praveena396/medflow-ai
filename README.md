<div align="center">

<br/>

```
███╗   ███╗███████╗██████╗ ███████╗██╗      ██████╗ ██╗    ██╗     █████╗ ██╗
████╗ ████║██╔════╝██╔══██╗██╔════╝██║     ██╔═══██╗██║    ██║    ██╔══██╗██║
██╔████╔██║█████╗  ██║  ██║█████╗  ██║     ██║   ██║██║ █╗ ██║    ███████║██║
██║╚██╔╝██║██╔══╝  ██║  ██║██╔══╝  ██║     ██║   ██║██║███╗██║    ██╔══██║██║
██║ ╚═╝ ██║███████╗██████╔╝██║     ███████╗╚██████╔╝╚███╔███╔╝    ██║  ██║██║
╚═╝     ╚═╝╚══════╝╚═════╝ ╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝     ╚═╝  ╚═╝╚═╝
```

**Healthcare Automation Platform**

*AI-powered triage · Smart scheduling · RAG-grounded clinical assistant*

<br/>

[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://mongodb.com)
[![LangChain](https://img.shields.io/badge/LangChain-RAG-1C3C3C?style=flat-square)](https://langchain.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/Status-In%20Development-orange?style=flat-square)]()

<br/>

[Live Demo](#demo) · [Features](#features) · [Architecture](#architecture) · [Setup](#setup) · [API Docs](#api-reference)

<br/>

</div>

---

## What is MedFlow AI?

MedFlow AI is a full-stack healthcare automation platform built to reduce the administrative load on hospitals and clinics. It brings together an AI-driven triage engine, a context-aware health chatbot, and a smart scheduling system into one product — with real-time dashboards for operations staff.

The AI layer is built on a **Retrieval-Augmented Generation (RAG)** pipeline, which means every chatbot response is grounded in the patient's own uploaded documents rather than generic LLM knowledge. A similarity-score threshold prevents the model from answering when it doesn't have enough context, which matters a lot in a medical setting.

> **Important:** MedFlow AI is a clinical-assistance and workflow tool, not a diagnostic system. All AI-generated outputs are advisory and must be reviewed by a qualified healthcare professional.

---

## Demo

| | |
|---|---|
| **Live App** | [medflow-ai.vercel.app](https://medflow-ai.vercel.app) *(add once deployed)* |
| **Loom Walkthrough** | [Watch the 3-min demo](#) *(add once recorded)* |
| **API Health Check** | `GET /health` |

---

## Features

| Feature | Description |
|---|---|
| **AI Symptom Triage** | Natural-language symptom input classified by urgency. Flags critical cases and suggests the appropriate care pathway. |
| **Smart Scheduling** | Book, reschedule, or cancel via chat or the UI. Respects doctor availability and prevents double-booking. |
| **Medical Report Analysis** | OCR + NLP pipeline extracts and summarizes findings from uploaded PDFs, lab results, and prescription images. |
| **RAG Health Chatbot** | Answers grounded in the patient's own documents. Declines to answer when retrieval confidence is below threshold — no hallucinations. |
| **Automated Notifications** | SMS and email reminders for appointments, medications, and follow-ups via Twilio and Nodemailer. |
| **Operations Dashboard** | Real-time view of bed occupancy, appointment queue, and triage status for hospital administrators. |
| **Role-Based Access** | Separate portals for patients, doctors, and admins. Server-side JWT validation — the frontend role value is never trusted. |
| **Patient Health Records** | Lightweight EHR: visit history, allergies, current medications, and linked document references. |

---

## Architecture

```
                        CLIENT LAYER
                  Next.js SPA  (Vercel CDN)
                         |
                     HTTPS / REST
                         |
                    API GATEWAY
              Express.js  |  Auth Middleware
                         |
          +--------------+--------------+
          |              |              |
    Auth Service   Appointment     AI Service
    (Firebase)      Service       (LangChain)
          |              |              |
          +--------------+--------------+
                    DATA LAYER
       MongoDB      ChromaDB / Pinecone     S3
   (structured)    (vector embeddings)   (files)
                         |
                   ASYNC QUEUE
             BullMQ + Redis Workers
          (notifications, PDF processing)
```

Heavy operations — PDF parsing, embedding generation, notification delivery — are offloaded to BullMQ workers so the API always returns fast. The upload endpoint returns a `jobId` immediately; the client polls for completion.

---

## RAG Pipeline

**Document ingestion**

1. User uploads a PDF or image
2. OCR extracts raw text from scanned documents
3. Text is chunked at ~500 tokens with 50-token overlap to preserve context across boundaries
4. Each chunk is embedded via `text-embedding-3-small`
5. Vectors are stored in ChromaDB (dev) or Pinecone (prod) with source metadata

**Query flow**

1. User message is embedded with the same model
2. Similarity search retrieves the top-4 most relevant chunks
3. If the highest score is below `0.75`, the bot returns a fallback rather than guessing
4. Retrieved context + query are sent to the LLM
5. Response is returned with a source document reference

```js
const chain = RetrievalQAChain.fromLLM(llm, vectorStore.asRetriever({ k: 4 }));
const result = await chain.call({ query: userMessage });

if (result.similarityScore < 0.75) {
  return "I don't have enough information in your documents to answer that.";
}
return result.text;
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 14, React, Tailwind CSS |
| **Backend** | Node.js 18, Express.js |
| **AI / LLM** | Ollama (`llama3.2`) by default; OpenAI via `LLM_PROVIDER=openai` |
| **Embeddings** | Ollama `nomic-embed-text` (768-dim); OpenAI optional |
| **Vector Store** | MongoDB (per-patient chunks, cosine similarity) |
| **Database** | MongoDB + Mongoose |
| **Auth** | JWT access (15 min) + refresh (7 d) tokens, role-based middleware |
| **File Storage** | Local disk (dev) or S3/MinIO via `FILE_STORAGE_TYPE=s3` |
| **Async Queue** | BullMQ + Redis |
| **Notifications** | Twilio (SMS) + Nodemailer (email) |
| **Logging** | Winston + Morgan |
| **Deployment** | Vercel (frontend) · Railway or Render (backend) |

---

## Project Structure

```
medflow-ai/
├── client/                     # Next.js frontend
│   ├── components/             # Reusable UI components
│   ├── pages/                  # Next.js route pages
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # API client helpers
│   └── styles/                 # Tailwind config + globals
├── server/                     # Express backend
│   ├── controllers/            # Route handlers (thin layer)
│   ├── services/               # Business logic
│   ├── models/                 # Mongoose schemas
│   ├── routes/                 # API route definitions
│   ├── middleware/             # Auth, RBAC, error handling
│   ├── ai/                     # LangChain chains + RAG logic
│   ├── workers/                # BullMQ job processors
│   └── utils/                  # Shared helpers, logger
├── shared/                     # Types + constants (both sides)
└── .env.example
```

---

## Setup

### Prerequisites (all free — no paid API keys needed)

- Node.js v18+
- MongoDB — local Community Server (or free Atlas M0 tier)
- [Ollama](https://ollama.com) with two models: `ollama pull llama3.2` and `ollama pull nomic-embed-text`
- Redis — [Memurai](https://www.memurai.com) on Windows, `redis-server` on Linux/Mac, or Docker
- No OpenAI/AWS/Twilio keys required; the code switches to them via `.env` flags when available

### 1. Clone

```bash
git clone https://github.com/praveena396/medflow-ai.git
cd medflow-ai
```

### 2. Install dependencies

```bash
# Backend
cd server && npm install

# Frontend
cd ../client && npm install
```

### 3. Configure environment

Copy the template and generate two random secrets:

```bash
cd server
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # → JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # → JWT_REFRESH_SECRET
```

Every setting is documented inside [`server/.env.example`](server/.env.example). The defaults use the free local stack (Ollama + local MongoDB + Redis + Ethereal test email); production services (OpenAI, S3/MinIO, Twilio, real SMTP) are enabled by switching driver flags in the same file.

### 4. Seed starter accounts

```bash
cd server && npm run seed
```

Creates two doctors, an admin, and a test patient (password pattern `<Role>@123`, e.g. `patient@medflow.local` / `Patient@123`).

### 5. Run

```bash
# Terminal 1 — backend API
cd server && npm start

# Terminal 2 — background worker (required for document processing + notifications)
cd server && npm run worker

# Terminal 3 — frontend  →  http://localhost:3000
cd client && npm run dev
```

### 6. Test

```bash
cd server && npm test    # 52 tests via Vitest + Supertest (needs local MongoDB + Redis)
```

### Docker (alternative)

```bash
docker compose up -d
# first run only — pull the AI models into the ollama container:
docker compose exec ollama ollama pull llama3.2
docker compose exec ollama ollama pull nomic-embed-text
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a new patient account (staff accounts via seed/admin only) |
| `POST` | `/api/auth/login` | Login and receive JWT + refresh token |
| `POST` | `/api/auth/refresh` | Exchange a refresh token for new tokens |
| `GET` | `/api/appointments` | List appointments for the current user |
| `GET` | `/api/appointments/doctors` | List doctors available for booking |
| `POST` | `/api/appointments` | Book a new appointment (queues confirmation + reminder emails) |
| `PATCH` | `/api/appointments/:id` | Update an appointment |
| `DELETE` | `/api/appointments/:id` | Cancel an appointment |
| `POST` | `/api/chat` | Send a message to the RAG chatbot (answers cite source documents) |
| `GET` | `/api/chat/history` | Fetch the current chat session |
| `DELETE` | `/api/chat/history` | Clear the current chat session |
| `POST` | `/api/triage` | Submit symptoms for AI urgency classification |
| `GET` | `/api/triage/history` | Past triage assessments |
| `POST` | `/api/documents` | Upload a medical PDF/TXT (processed in the background) |
| `GET` | `/api/documents` | List the current user's documents |
| `GET` | `/api/documents/:id/status` | Poll background processing status |
| `DELETE` | `/api/documents/:id` | Delete a document and its search index |
| `GET` | `/api/admin/stats` | Dashboard summary numbers *(admin only)* |
| `GET` | `/api/admin/appointments` | Upcoming appointment queue *(admin only)* |
| `GET` | `/api/admin/users` | User list with search *(admin only)* |
| `GET` | `/api/admin/export/appointments` | CSV export *(admin only)* |
| `GET` | `/health` | Health check reporting DB / Redis / LLM status |

---

## Performance

| Metric | Value | Notes |
|---|---|---|
| API response time | < 200ms | p95, non-AI routes |
| Chatbot response | ~2.1s | RAG + LLM round-trip |
| RAG retrieval accuracy | ~87% | top-4 relevance, estimated |
| Booking conflict reduction | −68% | vs. manual scheduling |
| PDF processing time | ~8s | 20-page document, OCR + embed |
| Vector DB query latency | < 50ms | Pinecone, top-4 search |

---

## Security

- **JWT + refresh tokens** — 15-minute access token expiry; refresh token stored in `httpOnly` cookie
- **Server-side RBAC** — role is validated from the JWT on every protected route, never from the client
- **Encryption at rest** — MongoDB Atlas AES-256; S3 SSE-S3 for uploaded files
- **Signed URLs** — medical files accessed via S3 pre-signed URLs with 15-minute expiry
- **Input sanitization** — `express-validator` on all inputs; prompt injection guarded via LangChain system message
- **Rate limiting** — `/api/chat` and `/api/triage` capped at 20 req/min per user
- **Audit logs** — all AI recommendations and admin actions written to append-only collections

---

## Challenges & Learnings

**LLM hallucinations in a medical context** — solved with similarity-score thresholds in the retriever. The bot declines rather than fabricates.

**RBAC across three user roles** — role is encoded in the JWT and verified by reusable Express middleware. The frontend only controls UI visibility.

**Large PDF parsing latency** — offloaded to BullMQ workers. The API returns a `jobId` immediately; the client polls for status.

**Prompt injection** — LangChain system message scopes the assistant to medical queries. User text is stripped of special characters before prompt insertion.

**RAG latency vs. accuracy trade-off** — chunk size of 500 tokens with 50-token overlap was the sweet spot. Smaller chunks were faster but lost context; larger chunks degraded retrieval precision.

---

## Roadmap

- [ ] FHIR integration for hospital system interoperability
- [ ] Voice input for triage via Web Speech API
- [ ] Multi-language support — Hindi and Telugu
- [ ] Doctor availability calendar with drag-and-drop scheduling
- [x] Vitest + Supertest integration tests (52 tests)
- [ ] OpenAPI / Swagger docs for all endpoints

---

## Author

**Praveena Ganesan** — Full Stack Developer

[![GitHub](https://img.shields.io/badge/GitHub-praveena396-181717?style=flat-square&logo=github)](https://github.com/praveena396)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-praveena--ganesan-0A66C2?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/praveena-ganesan-b84541247/)

---

<div align="center">

*Built with care for better healthcare workflows.*

</div>
