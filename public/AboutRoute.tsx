// /about — ported verbatim from the legacy about.html (no logic of its own there either, just
// static content) as part of the SPA route table (see docs/list-centric-redesign.md).
import { onMount, onCleanup } from 'solid-js';
import { setBaseTitle } from './pageTitle.ts';

export default function AboutRoute() {
  onMount(() => setBaseTitle('About'));
  onCleanup(() => setBaseTitle(null));

  return (
    <div class="container">
      <header>
        <h1>About</h1>
      </header>

      <div class="card">
        <h2>About</h2>
        <p class="card-subtitle">
          steam.isonoe.net compares Steam libraries across players and helps you browse a single library,
          with ratings, playtime, and completion-time estimates. It's a small personal project, not affiliated
          with or endorsed by Valve, Steam, or HowLongToBeat.
        </p>
      </div>

      <div class="card">
        <h2>Data sources</h2>
        <ol class="how-steps">
          <li><strong>Steam Web API</strong> (Valve) — profile info (name, avatar), owned games, and playtime for any player you look up, plus store review scores used to compute ratings.</li>
          <li><strong>Steam Store</strong> — store metadata (description, screenshots, genres, release date), user tags, and the "look up any game" search box's name results. Uses unofficial storefront endpoints.</li>
          <li><strong>HowLongToBeat</strong> — estimated time to complete a game. Fetched from an unofficial endpoint; estimates may occasionally be missing or stale if that changes.</li>
          <li><strong>IsThereAnyDeal</strong> — current Steam bundle listings and prices, on the Bundles page. Requires a free API key; the page shows a clear message if one isn't configured.</li>
        </ol>
      </div>

      <div class="card">
        <h2>What's stored</h2>
        <p class="card-subtitle">
          Only public Steam profile data (Steam ID, name, avatar, owned games/playtime) and the ratings/tags/
          completion-time estimates above are cached temporarily to keep the site fast — cached entries expire
          automatically, from an hour for library data up to a few weeks for slower-changing data like ratings
          and tags. Nothing else is collected: no accounts, no passwords, no analytics or tracking, and no data
          is shared with anyone beyond the API calls needed to show you the page.
        </p>
      </div>

      <div class="card">
        <h2>Contact</h2>
        <p class="card-subtitle">
          Questions, or want data related to your profile removed from the cache? Open an issue on{' '}
          <a href="https://github.com/julien-f/steam-common-games/issues" class="footer-link">GitHub</a>.
        </p>
      </div>
    </div>
  );
}
