# Changelog

All bugs hunted and fixes applied during the iterative session that built up the current state of this repository. Newest at the top.

The repo is ready to push to any Git host. Every fix below is in the commit history (`git log`).

---

## Session 2026-05 — Stabilization pass

### `.env` quoting + `mu-plugin/` → `mu-plugins/` folder rename

**Bug.** A teammate setting up a fresh project (`mcptest1`) hit smoke-test failures:

```
.env:14: command not found: j25H
.env:18: no such file or directory: Sites/mcptest1/app/public
```

…followed by all three `curl` smoke tests returning empty bodies (because no env vars had been loaded).

**Root cause.** `WP_APP_PASSWORD` and `WP_ROOT` routinely contain spaces (the WordPress-issued app password is `xxxx xxxx xxxx xxxx xxxx xxxx`, and Local-by-Flywheel paths contain `Local Sites/`). The `.env.example` we shipped had those values unquoted. Node's `dotenv` parses them fine; bash `source .env` does NOT — unquoted spaces split a `KEY=val1 val2` line into "set KEY=val1, then exec val2 as a command".

**Fix.**
- `.env.example` — wrap `WP_APP_PASSWORD` and `WP_ROOT` placeholders in double quotes, with a header comment explaining why.
- `ONBOARDING.md` Part 4 — show the quoted form in both the template and the concrete `coreai` example, with a callout box.
- `ONBOARDING.md` Part 8 — keep the convenient `set -a; source .env; set +a` as the primary loader, AND show a safer line-by-line loader (`while IFS='=' read -r key value …`) for users whose `.env` is already filled in unquoted.
- `ONBOARDING.md` Troubleshooting — two new rows mapping the exact error messages to the fix.

**Bonus tidy-up.** Renamed the repo's `mu-plugin/` folder (singular) to `mu-plugins/` (plural) to match WordPress's actual `wp-content/mu-plugins/` destination. Eliminates the common singular-vs-plural typo source (it confused a teammate during onboarding). Path references in README, ONBOARDING, and CHANGELOG updated.

Files: `.env.example`, `ONBOARDING.md`, `README.md`, `CHANGELOG.md`, `mu-plugins/wp-backend-mcp.php` (renamed from `mu-plugin/`).

---

### `c6ccdf6` — ONBOARDING: rewrite as full end-to-end guide (AI + lite profiles)

The original ONBOARDING.md was a thin 15-minute walkthrough. Replaced with a 600-line guide that covers:

- **Two profiles** — Full (WordPress nightly + WP AI Core + connector + custom abilities) and Lite (vanilla WP 6.5+, MCP for backend ops only).
- **Explicit paths table** for Local-by-Flywheel layout (`~/Local Sites/<sitename>/app/…`) with the singular-vs-plural `mu-plugin/` ↔ `mu-plugins/` distinction called out (common typo source).
- **Step-by-step parts** (clone → mu-plugin → app password → `.env` → MCP secret → `claude mcp add` → verify → smoke tests) with concrete `coreai`-named example commands alongside the templated ones, so a teammate can copy-paste either form.
- **AI prerequisites**: `wp core update --version=nightly --force` (plus the WordPress Beta Tester plugin as a no-CLI alternative), WP AI Core + connector + enabling abilities + e2m-custom-abilities.
- **Three smoke tests** (mu-plugin reachable, core REST + app password, abilities visible) with `set -a; source .env; set +a` pattern so they can be copy-pasted into any shell.
- **Expanded troubleshooting matrix** including every issue this session uncovered (TLS, args-shape, Gemini meta-description timeouts, abilities-not-registered).

Files: `ONBOARDING.md`.

---

### `542bbc6` — execute_ability: fix args double-serialization

**Bug.** When invoking `execute_ability` via the MCP tool, the WP-side handler rejected the call with `"input is not of type object"` — the ability was getting a JSON-encoded *string* instead of the inner object.

