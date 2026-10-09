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

*AI symptom triage · Appointment scheduling · A document-grounded health chatbot*

<br/>

[![Server tests](https://github.com/praveena396/medflow-ai/actions/workflows/server-tests.yml/badge.svg)](https://github.com/praveena396/medflow-ai/actions/workflows/server-tests.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://mongodb.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/Status-In%20Development-orange?style=flat-square)]()

<br/>

[Features](#features) · [Architecture](#architecture) · [Setup](#setup) · [API](#api-reference) · [Benchmarks](#benchmarks) · [Roadmap](#roadmap)

<br/>

</div>

---

## What is MedFlow AI?

MedFlow AI is a full-stack healthcare workflow app: patients triage their symptoms, book appointments, upload medical reports and ask questions about them; doctors manage their appointments; admins see summary numbers, the appointment queue and the user list.

The chatbot uses **retrieval-augmented generation (RAG)**: it answers from the patient's own uploaded documents. If nothing in those documents is similar enough to the question, it says so and does not ask the model at all.

It runs entirely on free, local services by default (Ollama, MongoDB, Redis). It is not deployed anywhere yet.

> **Important:** MedFlow AI is a workflow and assistance tool, not a diagnostic system. Everything the AI produces is advisory and must be reviewed by a qualified healthcare professional.

---

## Features

| Feature | What the code does |
|---|---|
| **AI symptom triage** | The LLM classifies free-text symptoms as `low`, `medium`, `high` or `critical` (temperature 0, JSON output; "when in doubt, choose the higher urgency"). If the reply can't be parsed, keyword rules decide. Next steps come from a fixed table per urgency. Results are saved to the patient's triage history. |
| **Appointment scheduling** | Patients pick a doctor and a time in the UI. The API rejects a booking or reschedule that overlaps another `scheduled` appointment for the same doctor (`409`). Patients can change only their own appointments, doctors only those assigned to them, admins any. |
| **Document processing** | PDF and plain-text uploads. A BullMQ worker extracts the text (`pdf-parse`), splits it into 500-word chunks with a 50-word overlap, embeds each chunk, stores the chunks, and writes a short AI summary. Images are rejected until OCR exists (see [Roadmap](#roadmap)). |
| **Document-grounded chatbot** | Retrieves the patient's 4 most similar chunks. If none reaches `RAG_SIMILARITY_THRESHOLD` (default `0.45`), it replies "There is not enough information in your documents to answer that…" with `declined: true`. Otherwise the LLM answers from those chunks only, and the reply lists the source files. |
| **Notifications** | Booking queues a confirmation email straight away and a reminder 24 h before (1 h before for appointments less than a day away). Patients with a phone number also get the reminder by SMS. Email defaults to Ethereal test inboxes and SMS to a mock driver that only logs. SMTP and Twilio are switched on in `.env`. |
| **Admin dashboard** | Counts of users by role, appointments by status and triage results by urgency, plus the upcoming-appointment queue, a searchable user list and a CSV export of appointments. |
| **Role-based access** | Patient, doctor and admin roles. The role is read from the verified JWT on the server; public registration always creates a patient. |

---

## Architecture

```
                     Next.js 16 client (React 19, Tailwind 4)
                                   |
                              HTTPS / REST
                                   |
          Express API: helmet, CORS allowlist, Redis-backed rate limits,
          JWT auth + role checks, express-validator
                                   |
     +-------------+---------------+---------------+-----------------+
     |             |               |               |                 |
   Auth      Appointments     Chat (RAG)        Triage           Documents
     |             |               |               |                 |
     |             |        llmClient (axios) -> Ollama or OpenAI    |
     |             |               |                                 |
     +------ MongoDB (Mongoose): users, appointments, triage, chat,  |
             documents, and chunk embeddings for vector search       |
                                   |                                 |
                     BullMQ queues on Redis  <-----------------------+
                                   |
        Workers: document processing (extract -> chunk -> embed -> summary)
                 notifications (Nodemailer email, Twilio or mock SMS)
                                   |
                   File storage: local disk or S3-compatible
```

- **LLM client:** one small axios wrapper (`server/src/ai/llmClient.js`) with the same chat and embedding calls for Ollama (`llama3.2`, `nomic-embed-text`) and OpenAI (`LLM_PROVIDER=openai`). No LangChain.
- **Vector search:** chunk embeddings are stored in MongoDB (`DocumentChunk`). A query loads that patient's chunks and ranks them by cosine similarity in Node (`server/src/services/vectorStoreService.js`). That's simple and fine at the scale of one patient's documents; a vector index is on the roadmap.
- **Background work:** uploads return straight away with `processingStatus: "pending"`; the client polls `GET /api/documents/:id/status`.

---

## RAG pipeline

**Ingestion (document worker)**

1. The file is read from storage (local disk or S3-compatible).
2. Text is extracted: `pdf-parse` for PDFs, read directly for `.txt`.
3. The text is split into chunks of 500 words with a 50-word overlap (`DOC_CHUNK_SIZE_WORDS`, `DOC_CHUNK_OVERLAP_WORDS`).
4. Each chunk is embedded (`nomic-embed-text` by default) and saved with the patient id and file name.
5. The LLM writes a short summary for the document list.

**Query (chat)**

1. The question is embedded with the same model.
2. The patient's chunks are ranked by cosine similarity, and the top 4 are kept.
3. Chunks below `RAG_SIMILARITY_THRESHOLD` (default `0.45`) are dropped. If none are left, the API returns the "not enough information in your documents" message with `declined: true`, and the LLM is not called.
4. Otherwise the remaining chunks and the question go to the LLM, with a system prompt that tells it to answer only from those documents.
5. The reply includes the source file names and similarity scores.

The right threshold depends on the embedding model; the default is `0.45`. `npm run bench:retrieval` shows how a given value trades answered questions against declined ones.

---

## Tech stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript |
| **Backend** | Node.js 20+, Express 4 (ES modules) |
| **AI / LLM** | Ollama `llama3.2` by default; OpenAI via `LLM_PROVIDER=openai`; plain axios client |
| **Embeddings** | Ollama `nomic-embed-text` by default; OpenAI optional |
| **Vector search** | Embeddings in MongoDB, cosine similarity computed in Node |
| **Database** | MongoDB 7 + Mongoose 7 |
| **Auth** | JWT access token (15 min) and refresh token (7 days), bcrypt password hashes |
| **Validation** | express-validator on register, login and appointment create/update/cancel |
| **Queue** | BullMQ + Redis (document processing, notifications) |
| **File storage** | Local disk, or S3-compatible (AWS S3, MinIO) via `FILE_STORAGE_TYPE=s3` |
| **Notifications** | Nodemailer (Ethereal, SMTP or mock); Twilio or mock for SMS |
| **Logging** | Winston + Morgan |
| **Tests** | Vitest + Supertest, mongodb-memory-server, GitHub Actions |
| **Containers** | Docker Compose: mongo, redis, ollama, server, worker, client |

---

## Project structure

```
medflow-ai/
├── client/                    # Next.js frontend (App Router)
│   └── app/
│       ├── admin/ appointments/ auth/ chat/ dashboard/ documents/ triage/
│       ├── components/        # Navbar
│       └── lib/               # API client, auth hook
├── server/                    # Express backend
│   ├── src/
│   │   ├── ai/                # llmClient (Ollama/OpenAI) and ragChain (chat + triage)
│   │   ├── config/            # config, env validation, Redis connection
│   │   ├── controllers/       # route handlers
│   │   ├── middleware/        # auth, roles, rate limits, validation runner
│   │   ├── models/            # Mongoose schemas
│   │   ├── queues/            # BullMQ queues
│   │   ├── routes/            # API routes
│   │   ├── services/          # embeddings, vector search, storage, notifications
│   │   ├── utils/             # logger, database, PDF extraction, chunking
│   │   ├── validators/        # express-validator rules
│   │   └── workers/           # document and notification workers
│   ├── scripts/seed.js        # starter accounts
│   ├── tests/                 # unit/ and api/ (Vitest + Supertest)
│   └── benchmarks/            # load test, pipeline timing, retrieval eval
├── shared/types/              # shared TypeScript types
├── .github/workflows/         # CI tests; manual API benchmark
└── docker-compose.yml
```

---

## Setup

### Prerequisites (all free; no paid API keys needed)

- Node.js 20 or later
- MongoDB (local Community Server, Docker, or a free Atlas cluster)
- Redis (`redis-server`, Docker, or [Memurai](https://www.memurai.com) on Windows)
- [Ollama](https://ollama.com) with two models: `ollama pull llama3.2` and `ollama pull nomic-embed-text`

OpenAI, S3, SMTP and Twilio are optional; each is switched on by a driver flag in `server/.env`.

### 1. Clone and install

```bash
git clone https://github.com/praveena396/medflow-ai.git
cd medflow-ai
cd server && npm install
cd ../client && npm install
```

### 2. Configure

```bash
cd server
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_REFRESH_SECRET
```

Every setting is explained in [`server/.env.example`](server/.env.example).

### 3. Seed starter accounts

```bash
cd server && npm run seed
```

This creates two doctors, an admin and a test patient (password pattern `<Role>@123`, e.g. `patient@medflow.local` / `Patient@123`). Change them outside local development.

### 4. Run

```bash
cd server && npm start         # API on http://localhost:5000
cd server && npm run worker    # background worker (documents + notifications)
cd client && npm run dev       # frontend on http://localhost:3000
```

### 5. Test

```bash
cd server && npm test
```

The API tests need Redis on `localhost:6379` (for the rate-limiter store). For MongoDB they use:

1. `MONGO_URI` if it is set; the database name must contain "test", because the tests drop it;
2. otherwise a throwaway in-memory MongoDB from `mongodb-memory-server` (it downloads a `mongod` binary on first run);
3. otherwise `mongodb://localhost:27017/medflow-test`.

GitHub Actions runs the same suite on every push and pull request, against MongoDB and Redis service containers ([workflow](.github/workflows/server-tests.yml)).

### Docker (alternative)

```bash
docker compose up -d
# first run only: pull the models into the ollama container
docker compose exec ollama ollama pull llama3.2
docker compose exec ollama ollama pull nomic-embed-text
```

---

## API reference

All routes except register, login, refresh and `/health` need `Authorization: Bearer <access token>`. Validation errors return `400` with `{ message, errors: [{ field, message }] }`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a patient (`name`, `email`, `password` of 8+ characters, optional `phone` in E.164 format). Staff accounts come from the seed script. |
| `POST` | `/api/auth/login` | Log in; returns `token` and `refreshToken` in the JSON body |
| `POST` | `/api/auth/refresh` | Exchange a refresh token for new tokens |
| `GET` | `/api/appointments` | Appointments where the user is the patient or the doctor |
| `GET` | `/api/appointments/doctors` | Doctors available for booking |
| `POST` | `/api/appointments` | Book (`doctorId`, future ISO `dateTime`, `reason`, optional `duration` in minutes); `409` if the doctor is busy |
| `PATCH` | `/api/appointments/:id` | Change `dateTime`, `reason` or `status` (owner, assigned doctor or admin); `409` on overlap |
| `DELETE` | `/api/appointments/:id` | Cancel (owner, assigned doctor or admin) |
| `POST` | `/api/chat` | Ask the chatbot; the response has `text`, `sourceDocuments`, `confidence` and `declined` |
| `GET` | `/api/chat/history` | The current chat session |
| `DELETE` | `/api/chat/history` | Clear the chat session |
| `POST` | `/api/triage` | Assess symptoms |
| `GET` | `/api/triage/history` | Past assessments |
| `POST` | `/api/documents` | Upload a PDF or `.txt` (multipart `file`, max 10 MB); processed in the background |
| `GET` | `/api/documents` | The user's documents |
| `GET` | `/api/documents/:id/status` | Processing status |
| `DELETE` | `/api/documents/:id` | Delete a document and its chunks |
| `GET` | `/api/admin/stats` | Dashboard counts *(admin)* |
| `GET` | `/api/admin/appointments` | Upcoming appointment queue *(admin)* |
| `GET` | `/api/admin/users` | User list with search *(admin)* |
| `GET` | `/api/admin/export/appointments` | CSV export *(admin)* |
| `GET` | `/health` | MongoDB, Redis and LLM status |

---

## Security

What is implemented:

- **JWT auth.** Access tokens last 15 minutes and refresh tokens 7 days. Both are returned in the JSON response body, and the web client keeps them in `localStorage`. Passwords are hashed with bcrypt.
- **Server-side roles.** The role comes from the verified token, never from the client. Admin routes require `admin`. Appointment changes are limited to the patient who booked, the assigned doctor or an admin. Documents and chat are scoped to the patient. Public registration can only create patients.
- **Input validation.** express-validator rules on register, login and appointment create/update/cancel.
- **Rate limiting.** Per IP, with counters in Redis: 300 requests per 15 minutes across `/api`, and 20 per 15 minutes on `/api/auth`. Both are configurable (`RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`).
- **HTTP hardening.** `helmet`, a CORS allowlist (`CORS_ORIGINS`), a 1 MB JSON body limit, and uploads limited to PDF/plain text up to 10 MB.
- **Storage.** With the S3 driver, uploads are written with server-side encryption (`AES256`).
- **Prompting.** The chat system prompt restricts answers to the retrieved documents, and the API declines before calling the LLM when nothing relevant is found. This reduces, but cannot rule out, wrong answers.

Not built yet (see [Roadmap](#roadmap)): httpOnly-cookie refresh tokens, pre-signed download URLs, audit logs, and per-user limits on the AI routes.

---

## Benchmarks

The scripts live in [`server/benchmarks/`](server/benchmarks). Run them from `server/`. Results are written as JSON to `server/benchmarks/results/` (git-ignored) together with the machine details. **Any figures quoted for this project should come from these scripts, along with the environment they ran in.** None are recorded here.

| Command | Measures | Needs |
|---|---|---|
| `npm run bench:api` | [autocannon](https://github.com/mcollina/autocannon) against the non-AI routes (`GET /api`, `/api/appointments/doctors`, `/api/appointments`): requests per second and p50/p95/p99 latency at a set concurrency | A running API, MongoDB and Redis |
| `npm run bench:pipeline` | The document worker's stages on a generated multi-page PDF: text extraction, chunking, and embedding every chunk | Nothing for `-- --no-embed`; Ollama (or OpenAI) for the embedding step |
| `npm run bench:retrieval` | Top-4 hit rate, hit@1, mean reciprocal rank, and decline rates at the current threshold, on a small synthetic labelled set ([`benchmarks/data/retrieval-eval.json`](server/benchmarks/data/retrieval-eval.json)) | Ollama with `nomic-embed-text` (or OpenAI), so it is run locally |

```bash
# API load test: raise the per-IP limit, or most requests become 429s
RATE_LIMIT_MAX=100000000 npm start      # terminal 1
npm run bench:api                       # terminal 2; BENCH_CONNECTIONS=50 BENCH_DURATION=20 by default

# Document pipeline: BENCH_PAGES=20 BENCH_RUNS=5 by default
npm run bench:pipeline
npm run bench:pipeline -- --no-embed

# Retrieval eval
ollama pull nomic-embed-text
npm run bench:retrieval
```

The **API benchmark** workflow ([`.github/workflows/benchmark.yml`](.github/workflows/benchmark.yml)) is started by hand from the Actions tab, with a choice of concurrency and duration. It starts the API against MongoDB and Redis service containers, runs `bench:api`, and uploads the JSON result as an artifact. The load generator and the API share one GitHub-hosted runner, so those numbers describe that runner, not a production deployment.

---

## Design notes

- **Decline rather than guess.** In a medical setting, "I don't know" is safer than a fluent wrong answer, so the API declines when retrieval finds nothing relevant, before calling the LLM.
- **Queues for slow work.** PDF extraction, embedding and email/SMS run in BullMQ workers, so requests don't wait on them and failed jobs can be retried.
- **One LLM gateway.** Every model call goes through `llmClient`, so switching between Ollama and OpenAI is a single environment variable.
- **Roles enforced on the server.** The frontend only decides what to show; the API checks the token's role and resource ownership on every request.

---

## Roadmap

Built: Vitest + Supertest unit and API tests, run in CI on every push and pull request.

Not built yet:

- [ ] OCR for scanned PDFs and images (e.g. tesseract.js); PNG/JPEG uploads are rejected until then
- [ ] Deployment and a public demo
- [ ] Refresh tokens in an httpOnly cookie instead of the response body
- [ ] Pre-signed, short-lived download URLs for files in S3
- [ ] Audit log of AI recommendations and admin actions
- [ ] Per-user rate limits on `/api/chat` and `/api/triage`
- [ ] Doctor working hours and an availability calendar (today only overlaps are prevented)
- [ ] Booking and rescheduling through the chatbot
- [ ] Medication reminders
- [ ] Health record: visit history and medications in the API and UI (the User model has `allergies` and `currentMedications` fields, but there are no endpoints for them yet)
- [ ] Hospital operations view (e.g. bed occupancy)
- [ ] A vector index (e.g. MongoDB Atlas Vector Search) instead of in-process cosine similarity
- [ ] FHIR integration
- [ ] Voice input for triage (Web Speech API)
- [ ] Hindi and Telugu support
- [ ] OpenAPI / Swagger docs

---

## Author

**Praveena Ganesan**, Full Stack Developer

[![GitHub](https://img.shields.io/badge/GitHub-praveena396-181717?style=flat-square&logo=github)](https://github.com/praveena396)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-praveena--ganesan-0A66C2?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/praveena-ganesan-b84541247/)

---

<div align="center">

*Built with care for better healthcare workflows.*

</div>
