# Intake API

A Cloudflare Worker that serves dynamic client intake forms and a RESTful API for managing form submissions. Agents create forms programmatically through the API. Clients complete them through a branded web interface.

Built with Hono, NEON Postgres (via Drizzle ORM), and Cloudflare R2 for file storage.

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

## API reference

All API endpoints are prefixed with `/api`. Request and response bodies use JSON unless otherwise noted.

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

Set the `CLOUDFLARE_ACCOUNT_ID` environment variable, then deploy:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
npm run deploy
```

Set the `DATABASE_URL` secret in Cloudflare:

```bash
npx wrangler secret put DATABASE_URL
```

The `wrangler.toml` file defines the route patterns. Update these to match your domain configuration.

## Security considerations

- **Secrets**: The `.dev.vars` file contains database credentials and must not be committed. It is listed in `.gitignore`.
- **Tokens**: Access tokens use a 24-character alphanumeric string generated from `crypto.getRandomValues()`. The alphabet excludes ambiguous characters (0, O, 1, l, I).
- **Password protection**: Form passwords are hashed with SHA-256 before storage. This is appropriate for low-sensitivity PINs shared via email, not for user account credentials.
- **File uploads**: Limited to 10 MB per file. Filenames are sanitised to alphanumeric characters, dots, hyphens, and underscores.
- **CORS**: Restricted to the production hostname and `localhost:8787` for development.
- **Expiry**: Forms expire after 30 days. The API returns `410 Gone` for expired tokens.
