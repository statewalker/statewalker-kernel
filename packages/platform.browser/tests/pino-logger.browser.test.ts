import { LoggerAdapter, loggerOf, Workspace } from "@statewalker/workspace";
import { describe, expect, it } from "vitest";
import { PinoLoggerAdapter, registerPinoLogger } from "../src/pino-logger.browser.js";

describe("registerPinoLogger", () => {
  it("registers a pino LoggerAdapter resolvable on the workspace; loggerOf works", () => {
    const ws = new Workspace();
    const dispose = registerPinoLogger(ws, { level: "debug" });

    const adapter = ws.getAdapter(LoggerAdapter);
    expect(adapter).toBeInstanceOf(PinoLoggerAdapter);

    const log = loggerOf(ws, "scanner");
    expect(() => log.info("hello", { a: 1 })).not.toThrow();

    dispose();
  });

  it("newLogger returns a child logger without throwing (metadata stamped)", () => {
    const adapter = new PinoLoggerAdapter(
      { projectName: "demo", workspace: { label: "WS" } },
      { level: "info" },
    );
    const child = adapter.newLogger("build", { run: 1 });
    expect(() => child.warn("ok")).not.toThrow();
    expect(typeof child.child).toBe("function");
  });
});
