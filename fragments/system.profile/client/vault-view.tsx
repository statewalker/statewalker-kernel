import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@statewalker/ui.view.shadcn";
import { type ComponentType, type FormEvent, useEffect, useId, useState } from "react";
import type { Vault, VaultState } from "../src/index.js";

/** A message the person sees: an error's own message (the model's never hold a secret). */
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong; nothing changed.";

/**
 * The vault view: create the vault, unlock it with the password or a passkey (optionally
 * remembered on this device), lock it, forget the remembered key, add or remove passkeys. An
 * unreadable vault shows why and offers nothing that would write it. No secret is ever shown.
 */
export function VaultView({ vault }: { vault: Vault }) {
  const [state, setState] = useState<VaultState>(() => vault.state());
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [passkeys, setPasskeys] = useState(false);
  // "Remember on this device": one choice for the password form and the passkey button.
  const [remember, setRemember] = useState(false);
  useEffect(() => vault.observe((next) => setState(next)), [vault]);
  useEffect(() => {
    let live = true;
    vault.passkeysAvailable().then(
      (available) => live && setPasskeys(available),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [vault]);

  /** Run an action, showing its refusal (`false`) or its error; the fields are cleared after. */
  async function run(action: () => Promise<unknown>, refused?: string) {
    setBusy(true);
    setProblem(undefined);
    try {
      const done = await action();
      if (done === false && refused) setProblem(refused);
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="vault-view"
      data-status={state.status}
      className="flex flex-col gap-4 overflow-auto p-4"
    >
      <Card>
        <CardHeader>
          <CardTitle>Vault</CardTitle>
          <CardDescription>
            Secrets kept encrypted in your profile on this device, opened with your password or a
            passkey.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p data-testid="vault-status" className="m-0 text-sm">
            {statusText(state)}
          </p>
          {state.status === "corrupt" && state.reason && (
            <p data-testid="vault-reason" role="alert" className="m-0 text-sm text-destructive">
              {state.reason.message} The vault stays locked and is left as it is.
            </p>
          )}
          {state.status === "absent" && (
            <PasswordForm
              action="Create the vault"
              confirm
              busy={busy}
              remember={remember}
              setRemember={setRemember}
              onSubmit={(password, remember) => run(() => vault.create(password, { remember }))}
            />
          )}
          {state.status === "locked" && (
            <>
              <PasswordForm
                action="Unlock"
                busy={busy}
                remember={remember}
                setRemember={setRemember}
                onSubmit={(password, remember) =>
                  run(() => vault.unlock(password, { remember }), "Wrong password.")
                }
              />
              {passkeys && state.passkeys.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => vault.unlockWithPasskey({ remember }),
                      "This passkey doesn't unlock this vault.",
                    )
                  }
                >
                  Unlock with a passkey
                </Button>
              )}
            </>
          )}
          {state.status === "unlocked" && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => vault.lock()}>
                Lock
              </Button>
            </div>
          )}
          {state.remembered && (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-sm text-muted-foreground">
                The vault's key is remembered on this device: it unlocks when the app starts.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => vault.forget())}
              >
                Forget on this device
              </Button>
            </div>
          )}
          {state.notice && (
            <p
              data-testid="vault-notice"
              role="status"
              className="m-0 text-sm text-muted-foreground"
            >
              {state.notice}
            </p>
          )}
          {problem && (
            <p data-testid="vault-problem" role="alert" className="m-0 text-sm text-destructive">
              {problem}
            </p>
          )}
        </CardContent>
      </Card>
      {state.status === "unlocked" && (
        <PasskeysCard vault={vault} state={state} available={passkeys} busy={busy} run={run} />
      )}
    </div>
  );
}

function statusText(state: VaultState): string {
  switch (state.status) {
    case "absent":
      return "There is no vault yet. Choose a password to create it.";
    case "locked":
      return "The vault is locked.";
    case "unlocked":
      return "The vault is unlocked.";
    case "corrupt":
      return "The vault cannot be opened.";
  }
}

function PasswordForm({
  action,
  confirm = false,
  busy,
  remember,
  setRemember,
  onSubmit,
}: {
  action: string;
  confirm?: boolean;
  busy: boolean;
  remember: boolean;
  setRemember: (remember: boolean) => void;
  onSubmit: (password: string, remember: boolean) => Promise<void>;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const mismatch = confirm && again !== "" && again !== password;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch) return;
    const given = password;
    setPassword("");
    setAgain("");
    await onSubmit(given, remember);
  }
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-password`}>Password</Label>
        <Input
          id={`${id}-password`}
          type="password"
          autoComplete={confirm ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {confirm && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-again`}>Password again</Label>
          <Input
            id={`${id}-again`}
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
          {mismatch && <p className="m-0 text-sm text-destructive">The passwords differ.</p>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          id={`${id}-remember`}
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <Label htmlFor={`${id}-remember`}>Remember on this device</Label>
      </div>
      <div>
        <Button type="submit" disabled={busy || password === "" || (confirm && again !== password)}>
          {action}
        </Button>
      </div>
    </form>
  );
}

function PasskeysCard({
  vault,
  state,
  available,
  busy,
  run,
}: {
  vault: Vault;
  state: VaultState;
  available: boolean;
  busy: boolean;
  run: (action: () => Promise<unknown>, refused?: string) => Promise<void>;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  return (
    <Card data-testid="vault-passkeys">
      <CardHeader>
        <CardTitle>Passkeys</CardTitle>
        <CardDescription>
          {available
            ? "A passkey unlocks the vault without the password."
            : "This browser can't use passkeys to unlock; use the password."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.passkeys.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {state.passkeys.map((passkey) => (
              <li key={passkey.credentialId} className="flex items-center gap-2 text-sm">
                <span className="flex-1">Passkey added {passkey.createdAt.slice(0, 10)}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => run(() => vault.removePasskey(passkey.credentialId))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {available && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const given = password;
              setPassword("");
              void run(() => vault.addPasskey(given), "Wrong password.");
            }}
          >
            <Label htmlFor={`${id}-password`}>Password, to add a passkey</Label>
            <Input
              id={`${id}-password`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div>
              <Button type="submit" disabled={busy || password === ""}>
                Add a passkey
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** The fragment's client module, bound to the vault: what its references (`./index.js`) name. */
export function vaultModule(vault: Vault): Record<string, unknown> {
  const View: ComponentType = () => <VaultView vault={vault} />;
  return { VaultView: View };
}
