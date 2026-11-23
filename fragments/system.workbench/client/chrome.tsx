// The workbench's chrome around the dock: the menu bar, the activity bar, the status bar, the
// command palette, and the hosts of the dialogs and notifications fragments raise. Each renders
// the React-free model (../src), so every fragment's contributions look the same.
import {
  Button,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Menubar,
  MenubarContent,
  MenubarMenu,
  MenubarTrigger,
  toast,
} from "@statewalker/ui.view.shadcn";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  type DialogRequest,
  formatChord,
  type NotificationRequest,
  type WhenContext,
  type Workbench,
} from "../src/index.js";
import { MenuEntries, menubarFamily } from "./menus.js";

/** The menu bar: one menu per submenu contributed to `menubar`. */
export function MenuBar({ workbench, context }: { workbench: Workbench; context: WhenContext }) {
  const run = (command: string) => void workbench.execute(command);
  return (
    <Menubar className="h-9 rounded-none border-0 border-b shadow-none">
      {workbench.menu("menubar", context).map((node) =>
        node.kind === "submenu" ? (
          <MenubarMenu key={node.key}>
            <MenubarTrigger>{node.title}</MenubarTrigger>
            <MenubarContent>
              <MenuEntries nodes={node.children} family={menubarFamily} run={run} />
            </MenubarContent>
          </MenubarMenu>
        ) : null,
      )}
    </Menubar>
  );
}

/** The activity bar: entries opening a view or running a command. */
export function ActivityBar({ workbench }: { workbench: Workbench }) {
  return (
    <nav
      data-testid="activitybar"
      aria-label={workbench.text("activitybar.label", "Activity bar")}
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-muted py-2"
    >
      {workbench.activitybar().map((item) => (
        <Button
          key={item.id}
          variant="ghost"
          size="icon"
          aria-label={item.title}
          title={item.title}
          onClick={() => {
            if (item.view) {
              workbench.open(item.view);
              workbench.setActive(item.view);
            } else if (item.command) void workbench.execute(item.command);
          }}
        >
          <span aria-hidden="true" className="text-sm font-semibold">
            {item.title.slice(0, 1).toUpperCase()}
          </span>
        </Button>
      ))}
    </nav>
  );
}

/** The status bar: items on the left and the right, a click running an item's command. */
export function StatusBar({ workbench, context }: { workbench: Workbench; context: WhenContext }) {
  const items = workbench.statusbar(context);
  const side = (alignment: "left" | "right") =>
    items
      .filter((item) => item.alignment === alignment)
      .map((item) =>
        item.command ? (
          <button
            key={item.id}
            type="button"
            title={item.tooltip}
            className="rounded-sm px-2 hover:bg-accent hover:text-accent-foreground"
            onClick={() => item.command && void workbench.execute(item.command)}
          >
            {item.text}
          </button>
        ) : (
          <span key={item.id} title={item.tooltip} className="px-2">
            {item.text}
          </span>
        ),
      );
  return (
    <footer
      data-testid="statusbar"
      className="flex h-6 shrink-0 items-center border-t bg-muted text-xs text-muted-foreground"
    >
      <div className="flex items-center">{side("left")}</div>
      <div className="ml-auto flex items-center">{side("right")}</div>
    </footer>
  );
}

/** The command palette: every command on the bus by its label, run on select. */
export function Palette({
  workbench,
  open,
  onOpenChange,
}: {
  workbench: Workbench;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={workbench.text("palette.placeholder", "Type a command…")} />
      <CommandList>
        <CommandEmpty>{workbench.text("palette.empty", "No commands found.")}</CommandEmpty>
        {open &&
          workbench.palette().map((entry) => (
            <CommandItem
              key={entry.command}
              value={entry.command}
              keywords={[entry.title]}
              title={entry.description}
              onSelect={() => {
                onOpenChange(false);
                void workbench.execute(entry.command);
              }}
            >
              {entry.title}
              {entry.keybinding && (
                <CommandShortcut>{formatChord(entry.keybinding)}</CommandShortcut>
              )}
            </CommandItem>
          ))}
      </CommandList>
    </CommandDialog>
  );
}

/** The oldest dialog waiting for an answer; closing it answers with no action. */
export function DialogHost({
  workbench,
  dialogs,
}: {
  workbench: Workbench;
  dialogs: readonly DialogRequest[];
}) {
  const request = dialogs[0];
  if (!request) return null;
  return <RequestDialog key={request.request} workbench={workbench} request={request} />;
}

