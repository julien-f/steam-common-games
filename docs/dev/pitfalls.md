# Pitfalls

Surprising behaviors, misleading errors and their fixes. One entry each: symptom first (exact error text when there is one), then cause and fix. Delete entries once obsolete.

## Tests run slowly when started without `npm test`

- **Symptom**: `node --test` on store-backed tests spends most of its time idle.
- **Cause**: store calls are paced by `STORE_MIN_INTERVAL_MS` (500 ms, `default.env`), which `npm test` sets to 0.
- **Fix**: set `DB_FILE= STORE_MIN_INTERVAL_MS=0` when running a test file directly.
