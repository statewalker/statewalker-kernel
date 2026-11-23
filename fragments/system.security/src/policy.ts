// The user's Allow/Ask/Block policy, on the harness's modes (statewalker-ai `ai-access`,
// `modes.ts`): a verdict per tool and per action kind; of the verdicts that apply to a call the
// strictest wins (block beats ask, ask beats allow), and a call none applies to asks.

/** What the user decided for a tool or an action kind. */
export type Verdict = "allow" | "ask" | "block";

/** An action kind, as a command's `agent` exposure declares it. */
export type ActionKind = "read" | "write" | "admin";

export interface Policy {
  /** A verdict per action kind. */
  readonly actions?: Partial<Record<ActionKind, Verdict>>;
  /** A verdict per tool, by its identity `<fragment-id>/<command-id>`. */
  readonly tools?: Readonly<Record<string, Verdict>>;
}

export interface PolicyDecision {
  readonly verdict: Verdict;
  readonly reason: string;
}

const STRICTNESS: readonly Verdict[] = ["block", "ask", "allow"];

/** The verdict of a call to the tool `tool` of kind `action` under `policy`. */
export function decide(policy: Policy, tool: string, action: ActionKind): PolicyDecision {
  const applying: { verdict: Verdict; reason: string }[] = [];
  const own = Object.hasOwn(policy.tools ?? {}, tool) ? policy.tools?.[tool] : undefined;
  if (own && STRICTNESS.includes(own))
    applying.push({ verdict: own, reason: `the policy's ${own} for ${tool}` });
  const kind = policy.actions?.[action];
  if (kind && STRICTNESS.includes(kind))
    applying.push({ verdict: kind, reason: `the policy's ${kind} for ${action} actions` });
  for (const verdict of STRICTNESS) {
    const found = applying.find((a) => a.verdict === verdict);
    if (found) return found;
  }
  return { verdict: "ask", reason: `no policy for ${tool} or ${action} actions` };
}
