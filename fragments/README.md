# fragments

The eleven core fragments of the platform (`system.commands`, `system.workbench`, `system.settings`, `system.appearance`, `system.l10n`, `system.a2ui`, `system.security`, `system.agents`, `system.fragments`, `system.host`, `system.profile`). Each fragment is a folder with its `fragment.jsonc` and its aspects (`server/`, `client/`, `agent/<plugin>/`).

So far: [system.commands](system.commands), the command bus and the `commands` and `keybindings` points; [system.workbench](system.workbench), the `views`, `menus`, `notifications`, `dialogs`, `statusbar` and `activitybar` points and the workbench (menu bar, context menus, palette, keyboard shortcuts, dialogs, notifications and bars around one dockview); and [system.security](system.security), the `capabilities` point, the capabilities only system code issues, and the gate of calls from agents, peers and sandboxes (grants and the user's Allow/Ask/Block policy). Each core fragment is also a private workspace package whose code the host runs when the kernel activates the fragment.

The fragment model is specified in statewalker/statewalker-root#215.
