import { Hono } from "hono";
import { cors } from "./middleware/cors";
import apiRoutes from "./routes/api";
import formRoutes from "./routes/form";

export interface Env {
  DATABASE_URL: string;
  INTAKE_BUCKET: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use("*", cors);

// API routes (agent-facing)
app.route("/api", apiRoutes);

// Form routes (client-facing) - must come after /api to avoid catching /api/* paths
app.route("/", formRoutes);

export default app;
