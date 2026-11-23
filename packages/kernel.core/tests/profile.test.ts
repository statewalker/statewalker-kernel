import { describe, expect, it } from "vitest";
import { archiveHash, createMemoryProfile, fragmentRecordKey } from "../src/index.js";
import { archive, fragment, newKernel } from "./helpers.js";

const A = "org.example.a";

describe("the profile", () => {
  it("records each installed fragment's version, archive and enabled state; a removal drops it", async () => {
    const profile = createMemoryProfile();
    const { kernel } = newKernel({ profile });
    const files = archive(fragment(A, { version: "1.2.0" }));
    const hash = await archiveHash(files);
    await kernel.install([files]);
    expect(await profile.get(fragmentRecordKey(A))).toEqual({
      version: "1.2.0",
      archive: hash,
      enabled: false,
    });
    await kernel.enable(A);
    expect(await profile.get(fragmentRecordKey(A))).toMatchObject({ enabled: true });
    await kernel.disable(A);
    expect(await profile.get(fragmentRecordKey(A))).toMatchObject({ enabled: false });
    await kernel.remove(A);
    expect(await profile.get(fragmentRecordKey(A))).toBeUndefined();
  });

  it("records the core fragments shipped with the platform too, enabled", async () => {
    const profile = createMemoryProfile();
    const core = archive(fragment("system.example"));
    const { kernel } = newKernel({ profile, core: [core] });
    await kernel.start();
    expect(await profile.get(fragmentRecordKey("system.example"))).toEqual({
      version: "1.0.0",
      archive: await archiveHash(core),
      enabled: true,
    });
  });
});
