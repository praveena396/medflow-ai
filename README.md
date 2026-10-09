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
[![Client build](https://github.com/praveena396/medflow-ai/actions/workflows/client.yml/badge.svg)](https://github.com/praveena396/medflow-ai/actions/workflows/client.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://mongodb.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/Status-In%20Development-orange?style=flat-square)]()

<br/>

[Features](#features) · [Architecture](#architecture) · [Setup](#setup) · [API](#api-reference) · [Benchmarks](#benchmarks) · [Deploy](#deploy) · [Roadmap](#roadmap)

<br/>

</div>

---

## What is MedFlow AI?

MedFlow AI is a full-stack healthcare workflow app: patients triage their symptoms, book appointments, upload medical reports (including photos of lab results and prescriptions) and ask questions about them; doctors manage their appointments and keep a lightweight health record for each of their patients; admins see summary numbers, the appointment queue, the user list and an audit log.

The chatbot uses **retrieval-augmented generation (RAG)**: it answers from the patient's own uploaded documents. If nothing in those documents is similar enough to the question, it says so and does not ask the model at all.

It runs entirely on free, local services by default (Ollama, MongoDB, Redis). It is not deployed anywhere yet; [Deploy](#deploy) lists the exact steps for free hosted services.

> **Important:** MedFlow AI is a workflow and assistance tool, not a diagnostic system. Everything the AI produces is advisory and must be reviewed by a qualified healthcare professional.

---

## Features

| Feature | What the code does |
|---|---|
| **AI symptom triage** | The LLM classifies free-text symptoms as `low`, `medium`, `high` or `critical` (temperature 0, JSON output; "when in doubt, choose the higher urgency"). If the reply can't be parsed, keyword rules decide. Next steps come from a fixed table per urgency. Results are saved to the patient's triage history and the audit log. |
| **Appointment scheduling** | Patients pick a doctor and a time in the UI. The API rejects a booking or reschedule that overlaps another `scheduled` appointment for the same doctor (`409`), and the booking screen says the slot is taken. Patients can change only their own appointments, doctors only those assigned to them, admins any. Only the doctor or an admin can mark an appointment completed or no-show. |
| **Health record (lightweight EHR)** | One record per patient: allergies (with reaction and severity), current medications, notes, visit history and links to the patient's uploaded documents. The patient reads their own record; a doctor reads and edits the records of patients they have an appointment with; an admin can read any. When a doctor marks an appointment completed, a visit is added to the record (once per appointment), with optional visit notes. |
| **Document processing** | PDF, plain-text, PNG and JPEG uploads. A BullMQ worker extracts the text (`pdf-parse` for PDFs, [tesseract.js](https://github.com/naptha/tesseract.js) OCR for images, with the English model bundled so nothing is downloaded at run time), splits it into 500-word chunks with a 50-word overlap, embeds each chunk, stores the chunks, and writes a short AI summary. The document list shows how the text was read and the OCR confidence. A PDF with no text layer (a scan) fails with a message asking for the pages as images; see [Roadmap](#roadmap). |
| **Document downloads** | With S3 storage, the API hands out a pre-signed GET URL that expires after 15 minutes (`DOWNLOAD_URL_EXPIRY_SECONDS`). With local storage, the file is streamed through an authenticated route. Either way the same access rules as the health record apply. |
| **Document-grounded chatbot** | Retrieves the patient's 4 most similar chunks. If none reaches `RAG_SIMILARITY_THRESHOLD` (default `0.45`), it replies "There is not enough information in your documents to answer that…" with `declined: true`. Otherwise the LLM answers from those chunks only, and the reply lists the source files. Answers and declines are written to the audit log. |
| **Audit log** | An append-only collection of AI outputs (chat answers, declines and errors; triage results) and admin and clinical actions (user role or status changes, appointment changes and cancellations by an admin, CSV exports, health-record edits and new visits). The model refuses every update and delete path. Admins read it at `/admin/audit` with filters for action, actor, target and date. |
| **Notifications** | Booking queues a confirmation email straight away and a reminder 24 h before (1 h before for appointments less than a day away). Patients with a phone number (optional at registration) also get the reminder by SMS. Email defaults to Ethereal test inboxes and SMS to a mock driver that only logs. SMTP and Twilio are switched on in `.env`. |
| **Admin dashboard** | Counts of users by role, appointments by status and triage results by urgency, plus the upcoming-appointment queue, a searchable user list where accounts can be deactivated and reactivated, a CSV export of appointments and the audit log. |
| **Role-based access** | Patient, doctor and admin roles. The role is read from the verified JWT on the server; public registration always creates a patient. |

---

## Architecture

```
                     Next.js 16 client (React 19, Tailwind 4)
                                   |
                 HTTPS / REST (refresh token in an httpOnly cookie)
                                   |
          Express API: helmet, CORS allowlist, Redis-backed rate limits
          (per IP, and per user on the AI routes), JWT auth + role checks,
          express-validator, prompt sanitising
                                   |
   +---------+-------------+-------------+---------+-------------+----------+
   |         |             |             |         |             |          |
  Auth  Appointments   Chat (RAG)     Triage   Documents   Health records  Admin
   |         |             |             |         |             |          |
   |         |      llmClient (axios) -> Ollama or OpenAI        |          |
   |         |             |                       |             |          |
   +---- MongoDB (Mongoose): users, appointments, triage, chat, documents,  |
         chunk embeddings*, health records, append-only audit log  <--------+
         (* or ChromaDB, with VECTOR_STORE=chroma)
                                   |                   |
                     BullMQ queues on Redis  <---------+
                                   |
        Workers: document processing (extract or OCR -> chunk -> embed -> summary)
                 notifications (Nodemailer email, Twilio or mock SMS)
                                   |
         File storage: local disk (streamed by the API) or S3-compatible
                       (pre-signed download URLs)
```

- **LLM client:** one small axios wrapper (`server/src/ai/llmClient.js`) with the same chat and embedding calls for Ollama (`llama3.2`, `nomic-embed-text`) and OpenAI (`LLM_PROVIDER=openai`). No LangChain.
- **Vector search:** there are two drivers behind one interface, chosen with `VECTOR_STORE`.
  - **`mongo` (default).** Chunk embeddings are stored in MongoDB (`DocumentChunk`). A query loads that patient's chunks and ranks them by cosine similarity in Node (`server/src/services/vectorStoreService.js`). That's simple and fine at the scale of one patient's documents.
  - **`chroma`.** Chunks go into one [ChromaDB](https://www.trychroma.com) collection in cosine space, through the official `chromadb` client (`server/src/services/chromaVectorStore.js`). Each chunk carries `patientId` and `documentId` metadata, and every search filters on `patientId`, so one patient never retrieves another's text.
  - **Same behaviour either way.** The score is the same cosine similarity (Chroma's `1 - distance`), so top-4, the threshold and declining work identically. Deleting a document deletes its vectors.
  - **Switching stores** doesn't copy existing chunks; upload the documents again after you change it.
- **Background work:** uploads return straight away with `processingStatus: "pending"`; the client polls `GET /api/documents/:id/status`. The workers run as a separate process (`npm run worker`) or, with `RUN_WORKERS_IN_PROCESS=true`, inside the API.

---

## RAG pipeline

**Ingestion (document worker)**

1. The file is read from storage (local disk or S3-compatible).
2. Text is extracted: `pdf-parse` for PDFs, read directly for `.txt`, and tesseract.js OCR for PNG and JPEG images.
3. The text is split into chunks of 500 words with a 50-word overlap (`DOC_CHUNK_SIZE_WORDS`, `DOC_CHUNK_OVERLAP_WORDS`).
4. Each chunk is embedded (`nomic-embed-text` by default) and saved with the patient id and file name, in MongoDB or ChromaDB (`VECTOR_STORE`).
5. The LLM writes a short summary for the document list.

**Query (chat)**

1. The question is sanitised (see [Security](#security)) and embedded with the same model.
2. The patient's chunks are ranked by cosine similarity, and the top 4 are kept. With MongoDB this is computed in Node; with ChromaDB it is a filtered nearest-neighbour query.
3. Chunks below `RAG_SIMILARITY_THRESHOLD` (default `0.45`) are dropped. If none are left, the API returns the "not enough information in your documents" message with `declined: true`, and the LLM is not called.
4. Otherwise the remaining chunks go to the LLM inside `<documents>` tags and the question inside `<question>` tags, with a system prompt that tells it to answer only from those documents and to treat everything inside the tags as data, not instructions.
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
| **OCR** | tesseract.js 6 with the bundled English model (`@tesseract.js-data/eng`) |
| **Vector search** | Embeddings in MongoDB with cosine similarity computed in Node (default), or ChromaDB 1.5 via the `chromadb` client (`VECTOR_STORE=chroma`) |
| **Database** | MongoDB 7 + Mongoose 7 |
| **Auth** | JWT access token (15 min) in the response body; refresh token (7 days) in an httpOnly cookie; bcrypt password hashes |
| **Validation** | express-validator on every route that takes input |
| **Queue** | BullMQ + Redis (document processing, notifications) |
| **File storage** | Local disk, or S3-compatible (AWS S3, Cloudflare R2, MinIO) via `FILE_STORAGE_TYPE=s3`, with pre-signed download URLs |
| **Notifications** | Nodemailer (Ethereal, SMTP or mock); Twilio or mock for SMS |
| **Logging** | Winston + Morgan; append-only audit log in MongoDB |
| **Tests** | Vitest + Supertest, mongodb-memory-server, GitHub Actions (server tests, client lint and build) |
| **Containers** | Docker Compose: mongo, redis, ollama, server, worker, client |
| **Deployment config** | `render.yaml` (API and worker); Vercel for the client |

---

## Project structure

```
medflow-ai/
├── client/                    # Next.js frontend (App Router)
│   └── app/
│       ├── admin/ (audit/) appointments/ auth/ chat/ dashboard/
│       ├── documents/ records/ triage/
│       ├── components/        # Navbar
│       └── lib/               # API client, session hook, downloads
├── server/                    # Express backend
│   ├── src/
│   │   ├── ai/                # llmClient (Ollama/OpenAI), ragChain (chat + triage), prompt sanitising
│   │   ├── config/            # config, env validation, Redis connection
│   │   ├── controllers/       # route handlers
│   │   ├── middleware/        # auth, roles, rate limits, validation runner
│   │   ├── models/            # Mongoose schemas (incl. HealthRecord, AuditLog)
│   │   ├── queues/            # BullMQ queues
│   │   ├── routes/            # API routes
│   │   ├── services/          # embeddings, vector stores (MongoDB, ChromaDB), storage, OCR, audit, health records, notifications
│   │   ├── utils/             # logger, database, text extraction, chunking
│   │   ├── validators/        # express-validator rules
│   │   └── workers/           # document and notification workers
│   ├── scripts/seed.js        # starter accounts
│   ├── tests/                 # unit/ and api/ (Vitest + Supertest)
│   └── benchmarks/            # load test, pipeline timing, retrieval eval
├── shared/types/              # shared TypeScript types
├── .github/workflows/         # server tests, client build, manual benchmarks
├── render.yaml                # Render Blueprint (API + worker)
└── docker-compose.yml
```

---

## Setup

### Prerequisites (all free; no paid API keys needed)

- Node.js 20 or later
- MongoDB (local Community Server, Docker, or a free Atlas cluster)
- Redis (`redis-server`, Docker, or [Memurai](https://www.memurai.com) on Windows)
- [Ollama](https://ollama.com) with two models: `ollama pull llama3.2` and `ollama pull nomic-embed-text`
- Optional: [ChromaDB](https://docs.trychroma.com) if you set `VECTOR_STORE=chroma`, e.g. `docker run -p 8000:8000 chromadb/chroma:1.5.9` or `docker compose --profile chroma up -d chroma`; then set `CHROMA_URL=http://localhost:8000`

OpenAI, S3, SMTP and Twilio are optional; each is switched on by a driver flag in `server/.env`. The OCR model ships with the `@tesseract.js-data/eng` package, so it needs no extra setup.

The refresh cookie is `Secure` by default. Chrome and Firefox accept that on `http://localhost`. If you use Safari, or reach the API over plain HTTP under another host name, set `REFRESH_COOKIE_SECURE=false` in `server/.env`. Otherwise the browser drops the cookie and you'll have to log in again every 15 minutes.

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

The ChromaDB integration test (`tests/integration/chroma.test.js`) runs only when `CHROMA_URL` points at a Chroma server; otherwise it is skipped:

```bash
CHROMA_URL=http://localhost:8000 npm test
```

GitHub Actions runs the same suite on every push and pull request, against MongoDB, Redis and ChromaDB service containers ([workflow](.github/workflows/server-tests.yml)). A second workflow lints and builds the client ([workflow](.github/workflows/client.yml)):

```bash
cd client && npm run lint && npm run build
```

### Docker (alternative)

```bash
docker compose up -d
# first run only: pull the models into the ollama container
docker compose exec ollama ollama pull llama3.2
docker compose exec ollama ollama pull nomic-embed-text

# with the ChromaDB vector store (also set VECTOR_STORE=chroma in server/.env)
docker compose --profile chroma up -d
```

---

## API reference

All routes except register, login, refresh, logout, `/api` and `/health` need `Authorization: Bearer <access token>`. Validation errors return `400` with `{ message, errors: [{ field, message }] }`.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Register a patient (`name`, `email`, `password` of 8+ characters, optional `phone` in E.164 format). Staff accounts come from the seed script. Returns `token` and `user`, and sets the refresh cookie. |
| `POST` | `/api/auth/login` | Log in; returns `token` and `user`, and sets the refresh cookie. `403` for a deactivated account. |
| `POST` | `/api/auth/refresh` | Reads the refresh cookie, rotates it and returns a new `token` (`401` without the cookie, `403` if it is invalid) |
| `POST` | `/api/auth/logout` | Clears the refresh cookie |
| `GET` | `/api/auth/me` | The current user |
| `GET` | `/api/appointments` | Appointments where the user is the patient or the doctor |
| `GET` | `/api/appointments/doctors` | Doctors available for booking |
| `POST` | `/api/appointments` | Book (`doctorId`, future ISO `dateTime`, `reason`, optional `duration` in minutes); `409` if the doctor is busy |
| `PATCH` | `/api/appointments/:id` | Change `dateTime`, `reason` or `status` (owner, assigned doctor or admin; only the doctor or an admin can set `completed` or `no-show`); `409` on overlap. Setting `completed` adds a visit to the patient's health record, with optional `notes`, and returns `visitAdded`. |
| `DELETE` | `/api/appointments/:id` | Cancel (owner, assigned doctor or admin) |
| `POST` | `/api/chat` | Ask the chatbot (`message`, up to 2,000 characters; 20 a minute per user); the response has `text`, `sourceDocuments`, `confidence` and `declined` |
| `GET` | `/api/chat/history` | The current chat session |
| `DELETE` | `/api/chat/history` | Clear the chat session |
| `POST` | `/api/triage` | Assess symptoms (`symptoms`, up to 2,000 characters; 20 a minute per user) |
| `GET` | `/api/triage/history` | Past assessments |
| `POST` | `/api/documents` | Upload a PDF, `.txt`, PNG or JPEG (multipart `file`, max 10 MB); processed in the background |
| `GET` | `/api/documents` | The user's documents |
| `GET` | `/api/documents/:id/status` | Processing status |
| `GET` | `/api/documents/:id/download` | `{ mode: "s3", url, expiresIn }` with a pre-signed URL, or `{ mode: "local", url }` pointing at the route below |
| `GET` | `/api/documents/:id/file` | The file itself (local storage), or a redirect to a pre-signed URL (S3) |
| `DELETE` | `/api/documents/:id` | Delete a document and its chunks |
| `GET` | `/api/records/me` | The patient's own health record |
| `GET` | `/api/records/patients` | Patients whose records the user can open (a doctor's patients, or everyone for an admin) |
| `GET` | `/api/records/:patientId` | A patient's record (the patient, their doctors, or an admin); includes `canEdit` |
| `PATCH` | `/api/records/:patientId` | Replace `allergies`, `currentMedications` and/or `notes` *(the patient's doctor)* |
| `POST` | `/api/records/:patientId/visits` | Add a visit (`reason`, optional `date`, `diagnosis`, `notes`, `appointmentId`, `documentIds`) *(the patient's doctor)* |
| `GET` | `/api/admin/stats` | Dashboard counts *(admin)* |
| `GET` | `/api/admin/appointments` | Upcoming appointment queue *(admin)* |
| `GET` | `/api/admin/users` | User list with search *(admin)* |
| `PATCH` | `/api/admin/users/:id` | Change a user's `role` or `isActive` (not your own) *(admin)* |
| `GET` | `/api/admin/export/appointments` | CSV export *(admin)* |
| `GET` | `/api/admin/audit` | Audit log: `action` (exact, or a prefix ending in `*` such as `ai.*`), `actorId`, `targetType`, `targetId`, `from`, `to`, `page`, `limit` (max 200) *(admin)* |
| `GET` | `/health` | MongoDB, Redis and LLM status |

---

## Security

What is implemented:

- **JWT auth.** Access tokens last 15 minutes and are returned in the JSON body; the client keeps the access token and the user in `localStorage`. Refresh tokens last 7 days and travel only in an httpOnly, `Secure`, `SameSite=Strict` cookie scoped to `/api/auth`, so page scripts can't read them. Each refresh rotates the cookie, and logout clears it. Passwords are hashed with bcrypt. Deactivated accounts can't log in.
- **Server-side roles.** The role comes from the verified token, never from the client. Admin routes require `admin`. Appointment changes are limited to the patient who booked, the assigned doctor or an admin. Health records and document downloads are limited to the patient, doctors with an appointment with that patient, and admins; only those doctors can edit. Chat is scoped to the patient. Public registration can only create patients.
- **Input validation.** express-validator rules on every route that takes input, including a 2,000-character cap on chat messages and symptoms.
- **Rate limiting.** Counters live in Redis. Per IP: 300 requests per 15 minutes across `/api`, and 20 per 15 minutes on `/api/auth`. Per user (keyed by user id, so one account can't get around it by changing IP): 20 requests a minute on `/api/chat` and `/api/triage`. All are configurable (`RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`, `AI_RATE_LIMIT_*`).
- **Prompt-injection hardening.** User text is normalised (NFKC) and stripped of control, zero-width and bidi characters, model special tokens (`<|...|>`, `[INST]`, `<<SYS>>`), fake `system:` / `assistant:` role lines and the tags the prompts use, then length-capped. Document text gets the same treatment before it goes into a prompt. The system prompts stay scoped to their task and say to treat tagged content as data. This lowers the risk; it can't remove it.
- **Audit log.** AI outputs and admin and clinical changes are written to an append-only collection: the model throws on every update, replace and delete path, and there is no API to change entries.
- **HTTP hardening.** `helmet`, a CORS allowlist (`CORS_ORIGINS`, with credentials for the cookie), a 1 MB JSON body limit, and uploads limited to PDF, plain text, PNG and JPEG up to 10 MB.
- **Storage.** With the S3 driver, uploads are written with server-side encryption (`AES256`) and downloads use pre-signed URLs that expire after 15 minutes. With local storage, files are only reachable through the authenticated `/api/documents/:id/file` route, sent with `Cache-Control: private, no-store`.
- **Prompting.** The chat system prompt restricts answers to the retrieved documents, and the API declines before calling the LLM when nothing relevant is found. This reduces, but cannot rule out, wrong answers.

---

## Benchmarks

The scripts live in [`server/benchmarks/`](server/benchmarks). Run them from `server/`. Results are written as JSON to `server/benchmarks/results/` (git-ignored) together with the machine details. **Any figures quoted for this project should come from these scripts, along with the environment they ran in.** None are recorded here.

| Command | Measures | Needs |
|---|---|---|
| `npm run bench:api` | [autocannon](https://github.com/mcollina/autocannon) against the non-AI routes (`GET /api`, `/api/appointments/doctors`, `/api/appointments`): requests per second and p50/p95/p99 latency at a set concurrency | A running API, MongoDB and Redis |
| `npm run bench:pipeline` | The document worker's stages on a generated multi-page PDF (text extraction, chunking, embedding every chunk, and the total per page), plus OCR time for a generated image of a lab-report page | Nothing for `-- --no-embed`; Ollama (or OpenAI) for the embedding step |
| `npm run bench:retrieval` | Top-4 hit rate, hit@1, mean reciprocal rank, and decline rates at the current threshold, on a small synthetic labelled set ([`benchmarks/data/retrieval-eval.json`](server/benchmarks/data/retrieval-eval.json)). `-- --store=mongo` (the default ranking) or `-- --store=chroma` (through the ChromaDB driver) | Ollama with `nomic-embed-text` (or OpenAI); a Chroma server for `--store=chroma` |

```bash
# API load test: raise the per-IP limit, or most requests become 429s
RATE_LIMIT_MAX=100000000 npm start      # terminal 1
npm run bench:api                       # terminal 2; BENCH_CONNECTIONS=50 BENCH_DURATION=20 by default

# Document pipeline: BENCH_PAGES=20 BENCH_RUNS=5 BENCH_OCR_RUNS=3 by default
npm run bench:pipeline
npm run bench:pipeline -- --no-embed --no-ocr

# Retrieval eval
ollama pull nomic-embed-text
npm run bench:retrieval                      # VECTOR_STORE, mongo by default
npm run bench:retrieval -- --store=chroma    # needs CHROMA_URL
```

The **API benchmark** workflow ([`.github/workflows/benchmark.yml`](.github/workflows/benchmark.yml)) is started by hand from the Actions tab, with a choice of concurrency and duration. It has two jobs:

- `api-load` starts the API against MongoDB and Redis service containers and runs `bench:api`.
- `retrieval-and-pipeline` installs Ollama, pulls `nomic-embed-text` and runs `bench:pipeline` and `bench:retrieval` on the runner's CPU. The retrieval benchmark runs twice: once with the MongoDB ranking, and once against a ChromaDB service container.

Both print their JSON results in the job log and upload them as an artifact. Everything runs on one shared GitHub-hosted runner per job, so those numbers describe that runner, not a production deployment.

---

## Deploy

The repository is ready to deploy but is not deployed. The plan below uses free tiers: the client on **Vercel**, the API on **Render**, **MongoDB Atlas M0**, **Upstash Redis** and an **OpenAI API key** (Ollama can't run on these hosts). Do the steps in this order, because each one produces a value the next one needs.

**1. MongoDB Atlas (M0, free)**

1. At [cloud.mongodb.com](https://cloud.mongodb.com), create a project and a **M0** cluster.
2. Under *Database Access*, add a user with a generated password and the *Read and write to any database* role.
3. Under *Network Access*, allow `0.0.0.0/0`. Render's free services have no fixed outbound IP.
4. Under *Connect* → *Drivers*, copy the `mongodb+srv://...` string, put the password in, and add the database name: `.../medflow?retryWrites=true&w=majority`. This is `MONGO_URI`.

**2. Upstash Redis (free)**

1. At [console.upstash.com](https://console.upstash.com), create a Redis database in the region closest to your Render region.
2. Copy the `rediss://default:<password>@<name>.upstash.io:6379` URL. It must start with `rediss://`, because Upstash requires TLS. This is `REDIS_URL`.
3. BullMQ polls Redis, which uses up the free tier's command quota faster than normal traffic. Keep an eye on it in the Upstash console.

**3. OpenAI**

1. Create an API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys) and add a small amount of credit. This is `OPENAI_API_KEY`.
2. `render.yaml` sets `LLM_CHAT_MODEL=gpt-4o-mini` and `LLM_EMBEDDING_MODEL=text-embedding-3-small`. OpenAI embeddings have a different size from `nomic-embed-text`, so documents embedded locally won't match questions embedded in production. Upload them again after you switch.

**4. File storage (S3 or Cloudflare R2)**

Render's disk is wiped on every deploy, so keep uploads in a bucket. `render.yaml` sets `FILE_STORAGE_TYPE=s3`.

- **AWS S3:** create a private bucket, and an IAM user with `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on it. Set `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, and leave `S3_ENDPOINT` empty.
- **Cloudflare R2:** this has a free tier. Create a bucket and an R2 API token with *Object Read & Write*. Set `S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com` and `S3_REGION=auto`, plus the bucket, key id and secret.

Downloads are pre-signed URLs, so the bucket stays private.

**5. Render (API and worker)**

1. At [dashboard.render.com](https://dashboard.render.com), choose *New* → *Blueprint* and pick this repository. Render reads [`render.yaml`](render.yaml): a `medflow-api` web service and a `medflow-worker` background worker, both built from `server/`. They share an environment group, and the JWT secrets are generated for you.
2. When asked, fill in `MONGO_URI`, `REDIS_URL`, `OPENAI_API_KEY` and the `S3_*` values from steps 1 to 4. Set `CORS_ORIGINS` to a placeholder for now; you'll get the real value in step 6.
3. Render has no free background workers. To stay free, delete the `medflow-worker` service from `render.yaml` before you create the Blueprint, and set `RUN_WORKERS_IN_PROCESS=true` on `medflow-api`. The API then runs the document and notification workers itself.
4. The blueprint already sets these for you:
   - `REFRESH_COOKIE_SAMESITE=none` and `REFRESH_COOKIE_SECURE=true`. The client and API are on different sites, and browsers only send a cross-site cookie that is `SameSite=None; Secure`.
   - `TRUST_PROXY=1`, so the per-IP rate limits see the client's address and not Render's proxy.
5. After the first deploy, open `https://<service>.onrender.com/health`. It should report `database`, `redis` and `llm` as `up`. Free web services sleep after 15 minutes without traffic, so the first request after that is slow.
6. To create the staff accounts, run the seed script once from your own machine against Atlas: `cd server && MONGO_URI='<the Atlas string>' npm run seed`. Render's free instances have no shell. Then change those passwords.

**6. Vercel (client)**

1. At [vercel.com/new](https://vercel.com/new), import the repository and set **Root Directory** to `client`. Vercel detects Next.js, so no `vercel.json` is needed.
2. Add the environment variable `NEXT_PUBLIC_API_URL=https://<service>.onrender.com`, with no trailing slash, and deploy.
3. Copy the Vercel URL, for example `https://medflow.vercel.app`. Set it as `CORS_ORIGINS` on the Render service, with no trailing slash and comma-separated if there are several, and redeploy the API.

**7. Check the deployment**

1. Register a patient on the Vercel site and reload the page. Staying logged in after the access token expires shows the refresh cookie works.
2. Upload a PDF or a photo of a report, and wait until it shows as processed.
3. Ask the chatbot about it.
4. Log in as the seeded admin and open *Audit Log*. The chat answer should be there.

Optional: set `EMAIL_DRIVER=smtp` with `SMTP_*`, and `SMS_DRIVER=twilio` with `TWILIO_*`, to send real notifications.

---

## Design notes

- **Decline rather than guess.** In a medical setting, "I don't know" is safer than a fluent wrong answer, so the API declines when retrieval finds nothing relevant, before calling the LLM.
- **Queues for slow work.** PDF extraction, embedding and email/SMS run in BullMQ workers, so requests don't wait on them and failed jobs can be retried.
- **One LLM gateway.** Every model call goes through `llmClient`, so switching between Ollama and OpenAI is a single environment variable.
- **Roles enforced on the server.** The frontend only decides what to show; the API checks the token's role and resource ownership on every request.
- **Care relationship as the access rule.** A doctor can open a patient's record only if the two share an appointment. That's simple to explain and to check, and it means a doctor can't browse records of patients they've never seen.
- **An audit log that can only grow.** Entries are written with the outcome of each AI call and admin change, and the model rejects every update and delete. Writing an entry never fails the request it describes.

---

## Roadmap

Built: Vitest + Supertest unit and API tests and a client lint and build, run in CI on every push and pull request; OCR for images; a lightweight health record; an append-only audit log; httpOnly-cookie refresh tokens; per-user limits on the AI routes; prompt-injection hardening; pre-signed download URLs; a ChromaDB vector store option; deployment configuration.

Not built yet:

- [ ] OCR for scanned PDFs. Images are read with OCR, but a PDF without a text layer is rejected with a request to upload the pages as images, because the PDF would first have to be rasterised.
- [ ] Deployment and a public demo (the configuration and steps are in [Deploy](#deploy))
- [ ] Doctor working hours and an availability calendar (today only overlaps are prevented)
- [ ] Booking and rescheduling through the chatbot
- [ ] Medication reminders
- [ ] Hospital operations view (e.g. bed occupancy)
- [ ] An approximate-nearest-neighbour index in MongoDB (Atlas Vector Search) for the default store. ChromaDB is available today through `VECTOR_STORE=chroma`.
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
