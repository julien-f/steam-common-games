import { For, Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import BookOpen from 'lucide-solid/icons/book-open';
import Compass from 'lucide-solid/icons/compass';
import Handshake from 'lucide-solid/icons/handshake';
import Play from 'lucide-solid/icons/play';
import Swords from 'lucide-solid/icons/swords';
import Users from 'lucide-solid/icons/users';
import type { Archetype, StoryGames } from './playerProfile.ts';
import type { PlayedTag } from './tagTaste.ts';

const ARCHETYPE_ICONS = { 'book-open': BookOpen, compass: Compass, handshake: Handshake, swords: Swords, users: Users };

export function ProfileBadge(props: { archetype: Archetype; small?: boolean }): JSX.Element {
  return (
    <span class="profile-badge" classList={{ 'profile-badge--small': props.small }} aria-hidden="true">
      <Dynamic component={ARCHETYPE_ICONS[props.archetype.icon]} />
    </span>
  );
}

const pct = (weight: number) => `${Math.round(weight * 100)}%`;

// Each tag a filter button carrying its weight as a bar; the % is said, not only drawn.
export function TagBars(props: {
  tags: PlayedTag[];
  isActive: (tag: string) => boolean;
  onTag: (tag: string) => void;
}): JSX.Element {
  return (
    <ul class="profile-bars">
      <For each={props.tags}>
        {({ tag, weight }, i) => (
          <li>
            <button
              type="button"
              class="profile-bar"
              classList={{ active: props.isActive(tag) }}
              aria-pressed={props.isActive(tag)}
              title={`Filter by ${tag}, ranked by Tag match · ${i() === 0 ? 'the top tag' : `${pct(weight)} as strong as ${props.tags[0].tag}`}`}
              onClick={() => props.onTag(tag)}
            >
              <span class="profile-bar-name">{tag}</span>
              <span class="profile-bar-track">
                <span style={{ width: pct(weight) }} />
              </span>
              <span class="visually-hidden">{pct(weight)}</span>
            </button>
          </li>
        )}
      </For>
    </ul>
  );
}

function StoryRing(props: { story: StoryGames }): JSX.Element {
  const reached = () => props.story.reached.length;
  const total = () => reached() + props.story.fellShort.length;
  const circumference = 2 * Math.PI * 19;
  return (
    <svg
      class="profile-ring"
      viewBox="0 0 48 48"
      role="img"
      aria-label={`${reached()} of ${total()} story games played for their main story's length`}
    >
      <circle class="profile-ring-track" cx="24" cy="24" r="19" />
      <circle
        class="profile-ring-arc"
        cx="24"
        cy="24"
        r="19"
        stroke-dasharray={`${(circumference * reached()) / total()} ${circumference}`}
        transform="rotate(-90 24 24)"
      />
      <text x="24" y="28" text-anchor="middle" aria-hidden="true">
        {reached()}/{total()}
      </text>
    </svg>
  );
}

// Owned's profile: the archetype and the tags it plays most, beside its story and no-playtime tiles.
export function OwnedProfile(props: {
  archetype: Archetype | null;
  tags: PlayedTag[];
  played: number;
  styleSentence: string | null;
  story: StoryGames | null;
  unplayed: number; // games played `playNextHours` or less
  playNextHours: number;
  backlogShown: boolean;
  whyOpen: boolean;
  isTagActive: (tag: string) => boolean;
  onTag: (tag: string) => void;
  onBacklog: () => void;
  onWhy: () => void;
}): JSX.Element {
  const tiles = () => !!props.story || props.unplayed > 0;
  return (
    <Show when={props.tags.length || tiles()}>
      <div class="profile" classList={{ 'profile--tiles': tiles() && props.tags.length > 0 }}>
        <Show when={props.tags.length}>
          <div class="profile-main">
            <div class="profile-head">
              <Show when={props.archetype}>{(archetype) => <ProfileBadge archetype={archetype()} />}</Show>
              <div>
                <h2 class="profile-title">{props.archetype?.name ?? 'Plays mostly'}</h2>
                <p class="profile-sub">
                  <Show when={props.styleSentence}>
                    <span class="profile-style">{props.styleSentence} · </span>
                  </Show>
                  from {props.played} played games ·{' '}
                  <button
                    type="button"
                    class="list-plays-mostly-why"
                    aria-expanded={props.whyOpen}
                    aria-controls="plays-mostly-breakdown"
                    onClick={() => props.onWhy()}
                  >
                    Why these? <span aria-hidden="true">{props.whyOpen ? '▴' : '▾'}</span>
                  </button>
                </p>
              </div>
            </div>
            <Show when={props.archetype}>
              <span class="profile-label profile-label--bars">Plays mostly</span>
            </Show>
            <TagBars tags={props.tags} isActive={props.isTagActive} onTag={props.onTag} />
          </div>
        </Show>
        <Show when={tiles()}>
          <div class="profile-tiles">
            <Show when={props.story}>
              {(story) => (
                <div class="profile-tile">
                  <span class="profile-label">
                    <BookOpen /> Story games
                  </span>
                  <div class="profile-tile-body">
                    <StoryRing story={story()} />
                    <span>of story games played for their main story's length</span>
                  </div>
                </div>
              )}
            </Show>
            <Show when={props.unplayed}>
              <div class="profile-tile">
                <span class="profile-label">
                  <Play /> Barely played
                </span>
                <div class="profile-tile-body">
                  <span class="profile-figure">{props.unplayed}</span>
                  <span>
                    {props.unplayed === 1 ? 'game' : 'games'} played {props.playNextHours} h or less
                  </span>
                  <button
                    type="button"
                    class="btn"
                    aria-pressed={props.backlogShown}
                    aria-label={`Play next: ${props.unplayed} ${props.unplayed === 1 ? 'game' : 'games'} played ${props.playNextHours} h or less`}
                    title="Open Play next: these games, best Taste fit first"
                    onClick={() => props.onBacklog()}
                  >
                    Play next
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}
