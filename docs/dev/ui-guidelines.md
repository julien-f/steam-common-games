# UI guidelines

How the UI should behave where [journeys.md](journeys.md) and the feature docs are silent; what `ux-review` judges taste against. Conventions, not hard rules: a design that breaks one says why in [frontend.md](frontend.md).

## Principles

- One way to do each thing; a second path is a shortcut to the same action, not a variant. A control that states a fact also acts on it (the Updated tile refreshes) instead of a separate button doing so.
- Every state the user can reach, they can leave: an active filter, sort, group, shared view or selection is visible and undone in one action.
- No hidden affordances: every keyboard shortcut, swipe and drag has a visible equivalent.
- Defaults that work without settings; a new preference is the last resort, not a way to avoid deciding.
- The user's own setup is never changed behind their back: a shared link or another account shows its view without overwriting theirs, until they choose to keep it.

## Data and freshness

- Data that can be stale shows its age where it's read, and the age is the way to refresh it.
- No data and failed are different: a source that didn't answer says so (⚠, "didn't answer") and offers a retry; "—" means there is nothing to show.
- A missing optional key or upstream disables only its feature, and the UI says why.
- Long work shows progress where the user is looking, with time left; past a minute, why it's slow. A refresh keeps what's on screen until the new data replaces it.

## Feedback

- Every action visibly changes something where the user is looking; a result with nothing to see (a copied link) is announced through a live region.
- Reversible actions (sort, filter, hide a column, switch account) act at once, no confirmation. Clearing many at once (Default view) is where an undo is worth it; deleting is soft or confirmed.
- Disabled controls look it (`:disabled`, or `[aria-disabled='true']` when a press must say why: half opacity, `not-allowed` cursor) and say why in text, beside them or on press, not only a tooltip (touch and keyboard users never see one), or are hidden when there's nothing to act on.
- Empty states say what emptied the screen (no games, a filter matching nothing, a private profile) and offer the way back.

## Keyboard

- Every action is reachable from the keyboard with visible focus; `?` lists the shortcuts.
- Focus follows reading order and is never dropped to `<body>`: closing a popover returns focus to its opener, activating a control keeps focus on it, removing the focused element moves focus to its nearest equivalent.
- Esc closes the innermost thing first (search text, popover, lightbox, panel). No shortcut overrides a browser one or fires while typing in a field.

## Touch and phone

- Touch targets are at least 24×24 px (WCAG 2.5.8), 44×44 px where space allows; links in running text are exempt.
- No information is hover-only — a `title` alone doesn't count.
- At 390 px: no horizontal page scroll (tables scroll inside their own area), nothing clipped, popovers fit the screen, and the table starts as high as possible — secondary actions fold behind ⋯.

## Accessibility

- Native element first: a landmark, heading, list, button or form field is the HTML element for it (`<nav>`, `<h2>`, `<button>`, `<fieldset>`…), restyled if needed; a `role` only where no element exists. Each `<nav>` and `<aside>` is named; each page has one `<h1>` (`.visually-hidden` where the layout says it without one), and no heading level is skipped.
- Every control has an accessible name, icon-only buttons and checkboxes included, saying what it does ("Remove sort", not "×"). A field takes its name from visible text (a `<label>`, `aria-labelledby`, a `<fieldset>`'s `<legend>` for a group), else from an `aria-label` repeating its placeholder: a placeholder alone vanishes once typed over.
- State is exposed, not only coloured: pressed toggles (`aria-pressed`), the current page or open game (`aria-current`), expanded sections, sort direction.
- Text and icons meet WCAG AA contrast, ages and secondary text included.

## Wording and numbers

- User terms, not model terms: "Owned by Alice", not a formula; a list or comparison is named after what it shows.
- Numbers read as the user thinks of them: rounded, with units ("10.5 h to beat", "€5.99"), never raw floats or timestamps; filters, chips and group headers format values as their column does.
- Dates: ISO everywhere (`YYYY-MM-DD`, plus `HH:MM` where the time matters), so one date reads the same in a table, a card and the panel; a coarse Steam release ("Q4 2026") stays as Steam wrote it.

## Type

- Sizes come from the `--fs-*` scale in `styles/base.css`'s `:root` (caps labels, meta and chips, tables and controls, prose, card titles, page titles, big figures); px sizes are for icon glyphs only. `test/typeScale.test.js` enforces it for the app's own CSS, not the table library's.
- Two weights: 400, and 600 for emphasis.
- Two faces, self-hosted: Geist (`--font-sans`) for text; Geist Mono (`--font-mono`) with tabular figures for a figure standing alone (`<time>`, `<output>`, `<data>`, a price, a score, a duration). Table cells stay in Geist, with tabular figures, since a cell can't be told numeric from CSS.

## Motion

- Durations and easing from the `--dur-*` / `--ease-out` tokens in `styles/base.css`; motion explains a change (something opening, arriving, pressed), never decorates.
- Only `opacity` and `transform` (or `translate`/`scale`) move; layout properties never animate. Never transition a table dropdown's (`.dt-dd`) transform: it freezes the page ([pitfalls.md](pitfalls.md)).
- Press feedback: buttons give to `scale: 0.98` while held, clickable rows to `0.995` (a full-width row would jump at 0.98), and both snap back on release, so a menu the click opens measures its trigger at full size.
- An image fades in once loaded (`fadeInOnLoad`), so a row or the panel never flashes a half-drawn picture; a cached one shows at once.
- View Transitions only for a shared element (row thumbnail → panel hero, hero → lightbox), through `viewTransition.ts`'s `morph`: feature-detected, skipped under reduced motion or while a top-layer popover or dialog is open, its `view-transition-name` set on the two elements only for the transition's length, the root cross-fade off, focus moved after `updateCallbackDone`. Not for route changes: the router has no hook, and a lazy route would freeze the screen while its chunk loads.
- Reduced motion: `styles/base.css` sets every transition to `0s` and every animation to a near-instant single run, so end states are reached at once; JS smooth scrolls go through `smoothScroll()`.

## Checklist for a new UI feature

- Keyboard path and touch equivalent.
- Its inverse, and where its state shows while active.
- Empty, loading, failed and disabled states.
- Accessible names and exposed state.
- Phone width: no page overflow, nothing clipped, targets ≥ 24 px (`node scripts/ux-measure.js` reports both).
- A scenario in [journeys.md](journeys.md) covering it, or an edge on an existing one.
