import { describe, expect, it } from "vitest";
import {
  type ActivationContext,
  activeFragmentsSlot,
  archiveHash,
  createMemoryArchiveStore,
  createMemoryProfile,
  type Extension,
  enabledFragmentsSlot,
  FragmentInstallError,
  FragmentLifecycleError,
  FragmentRollbackError,
  fragmentRecordKey,
  installedFragmentsSlot,
  type KernelOptions,
  resolvedFragmentsSlot,
} from "../src/index.js";
import { archive, fragment, ids, membershipLog, newKernel } from "./helpers.js";

const A = "org.example.a";
const B = "org.example.b";

/** a, and b requiring a ^1; both enabled and active in the client aspect. */
async function setup(options: Partial<KernelOptions> = {}) {
  const log: string[] = [];
  const archives = createMemoryArchiveStore();
  const profile = createMemoryProfile();
  const { kernel, slots } = newKernel({
    archives,
    profile,
    activators: {
      client: (f) => {
        log.push(`activate ${f.id}@${f.manifest.version}`);
        return () => {
          log.push(`cleanup ${f.id}@${f.manifest.version}`);
        };
      },
    },
    ...options,
  });
  const v1 = archive(fragment(A));
  await kernel.install([v1, archive(fragment(B, { requires: { [A]: "^1.0.0" } }))]);
  await kernel.enable(A);
  await kernel.enable(B);
  await kernel.activate("client");
  log.length = 0;
  return { kernel, slots, log, archives, profile, v1 };
}

describe("upgrade", () => {
  it("deactivates, swaps the archive and reactivates; the previous archive is kept", async () => {
    const { kernel, slots, log, archives, profile, v1 } = await setup();
    const v2 = archive(fragment(A, { version: "1.1.0" }));
    await kernel.upgrade(A, v2);

    // Dependents first on the way down, requirements first on the way up.
    expect(log).toEqual([
      `cleanup ${B}@1.0.0`,
      `cleanup ${A}@1.0.0`,
      `activate ${A}@1.1.0`,
      `activate ${B}@1.0.0`,
    ]);
    const hash = await archiveHash(v2);
    for (const slot of [installedFragmentsSlot, enabledFragmentsSlot, resolvedFragmentsSlot]) {
      expect(slots.get(slot, A)?.manifest.version).toBe("1.1.0");
      expect(slots.get(slot, A)?.archive).toBe(hash);
    }
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client"))).sort()).toEqual([A, B]);
    expect(slots.get(activeFragmentsSlot("client"), A)?.manifest.version).toBe("1.1.0");

    expect(await archives.get(hash)).toEqual(v2);
    expect(await archives.get(await archiveHash(v1))).toEqual(v1);
    // The profile records the version, its archive and the one it replaced.
    expect(await profile.get(fragmentRecordKey(A))).toEqual({
      version: "1.1.0",
      archive: hash,
      enabled: true,
      upgrade: { from: { version: "1.0.0", archive: await archiveHash(v1) }, migrations: [] },
    });
  });

  it("can be rolled back before any migration ran: the previous archive is active again", async () => {
    const { kernel, slots, log, profile, v1 } = await setup();
    await kernel.upgrade(A, archive(fragment(A, { version: "1.1.0" })));
    log.length = 0;
    await kernel.rollback(A);
    expect(log).toEqual([
      `cleanup ${B}@1.0.0`,
      `cleanup ${A}@1.1.0`,
      `activate ${A}@1.0.0`,
      `activate ${B}@1.0.0`,
    ]);
    const hash = await archiveHash(v1);
    for (const slot of [
      installedFragmentsSlot,
      resolvedFragmentsSlot,
      activeFragmentsSlot("client"),
    ]) {
      expect(slots.get(slot, A)?.archive).toBe(hash);
    }
    expect(slots.get(installedFragmentsSlot, A)?.files).toEqual(v1);
    expect(await profile.get(fragmentRecordKey(A))).toEqual({
      version: "1.0.0",
      archive: hash,
      enabled: true,
    });
    // Nothing left to roll back to.
    await expect(kernel.rollback(A)).rejects.toBeInstanceOf(FragmentRollbackError);
  });

  it("refuses an archive that is not a later version, does not fit the host, or breaks a dependent; nothing changes", async () => {
    const { kernel, slots, log, profile } = await setup();
    const before = await profile.get(fragmentRecordKey(A));
    const installedBefore = slots.get(installedFragmentsSlot, A);
    const codes = async (files: Record<string, string>, id = A) => {
      const error = await kernel.upgrade(id, files).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FragmentInstallError);
      return (error as FragmentInstallError).refusals.map((r) => r.code);
    };
    expect(await codes(archive(fragment("org.example.c", { version: "2.0.0" })))).toEqual([
      "not-an-upgrade",
    ]);
    expect(await codes(archive(fragment(A)))).toEqual(["not-an-upgrade"]);
    expect(await codes(archive(fragment(A, { version: "0.9.0" })))).toEqual(["not-an-upgrade"]);
    expect(
      await codes(archive(fragment(A, { version: "1.1.0", engines: { platform: "^2.0.0" } }))),
    ).toEqual(["incompatible-platform"]);
    expect(await codes(archive(fragment(A, { version: "1.1.0", bindings: ["gpu"] })))).toEqual([
      "missing-binding",
    ]);
    expect(
      await codes(archive(fragment(A, { version: "1.1.0", requires: { "org.example.z": "^1" } }))),
    ).toEqual(["unmet-requirement"]);
    // b requires a ^1.0.0: a 2.0.0 would break it.
    const error = await kernel
      .upgrade(A, archive(fragment(A, { version: "2.0.0" })))
      .catch((e) => e);
    expect((error as FragmentInstallError).refusals).toEqual([
      expect.objectContaining({ id: B, code: "unmet-requirement" }),
    ]);
    await expect(kernel.upgrade("org.example.none", archive(fragment(A)))).rejects.toBeInstanceOf(
      FragmentLifecycleError,
    );

    expect(log).toEqual([]);
    expect(slots.get(installedFragmentsSlot, A)).toBe(installedBefore);
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual([A, B]);
    expect(await profile.get(fragmentRecordKey(A))).toEqual(before);
  });

  it("refuses to upgrade a core fragment, shipped with the platform", async () => {
    const { kernel } = newKernel({ core: [archive(fragment("system.example"))] });
    await kernel.start();
    await expect(
      kernel.upgrade("system.example", archive(fragment("system.example", { version: "1.1.0" }))),
    ).rejects.toBeInstanceOf(FragmentLifecycleError);
  });
});

