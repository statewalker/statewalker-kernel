// An archive uploaded in the manager view: a JSON object of file names to their texts.
import { describe, expect, it } from "vitest";
import { readArchiveFile } from "../client/index.js";

describe("readArchiveFile", () => {
  it("reads a JSON object of file texts", () => {
    expect(readArchiveFile('{"fragment.jsonc":"{}"}')).toEqual({ "fragment.jsonc": "{}" });
  });

  it.each([
    ["not JSON", "{ nope", /not JSON/],
    ["an array", "[]", /JSON object/],
    ["a file that is not a text", '{"fragment.jsonc":1}', /"fragment.jsonc" is not a text/],
  ])("refuses %s, with the reason", (_label, text, reason) => {
    expect(() => readArchiveFile(text)).toThrow(reason);
  });
});
