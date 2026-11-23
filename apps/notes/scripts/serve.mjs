#!/usr/bin/env node
// `pnpm start`: serve the built app (run `pnpm run build` first). PORT picks the port (4173).
import { resolve } from "node:path";
import { serveStatic } from "./static-server.mjs";

const server = await serveStatic(
  resolve(import.meta.dirname, "..", "dist"),
  Number(process.env.PORT ?? 4173),
);
console.log(`apps/notes on ${server.url}`);
