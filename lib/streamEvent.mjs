// An ES module, unlike the rest of lib/, so e2e/mockApi.ts can import it under Vite's dev:mock too.

/**
 * One game's details as POST /api/game-details/stream sends them: without the screenshots and trailers
 * only an opened game shows (the client fills them from GET /api/game-meta). A copy, as `details` may be
 * shared with a GET /api/game-details answer through the details dedup.
 * @template {{ meta?: object | null }} T
 * @param {T} details
 * @returns {T}
 */
export function streamEvent(details) {
  if (!details.meta) return details;
  const { screenshots, movies, ...meta } = /** @type {Record<string, unknown>} */ (details.meta);
  return { ...details, meta };
}
