# Intake API

An inbox for AI coding agents.

AI agents can read files, write code, and call APIs. But when they need input from someone outside the terminal — a client, a stakeholder, a subject matter expert — the human operator becomes a manual relay. This project removes that bottleneck.

The Intake API is a feedback machine. An agent creates a structured form, pre-fills it with what it already knows, and sends a token URL to the right person. That person opens the link, verifies the pre-filled data, fills in the gaps, and submits. The agent retrieves the structured response via API and continues working. No accounts, no apps, no copy-pasting between email and terminal.

One Cloudflare Worker serves both the JSON API (agent-facing) and the branded web forms (human-facing). Built with Hono, NEON Postgres (via Drizzle ORM), and Cloudflare R2 for file storage.

For the design rationale behind this approach, read [Giving AI Coding Agents an Inbox](https://www.userhat.com/giving-ai-coding-agents-an-inbox/).

## How it works

1. An agent sends a `POST /api/intake` request with a form definition (fields, sections, pre-filled values).
2. The API returns a unique token and a shareable URL.
3. The client opens the URL in their browser, sees a branded multi-section form, and fills it in.
4. Form progress saves automatically to the browser's local storage.
5. On submission, responses are stored in R2 and the record status updates in Postgres.
6. The agent retrieves the submitted data via `GET /api/intake/:token`.

## Multi-brand support

The worker serves multiple brands from a single deployment. It selects the brand based on the request hostname.

| Hostname | Brand |
|----------|-------|
| `intake.example.com` | Acme Agency |
| `intake.other-brand.com.au` | Other Brand |
| All other hosts | Default brand |

Each brand applies its own name, tagline, primary colour, and footer text to the form interface. Add or modify brands in `src/lib/brands.ts`. The `getBrand()` function matches the request hostname and returns the appropriate configuration.

## Authentication

All `/api/*` endpoints require a bearer token. Include the `Authorization` header in every request:

```
Authorization: Bearer <your-api-key>
```

The API key is stored as a Cloudflare Worker secret (`INTAKE_API_KEY`). Requests without a valid token receive `401 Unauthorized` or `403 Forbidden`.

Client-facing form pages (`/:token`, `/:token/verify`, `/:token/thanks`) do not require the API key — they are protected by an optional PIN instead.

## API reference

All API endpoints are prefixed with `/api`. Request and response bodies use JSON unless otherwise noted. Every request must include the `Authorization: Bearer <key>` header.

### Create an intake form

```
POST /api/intake
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project_name` | string | Yes | Display name for the project |
| `workflow` | string | Yes | `migrate` or `newsite` |
| `mode` | string | No | `full`, `prd`, `autonomous`, or `quickstart`. Defaults to `full` |
| `form_definition` | object | Yes | Sections and fields that define the form (see Form definitions below) |
| `password` | string | No | If set, clients must enter this password before viewing the form |

**Response:**

```json
{
  "id": "uuid",
  "token": "abc123...",
  "url": "https://intake.example.com/abc123...",
  "expires_at": "2026-03-27T00:00:00.000Z"
}
```

Forms expire 30 days after creation.

### Get intake metadata

```
GET /api/intake/:token
```

Returns the record metadata and the submitted response (if one exists). Returns `410 Gone` if the form has expired.

### Get form definition

```
GET /api/intake/:token/definition
```

Returns the original form definition stored in R2.

### Get submitted response

```
GET /api/intake/:token/response
```

Returns only the submitted response data from R2. Returns `404` if no response has been submitted.

### Submit or update a response

```
PUT /api/intake/:token
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `submitted_data` | object | Yes | Key-value pairs of form field responses |
| `partial` | boolean | No | If `true`, saves progress without marking as submitted |

### Update status

```
PATCH /api/intake/:token/status
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | Yes | One of `draft`, `sent`, `submitted`, or `imported` |

### Upload a file

```
POST /api/intake/:token/upload
Content-Type: multipart/form-data
```

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | Yes | The file to upload (max 10 MB) |
| `category` | string | No | `logo`, `photo`, `document`, or `other`. Defaults to `other` |

### List uploaded files

```
GET /api/intake/:token/files
```

### Download a file

```
GET /api/intake/:token/files/:fileId
```

Returns the file with appropriate `Content-Type` and `Content-Disposition` headers.

### Delete an intake record

```
DELETE /api/intake/:token
```

Deletes the intake record, all associated files (from R2 and the database), the form definition, and the submitted response. Returns the count of deleted files.

## Form definitions

The `form_definition` object controls what the client sees. It contains a title, optional description, and an array of sections.

```json
{
  "title": "Project Intake Form",
  "description": "Please review the pre-filled information and complete any gaps.",
  "sections": [
    {
      "heading": "Business Details",
      "description": "Basic information about your business.",
      "fields": [
        {
          "name": "business_name",
          "label": "Business name",
          "type": "text",
          "value": "Acme Plumbing",
          "required": true
        },
        {
          "name": "services",
          "label": "Services offered",
          "type": "textarea",
          "placeholder": "List your main services..."
        },
        {
          "name": "service_area",
          "label": "Service area",
          "type": "select",
          "options": ["Brisbane", "Gold Coast", "Sunshine Coast"]
        },
        {
          "name": "logo",
          "label": "Upload your logo",
          "type": "file",
          "accept": "image/*",
          "category": "logo"
        }
      ]
    }
  ]
}
```

### Supported field types

| Type | Description |
|------|-------------|
| `text` | Single-line text input |
| `textarea` | Multi-line text input |
| `select` | Dropdown menu. Requires `options` array |
| `checkbox` | Group of checkboxes. Requires `options` array |
| `content` | Read-only rendered Markdown. Uses `value` as the content source |
| `file` | File upload with drag-and-drop. Supports `accept` and `category` attributes |

Pre-filled values use the `value` or `default` field. The client can edit all fields except `content` blocks.

## Client-facing pages

| Path | Description |
|------|-------------|
| `/:token` | Renders the intake form (or password gate if protected) |
| `/:token/verify` | Verifies the password and renders the form |
| `/:token/thanks` | Confirmation page shown after submission |

The form interface uses Tailwind CSS (via CDN), renders server-side with Hono JSX, and includes client-side JavaScript for local storage persistence, file uploads, and form submission.

## Record lifecycle

```
draft  -->  sent  -->  submitted  -->  imported
```

| Status | Meaning |
|--------|---------|
| `draft` | Form created by agent, not yet viewed by client |
| `sent` | Client has opened the form URL |
| `submitted` | Client has completed and submitted the form |
| `imported` | Agent has retrieved and processed the submission |

The status transitions from `draft` to `sent` automatically when the client first views the form.

## Database schema

Two tables in NEON Postgres, managed by Drizzle ORM.

### `intake_records`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `token` | VARCHAR(64) | Unique access token |
| `project_name` | VARCHAR(255) | Project display name |
| `workflow` | ENUM | `migrate` or `newsite` |
| `mode` | ENUM | `full`, `prd`, `autonomous`, or `quickstart` |
| `status` | ENUM | `draft`, `sent`, `submitted`, or `imported` |
| `password_hash` | VARCHAR(128) | SHA-256 hash of access password (nullable) |
| `created_at` | TIMESTAMP | Record creation time |
| `updated_at` | TIMESTAMP | Last modification time |
| `submitted_at` | TIMESTAMP | Form submission time (nullable) |
| `expires_at` | TIMESTAMP | Expiry date (30 days from creation) |

### `intake_files`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `intake_id` | UUID | Foreign key to `intake_records` |
| `filename` | VARCHAR(255) | Timestamped safe filename |
| `original_name` | VARCHAR(255) | Original upload filename |
| `mime_type` | VARCHAR(127) | File MIME type |
| `size_bytes` | INTEGER | File size |
| `r2_key` | VARCHAR(512) | Storage path in R2 |
| `category` | ENUM | `logo`, `photo`, `document`, or `other` |
| `created_at` | TIMESTAMP | Upload time |

## File storage

Form definitions, responses, and uploaded files are stored in Cloudflare R2.

```
forms/{token}/definition.json    # Form structure (sections, fields, pre-filled values)
forms/{token}/response.json      # Submitted client responses
intake/{token}/{category}/{file} # Uploaded files (logos, photos, documents)
```

## Project structure

```
src/
  index.ts              # Application entry point and Hono app
  routes/
    api.ts              # REST API endpoints (agent-facing)
    form.tsx            # HTML form routes (client-facing)
  views/
    layout.tsx          # Base HTML layout with Tailwind
    dynamic-form.tsx    # Dynamic form renderer
    password-gate.tsx   # Password entry page
    thanks.tsx          # Post-submission confirmation
  lib/
    brands.ts           # Multi-brand configuration
    markdown.ts         # Markdown rendering
    storage.ts          # R2 upload, download, and key helpers
    tokens.ts           # Secure token generation
  schema/
    index.ts            # Drizzle ORM table definitions
  middleware/
    auth.ts             # Bearer token auth for API routes
    cors.ts             # CORS middleware
drizzle/                # Generated migration files
wrangler.toml           # Cloudflare Worker configuration
drizzle.config.ts       # Drizzle Kit configuration
```

## Development

### Prerequisites

- Node.js 18 or later
- A NEON Postgres database
- A Cloudflare account with an R2 bucket named `intake-uploads`

### Setup

Install dependencies:

```bash
npm install
```

Create a `.dev.vars` file with your secrets:

```
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

Run the development server:

```bash
npm run dev
```

The worker runs at `http://localhost:8787`.

### Database migrations

Generate a migration after changing the schema:

```bash
npm run db:generate
```

Push schema changes to the database:

```bash
npm run db:push
```

Open Drizzle Studio to browse data:

```bash
npm run db:studio
```

## Deployment

The checked-in `wrangler.toml` has no routes — it's safe for a public repository. Create a `wrangler.production.toml` with your real domain routes:

```toml
name = "intake-api"
main = "src/index.ts"
compatibility_date = "2024-12-30"
compatibility_flags = ["nodejs_compat"]
routes = [
  { pattern = "intake.example.com/*", zone_name = "example.com" }
]

[vars]
ENVIRONMENT = "production"

[[r2_buckets]]
binding = "INTAKE_BUCKET"
bucket_name = "intake-uploads"
```

This file is gitignored. Deploy with:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
npx wrangler deploy --config wrangler.production.toml
```

Set the secrets in Cloudflare:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put INTAKE_API_KEY
```

## How this differs from other human-in-the-loop tools

Most human-in-the-loop patterns assume the human is the agent operator. This project assumes the human is someone else entirely — a client, a stakeholder, or a domain expert who has no access to the agent's session and no idea an agent is involved.

| Project | Who responds | Interface | Direction |
|---------|-------------|-----------|-----------|
| **Intake API** | External person (client, stakeholder) | Branded web form at a token URL | Agent sends structured questions out, retrieves structured answers back |
| [Agent Inbox](https://github.com/langchain-ai/agent-inbox) (LangChain) | Agent operator | Developer dashboard for LangGraph interrupts | Operator reviews and resumes paused agent runs |
| [HumanLayer](https://github.com/humanlayer/humanlayer) | Team members | Slack, email, or Discord notifications | Agent requests approve/reject decisions from internal users |
| [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) | Agent operator | Terminal prompt | Operator approves or denies tool calls |
| [Cloudflare Agents SDK + Knock](https://blog.cloudflare.com/building-agents-at-knock-agents-sdk/) | Team members | Push notifications via Knock | Agent requests approval through notification channels |

The other key difference is **pre-filling**. The agent does its research first — scraping public data, querying business registries, gathering social profiles — and populates the form with what it already knows. The external person verifies and corrects rather than starting from a blank page. None of the projects above include this pattern.

## Security considerations

- **API authentication**: All `/api/*` routes require a bearer token (`INTAKE_API_KEY`). Client-facing form pages are exempt.
- **Secrets**: The `.dev.vars` file contains database credentials and the API key, and must not be committed. It is listed in `.gitignore`.
- **Tokens**: Access tokens use a 24-character alphanumeric string generated from `crypto.getRandomValues()`. The alphabet excludes ambiguous characters (0, O, 1, l, I).
- **Password protection**: Form passwords are hashed with SHA-256 before storage. This is appropriate for low-sensitivity PINs shared via email, not for user account credentials.
- **File uploads**: Limited to 10 MB per file. Filenames are sanitised to alphanumeric characters, dots, hyphens, and underscores.
- **CORS**: Restricted to the production hostname and `localhost:8787` for development.
- **Expiry**: Forms expire after 30 days. The API returns `410 Gone` for expired tokens.
