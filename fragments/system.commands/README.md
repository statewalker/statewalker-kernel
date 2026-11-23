# system.commands

## What it is

The first core fragment of the platform. It opens two extension points in the client aspect, `commands` and `keybindings`, and runs the command bus: fragments declare each command once as an OpenAPI 3.1 operation, the bus calls it with its input and output checked against the operation's schemas and fails with typed errors, and the catalogue is projected to harness tool documents (for `agent`-exposed commands) and to MCP tools (for `mcp`-exposed ones). It is a private workspace package, `@statewalker/system.commands`, with no React, no DOM and no Node built-ins.

## Why it exists

ADR `2026-11-21-commands-exposures-and-agents` (statewalker-root) makes a command the single representation of anything a fragment offers, with opt-in exposures to agents, HTTP and MCP, and derives the harness's tools and MCP from one catalogue. ADR `2026-11-20-kernel-and-core-fragments` gives the `commands` and `keybindings` points to `system.commands`. Before this, commands lived in code (`@statewalker/shared-commands` declarations registered at activation): nothing could list a fragment's commands before its code ran, and every command was implicitly a tool. Here the declaration is data in `fragment.client.jsonc`, so the catalogue, the tools and the keybindings are known while the handlers stay lazy.

## How to use

```ts
import {
  CommandCallError,
  CommandFailure,
  createSystemCommands,
  harnessTools,
  mcpTools,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
  toolByName,
} from "@statewalker/system.commands";
```

| Export | Provides |
| --- | --- |
| `systemCommandsArchive`, `SYSTEM_COMMANDS_ID` | The fragment's files (`fragment.jsonc`, `fragment.client.jsonc`), for `createKernel({ core })`. |
| `createSystemCommands({ gate? })` → `{ bus, activate }` | The bus, and the body of the fragment's client activator; `gate` decides calls from callers other than the user (system.security's). |
| `CommandBus` | `call(id, input, { caller? })`, `list()`, `get(id)`, `keybindings()`, `observe(listener)`. |
| `Caller`, `CallOptions`, `CallGate`, `CallRequest` | Who makes a call (the user, or a holder of a capability), and the gate's contract. |
| `CommandCallError`, `CommandCallErrorKind`, `CommandFailure` | The one error a call rejects with, and what a handler throws for a declared error. |
| `harnessTools(commands, { locale })`, `mcpTools(commands, { locale, fragment })` | The projections, recomputed from `bus.list()`. |
| `toolNames(commands)`, `toolByName(commands, name, exposure)`, `toolPermission(id)`, `defaultHttpPath(command)` | Provider-safe names, their reverse map, `tools.use:<id>`, the HTTP path `mcp` implies. |
| `labelsOf(entry, locale)`, `closedSchema(schema)` | A command's localized title and description; the profile's closed input schema. |
| `commandSchema`, `keybindingSchema` | The two points' schemas (JSON Schema 2020-12). |
| `CommandEntry`, `CommandData`, `CommandOperation`, `Exposures`, `Label`, `Keybinding`, `HarnessToolDocument`, `McpTool`, `ToolExposure` | The types. |

## Examples

A fragment declares a command in its `fragment.client.jsonc`, with no `requires` on `system.commands`:

```jsonc
{
  "$schema": "./node_modules/@statewalker/kernel.core/schemas/fragment-aspect.v1.schema.json",
  "extensions": [
    {
      "point": "commands",
      "data": {
        "operation": {
          "operationId": "get-note",
          "summary": "Read a note",
          "requestBody": {
            "content": { "application/json": { "schema": {
              "type": "object", "required": ["id"], "properties": { "id": { "type": "string" } }
            } } }
          },
          "responses": {
            "200": { "description": "The note", "content": { "application/json": { "schema": {
              "type": "object", "properties": { "text": { "type": "string" } }
            } } } },
            "404": { "description": "No such note", "content": { "application/json": { "schema": {
              "type": "object", "required": ["code"], "properties": { "code": { "const": "not-found" } }
            } } } }
          }
        },
        "exposures": { "agent": { "action": "read" }, "http": { "path": "/notes/get" }, "mcp": {} },
        "labels": { "fr": { "title": "Lire une note" } }
      },
      "reference": { "module": "./commands.js", "export": "getNote" }
    }
  ]
}
```