describe("rollback", () => {
  it("is refused, nothing changed, when the store no longer holds the previous archive", async () => {
    const store = createMemoryArchiveStore();
    const forgetful = { put: store.put, get: async () => undefined };
    const { kernel, slots } = await setup({ archives: forgetful });
    await kernel.upgrade(A, archive(fragment(A, { version: "1.1.0" })));
    await expect(kernel.rollback(A)).rejects.toBeInstanceOf(FragmentRollbackError);
    expect(slots.get(activeFragmentsSlot("client"), A)?.manifest.version).toBe("1.1.0");
  });
});

describe("an upgrade in the slots", () => {
  it("is dispose plus register: observers see the fragment leave and come back, its extensions replaced", async () => {
    const contexts = new Map<string, ActivationContext>();
    const { kernel, slots } = newKernel({
      activators: {
        client: (f, context) => {
          contexts.set(f.id, context);
        },
      },
    });
    const menus = { type: "object", properties: { label: { type: "string" } } };
    const contribution = (id: string, label: string, version = "1.0.0") =>
      archive(
        fragment(id, {
          version,
          aspects: {
            client: { extensions: [{ point: "org.example.owner/menus", data: { label } }] },
          },
        }),
      );
    await kernel.install([
      archive(
        fragment("org.example.owner", {
          aspects: { client: { extensionPoints: { menus: { schema: menus } } } },
        }),
      ),
      contribution(A, "A1"),
      contribution(B, "B"),
    ]);
    for (const id of ["org.example.owner", A, B]) await kernel.enable(id);
    await kernel.activate("client");
    const events: string[] = [];
    const label = (e: Extension) => (e.data as { label: string }).label;
    contexts.get("org.example.owner")?.extensions.observe("menus", (all, { added, removed }) => {
      events.push(`[${all.map(label)}] +[${added.map(label)}] -[${removed.map(label)}]`);
    });
    const installed = membershipLog(slots, installedFragmentsSlot);
    const resolved = membershipLog(slots, resolvedFragmentsSlot);

    await kernel.upgrade(A, contribution(A, "A2", "1.1.0"));

    expect(installed.events).toEqual([`-${A}`, `+${A}`]);
    expect(resolved.events).toEqual([`-${A}`, `+${A}`]);
    // The owner, which does not require a, stays active and sees a's extension replaced.
    expect(events).toEqual(["[A1,B] +[A1,B] -[]", "[B] +[] -[A1]", "[B,A2] +[A2] -[]"]);
  });
});
