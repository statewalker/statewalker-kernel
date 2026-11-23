# fragments

The eleven core fragments of the platform (`system.commands`, `system.workbench`, `system.settings`, `system.appearance`, `system.l10n`, `system.a2ui`, `system.security`, `system.agents`, `system.fragments`, `system.host`, `system.profile`). Each fragment is a folder with its `fragment.jsonc` and its aspects (`server/`, `client/`, `agent/<plugin>/`).

So far: [system.commands](system.commands), the command bus and the `commands` and `keybindings` points, and [system.workbench](system.workbench), the `views` point and the workbench (one dockview). Each core fragment is also a private workspace package whose code the host runs when the kernel activates the fragment.

The fragment model is specified in statewalker/statewalker-root#215.