**Root cause.** The `args` parameter in the tool's JSON Schema had no `type` declaration. Some MCP SDKs fall back to string-serializing untyped parameters before they cross the RPC boundary. So `{"content":"Hello"}` arrived in the request body as `"input":"{\"content\":\"Hello\"}"` — a string, not an object — and `rest_validate_value_from_schema` correctly refused.

**Fix.** Two-pronged:

- `lib/tools.js` — declare `args` as `{ type: 'object', additionalProperties: true }` so the SDK passes objects through structurally.
- `mu-plugin/wp-backend-mcp.php` — if `input` arrives as a string that looks like JSON, decode it defensively before handing to the ability. Belt-and-braces in case any client still serializes.

Files: `lib/tools.js`, `mu-plugin/wp-backend-mcp.php`.

---

### `30adc27` — execute_ability: use `input` instead of `args` in MU-plugin POST body

**Bug.** Before the double-serialization fix above was found, `$req->get_param('args')` was sometimes returning `null` in the WP-side handler even when the body clearly contained `"args": {...}`.

**Root cause.** `args` is a reserved parameter name in WP REST — `register_rest_route` consumes it for route-level schema/arg declarations. Depending on the exact request lifecycle, `get_param('args')` can be shadowed by that internal meaning.

**Fix.** Two-pronged:

- Node `handlers/rest.js` — POST the payload under `input` (no conflict).
- PHP `mu-plugin/wp-backend-mcp.php` — read `input` first, fall back to `args` (for any older Node client), final fallback to a raw `json_decode` of the request body so the value is always recoverable.

Files: `handlers/rest.js`, `mu-plugin/wp-backend-mcp.php`.

---

### `c1d5e74` — lib/wp.js: opt-in WP_INSECURE_TLS for self-signed dev certs

**Bug.** Tool calls to a Local-by-Flywheel site that auto-enabled HTTPS failed every time with:
`self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca`

**Root cause.** Local serves dev sites with a self-signed cert. Node's default agent (and axios on top) refuses self-signed certs.

**Fix.** Added a `WP_INSECURE_TLS=1` opt-in environment flag. When set, both axios clients in `lib/wp.js` use an `https.Agent({ rejectUnauthorized: false })`. Documented in `.env.example`. **Off by default; opt-in for dev only.**

Files: `lib/wp.js`, `.env.example`.

---

### `910fc0d` — mu-plugin: force-trigger lazy abilities registry init in REST handlers

**Defensive hardening.** The WP Abilities API initializes lazily — `wp_abilities_api_init` fires on the first call to `WP_Abilities_Registry::get_instance()`. If our REST handler runs before any other code has triggered that, plugin-registered abilities may not all have registered yet when we read the registry.

**Fix.** Added `WP_Backend_MCP_Bridge::ensure_abilities_loaded()` that calls `WP_Abilities_Registry::get_instance()` at the top of both `abilities_list` and `abilities_execute`. Idempotent — subsequent calls return the same singleton. Harmless when init already happened.

Files: `mu-plugin/wp-backend-mcp.php`.

---

### Pre-session improvements bundled into the initial commit

These were applied during the session but bundled into `2039cd8` (Initial commit) or its follow-up syncs:

#### CPT/Taxonomy title field

**Bug.** When registering a CPT via `mcp__wp-backend__register_cpt`, the underlying `acf-post-type` record was created with an empty `post_title` — so ACF → Post Types showed "(no title)" until the user manually opened and saved the entry.

**Root cause.** The handler passed `labels.name` but not a top-level `title` to `acf_update_internal_post_type()`. Newer ACF accepts both; older versions need an explicit `title`.

**Fix.** In `acf_register_cpt` and `acf_register_taxonomy`:
- Include `title => $plural` in the ACF payload.
- Belt-and-braces: after `acf_update_internal_post_type` returns, if the underlying post still has an empty `post_title`, `wp_update_post()` to set it explicitly.

Files: `mu-plugin/wp-backend-mcp.php`.

#### ACF field group parent resolution

