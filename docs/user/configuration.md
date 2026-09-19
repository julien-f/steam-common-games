# Configuration

All settings live in environment variables. `default.env` (committed) lists every one with its default and an explanation — it is the reference; this page covers what you actually need to set.

Create `.env` (gitignored) with only the values you want to override:

```
STEAM_API_KEY=your_key_here
```

- **`STEAM_API_KEY`** — the only required setting. Get one at <https://steamcommunity.com/dev/apikey>. The server exits at startup with a clear message if it's missing.
- **`ITAD_API_KEY`** — optional, enables bundle browsing and every price column. Without it those surfaces are hidden and the rest of the app runs normally. Get one at <https://isthereanydeal.com/apps/new/>.
- **`HOST`/`PORT`** — where the server binds; `127.0.0.1:3000` by default.
- **`DB_FILE`** — path to the SQLite database (`db.sqlite` by default). Set it empty to run entirely in memory.

Everything else in `default.env` is a limit or a cache lifetime with a sensible default:

- **Rate limits** (`*_RATE_LIMIT_MAX`, `MAX_USERS`, `STREAM_MAX_GAMES`, `STREAM_CONCURRENCY`) — per-client request budgets and how much work one request may queue.
- **Outbound budgets** (`OUTBOUND_HOURLY_MAX`, `OUTBOUND_DAILY_MAX`) — a hard ceiling on requests this app makes to each third-party service per hour and per day, protecting an API key's quota no matter how many clients are asking. `0` disables.
- **Cache lifetimes** (`*_CACHE_TTL_MINUTES`) — how long each kind of upstream data is kept. They're generous on purpose; every screen that shows cached data says how old it is and offers a ↻ that fetches fresh.

`npm run cache:clear` empties every cache table without deleting the database.
