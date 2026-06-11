import { Hono } from "hono";
import { cors } from "./middleware/cors";
import apiRoutes from "./routes/api";
import formRoutes from "./routes/form";
import type { EmailSender } from "./lib/notify";

export interface Env {
  DB: D1Database;
  INTAKE_BUCKET: R2Bucket;
  INTAKE_API_KEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  CF_ACCOUNT_ID: string;
  // Cloudflare Email Service binding (optional: no-op when absent)
  NOTIFY?: EmailSender;
  NOTIFY_TO?: string;
  NOTIFY_FROM?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", cors);

// API routes (agent-facing)
app.route("/api", apiRoutes);

// Form routes (client-facing) - must come after /api to avoid catching /api/* paths
app.route("/", formRoutes);

export default app;
