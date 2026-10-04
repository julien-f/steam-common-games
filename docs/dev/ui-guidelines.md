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
- Reversible actions (sort, filter, hide a column, switch account) act at once, no confirmation. Clearing many at once (Reset view) is where an undo is worth it; deleting is soft or confirmed.
- Disabled controls say why (a tooltip naming the blocker), or are hidden when there's nothing to act on.
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

- Every control has an accessible name, icon-only buttons and checkboxes included, saying what it does ("Remove sort", not "×").
- State is exposed, not only coloured: pressed toggles (`aria-pressed`), the current page or open game (`aria-current`), expanded sections, sort direction.
- Text and icons meet WCAG AA contrast, ages and secondary text included.

## Wording and numbers

- User terms, not model terms: "Owned by Alice", not a formula; a list or comparison is named after what it shows.
- Numbers read as the user thinks of them: rounded, with units ("10.5 h to beat", "€5.99"), never raw floats or timestamps; filters, chips and group headers format values as their column does.
- Dates: ISO in table columns (scanned down a sorted page), locale-formatted in cards and prose (read one at a time).

## Checklist for a new UI feature

- Keyboard path and touch equivalent.
- Its inverse, and where its state shows while active.
- Empty, loading, failed and disabled states.
- Accessible names and exposed state.
- Phone width: no page overflow, nothing clipped, targets ≥ 24 px (`node scripts/ux-measure.js` reports both).
- A scenario in [journeys.md](journeys.md) covering it, or an edge on an existing one.
