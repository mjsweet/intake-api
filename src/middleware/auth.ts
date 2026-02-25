import { createMiddleware } from "hono/factory";
import type { Env } from "../index";

export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }

    const header = c.req.header("Authorization");

    if (!header) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const match = header.match(/^Bearer\s+(.+)$/);

    if (!match) {
      return c.json({ error: "Invalid Authorization format — expected Bearer token" }, 401);
    }

    const token = match[1];

    if (token !== c.env.INTAKE_API_KEY) {
      return c.json({ error: "Invalid API key" }, 403);
    }

    await next();
  }
);
