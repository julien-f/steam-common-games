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
import { fadeInOnLoad, fmtHours, roundHours } from './utils.ts';

const ARCHETYPE_ICONS = { 'book-open': BookOpen, compass: Compass, handshake: Handshake, swords: Swords, users: Users };

export function ProfileBadge(props: { archetype: Archetype; small?: boolean }): JSX.Element {
  return (
    <span class="profile-badge" classList={{ 'profile-badge--small': props.small }} aria-hidden="true">
      <Dynamic component={ARCHETYPE_ICONS[props.archetype.icon]} />
    </span>
  );
}

// Without a Steam avatar, the player's initial on a colour of its own, by position in the comparison.
const AVATAR_COLOURS = ['--kind-tag', '--kind-category', '--kind-genre', '--kind-devpub'];
export function PlayerAvatar(props: { url?: string; label: string; index: number }): JSX.Element {
  return (
    <Show
      when={props.url}
      fallback={
        <span
          class="player-avatar"
          style={{ background: `var(${AVATAR_COLOURS[props.index % AVATAR_COLOURS.length]})` }}
          aria-hidden="true"
        >
          {Array.from(props.label)[0]?.toUpperCase()}
        </span>
      }
    >
      {(url) => <img class="player-avatar" src={url()} alt="" width="36" height="36" ref={fadeInOnLoad} />}
    </Show>
  );
}

const pct = (weight: number) => `${Math.round(weight * 100)}%`;

// Each tag a filter button carrying its weight as a bar; the % is said, not only drawn.
export function TagBars(props: {
  tags: PlayedTag[];
  isActive: (tag: string) => boolean;
  onTag: (tag: string) => void;
  detail?: (tag: PlayedTag) => JSX.Element; // under its bar, e.g. Why these?'s games
}): JSX.Element {
  return (
    <ul class="profile-bars">
      <For each={props.tags}>
        {(played, i) => (
          <li>
            <button
              type="button"
              class="profile-bar"
              classList={{ active: props.isActive(played.tag) }}
              aria-pressed={props.isActive(played.tag)}
              title={`Filter by ${played.tag}, ranked by Tag match · ${i() === 0 ? 'the top tag' : `${pct(played.weight)} as strong as ${props.tags[0].tag}`}`}
              onClick={() => props.onTag(played.tag)}
            >
              <span class="profile-bar-name">{played.tag}</span>
              <span class="profile-bar-track">
                <span style={{ width: pct(played.weight) }} />
              </span>
              <span class="visually-hidden">{pct(played.weight)}</span>
            </button>
            {props.detail?.(played)}
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

export interface ProfileGameInfo {
  name: string;
  art: string | null;
  hours: number;
  main: number | null; // How Long To Beat's main story, hours
}

const STORY_GAMES_SHOWN = 5;

function GameArt(props: { art: string | null }): JSX.Element {
  return <img src={props.art ?? undefined} alt="" width="46" height="17" loading="lazy" ref={fadeInOnLoad} />;
}

// Story games with their hours against their main story's length, reached ones then those short of it.
function StoryList(props: {
  story: StoryGames;
  game: (appid: number) => ProfileGameInfo | undefined;
  onGame: (appid: number) => void;
}): JSX.Element {
  const groups = () => [
    { label: "Reached the main story's length", appids: props.story.reached, reached: true },
    { label: 'Fell short', appids: props.story.fellShort, reached: false },
  ];
  return (
    <div class="profile-story">
      <For each={groups().filter((g) => g.appids.length)}>
        {(group) => (
          <>
            <span class="profile-label">{group.label}</span>
            <For each={group.appids.slice(0, STORY_GAMES_SHOWN)}>
              {(appid) => (
                <Show when={props.game(appid)}>
                  {(g) => (
                    <button type="button" class="profile-story-game" onClick={() => props.onGame(appid)}>
                      <span class="profile-story-name">
                        <GameArt art={g().art} />
                        {g().name}
                      </span>
                      <span class="profile-story-track" classList={{ reached: group.reached }}>
                        <span style={{ width: `${Math.min(100, (100 * g().hours) / (g().main || g().hours))}%` }} />
                      </span>
                      <span class="profile-story-hours">
                        {roundHours(g().hours)} / {roundHours(g().main ?? 0)} h
                      </span>
                    </button>
                  )}
                </Show>
              )}
            </For>
            <Show when={group.appids.length > STORY_GAMES_SHOWN}>
              <span class="profile-more">+{group.appids.length - STORY_GAMES_SHOWN} more</span>
            </Show>
          </>
        )}
      </For>
    </div>
  );
}

// Owned's profile: the archetype and the tags it plays most, beside its story and no-playtime tiles.
// Why these? opens each figure's evidence in place: games under each tag, the story games in their tile.
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
  game: (appid: number) => ProfileGameInfo | undefined;
  onGame: (appid: number) => void;
}): JSX.Element {
  const tiles = () => !!props.story || props.unplayed > 0;
  return (
    <Show when={props.tags.length || tiles()}>
      <div
        id="player-profile"
        class="profile"
        classList={{ 'profile--tiles': tiles() && props.tags.length > 0, 'profile--open': props.whyOpen }}
      >
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
                    aria-controls="player-profile"
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
            <TagBars
              tags={props.tags}
              isActive={props.isTagActive}
              onTag={props.onTag}
              detail={(played) => (
                <Show when={props.whyOpen}>
                  <div class="profile-bar-games">
                    <For each={played.games}>
                      {(g) => (
                        <button type="button" class="profile-chip" onClick={() => props.onGame(g.appid)}>
                          <GameArt art={props.game(g.appid)?.art ?? null} />
                          {g.name} <span class="profile-chip-hours">{fmtHours(g.hours)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              )}
            />
            <Show when={props.whyOpen}>
              <details class="profile-how">
                <summary>How it's counted</summary>
                <ul>
                  <li>
                    Tags: hours played × how strongly players tagged each game; tags most of the library carries count
                    less. Bars compare each tag with the top one.
                  </li>
                  <Show when={props.styleSentence}>
                    <li>
                      Play style: single-player, co-op or PvP, whichever holds over half the played games' weight (log
                      hours); a game with several modes goes by the one players tag it most for.
                    </li>
                  </Show>
                  <Show when={props.story}>
                    <li>
                      Story games: single-player, with a How Long To Beat main story and no endless tag (roguelike,
                      sandbox…), counted when played for at least 80% of it.
                    </li>
                  </Show>
                </ul>
              </details>
            </Show>
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
                  <Show when={props.whyOpen}>
                    <StoryList story={story()} game={props.game} onGame={props.onGame} />
                  </Show>
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
