# system.security

## What it is

The core fragment that holds the platform's authority over who may call what. It opens the `capabilities` extension point in the client aspect, issues capabilities (Biscuit tokens, `@statewalker/webrun-biscuit`) to the principals that are not the user (agent sessions, peers, sandboxes), and is the gate of the command bus: every call such a principal makes is checked against its grants, which are deny-by-default, and against the user's Allow/Ask/Block policy, where Ask suspends the call until the user answers. The user's own calls on the bus are not restricted. It is a private workspace package, `@statewalker/system.security`, with no React, no DOM and no Node built-ins.

## Why it exists

ADR `2026-11-19-code-kinds-and-trust` (statewalker-root) gives root authority to system code only: the kernel and the core fragments hold the root keys and issue capabilities, and grants to sandboxes and agent sessions are deny-by-default, visible, and expressed in the AI harness's capability model, so agents and sandboxes share one security system. ADR `2026-11-20-kernel-and-core-fragments` gives the `capabilities` point (identity, grants, Allow/Ask/Block) to `system.security`, and ADR `2026-11-21-commands-exposures-and-agents` makes every exposure of a command go through the same capability checks, with the permission `tools.use:<fragment-id>/<command-id>`. Before this, any code holding the bus could call any command; an agent's tool call and the user's click were the same thing.

## How to use

```ts
import {
  approvalsSlot,
  capabilityRefusalsSlot,
  createSystemSecurity,
  SYSTEM_SECURITY_ID,
  systemSecurityArchive,
} from "@statewalker/system.security";
```

