# Environment Configuration Contract

`.env.example` is a safe template and must contain no production values.

Current foundation keys:

- `NODE_ENV` — runtime mode.
- `HULK_BIND_HOST` — future local/server bind address.
- `HULK_PORT` — future control-plane listen port.
- `HULK_SESSION_ENCRYPTION_KEY` — empty placeholder for a future server-only secret; never exposed to the browser and never committed with a value.

Provider Host, Provider Username, and Provider Password are per-user authentication input and must never be configured as hardcoded production defaults.

Future secret/config additions require explicit server ownership, safe examples, fail-closed startup behavior where appropriate, and log redaction. Production secrets are provisioned outside Git and are not created by Phase 1.
