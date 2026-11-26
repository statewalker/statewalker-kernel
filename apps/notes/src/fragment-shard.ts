/// <reference lib="webworker" />
// One shard worker of the fragment host's pool (statewalker/statewalker-root#259): it runs every
// fragment's server half on CellB (SQLite WASM on OPFS), as src/fragment-servers.ts adds them.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { serveFragmentShard } from "@statewalker/cellb/browser";

serveFragmentShard({
  sqlite3: () =>
    (sqlite3InitModule as unknown as (o: object) => Promise<unknown>)({
      print() {},
      printErr() {},
    }),
});
