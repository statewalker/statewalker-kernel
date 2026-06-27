# Implementation map — (root)

## Files

### src/adapters.ts
- symbols: fn getCommands, fn setCommands, fn removeCommands
- deps (external): @statewalker/shared-commands, @statewalker/workspace.core

### src/commands/copy-to-clipboard/index.ts
- symbols: const COPY_TO_CLIPBOARD_COMMAND_KEY, interface CopyToClipboardPayload, const CopyToClipboardCommand
- deps (external): @statewalker/shared-commands

### src/commands/download-blob/index.ts
- symbols: const DOWNLOAD_BLOB_COMMAND_KEY, interface DownloadBlobPayload, const DownloadBlobCommand
- deps (external): @statewalker/shared-commands

### src/commands/download-to-files/index.ts
- symbols: const DOWNLOAD_TO_FILES_COMMAND_KEY, interface DownloadProgress, interface DownloadToFilesPayload, interface DownloadToFilesResult, const DownloadToFilesCommand
- deps (external): @statewalker/shared-commands, @statewalker/webrun-files

### src/commands/index.ts

### src/commands/pick-directory/index.ts
- symbols: const PICK_DIRECTORY_COMMAND_KEY, interface PickDirectoryPayload, interface PickDirectoryResult, const PickDirectoryCommand
- deps (external): @statewalker/shared-commands, @statewalker/webrun-files

### src/commands/pick-file/index.ts
- symbols: const PICK_FILE_COMMAND_KEY, interface PickFilePayload, interface PickFileResult, const PickFileCommand
- deps (external): @statewalker/shared-commands

### src/commands/preference-get/index.ts
- symbols: const PREFERENCE_GET_COMMAND_KEY, interface PreferenceGetPayload, interface PreferenceGetResult, const PreferenceGetCommand
- deps (external): @statewalker/shared-commands

### src/commands/preference-set/index.ts
- symbols: const PREFERENCE_SET_COMMAND_KEY, interface PreferenceSetPayload, const PreferenceSetCommand
- deps (external): @statewalker/shared-commands

### src/errors.ts
- symbols: class UserCancelledError, fn isUserCancelled

### src/index.ts

### src/url-state-view.ts
- symbols: interface UrlState, interface UrlSerializer, class Navigation
- deps (external): @statewalker/shared-adapters, @statewalker/shared-baseclass

<!-- carve:skeleton abd9206c -->
