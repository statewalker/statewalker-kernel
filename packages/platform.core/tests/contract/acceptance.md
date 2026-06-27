# platform.core — acceptance criteria

Black-box contract for `@statewalker/platform.core`. Authored in OpenSpec grammar; each
`#### Scenario:` is referenced from a contract test by an `[AC: <scenario>]` tag.

## Requirements

### Requirement: User-cancellation signalling

The package SHALL expose `UserCancelledError` (a named `Error` subclass) and the
`isUserCancelled` type guard so callers can distinguish a deliberate user cancellation from
a real failure.

#### Scenario: UserCancelledError carries name and message

- **WHEN** a `UserCancelledError` is constructed with or without a message
- **THEN** it is an `Error`, its `name` is `"UserCancelledError"`, and its message is the
  given one or the default

#### Scenario: isUserCancelled discriminates cancellation

- **WHEN** `isUserCancelled` is given a `UserCancelledError`, a plain `Error`, `null`, or `undefined`
- **THEN** it returns `true` only for the `UserCancelledError`

### Requirement: URL state view aggregation

The package SHALL expose `UrlStateView` with `UrlSerializer`/`UrlState` so multiple serializers
can build a single URL state and apply incoming URLs, with re-entrancy protection.

#### Scenario: serializers build and dispose

- **WHEN** a `UrlSerializer` is registered and later disposed
- **THEN** `buildState()` reflects it while registered and drops it after disposal

#### Scenario: serializers run in registration order

- **WHEN** several serializers are registered
- **THEN** `buildState()` applies them in registration order

#### Scenario: sync and applyUrl are loop-protected

- **WHEN** `sync()` triggers `applyUrl()` (or vice-versa) re-entrantly
- **THEN** the re-entrant call is suppressed

### Requirement: Workspace-bound commands shim

The package SHALL expose `getCommands` returning the workspace-bound command bus, with
`setCommands`/`removeCommands` retained as deprecated no-ops.

#### Scenario: getCommands returns the workspace bus

- **WHEN** `getCommands(ctx)` is called
- **THEN** it returns the same `Commands` instance as the workspace adapter, stable per `ctx`

#### Scenario: setCommands and removeCommands are deprecated no-ops

- **WHEN** `setCommands` or `removeCommands` is called
- **THEN** the workspace-bound bus is unchanged and a deprecation warning is emitted
