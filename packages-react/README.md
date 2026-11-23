# packages-react

React packages of the platform: the shell (`dockview-react`, shadcn, Tailwind v4), views and the A2UI renderer. Only here may code import React; `packages/` stays UI-free, and its lint fails any React import there.

The six core React packages (`ui.view.react`, `ui.view.shadcn`, `shell.view.react`, `render.view.react`, `settings.view.react`, `inline.view.react`) came from statewalker-shell-react (statewalker/statewalker-root#245) with their published names and versions. The views of integration fragments (explorer, MIME viewers, workspace, web app, AI configuration) stay in statewalker-shell-react for now.
