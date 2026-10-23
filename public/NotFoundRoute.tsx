// Any path no other route matches — an old link, a typo — rather than a blank page.
import { A } from '@solidjs/router';
import { useBaseTitle } from './pageTitle.ts';
import { ListHero } from './ListHero.tsx';

export default function NotFoundRoute() {
  useBaseTitle(() => 'Page not found');

  return (
    <div class="container">
      <ListHero title="Page not found" />

      <p>
        Nothing lives at this address — it may come from an old or mistyped link. <A href="/">Go to Home</A>.
      </p>
    </div>
  );
}
