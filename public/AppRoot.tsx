// SPA entry point — mounts @solidjs/router's <Router> (with AppShell as its persistent `root`,
// see AppShell.tsx) into #app, replacing the four separate HTML entries' per-page bootstrap
// (see docs/list-centric-redesign.md and the implementation plan's Phase 2).
//
// Route order matters: /lists/owned, /lists/wishlist, /lists/bundle/:bundleId, and /lists/recent
// are registered before the generic /lists/:listId — @solidjs/router ranks routes by segment
// specificity (a static segment always outranks a dynamic `:param` at the same position)
// regardless of declaration order, so this isn't strictly load-bearing the way a
// first-match-wins router would need it to be, but the explicit ordering documents the intent
// and costs nothing to keep.
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { AppShell } from './AppShell.tsx';
import HomeRoute from './HomeRoute.tsx';
import ListRoute from './ListRoute.tsx';
import BundlesBrowseRoute from './BundlesBrowseRoute.tsx';
import GameRoute from './GameRoute.tsx';
import AboutRoute from './AboutRoute.tsx';

render(() => (
  <Router root={AppShell}>
    <Route path="/" component={HomeRoute} />
    <Route path="/lists/owned" component={ListRoute} />
    <Route path="/lists/wishlist" component={ListRoute} />
    <Route path="/lists/bundle/:bundleId" component={ListRoute} />
    <Route path="/lists/recent" component={ListRoute} />
    <Route path="/lists/:listId" component={ListRoute} />
    <Route path="/bundles" component={BundlesBrowseRoute} />
    <Route path="/game/:appid" component={GameRoute} />
    <Route path="/about" component={AboutRoute} />
  </Router>
), document.getElementById('app')!);
