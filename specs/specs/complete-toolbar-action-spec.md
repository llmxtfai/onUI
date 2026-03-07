# Complete Toolbar Action Spec

## Summary

Add a new in-page toolbar button labeled `Complete` that performs a single sequential workflow:

1. Copy all current annotations to the clipboard.
2. Clear all current annotations for the page.
3. Turn annotate mode off for the current tab.

This action must not disable onUI for the tab. It only exits annotate mode.

## State Model

The existing runtime model distinguishes between:

- `enabled`: onUI is active for the current tab and the floating launcher is present.
- `annotateMode`: the page is in live element-picking mode.

The new `Complete` action must leave `enabled` unchanged and set `annotateMode` to `false` only after a successful copy and clear sequence.

## Toolbar UX

The toolbar panel should contain:

- `Annotate`
- `Copy`
- `Clear`
- `Complete`
- `Settings`

The new `Complete` button belongs in the primary action group with the existing annotation actions.

### Button States

- Default label: `Complete`
- Running label: `Completing...`
- Optional short-lived success label: `Completed`
- Disabled when there are zero annotations
- Disabled while the completion sequence is running

## Completion Behavior

The action is sequential and must not run steps in parallel.

### Success Path

1. Generate the current output using the existing output-generation logic.
2. Copy it to the clipboard.
3. Clear annotations for the current page.
4. Exit annotate mode.

### Failure Rules

- If copy fails:
  - do not clear annotations
  - do not exit annotate mode
- If clear fails after a successful copy:
  - keep annotate mode unchanged
  - surface a user-visible error
- If annotate mode fails to turn off after copy and clear succeed:
  - annotations remain cleared
  - surface a user-visible error

## Ownership and Wiring

### Toolbar Responsibilities

The toolbar owns:

- rendering the new button
- loading/running/success state for that button
- copy initiation
- button-level tooltip text

### App Responsibilities

The content app owns:

- clearing annotations
- toggling annotate mode
- surfacing user-visible error messages via the existing toast mechanism

The toolbar should call an app-provided callback after a successful copy. That callback performs:

1. clear annotations
2. turn annotate mode off

## Tooltip Requirements

Use native tooltips via the `title` attribute for discoverability.

### Required Toolbar Tooltips

- Launcher toggle
- Annotate
- Copy
- Clear
- Complete
- Settings

### Additional In-Page Tooltips to Add

Add tooltips where the control meaning is not fully obvious or where the control is icon-only:

- dialog close button
- remove-target button in multi-target dialog
- error-toast dismiss button

Do not add redundant tooltips to controls whose visible label already fully describes the action unless they are part of the toolbar action cluster above.

## Accessibility

- All actions remain native `<button>` elements.
- Existing visible text labels remain the primary accessible name.
- Tooltips should not replace visible labels.
- Running state must prevent duplicate execution.

## Testing

Add or extend tests to cover:

1. Rendering of the `Complete` button.
2. `Complete` copies output and then calls the completion callback.
3. `Complete` does not call the completion callback if clipboard copy fails.
4. `Complete` is disabled when there are no annotations.
5. Toolbar action buttons expose tooltips.
6. Additional icon-only controls expose tooltips where specified.

Tests should focus on external behavior rather than implementation details.

## Out of Scope

- Disabling onUI for the tab
- Changing popup behavior
- Adding a confirmation dialog
- Changing normal `Copy` semantics
- Changing annotation data shape