| Export | Provides |
| --- | --- |
| `systemSecurityArchive`, `SYSTEM_SECURITY_ID`, `CAPABILITIES_POINT` | The fragment's files (`fragment.jsonc`, `fragment.client.jsonc`), for `createKernel({ core })`. |
| `createSystemSecurity({ slots?, attended? })` → `SystemSecurity` | The fragment's code, held only by the host (system code). |
| `SystemSecurity` | `issue(principal, grant)`, `revoke(capability)`, `policy()`, `setPolicy(policy)`, `approvals()`, `answer(id, "allow" \| "deny")`, `gate`, `activate(context)`. |
| `approvalsSlot` | `system:security:approvals`: the calls waiting on the user, by approval id (`ApprovalRequest`). |
| `capabilityRefusalsSlot` | `system:security:refused`: extensions to `capabilities` refused because they are not a system fragment's static extension (`CapabilityRefusal`: `not-system-code` or `runtime-contribution`). |
| `decide(policy, tool, action)` | The policy's verdict for one call. |
| `capabilitySchema`, `PERMISSION_PATTERN` | The point's schema; the form of a permission. |
| `Principal`, `PrincipalKind`, `Grant`, `Policy`, `Verdict`, `ActionKind`, `Answer`, `SecurityRefusal` | The types; the error the gate refuses with (the `cause` of the bus's `forbidden`). |

## Examples

The host wires the gate into the bus and both fragments into the kernel:

```ts
const slots = new Slots();
const security = createSystemSecurity({ slots, attended: true }); // a shell with the user present
const commands = createSystemCommands({ gate: security.gate });
const kernel = createKernel({
  platform,
  slots,
  core: [systemCommandsArchive, systemSecurityArchive],
  activators: {
    client: (fragment, context) =>
      fragment.id === SYSTEM_COMMANDS_ID
        ? commands.activate(context)
        : fragment.id === SYSTEM_SECURITY_ID
          ? security.activate(context)
          : activateClient(fragment),
  },
});
await kernel.start();
```

System code (`system.agents` starting a session, the peer server, the sandbox broker) issues each principal its capability, and relays its calls with it:

```ts
const capability = security.issue(
  { kind: "agent", id: sessionId },
  { permissions: ["tools.use:org.example.notes/get-note", "tools.use:org.example.notes/delete-note"] },
);
security.setPolicy({ actions: { read: "allow", write: "ask", admin: "block" } });

const note = await commands.bus.call("org.example.notes/get-note", { id: "n1" }, { caller: { capability } });
const deleting = commands.bus.call("org.example.notes/delete-note", { id: "n1" }, { caller: { capability } });
// deleting waits: the approval request is in slots.getSnapshot(approvalsSlot)
```

The approvals UI follows the slot and answers through the API:

```ts
slots.observe(approvalsSlot, (requests) => {
  for (const [id, request] of requests) show(request, (answer) => security.answer(id, answer));
});
```

A holder may narrow its capability before handing it on (a sub-agent, a sandbox), never widen it:

```ts
const readOnly = Biscuit.fromBase64(capability)
  .attenuate('check if command("org.example.notes/get-note");')
  .toBase64();
```

A core fragment grants every principal of a kind a permission through the point (system code only):

```jsonc
{ "point": "capabilities", "data": { "principals": ["agent"], "permissions": ["tools.use:system.agents/ask-user"] } }
```

## Internals

### Principals and capabilities

The user is the one principal without a capability: a call without `caller` is theirs, and is not gated (system.commands, "Callers"). Every other principal is `{ kind, id }`, `kind` one of `agent` (an agent session), `peer` (a peer over HTTPeers) or `sandbox`. `issue` signs a Biscuit token with the fragment's root key (an Ed25519 key pair generated in memory by `createSystemSecurity`; it never leaves the closure): its authority block holds `principal(kind, id)`, one `right(permission)` per permission granted and, for an unattended context, `unattended(true)`. A permission is exactly `tools.use:<fragment-id>/<command-id>`; anything else is refused at issue.

The gate reads the principal from the verified token, never from the caller's word. A token signed by any other key fails verification; an attenuation block's facts are never trusted by the authorizer, so a holder can add checks (`command(...)` and `permission(...)` are the facts they may test) but no rights. Evaluating a token is bounded (`RUN_LIMITS`: 1000 facts, 100 iterations, 100 ms), since its holder writes the attenuation blocks.

`revoke(capability)` adds the token's last block's revocation id: the token is refused from then on, and so is every token narrowed from it (they carry its ids); a narrowed token can be revoked alone. The ids come from the signature chain alone, with no Datalog evaluated, so no block a holder writes can make revocation fail. Calls waiting on an approval with a revoked token are refused at once.

### The gate

For a call from a principal (`CallRequest`: the command's entry, the caller, a copy of the input), in order:

1. system.security is active (between `activate` and its cleanup); else refused;
2. the capability verifies against the root key and is not revoked;
3. the command is exposed to the principal's kind: an agent only an `agent`-exposed command, a peer only an `http`-exposed one (`mcp` implies `http`); a sandbox any command its grant names;
4. the token's rights, plus the standing grants of system code to its kind, include `tools.use:<command>` (Biscuit `allow if right({permission})`, the holder's checks applying);
5. the policy decides: Allow passes, Block is refused, Ask suspends the call. Where nobody attends (`attended: false`, the default) or the capability was issued `unattended`, Ask is refused at once with a reason. Otherwise an `ApprovalRequest` (`id`, `principal`, `command`, `action`, `permission`, `input`, `reason`; `input` a deep-frozen copy of its own, so nothing reading the slot reaches the input that runs) is published in `approvalsSlot` until `answer(id, ...)`: `allow` lets the call run, `deny` refuses it; deactivating system.security refuses every waiting call. The call is checked again for activity and revocation after the answer.

A refusal is a `SecurityRefusal`, and the bus rejects the call `forbidden` with it as `cause`.

### The policy

`Policy` is `{ actions?: { read?, write?, admin? }, tools?: { [<fragment-id>/<command-id>]: verdict } }`, each verdict `allow`, `ask` or `block`. A command's action kind is its `agent` exposure's; a command without one counts as `admin`. Of the verdicts that apply to a call (its tool's, its action kind's), the strictest wins; a call none applies to asks. The policy lives in memory until `system.profile` stores it.

### The `capabilities` point

An extension's data is `{ principals, permissions, description? }`: a standing grant of these permissions to every principal of these kinds. Only static extensions of system code are applied: those declared in the aspect file of a `system.` fragment (ids `<contributor>#<n>`; the kernel reserves the prefix for the fragments shipped with the platform). Any other is kept out and published in `capabilityRefusalsSlot` while it is live: a static extension of any other fragment as `not-system-code`, and every runtime contribution (keyed `<contributor>/<name>` in `system:extensions:contributed:*`) as `runtime-contribution`, whatever contributor it names, since a runtime contribution names its contributor itself and the kernel checks only its key's prefix.

### Correspondence with the harness (statewalker-ai `ai-access`)

`ai-access` is not on npm, so this fragment follows its model without depending on it:

| `ai-access` | here |
| --- | --- |
| Capabilities are Biscuit tokens (`capabilities.ts`); the Workspace DO's root key signs the user capability, the User DO attenuates it per agent session, a capability only narrows. | `issue` signs one token per principal with the fragment's root key; holders attenuate; attenuation never widens. |
| `AgentSessionGrant.unattended`, fixed in the capability; `settleAsk` turns an ask into a deny with a reason (`unattended.ts`). | `Grant.unattended` in the authority block; `attended: false` for the whole host; Ask refused with "nobody attends". |
| `toolRequest`: a tool's action `read` is `tools.read`, others `tools.use`; `tool:<name>` rules. | The action kind and the tool's identity are the policy's two keys; the permission is always `tools.use:<id>` (ADR `2026-11-21`). |
| Modes and rules: verdicts `allow`/`ask`/`deny`; deny beats ask beats allow; unmatched actions get the mode's `otherwise` (default `ask`) (`modes.ts`). | Verdicts `allow`/`ask`/`block`; strictest wins; unmatched asks. No modes yet: the policy is one rule layer. |
| `ApprovalRegistry`: approvals keyed by the action, answered once or for the session (`approvals.ts`). | `approvalsSlot` plus `answer(id)`, answered once; no session-scoped answers yet. |

### Threat model

**What is protected:** the commands of every fragment, from principals that are not the user: agent sessions (and the models driving them), peers on the mesh, and sandboxed code. **From whom:** a principal calling commands it was not granted, or that the user blocked or did not approve; a principal forging, widening or replaying a revoked capability; a fragment trying to grant capabilities; a principal changing a call's input after the user approved it. **How**, with the tests that check each property:

| Property | How | Tests |
| --- | --- | --- |
| Grants are deny-by-default | A capability grants only the permissions named at issue; none by default; a command not named is refused. | `gate.test.ts` "grants are deny-by-default" |
| Only system code issues | The root key lives in `createSystemSecurity`'s closure, held by the host; a token signed by any other key is refused; a contribution to `capabilities` that is not a system fragment's static extension (including a runtime contribution claiming a system contributor) is refused, published and grants nothing. | `issuing.test.ts` "only system code issues capabilities", "the capabilities point", "a runtime contribution to the capabilities point" |
| Capabilities only narrow | Biscuit: facts in attenuation blocks are not trusted by the authorizer; checks are. | `issuing.test.ts` "lets a holder narrow its capability, never widen it" |
| Exposures bound principals | Agents reach only `agent`-exposed commands, peers only `http`-exposed ones, whatever they are granted. | `gate.test.ts` "exposures" |
| The user's policy decides | Block refuses; the strictest applying verdict wins; unmatched asks. | `policy.test.ts` "Block", "Ask" |
| Ask never auto-allows | Ask suspends until `answer`; headless and unattended capabilities are refused at once; deactivation refuses the waiting calls. | `policy.test.ts` "Ask" |
| Revocation | Revoked tokens and tokens narrowed from them are refused, also when revoked while waiting on an approval; revocation never evaluates the holder's Datalog. | `gate.test.ts` "revocation", "revoking an issued capability", "revoking a token whose holder's Datalog exceeds the evaluation limits"; `policy.test.ts` "an approved call" |
| Fail-closed wiring | A bus without a gate refuses every principal's call; an inactive system.security refuses too. | system.commands `bus.test.ts` "callers other than the user"; `fragment.test.ts` |
| What was approved is what runs | The bus clones the input before the gate and runs that clone; the approval request publishes a separate deep-frozen copy. | system.commands `bus.test.ts` "a gated call's input"; `policy.test.ts` "an approval request's input" |
| The user is not restricted | Calls without a caller never reach the gate. | `policy.test.ts` "the user's own calls"; system.commands `bus.test.ts` "the user's own calls" |

**Not covered yet:**

- **Fragments are trusted.** A fragment's client half has the shell origin's full authority (ADR `2026-11-19`): it can call the bus as the user. The gate protects against principals that reach the bus through system code that relays them with their capability, not against installed fragment code. Wiring the `command` reference resolver with a caller is left to the host.
- **The root key is ephemeral.** It is generated in memory, so capabilities do not survive a restart, and no other runtime (a server half, a peer) can verify them. Keeping it in the vault (`system.profile`) and sharing a public key come later.
- **No expiry and no audit.** Tokens carry no time limit; refusals and answers are not logged. Revocations are kept in memory.
- **Peers are not authenticated here.** A peer's identity is whatever system code issued its capability to; binding it to an HTTPeers identity (third-party blocks) is the peer server's work.
- **Inputs in approval requests** are published as a frozen copy, for the approvals UI to show; they are not redacted, so a command whose input holds secrets would show them there. Agents never get secret values (ADR `2026-11-20`). An input holding a typed array cannot be frozen, so a call with one is refused when it asks.
- **Policy storage and modes.** The policy lives in memory; the harness's modes, "approve for this session" and auto mode's classifier are not carried over.

### Dependencies

- `@statewalker/kernel.core`: the activation context, `isSystemId`, the archive type.
- `@statewalker/system.commands`: the gate's contract (`CallGate`, `CallRequest`) and `toolPermission`.
- `@statewalker/webrun-biscuit`: capability tokens (pure TypeScript, no Node built-ins).
- `@statewalker/shared-slots`: the published approvals and refusals.

## License

MIT. See [LICENSE](../../LICENSE).