function RequestDialog({ workbench, request }: { workbench: Workbench; request: DialogRequest }) {
  const [value, setValue] = useState(request.input?.value ?? "");
  const inputId = useId();
  const primary = request.actions.find((a) => a.primary) ?? request.actions[0];
  const answer = (action?: string) =>
    workbench.dialogs.answer(
      request.request,
      action === undefined ? {} : { action, ...(request.input ? { value } : {}) },
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (primary) answer(primary.id);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && answer()}>
      <DialogContent data-testid="dialog" data-fragment={request.fragment}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
            {request.message !== undefined && (
              <DialogDescription>{request.message}</DialogDescription>
            )}
          </DialogHeader>
          {request.input && (
            <div className="grid gap-2">
              <Label htmlFor={inputId}>{request.input.label}</Label>
              <Input
                id={inputId}
                autoFocus
                placeholder={request.input.placeholder}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            {request.actions.map((action) =>
              action === primary ? (
                <Button key={action.id} type="submit">
                  {action.label}
                </Button>
              ) : (
                <Button
                  key={action.id}
                  type="button"
                  variant="outline"
                  onClick={() => answer(action.id)}
                >
                  {action.label}
                </Button>
              ),
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const toastId = (request: number) => `notification-${request}`;

/**
 * Shows each notification waiting for an answer as a Sonner toast, rendered by one component for
 * every fragment. A notification with actions stays until answered or dismissed; one without
 * closes by itself. Dismissing answers with no action; one answered elsewhere, or whose fragment
 * left, is taken down.
 */
export function NotificationHost({
  workbench,
  notifications,
}: {
  workbench: Workbench;
  notifications: readonly NotificationRequest[];
}) {
  /** The notifications shown, by request, as last rendered. */
  const shown = useRef(new Map<number, NotificationRequest>());
  useEffect(() => {
    const live = new Set(notifications.map((n) => n.request));
    for (const request of shown.current.keys()) {
      if (live.has(request)) continue;
      shown.current.delete(request);
      toast.dismiss(toastId(request));
    }
    for (const notification of notifications) {
      const before = shown.current.get(notification.request);
      if (before === notification) continue;
      shown.current.set(notification.request, notification);
      if (before) {
        // Its texts changed (the interface language): the same toast, re-rendered.
        toast.custom(() => <NotificationCard workbench={workbench} notification={notification} />, {
          id: toastId(notification.request),
        });
        continue;
      }
      const dismissed = () => workbench.notifications.answer(notification.request, {});
      toast.custom(() => <NotificationCard workbench={workbench} notification={notification} />, {
        id: toastId(notification.request),
        duration: notification.actions.length > 0 ? Number.POSITIVE_INFINITY : 6000,
        onDismiss: dismissed,
        onAutoClose: dismissed,
      });
    }
  }, [workbench, notifications]);
  return null;
}

const SEVERITY_ACCENT: Record<NotificationRequest["severity"], string> = {
  info: "border-l-primary",
  success: "border-l-primary",
  warning: "border-l-destructive",
  error: "border-l-destructive",
};

function NotificationCard({
  workbench,
  notification,
}: {
  workbench: Workbench;
  notification: NotificationRequest;
}) {
  const answer = (action?: string) => {
    workbench.notifications.answer(notification.request, action === undefined ? {} : { action });
    toast.dismiss(toastId(notification.request));
  };
  return (
    <div
      data-testid="notification"
      data-severity={notification.severity}
      data-fragment={notification.fragment}
      role={notification.severity === "error" ? "alert" : "status"}
      className={`flex w-[356px] items-start gap-3 rounded-md border border-l-4 bg-popover p-4 text-sm text-popover-foreground shadow-lg ${SEVERITY_ACCENT[notification.severity]}`}
    >
      <div className="grid flex-1 gap-1">
        <p className="m-0 font-medium">{notification.title}</p>
        {notification.message !== undefined && (
          <p className="m-0 text-muted-foreground">{notification.message}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {notification.actions.map((action) => (
          <Button key={action.id} size="sm" variant="outline" onClick={() => answer(action.id)}>
            {action.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          aria-label={workbench.text("notification.dismiss", "Dismiss")}
          onClick={() => answer()}
        >
          ×
        </Button>
      </div>
    </div>
  );
}
