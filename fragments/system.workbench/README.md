# system.workbench

## What it is

The core fragment that owns the workbench. It opens the `views` extension point in its client aspect, keeps the workbench model (which views fragments contribute, which are open), and its client half renders that model as one dockview (`dockview-react`) styled with the shadcn tokens. It is a private workspace package, `@statewalker/system.workbench`, in two halves: `src/` (React-free, tested in Node at seam 1; `lint:check` fails a React import or a `.tsx` file there) and `client/` (React, the fragment's default client folder).

So far it opens only `views`. The other points ADR `2026-11-20-kernel-and-core-fragments` gives it (`menus`, `notifications`, `dialogs`, `statusbar`, `activitybar`, layouts per device mode) come with their tickets (statewalker/statewalker-root#253, #254).

## Why it exists

ADR `2026-11-18-react-only-shell-with-shared-modules` makes the shell React only, one dockview with shadcn, sharing React, shadcn, dockview and the client API through an import map, with prebuilt CSS per fragment and no preflight. ADR `2026-11-20-kernel-and-core-fragments` puts the workbench's points in this fragment. A view is data in a fragment's `fragment.client.jsonc` (an id and a title) with its React component as the lazy reference, so the workbench lists views before their code loads, and a view leaves with its fragment.

## How to use

```ts
import {
  createSystemWorkbench,
  SYSTEM_WORKBENCH_ID,
  systemWorkbenchArchive,
  WorkbenchError,
} from "@statewalker/system.workbench";
import { WorkbenchView } from "@statewalker/system.workbench/client"; // React
import "@statewalker/system.workbench/theme.css"; // the token values, once per page
import "@statewalker/system.workbench/client.css"; // the workbench's prebuilt CSS
```

| Export | Provides |
| --- | --- |
| `systemWorkbenchArchive`, `SYSTEM_WORKBENCH_ID` | The fragment's files (`fragment.jsonc`, `fragment.client.jsonc`), for `createKernel({ core })`. |
| `createSystemWorkbench()` → `{ workbench, activate }` | The model, and the body of the fragment's client activator. |
| `Workbench` | `views()`, `view(id)`, `opened()`, `open(id)`, `close(id)`, `observe(listener)`. |
| `ViewEntry`, `WorkbenchState` | A view (`id`, `viewId`, `fragment`, `title`, `extension`, `component()`); the views and the open ones. |
| `WorkbenchError` | `unknown-view` (opening a view nobody contributes), `no-component`. |
| `viewSchema`, `VIEWS_POINT` | The point's schema (JSON Schema 2020-12) and short id. |
| `./client`: `WorkbenchView` | The React component rendering a `Workbench` as one dockview. |
| `./client.css`, `./theme.css`, `./tokens.css` | The prebuilt CSS; the shadcn token values (light, `.dark`); the tokens as Tailwind theme variables, for fragments' CSS. |

## Examples

A fragment contributes a view in its `fragment.client.jsonc`, with no `requires` on system.workbench:

```jsonc
{
  "$schema": "./node_modules/@statewalker/kernel.core/schemas/fragment-aspect.v1.schema.json",
  "extensions": [
    {
      "point": "views",
      "data": { "id": "notes", "title": "Notes" },
      "reference": { "module": "./index.js", "export": "NotesView" }
    }
  ]
}
```

The host runs the fragment and renders it:

```tsx
const workbench = createSystemWorkbench();
const kernel = createKernel({
  platform,
  core: [systemCommandsArchive, systemWorkbenchArchive],
  resolvers: { module: (ref, { contributor }) => importExport(contributor, ref) },
  activators: {
    client: (fragment, context) =>
      fragment.id === SYSTEM_WORKBENCH_ID ? workbench.activate(context) : activateClient(fragment),
  },
});
await kernel.start();
createRoot(element).render(<WorkbenchView workbench={workbench.workbench} />);
workbench.workbench.open("org.statewalker.notes/notes");
```

A fragment's CSS is compiled against the tokens, without preflight:

```css
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities) source(none);
@import "@statewalker/system.workbench/tokens.css";
@source "./";
```

## Internals

### The `views` point

An extension's data is `{ id, title }`: `id` is unique within the contributing fragment (lowercase letters and digits with inner hyphens, at most 64), and the view's identity is `<fragment-id>/<id>`. The reference is the view's React component (a client module export); `ViewEntry.component()` resolves it through the kernel, so it rejects with `ExtensionUnavailable` once the contributor is gone. Data that breaks the schema is refused by the kernel with a reason in `system:extensions:refused:client`. When one fragment declares the same view id twice, the first extension read wins.

### The model

The model follows the `views` point through the activation context, so a view lives exactly while its fragment is resolved. `open(id)` appends a contributed view to the open ones (a view already open stays where it is); `close(id)` removes it. A view that leaves (its fragment disabled or removed) is closed too, and the rest stays as it was; re-enabling the fragment brings its view back to the list, closed. Deactivating system.workbench empties the model. `observe` is called at once and after each change.

### The client half

`WorkbenchView` renders one `DockviewReact` whose panels are the open views: a newly opened view gets a panel titled with the view's title, a closed one loses its panel, and a panel the user closes closes its view. A panel resolves its view's component and renders it inside an error boundary, so a view that fails to load or throws shows its error in its panel and nothing else. React context crosses into panels (dockview renders them through portals).

dockview's light theme takes its colours from the shadcn tokens (`.dockview-theme-workbench` in `client/styles.css`). The prebuilt `dist/client.css` holds dockview's stylesheet and the utilities the client half uses, compiled with the Tailwind CLI against `tokens.css`, without preflight. `theme.css` holds the token values and the page's base rules; it is plain CSS the shell loads once (branding will set the values).

### Dependencies

- `@statewalker/kernel.core`: the activation context, the archive type.
- `dockview-react`, and `react`/`react-dom` as peers: the client half, shared by the shell's import map in a browser.

## License

MIT. See [LICENSE](../../LICENSE).
