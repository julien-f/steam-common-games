// Any path no other route matches — an old link, a typo — rather than a blank page.
import { onMount, onCleanup } from 'solid-js';
import { A } from '@solidjs/router';
import { setBaseTitle } from './pageTitle.ts';

export default function NotFoundRoute() {
  onMount(() => setBaseTitle('Page not found'));
  onCleanup(() => setBaseTitle(null));

  return (
    <div class="container">
      <header>
        <h1>Page not found</h1>
      </header>

      <div class="card">
        <p class="card-subtitle">
          Nothing lives at this address — it may come from an old or mistyped link. <A href="/">Go to Home</A>.
        </p>
      </div>
    </div>
  );
}
