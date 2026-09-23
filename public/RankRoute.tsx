// The compare screen of a ranked list (/lists/:listId/rank, see docs/dev/lists-and-accounts.md's
// Ranked lists section): asks one "which do you prefer?" pair at a time and feeds each answer to
// ranking.ts's binary insertion. Every answer is stored right away (listsStore.ts's setRanking),
// so leaving at any point loses nothing; undo is an in-memory stack of previous states.
import { createSignal, createEffect, onCleanup, Show, For, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import { A, useParams, useNavigate } from '@solidjs/router';
import { getList, getRanking, setRanking } from './listsStore.ts';
import { resolveListWithSources, flattenCombineResult, createDefaultFetchers } from './listResolve.ts';
import { createDefaultNaming, listDisplayName } from './listLabels.ts';
import { nextPair, answer, progress, ranks, type RankingState, type RankingPair, type RankingAnswer } from './ranking.ts';
import { setBaseTitle } from './pageTitle.ts';
import { withAccountParam } from './urlState.ts';
import type { GameDetails } from './types.ts';

const MAX_UNDO = 100;

function headerImage(appid: number): string {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

export default function RankRoute() {
  const params = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = createSignal('');
  const [status, setStatus] = createSignal('Resolving list…');
  const [source, setSource] = createSignal<Set<number> | null>(null);
  const [state, setState] = createSignal<RankingState | null>(null);
  const [pair, setPair] = createSignal<RankingPair | null>(null);
  const [undoStack, setUndoStack] = createSignal<RankingState[]>([]);
  // X arms an exclusion; the next ←/→ says which side.
  const [excludeArmed, setExcludeArmed] = createSignal(false);
  const [details, setDetails] = createStore<Record<number, GameDetails | null>>({});
  let loadToken = 0;

  function listHref(): string {
    return withAccountParam(`/lists/${params.listId}`);
  }

  async function load(): Promise<void> {
    const token = ++loadToken;
    const list = getList(params.listId!);
    if (!list || list.kind !== 'ranked') { setStatus('This ranked list no longer exists.'); return; }
    const name = listDisplayName(list, createDefaultNaming());
    setTitle(name);
    setBaseTitle(`Rank — ${name}`);
    try {
      const { result } = await resolveListWithSources(list, createDefaultFetchers());
      if (token !== loadToken) return;
      const appids = flattenCombineResult(result);
      const next = nextPair(getRanking(list.id), appids);
      setSource(appids);
      setState(next.state);
      setPair(next.pair);
      setUndoStack([]);
      setStatus('');
    } catch (err) {
      if (token !== loadToken) return;
      setStatus(`Error: ${(err as Error).message}`);
    }
  }

  // Cached per appid for this mount; the server's own cache makes a repeat cheap anyway.
  function fetchDetails(appid: number): void {
    if (appid in details) return;
    setDetails(appid, null);
    fetch(`/api/game-details/${appid}`)
      .then(res => (res.ok ? res.json() : null))
      .then((data: GameDetails | null) => { if (data) setDetails(appid, data); })
      .catch(() => { /* card falls back to the header image and appid */ });
  }

  createEffect(() => {
    const p = pair();
    if (p) { fetchDetails(p.candidate); fetchDetails(p.opponent); }
  });

  function respond(ans: RankingAnswer): void {
    const current = state();
    const src = source();
    if (!current || !src || !pair()) return;
    const next = answer(current, src, ans);
    setUndoStack(stack => [...stack.slice(-(MAX_UNDO - 1)), current]);
    setState(next.state);
    setPair(next.pair);
    setRanking(params.listId!, next.state);
    setExcludeArmed(false);
  }

  function undo(): void {
    const stack = undoStack();
    const src = source();
    if (!stack.length || !src) return;
    const previous = stack[stack.length - 1];
    const next = nextPair(previous, src);
    setUndoStack(stack.slice(0, -1));
    setState(next.state);
    setPair(next.pair);
    setRanking(params.listId!, next.state);
    setExcludeArmed(false);
  }

  function onKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, select, textarea')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    // Esc closes the shortcuts dialog first, when it's open (AppShell's own handler).
    if (key === 'Escape') { if (!document.querySelector('.shortcuts-modal.open')) navigate(listHref()); return; }
    if (key === 'z' || key === 'Z' || key === 'Backspace') { e.preventDefault(); undo(); return; }
    if (!pair()) return;
    if (key === 'x' || key === 'X') { e.preventDefault(); setExcludeArmed(v => !v); return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      const left = key === 'ArrowLeft';
      if (excludeArmed()) respond(left ? 'exclude-candidate' : 'exclude-opponent');
      else respond(left ? 'candidate' : 'opponent');
      return;
    }
    if (key === 'ArrowDown' || key === '=') { e.preventDefault(); respond('tie'); return; }
    if (key === 's' || key === 'S') { e.preventDefault(); respond('skip'); return; }
    setExcludeArmed(false);
  }
  document.addEventListener('keydown', onKeydown);
  onCleanup(() => {
    document.removeEventListener('keydown', onKeydown);
    loadToken++;
    setBaseTitle(null);
  });

  createEffect(() => { params.listId; void load(); });

  function currentProgress() {
    const s = state();
    const src = source();
    return s && src ? progress(s, src) : null;
  }

  function card(appid: number, side: 'candidate' | 'opponent', note: JSX.Element): JSX.Element {
    const d = (): GameDetails | null | undefined => details[appid];
    const meta = () => d()?.meta ?? null;
    const year = () => meta()?.releaseDate?.match(/\d{4}/)?.[0];
    const hltb = () => d()?.hltb?.main;
    return (
      <div class="rank-card" classList={{ 'rank-card-armed': excludeArmed() }}>
        <button type="button" class="rank-card-pick" onClick={() => respond(excludeArmed() ? `exclude-${side}` : side)}>
          <img src={headerImage(appid)} alt="" width="460" height="215" loading="eager" />
          <span class="rank-card-name">{meta()?.name || `App ${appid}`}</span>
          <span class="rank-card-facts">
            {[year(), ...(meta()?.genres ?? []).slice(0, 2), hltb() ? `${hltb()}h main story` : null].filter(Boolean).join(' · ')}
          </span>
          <span class="rank-card-note">{note}</span>
        </button>
        <button type="button" class="btn btn-ghost btn-sm" title="Leave this game out of the ranking" onClick={() => respond(`exclude-${side}`)}>
          Haven't played — exclude
        </button>
      </div>
    );
  }

  return (
    <div class="rank-route">
      <div class="rank-header">
        <A href={listHref()} class="btn btn-ghost btn-sm">← Back to list</A>
        <h1>{title()}</h1>
      </div>
      <Show when={status()}>
        <div class="list-status">{status()}</div>
      </Show>
      <Show when={currentProgress()}>
        {p => (
          <div class="rank-progress">
            <progress max={p().ranked + p().pending} value={p().ranked} />
            <span>
              {p().ranked} / {p().ranked + p().pending} ranked
              {p().excluded ? ` · ${p().excluded} excluded` : ''}
              {p().pending ? ` · ≈ ${p().remaining} comparisons left` : ''}
            </span>
          </div>
        )}
      </Show>
      <Show when={pair()} fallback={
        <Show when={source()}>
          <div class="rank-done">
            <p>Every game in this list is ranked. New games added to its source will show up here.</p>
            <A href={listHref()} class="btn btn-primary">See the ranking</A>
            <Show when={undoStack().length}>
              <button type="button" class="btn btn-ghost" onClick={undo}>Undo last answer</button>
            </Show>
          </div>
        </Show>
      }>
        {p => (
          <>
            <h2 class="rank-question">{excludeArmed() ? 'Exclude which game? (← / →)' : 'Which do you prefer?'}</h2>
            <div class="rank-pair">
              {card(p().candidate, 'candidate', 'New to the ranking')}
              {card(p().opponent, 'opponent', `Currently #${ranks(state()!, source()!).get(p().opponent) ?? '?'}`)}
            </div>
            <div class="rank-actions">
              <button type="button" class="btn btn-ghost" onClick={() => respond('tie')}>Tie <kbd>↓</kbd></button>
              <button type="button" class="btn btn-ghost" onClick={() => respond('skip')}>Skip, ask later <kbd>S</kbd></button>
              <button type="button" class="btn btn-ghost" disabled={!undoStack().length} onClick={undo}>Undo <kbd>Z</kbd></button>
            </div>
            <p class="rank-hint">
              <For each={[['← / →', 'pick'], ['X then ← / →', 'exclude'], ['Esc', 'stop — progress is saved']]}>
                {([k, v]) => <span><kbd>{k}</kbd> {v}</span>}
              </For>
            </p>
          </>
        )}
      </Show>
    </div>
  );
}
