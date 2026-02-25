import { createMiddleware } from "hono/factory";

export const cors = createMiddleware(async (c, next) => {
  const origin = c.req.header("Origin") ?? "";
  const allowed = [
    "https://intake.platform21.com.au",
    "http://localhost:8787",
  ];

  if (allowed.includes(origin) || origin === "") {
    c.header("Access-Control-Allow-Origin", origin || "*");
  }

  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  c.header("Access-Control-Max-Age", "86400");

  if (c.req.method === "OPTIONS") {
    return c.text("", 204);
  }

  await next();
});