**Bug.** Calling `create_field_group` or `add_field` created `acf-field` posts as orphans (`post_parent = 0`). The field group's edit screen then showed the fields as "Unknown" type, or no fields at all.

**Root cause.** `acf_update_field( $payload )` requires `parent` to be a **numeric post ID** of the parent field-group post. The handlers were passing the field group's string key (`group_abc123…`). In some ACF versions that's silently saved as parent=0.

**Fix.** Both handlers now resolve the string key to its numeric post ID via `acf_get_field_group()` before saving the field. `acf_create_field_group` also captures the return value of `acf_update_field_group()` (which contains the new group's `ID`) and uses that. After all fields are saved, the in-memory ACF stores (`fields`, `field-groups`, `local-fields`, `local-groups`) are reset so subsequent reads pick up the new state.

Files: `mu-plugin/wp-backend-mcp.php`.

#### server.js: register the `list_abilities` and `execute_ability` dispatchers

The two new ability tools were defined in `lib/tools.js` and implemented in `handlers/rest.js`, but the dispatcher in `server.js` was missing the wiring lines. Added:

```js
list_abilities: rest.list_abilities,
execute_ability: rest.execute_ability,
```

Files: `server.js`.

---

## What's in the repo now

```
wp-backend-mcp/
├── .env.example         ← template for teammates (the real .env stays out of git)
├── .gitignore           ← excludes .env, node_modules, .claude, OS junk
├── CHANGELOG.md         ← this file
├── LICENSE              ← MIT
├── ONBOARDING.md        ← full team onboarding (AI + lite profiles)
├── README.md            ← architecture + tool catalogue + safety + troubleshooting
├── server.js            ← MCP entrypoint + dispatcher
├── package.json / package-lock.json
├── handlers/
│   ├── fs.js            ← filesystem-backed tool handlers
│   └── rest.js          ← REST-backed tool handlers
├── lib/
│   ├── paths.js         ← path validation helpers
│   ├── tools.js         ← tool schemas (the surface Claude sees)
│   └── wp.js            ← axios clients + WP_INSECURE_TLS toggle
└── mu-plugin/
    └── wp-backend-mcp.php   ← companion mu-plugin (drop into wp-content/mu-plugins/)
```

47 tools across 12 categories (Discovery, Plugins, Themes, CPT/ACF, Content, Media, Taxonomies, Options, Menus, Users, Maintenance, Filesystem, WP Abilities).

---

## How to push this to your Git host

The repo is initialized, all changes committed, working tree clean. Pick your host and add a remote:

### GitHub
```bash
cd ~/wp-backend-mcp
# Create an empty repo at https://github.com/new (do NOT initialize with README/license).
git remote add origin git@github.com:<USER>/wp-backend-mcp.git
git push -u origin main
```

### GitLab
```bash
cd ~/wp-backend-mcp
git remote add origin git@gitlab.com:<USER>/wp-backend-mcp.git
git push -u origin main
```

### Bitbucket
```bash
cd ~/wp-backend-mcp
git remote add origin git@bitbucket.org:<USER>/wp-backend-mcp.git
git push -u origin main
```

### Using `gh` (GitHub CLI) — creates + pushes in one step
```bash
cd ~/wp-backend-mcp
gh repo create wp-backend-mcp --private --source=. --remote=origin --push
# (substitute --public if you want it open)
```

After the first push, teammates clone with `git clone <REPO_URL>` and follow [ONBOARDING.md](ONBOARDING.md).

---

## What is intentionally NOT in this repo

- **`.env`** — your local credentials. Never commit. Each developer has their own.
- **`node_modules/`** — fetched via `npm install`.
- **`.claude/`** — per-developer Claude Code session state.
- **`e2m-custom-abilities.php`** — site-specific WP plugin, lives in `wp-content/plugins/` on each WP install. Distribute separately or include in your WP project's repo.
- **`.claude/agents/wp-backend.md` and `.claude/skills/wp-backend/SKILL.md`** — Claude specialist behavior, distributed via a separate (private) Claude assets repo on your team.
