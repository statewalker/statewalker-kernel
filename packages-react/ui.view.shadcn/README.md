# @statewalker/ui.view.shadcn

## What it is

A packaged set of [shadcn/ui](https://ui.shadcn.com/) components (Radix-based
React primitives: Button, Dialog, AlertDialog, Card, Tabs, Select, Input,
Textarea, Label, Separator, ScrollArea, Collapsible, Tooltip, Avatar and the
`Resizable*` panel wrappers) plus the `cn()` class-merging helper.

## Why it exists

shadcn/ui components are normally copied into each app's
`src/components/ui`. Here they are one package, so every view package in the
shell imports the same primitives and a fix lands everywhere at once. The
package owns no slots and no commands.

## How to use

```sh
pnpm add @statewalker/ui.view.shadcn
```

Peer dependencies: `react` and `react-dom` (`>=18`). The host needs Tailwind v4.

| Import | Provides |
| --- | --- |
| `@statewalker/ui.view.shadcn` | The components and `cn()`; the default export is the fragment init |
| `@statewalker/ui.view.shadcn/fragment` | Default export: an `init(ctx)` that does nothing and returns a no-op cleanup |
| `@statewalker/ui.view.shadcn/styles` | `src/styles.css`: Tailwind v4 `@source` globs for the classes used in this package |

Import the stylesheets once at boot. The theme variables come from
`@statewalker/ui.view.react`:

```ts
import "@statewalker/ui.view.react/styles";
import "@statewalker/ui.view.shadcn/styles";
```

## Examples

### Button and Dialog

```tsx
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@statewalker/ui.view.shadcn";

<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline" size="sm">Open</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Settings</DialogTitle>
    </DialogHeader>
  </DialogContent>
</Dialog>;
```

`buttonVariants` (`class-variance-authority`): `variant` is one of
`default | destructive | outline | secondary | ghost | link`; `size` is one of
`default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg`. `asChild`
renders through a Radix `Slot`.

### Resizable panels

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@statewalker/ui.view.shadcn";

<ResizablePanelGroup orientation="horizontal">
  <ResizablePanel defaultSize="20%" minSize="180px">{sidebar}</ResizablePanel>
  <ResizableHandle />
  <ResizablePanel>{main}</ResizablePanel>
</ResizablePanelGroup>;
```

`ResizablePanelGroup` wraps `react-resizable-panels`' `Group`,
`ResizablePanel` is its `Panel`, `ResizableHandle` wraps its `Separator`.
Props are the library's (v4).

### `cn()`

```ts
import { cn } from "@statewalker/ui.view.shadcn";

cn("px-2 py-1", isActive && "bg-background", "px-3"); // "py-1 bg-background px-3"
```

`cn` is `twMerge(clsx(...))`: `clsx` resolves conditionals, `tailwind-merge`
drops conflicting utilities so the last one wins.

### Full export list

`cn`; `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`,
`AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`,
`AlertDialogHeader`, `AlertDialogOverlay`, `AlertDialogPortal`,
`AlertDialogTitle`, `AlertDialogTrigger`; `Avatar`, `AvatarFallback`,
`AvatarImage`; `Button`, `buttonVariants`; `Card`, `CardContent`,
`CardDescription`, `CardFooter`, `CardHeader`, `CardTitle`; `Collapsible`,
`CollapsibleContent`, `CollapsibleTrigger`; `Dialog`, `DialogClose`,
`DialogContent`, `DialogDescription`, `DialogFooter`, `DialogHeader`,
`DialogOverlay`, `DialogPortal`, `DialogTitle`, `DialogTrigger`; `Input`;
`Label`; `ResizableHandle`, `ResizablePanel`, `ResizablePanelGroup`;
`ScrollArea`, `ScrollBar`; `Select`, `SelectContent`, `SelectGroup`,
`SelectItem`, `SelectLabel`, `SelectScrollDownButton`, `SelectScrollUpButton`,
`SelectSeparator`, `SelectTrigger`, `SelectValue`; `Separator`; `Tabs`,
`TabsContent`, `TabsList`, `TabsTrigger`; `Textarea`; `Tooltip`,
`TooltipContent`, `TooltipProvider`, `TooltipTrigger`.

## Internals

### Components are colorless without the substrate theme

Components use semantic tokens (`bg-primary`, `text-muted-foreground`,
`border`, `ring`). Their values are CSS variables defined in
`@statewalker/ui.view.react/styles`, not here. Without that stylesheet the
components render, but with no colors, borders or focus rings.

### Classes missing from the host CSS

Tailwind v4 only emits classes it finds in scanned sources. If the host does
not import `@statewalker/ui.view.shadcn/styles` (or otherwise add an `@source`
for this package), components appear unstyled even though the theme is loaded.

### Local extensions

The components follow upstream shadcn/ui. The extra `Button` sizes `xs`,
`icon-xs`, `icon-sm`, `icon-lg` are added for dense UI such as dock tabs.

### Dependencies

- `@radix-ui/*`, `radix-ui` — accessible behavior behind each primitive.
- `react-resizable-panels` — the `Resizable*` wrappers.
- `class-variance-authority` — `buttonVariants` and other variants.
- `clsx`, `tailwind-merge` — `cn()`.
- `lucide-react` — icons inside some primitives.
- `@statewalker/shared-registry` — declared but not imported by the source.

## License

MIT
