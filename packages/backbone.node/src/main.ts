import { bootstrap } from "./bootstrap.js";

const roots = process.argv.slice(2).filter((arg) => arg !== "--");

console.log("[backbone] Starting...");
if (roots.length > 0) {
  console.log(`[backbone] Loading modules: ${roots.join(", ")}`);
} else {
  console.log("[backbone] No modules specified — running bare backbone");
}

const shutdown = await bootstrap({ roots });

// Keep the event loop alive until a signal is received.
const keepAlive = setInterval(() => {}, 1 << 30);

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(keepAlive);
    await shutdown();
    process.exit(0);
  });
}
