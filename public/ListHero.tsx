// The hero card at the top of every list route — the one place a list says what it *is* before
// its table says what's in it (see ListRoute.tsx's own heroTiles/hero JSX for each kind's
// content). Generalized from what used to be `kind === 'bundle'`-only markup: a bundle got a
// title, its shop/dates/tiers/counts as labelled tiles and ITAD's note, while every other kind
// opened with an unlabelled gray "Updated 3h ago" line and no name at all — `/lists/owned`
// didn't even say whose library was on screen (only <title> did, via pageTitle.ts).
//
// Deliberately dumb: no data of its own, no per-kind branching. Callers pass already-formatted
// values, so "what does a wishlist show" stays answerable in one place (ListRoute.tsx) rather
// than being split between there and here.
//
// `lead`/`chips`/`actions`/`note` are eagerly-created JSX props (built once by the caller's own
// render, reactive internally through whatever signals they read); `tiles` is a plain array
// recomputed as its inputs change. That split is on purpose — buttons keep their identity across
// a count/age change, and a tile's own value can't hold state worth preserving.
import { For, Show, type JSX } from 'solid-js';

export interface HeroTile {
  // Uppercased by CSS — write it in sentence case ("Ends", "Best deal"), not shouting.
  label: string;
  value: JSX.Element;
  // A second, smaller line under the value (a qualifier, not a second fact — "on Steam",
  // "Updated 2h ago").
  sub?: JSX.Element;
  // Native tooltip on the value, for the number this tile is deliberately *not* showing
  // (e.g. ITAD's own game count next to the count this route can actually enumerate).
  title?: string;
}

export interface ListHeroProps {
  title: string;
  lead?: JSX.Element; // before the title — the bundle route's ‹/› nav
  chips?: JSX.Element; // after the title — kind/shop/account chips
  actions?: JSX.Element; // right-hand side of the title row — refresh, outbound links
  tiles?: HeroTile[];
  note?: JSX.Element; // its own line under the tiles — prose (ITAD's note, a list's formula)
}

export function ListHero(props: ListHeroProps): JSX.Element {
  return (
    <div class="list-hero">
      <div class="list-hero-header">
        <div class="list-hero-titlebar">
          {props.lead}
          <h1 class="list-hero-title">{props.title}</h1>
          {props.chips}
        </div>
        <Show when={props.actions}>
          <div class="list-hero-actions">{props.actions}</div>
        </Show>
      </div>
      <Show when={props.tiles?.length}>
        <div class="list-hero-stats">
          <For each={props.tiles}>
            {tile => (
              <div class="list-stat">
                <span class="list-stat-label">{tile.label}</span>
                <span class="list-stat-value" title={tile.title}>{tile.value}</span>
                <Show when={tile.sub}>
                  <span class="list-stat-sub">{tile.sub}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.note}>
        <div class="list-hero-note">{props.note}</div>
      </Show>
    </div>
  );
}
