import { describe, expect, it } from "vitest";
import {
  activeFragmentsSlot,
  appliedMigrationsKey,
  archiveHash,
  createMemoryArchiveStore,
  createMemoryProfile,
  FragmentDeletesClassesError,
  FragmentInstallError,
  FragmentMigrationError,
  FragmentRollbackError,
  fragmentRecordKey,
  installedFragmentsSlot,
  type KernelOptions,
} from "../src/index.js";
import { archive, fragment, newKernel } from "./helpers.js";

const A = "org.example.a";

/** An archive of a with a server half whose wrangler.jsonc declares `migrations`. */
function serverArchive(version: string, migrations: Record<string, unknown>[]) {
  return archive(fragment(A, { version, aspects: { server: {}, client: {} } }), {
    "wrangler.jsonc": `// wrangler\n${JSON.stringify({ name: "org-example-a", migrations }, null, 2)}\n`,
  });
}

const V1 = { tag: "v1", new_sqlite_classes: ["Notes"] };
const V2 = { tag: "v2", new_sqlite_classes: ["Tags"] };
const V3 = { tag: "v3", deleted_classes: ["Tags"] };

async function setup(options: Partial<KernelOptions> = {}) {
  const log: string[] = [];
  const profile = createMemoryProfile();
  const { kernel, slots } = newKernel({
    profile,
    activators: {
      client: (f) => {
        log.push(`activate ${f.manifest.version}`);
        return () => {
          log.push(`cleanup ${f.manifest.version}`);
        };
      },
    },
    migrate: (f, migration) => {
      log.push(`migrate ${migration.tag} on ${f.manifest.version}`);
    },
    ...options,
  });
  await kernel.install([serverArchive("1.0.0", [V1])]);
  await kernel.enable(A);
  await kernel.activate("client");
  log.length = 0;
  return { kernel, slots, log, profile };
}