The handler takes the validated input and the call's context, and raises declared errors with `CommandFailure`:

```ts
export async function getNote({ id }: { id: string }) {
  const note = await store.get(id);
  if (!note) throw new CommandFailure("not-found", `no note ${id}`, { id });
  return { text: note.text };
}
```

The host wires the fragment into the kernel and calls commands by identity:

```ts
const commands = createSystemCommands();
const kernel = createKernel({
  platform,
  core: [systemCommandsArchive],
  resolvers: {
    module: (ref, { contributor }) => importExport(contributor, ref.module, ref.export),
    command: (ref) => (input: unknown) => commands.bus.call(ref.command, input),
  },
  activators: {
    client: (fragment, context) =>
      fragment.id === SYSTEM_COMMANDS_ID ? commands.activate(context) : activateClient(fragment),
  },
});
await kernel.start();

try {
  const note = await commands.bus.call("org.example.notes/get-note", { id: "n1" });
} catch (error) {
  if (error instanceof CommandCallError && error.kind === "declared-error") console.log(error.code);
}

commands.bus.observe((all) => {
  agentTools = harnessTools(all, { locale }); // only agent-exposed commands
  mcpList = mcpTools(all, { locale }); // only mcp-exposed commands
});
```

## Internals

### The `commands` point

An extension's data is `{ operation, exposures?, labels? }`, checked by the kernel against `commandSchema`; a declaration that breaks it is refused with a reason in `system:extensions:refused:client` and never reaches the bus.

