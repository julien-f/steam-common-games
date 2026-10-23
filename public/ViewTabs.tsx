// Owned/Wishlist's saved views (listViews.ts) as tabs of one list, with the active one's rename/delete.
import { For, Show, onCleanup, onMount, type JSX } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import Ellipsis from 'lucide-solid/icons/ellipsis';
import { deleteListView, getListViews, renameListView, type ViewKind } from './listViews.ts';
import { bindNavPopover } from './navPopover.ts';
import { urlWithParams } from './urlState.ts';
import type { SavedView } from './types.ts';

// This page with `view` set (or cleared, for the whole list); a shared layout isn't carried over.
export function useViewHref(): (id: string | null) => string {
  const location = useLocation();
  return (id) => {
    const params = new URLSearchParams(location.search);
    params.delete('tv');
    if (id) params.set('view', id);
    else params.delete('view');
    return urlWithParams(params, location.pathname);
  };
}

export function ViewTabs(props: { kind: ViewKind; activeId: string | null }): JSX.Element {
  const href = useViewHref();
  const views = () => getListViews(props.kind);
  let allTab!: HTMLAnchorElement;
  return (
    <Show when={views().length}>
      <nav class="view-tabs" aria-label="Views">
        <a ref={allTab} href={href(null)} class="view-tab" aria-current={props.activeId ? undefined : 'page'}>
          All games
        </a>
        {/* By id: every write to the pref reads back new objects, which would remount the ⋯ that has focus. */}
        <For each={views().map((v) => v.id)}>
          {(id) => (
            <Show when={views().find((v) => v.id === id)}>
              {(view) => (
                <>
                  <a href={href(id)} class="view-tab" aria-current={id === props.activeId ? 'page' : undefined}>
                    {view().name}
                  </a>
                  <Show when={id === props.activeId}>
                    <ManageView kind={props.kind} view={view()} onDeleted={() => allTab.focus()} />
                  </Show>
                </>
              )}
            </Show>
          )}
        </For>
      </nav>
    </Show>
  );
}

function ManageView(props: { kind: ViewKind; view: SavedView; onDeleted: () => void }): JSX.Element {
  const navigate = useNavigate();
  const href = useViewHref();
  let trigger!: HTMLButtonElement;
  let panel!: HTMLDivElement;
  let name!: HTMLInputElement;
  onMount(() => onCleanup(bindNavPopover(trigger, panel)));
  function rename(): void {
    const value = name.value.trim();
    if (value && value !== props.view.name) renameListView(props.kind, props.view.id, value);
    else name.value = props.view.name;
  }
  function remove(): void {
    if (!window.confirm(`Delete the view "${props.view.name}"? The list itself stays.`)) return;
    panel.hidePopover();
    deleteListView(props.kind, props.view.id);
    navigate(href(null));
    queueMicrotask(props.onDeleted);
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        class="view-tab-more"
        popovertarget="view-manage-panel"
        aria-label={`Manage ${props.view.name}`}
        aria-haspopup="true"
        title="Rename or delete this view"
      >
        <Ellipsis />
      </button>
      <div ref={panel} id="view-manage-panel" class="site-nav-popover-panel view-menu-panel" popover>
        <form
          class="view-menu-form"
          onSubmit={(e) => {
            e.preventDefault();
            rename();
            panel.hidePopover();
            trigger.focus();
          }}
        >
          <label class="view-menu-label" for="view-manage-name">
            View name
          </label>
          <input ref={name} id="view-manage-name" type="text" value={props.view.name} onChange={rename} />
        </form>
        <button type="button" class="tree-menu-item" onClick={remove}>
          Delete view
        </button>
      </div>
    </>
  );
}
