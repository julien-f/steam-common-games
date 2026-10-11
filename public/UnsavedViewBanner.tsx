import { Show, type JSX } from 'solid-js';
import { getAuthUser } from './authStore.ts';
import { isUnsaved, summarizeViewDiff } from './tableViewSync.ts';
import type { ViewStateApi } from '@vates/data-table-solid';
import { revertTableViewToServer, saveTableViewToServer } from './tableViewPrefs.ts';

// Shown while a signed-in viewer's table view differs from what's saved to their account (a
// table-view pref is never auto-pushed, see prefs.ts's setPref).
export function UnsavedViewBanner(props: { table: ViewStateApi; prefKey: string }): JSX.Element {
  return (
    <Show when={getAuthUser() && isUnsaved(props.prefKey, props.table.getViewState())}>
      <div class="pref-unsaved-banner">
        Unsaved changes to this view ({summarizeViewDiff(props.prefKey, props.table.getViewState()).join(', ')}) —
        differs from what's saved to your account.
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => saveTableViewToServer(props.prefKey, props.table.getViewState())}
        >
          Save
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onClick={() => revertTableViewToServer(props.table, props.prefKey)}
        >
          Revert
        </button>
      </div>
    </Show>
  );
}

// A table's "🔗 Share view"/"Default view" toolbar buttons — see tableViewPrefs.ts.
export function ViewActions(props: {
  onShare: (btn: HTMLElement) => void;
  onReset: () => void;
  shareDisabledReason?: string | null;
}): JSX.Element {
  return (
    <div class="list-view-actions">
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        aria-label="Share view"
        disabled={props.shareDisabledReason != null}
        title={props.shareDisabledReason ?? "Copy a link to this table's layout"}
        onClick={(e) => props.onShare(e.currentTarget)}
      >
        🔗<span class="btn-label"> Share view</span>
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        aria-label="Default view"
        title="Back to the default columns, sort and filters"
        onClick={() => props.onReset()}
      >
        <span class="btn-icon">↺</span>
        <span class="btn-label">Default view</span>
      </button>
    </div>
  );
}