- **`operation`** is an OpenAPI 3.1 operation object. `operationId` is the command id (lowercase letters and digits with inner hyphens, at most 64). The JSON request body's schema is the input and must be an object (none means an empty closed object, and a missing input is `{}`); the `200` JSON response's schema is the output (none means anything). Every non-2xx response whose JSON schema names `properties.code` (`const` or `enum`) is a declared error.
- **`exposures`** are opt-in; a command is internal without them. `agent: { action: "read" | "write" | "admin" }` makes it a harness tool. `http: { path }` serves it (POST) at `path` under `/fragments/{id}/`. `mcp: {}` offers it through MCP and implies `http`: without an `http` exposure the command is served at `/commands/<command-id>` under the fragment prefix (`defaultHttpPath`), and an explicit `http.path` wins. `CommandEntry.exposures` holds the exposures in effect.
- **`labels`** map a locale (`fr`, `fr-CA`) to `{ title?, description? }`. With system.l10n wired into the workbench, the chrome asks, in each locale of the interface language, its fragment's bundles (`commands.<command-id>.title`, `.description`), then these labels, then language packs; then the default language's bundles, then the operation (system.workbench's README); the projections read these labels alone.
- **The handler** is the extension's lazy reference (a module export, or a server entrypoint method reached over RPC), resolved by the host's resolver on the first call. A command without one is listed but fails `no-handler`.

A command's identity is `<fragment-id>/<command-id>`. When live extensions of one fragment declare the same command id, the first extension read wins, and the next takes over when it leaves: the bus rebuilds its commands from the point's whole extension list on every change.

### The bus

The bus is built on `@statewalker/shared-commands`: each live command is a `Command.required` declaration whose input and output Standard Schemas wrap the operation's JSON Schemas (validated with `@cfworker/json-schema`, draft 2020-12, no code generation), and the reference's handler is its listener. A call rejects with one `CommandCallError` whose `kind` is:

- `unknown-command`: no live command has that identity;
- `forbidden`: the caller is not the user, and the gate refused the call (its error as `cause`, its message as the call's), or no gate is wired; the handler does not run;
- `invalid-input`: the input breaks the schema (`issues` lists the violations); the handler does not run;
- `no-handler`: declared without a reference;
- `unavailable`: the contributor left while the call ran (the kernel's `ExtensionUnavailable` as `cause`);
- `declared-error`: the handler threw a `CommandFailure` whose code a response declares and whose body `{ code, message, data }` matches its schema (`code`, `status` as the response key, `data`);
- `handler-error`: anything else thrown (`cause`);
- `invalid-output`: the result breaks the output schema.

The bus follows the `commands` point through the activation context, so a command lives exactly while its fragment is resolved: disabling the fragment removes it from the bus and the projections, enabling it brings it back. Deactivating `system.commands` empties the bus. `observe` is called at once and after each change; projections are recomputed from `list()`, never stored.

### Callers

A call without `caller` (or with `{ kind: "user" }`) is the user's and is never restricted: whoever holds the bus is system code acting for the user. Every other caller (`{ capability }`: an agent session, a peer, a sandbox, through the system code that relays it) is gated. The bus copies the input (`structuredClone`; an input that is not plain data is `invalid-input`), hands the copy to the gate with the command's entry, and runs the call on that same copy once the gate returns, so a caller cannot change what an approval showed while it waits. A bus built without a gate refuses every such call (`forbidden`), and a command that left while the gate waited is `unknown-command`. system.security provides the gate:

```ts
const security = createSystemSecurity({ slots: kernel.slots, attended: true });
const commands = createSystemCommands({ gate: security.gate });
await commands.bus.call("org.example.notes/get-note", { id: "n1" }, { caller: { capability } });
```

A handler is called as `handler(input, { command })`. The context object is where call ids, progress and cancellation can be added if statewalker-root#204 asks for them, without changing a handler's signature.

### Projections

`harnessTools` reproduces the restricted profile of statewalker-root#90 as statewalker-ai's `ai-definitions` builds it (`toolDefinition`): one OpenAPI 3.1 document per tool with one `POST /tools/<fragment-id>/<command-id>`, the input closed throughout (`additionalProperties: false`), the 200 JSON output, and `x-dev.cellb.harness` with `id`, `name`, `source: "harness"`, `plugin` (the fragment id), `tool` (the command id), `action`, `permission: tools.use:<id>` and `route: { kind: "harness", entry: <id> }`. `ai-definitions` is not on npm yet, so the format is copied, not imported; `tests/projections.test.ts` pins its shape.

`mcpTools` gives MCP `tools/list` entries (`name`, `title`, `description`, `inputSchema`, `outputSchema` when declared, and the harness's annotations when the command also has an agent action), for every fragment or for one (`/fragments/{id}/.well-known/mcp`).

Names follow the harness's rule: `<fragment-id>__<command-id>` with every character outside `[A-Za-z0-9_-]` turned into `_`, cut to 55 characters plus `_` and an FNV-1a hash when over 64. Exposed commands whose names coincide all take the hashed form, so no name depends on the order commands arrived in; `toolByName(commands, name, "agent" | "mcp")` maps a name back, only to a command with that exposure, so a call through one projection never reaches a command exposed only to the other. Titles and descriptions come from the label of the locale asked for, then of its language, then from the operation's `summary` and `description`.

### The `keybindings` point

An extension's data is `{ key, command, when? }`, `command` naming a command's identity. `bus.keybindings()` lists the live ones with their contributor; the workbench reads them. They are not checked against the catalogue, since a binding may name a command that arrives later.

### Dependencies

- `@statewalker/kernel.core`: the activation context, `ExtensionUnavailable`, the archive type.
- `@statewalker/shared-commands`: the bus substrate.
- `@cfworker/json-schema`: JSON Schema 2020-12 validation without code generation.

## License

MIT. See [LICENSE](../../LICENSE).