describe("migrations", () => {
  it("are the installed archive's tags, recorded as applied, without running them", async () => {
    const { log, profile } = await setup();
    expect(log).toEqual([]);
    expect(await profile.get(appliedMigrationsKey(A))).toEqual(["v1"]);
  });

  it("an upgrade runs the new tags once, after the swap and before activation, and records them", async () => {
    const { kernel, log, profile } = await setup();
    await kernel.upgrade(A, serverArchive("1.1.0", [V1, V2]));
    expect(log).toEqual(["cleanup 1.0.0", "migrate v2 on 1.1.0", "activate 1.1.0"]);
    expect(await profile.get(appliedMigrationsKey(A))).toEqual(["v1", "v2"]);
    expect(await profile.get(fragmentRecordKey(A))).toMatchObject({
      version: "1.1.0",
      upgrade: { migrations: ["v2"] },
    });

    // A second upgrade does not run v2 again.
    log.length = 0;
    await kernel.upgrade(A, serverArchive("1.2.0", [V1, V2]));
    expect(log).toEqual(["cleanup 1.1.0", "activate 1.2.0"]);
    expect(await profile.get(appliedMigrationsKey(A))).toEqual(["v1", "v2"]);
  });

  it("refuse a rollback once one has run; the upgraded version stays active", async () => {
    const { kernel, slots, log, profile } = await setup();
    const v2 = serverArchive("1.1.0", [V1, V2]);
    await kernel.upgrade(A, v2);
    log.length = 0;
    const error = await kernel.rollback(A).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FragmentRollbackError);
    expect((error as FragmentRollbackError).migrations).toEqual(["v2"]);
    expect(log).toEqual([]);
    expect(slots.get(installedFragmentsSlot, A)?.manifest.version).toBe("1.1.0");
    expect(slots.get(activeFragmentsSlot("client"), A)?.archive).toBe(await archiveHash(v2));
    expect(await profile.get(fragmentRecordKey(A))).toMatchObject({ version: "1.1.0" });
  });

  it("an upgrade that ran none can be rolled back, though an earlier upgrade ran some", async () => {
    const { kernel, slots } = await setup();
    await kernel.upgrade(A, serverArchive("1.1.0", [V1, V2]));
    await kernel.upgrade(A, serverArchive("1.2.0", [V1, V2]));
    await kernel.rollback(A);
    expect(slots.get(activeFragmentsSlot("client"), A)?.manifest.version).toBe("1.1.0");
  });

  it("keep their record when the fragment is removed with its data kept, and drop it with the data", async () => {
    const { kernel, profile } = await setup({ removeData: () => {} });
    await kernel.remove(A);
    expect(await profile.get(appliedMigrationsKey(A))).toEqual(["v1"]);
    await kernel.install([serverArchive("1.0.0", [V1])]);
    await kernel.remove(A, { withData: true });
    expect(await profile.get(appliedMigrationsKey(A))).toBeUndefined();
  });

  it("an upgrade deleting classes stops for confirmation and changes nothing without it", async () => {
    const archives = createMemoryArchiveStore();
    const { kernel, slots, log, profile } = await setup({ archives });
    await kernel.upgrade(A, serverArchive("1.1.0", [V1, V2]));
    log.length = 0;
    const before = {
      installed: slots.get(installedFragmentsSlot, A),
      record: await profile.get(fragmentRecordKey(A)),
      applied: await profile.get(appliedMigrationsKey(A)),
    };
    const v3 = serverArchive("1.2.0", [V1, V2, V3]);
    const error = await kernel.upgrade(A, v3).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FragmentDeletesClassesError);
    expect((error as FragmentDeletesClassesError).deletions).toEqual([
      { tag: "v3", classes: ["Tags"] },
    ]);
    expect(log).toEqual([]);
    expect(slots.get(installedFragmentsSlot, A)).toBe(before.installed);
    expect(slots.get(activeFragmentsSlot("client"), A)).toBe(before.installed);
    expect(await profile.get(fragmentRecordKey(A))).toEqual(before.record);
    expect(await profile.get(appliedMigrationsKey(A))).toEqual(before.applied);
    expect(await archives.get(await archiveHash(v3))).toBeUndefined();

    // Confirmed, it runs.
    await kernel.upgrade(A, v3, { confirmDeletedClasses: true });
    expect(log).toEqual(["cleanup 1.1.0", "migrate v3 on 1.2.0", "activate 1.2.0"]);
    expect(await profile.get(appliedMigrationsKey(A))).toEqual(["v1", "v2", "v3"]);
  });

  it("refuse, at install and at upgrade, a wrangler.jsonc whose migrations lack a tag or repeat one", async () => {
    const { kernel } = await setup();
    for (const migrations of [[V1, V1], [{ new_classes: ["X"] }]]) {
      const error = await kernel
        .upgrade(A, serverArchive("1.1.0", migrations))
        .catch((e: unknown) => e);
      expect((error as FragmentInstallError).refusals?.map((r) => r.code)).toEqual([
        "invalid-manifest",
      ]);
    }
    const { kernel: fresh } = newKernel();
    await expect(fresh.install([serverArchive("1.0.0", [V1, V1])])).rejects.toBeInstanceOf(
      FragmentInstallError,
    );
  });

  it("that fails stops the upgrade with the new archive in place, inactive; the tags that ran stay recorded", async () => {
    const V4 = { tag: "v4" };
    const { kernel, slots, log, profile } = await setup({
      migrate: (_f, migration) => {
        log.push(`migrate ${migration.tag}`);
        if (migration.tag === "v4") throw new Error("disk full");
      },
    });
    const error = await kernel
      .upgrade(A, serverArchive("1.1.0", [V1, V2, V4]))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FragmentMigrationError);
    expect(error).toMatchObject({ id: A, tag: "v4" });
    expect((error as FragmentMigrationError).cause).toEqual(new Error("disk full"));
    expect(log).toEqual(["cleanup 1.0.0", "migrate v2", "migrate v4"]);
    expect(slots.get(installedFragmentsSlot, A)?.manifest.version).toBe("1.1.0");
    expect(slots.getSnapshot(activeFragmentsSlot("client")).has(A)).toBe(false);
    expect(await profile.get(appliedMigrationsKey(A))).toEqual(["v1", "v2"]);
    // v2 ran: no rollback.
    await expect(kernel.rollback(A)).rejects.toBeInstanceOf(FragmentRollbackError);
  });

  it("that fails before any ran leaves the upgrade free to roll back", async () => {
    const { kernel, slots } = await setup({
      migrate: () => {
        throw new Error("no");
      },
    });
    await expect(kernel.upgrade(A, serverArchive("1.1.0", [V1, V2]))).rejects.toBeInstanceOf(
      FragmentMigrationError,
    );
    await kernel.rollback(A);
    expect(slots.get(installedFragmentsSlot, A)?.manifest.version).toBe("1.0.0");
    await kernel.activate("client", A);
    expect(slots.get(activeFragmentsSlot("client"), A)?.manifest.version).toBe("1.0.0");
  });

  it("refuse a reinstall over kept data that would need migrations; the removed version reinstalls", async () => {
    const { kernel, profile } = await setup();
    await kernel.remove(A);
    const error = await kernel.install([serverArchive("1.1.0", [V1, V2])]).catch((e: unknown) => e);
    expect((error as FragmentInstallError).refusals).toEqual([
      expect.objectContaining({ id: A, code: "pending-migrations" }),
    ]);
    expect(await profile.get(appliedMigrationsKey(A))).toEqual(["v1"]);
    await kernel.install([serverArchive("1.0.0", [V1])]);
    await kernel.enable(A);
    await kernel.upgrade(A, serverArchive("1.1.0", [V1, V2]));
    expect(await profile.get(appliedMigrationsKey(A))).toEqual(["v1", "v2"]);
  });

  it("keep their record when removing with data fails: the data is still there", async () => {
    const { kernel, profile } = await setup({
      removeData: () => {
        throw new Error("storage down");
      },
    });
    await expect(kernel.remove(A, { withData: true })).rejects.toThrow(/storage down/);
    expect(await profile.get(appliedMigrationsKey(A))).toEqual(["v1"]);
  });

  it("refuse an install or an upgrade whose archive lacks a tag the data has had", async () => {
    const { kernel, slots } = await setup();
    await kernel.upgrade(A, serverArchive("1.1.0", [V1, V2]));
    const refusal = async (run: Promise<unknown>) =>
      ((await run.catch((e: unknown) => e)) as FragmentInstallError).refusals?.map((r) => r.code);
    expect(await refusal(kernel.upgrade(A, serverArchive("1.2.0", [V1])))).toEqual([
      "data-too-new",
    ]);
    expect(slots.get(activeFragmentsSlot("client"), A)?.manifest.version).toBe("1.1.0");
    // Removed with its data kept, the older version cannot come back over migrated data.
    await kernel.remove(A);
    expect(await refusal(kernel.install([serverArchive("1.0.0", [V1])]))).toEqual([
      "data-too-new",
    ]);
    await kernel.install([serverArchive("1.1.0", [V1, V2])]);
  });
});
