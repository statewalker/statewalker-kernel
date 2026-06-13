import {
  getCommands,
  PreferenceGetCommand,
  PreferenceSetCommand,
} from "@statewalker/platform.core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerPreferenceGetBrowser } from "../src/handlers/preference-get.browser.js";
import { registerPreferenceSetBrowser } from "../src/handlers/preference-set.browser.js";

describe("preference-get/set browser handlers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips a value through localStorage", async () => {
    const ctx = {};
    const commands = getCommands(ctx);
    const unregisterGet = registerPreferenceGetBrowser(commands);
    const unregisterSet = registerPreferenceSetBrowser(commands);
    try {
      await commands.call(PreferenceSetCommand, { key: "k", value: { a: 1, b: [true, "s"] } })
        .promise;
      const result = await commands.call(PreferenceGetCommand, { key: "k" }).promise;
      expect(result.value).toEqual({ a: 1, b: [true, "s"] });

      // Namespaced under workbench: prefix.
      expect(localStorage.getItem("workbench:k")).toBe(JSON.stringify({ a: 1, b: [true, "s"] }));
    } finally {
      unregisterSet();
      unregisterGet();
    }
  });

  it("returns { value: undefined } for a missing key", async () => {
    const ctx = {};
    const commands = getCommands(ctx);
    const unregisterGet = registerPreferenceGetBrowser(commands);
    try {
      const result = await commands.call(PreferenceGetCommand, { key: "never-set" }).promise;
      expect(result).toEqual({ value: undefined });
    } finally {
      unregisterGet();
    }
  });

  it("treats a corrupt JSON entry as missing", async () => {
    const ctx = {};
    const commands = getCommands(ctx);
    const unregisterGet = registerPreferenceGetBrowser(commands);
    try {
      localStorage.setItem("workbench:broken", "{not json");
      const result = await commands.call(PreferenceGetCommand, { key: "broken" }).promise;
      expect(result.value).toBeUndefined();
    } finally {
      unregisterGet();
    }
  });
});
