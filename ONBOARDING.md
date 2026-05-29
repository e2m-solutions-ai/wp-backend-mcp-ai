# Onboarding — wp-backend-mcp

End-to-end setup for using `wp-backend-mcp` with [Claude Code](https://docs.claude.com/en/docs/claude-code) on a Local-by-Flywheel WordPress install (or any other local stack).

This guide covers two profiles:

- **Full profile [AI profile]** — WordPress 7+ (ships the Abilities API in stable, no nightly needed) + the WP AI Core plugin + a connector + custom abilities. You get `mcp__wp-backend__execute_ability`, `list_abilities`, the e2m French-translation ability, auto-save hooks, etc.
- **Lite profile** — vanilla WordPress 6.5+, no AI plugins. You still get the 46 non-ability tools (CPT/ACF, plugins, themes, content, media, users, options, search-replace, child-theme + mu-plugin scaffolding, theme file r/w). Use this for projects where you only need backend automation.

If you only need the lite profile, skip every step labelled **[AI profile only]**.

---

## Paths used throughout

All examples assume a Local site named `<sitename>` on macOS. Substitute your own name.

| What | Path |
|---|---|
| Local site root | `~/Local Sites/<sitename>/` |
| WP install (contains `wp-config.php`) | `~/Local Sites/<sitename>/app/public/` |
| `wp-content/plugins/` | `~/Local Sites/<sitename>/app/public/wp-content/plugins/` |
| `wp-content/mu-plugins/` | `~/Local Sites/<sitename>/app/public/wp-content/mu-plugins/` |
| Where you clone this repo | `~/Local Sites/<sitename>/app/wp-backend-mcp/` |
| Your `.env` | `~/Local Sites/<sitename>/app/wp-backend-mcp/.env` |
| `wp-config.php` | `~/Local Sites/<sitename>/app/public/wp-config.php` |
| Project Claude assets | `~/Local Sites/<sitename>/.claude/` |
| User-wide Claude assets | `~/.claude/` |

> **Non-Local users:** any stack (MAMP, DDEV, plain LAMP, remote SSH) works. Wherever your WordPress install lives, that's `WP_ROOT`. The Node MCP server reads `.env` from its own folder; the mu-plugin lives in `<WP_ROOT>/wp-content/mu-plugins/`.

---

## Prerequisites

### System tools (all profiles)

- **Node.js 18 or newer** — `node -v` to confirm
- **PHP 8.0 or newer** — required by WordPress 7 / the AI plugin; `php -v` to confirm (set the site's PHP version in Local if it's older)
- **Local-by-Flywheel** (or your local stack of choice)
- **Claude Code** — `claude --version`
- **Git** — to clone this repo
- **openssl** — for generating the MCP shared secret (ships with macOS)

### WordPress baseline (all profiles)

You need a working WordPress install with:

- An **admin user**
- Permalinks set to *Post name* (or any non-default) — required for the REST API to register pretty routes

### [AI profile only] WordPress version & plugins

The WP Abilities API now ships in **stable WordPress 7** — no nightly or Beta Tester channel required anymore. Just update WordPress normally:

- **Dashboard → Updates → Update to 7.x**, or
- From Local (right-click your site → Open Site Shell): `wp core update`

**PHP 8.0 or newer is required** for WordPress 7 and the AI plugin. In Local, set the site's PHP version under the site's **Tools / settings → PHP version** (pick 8.1+ for the smoothest experience), then restart the site. Confirm with `php -v` in the Site Shell.

> **Upgrading from an older nightly?** If you previously ran `wp core update --version=nightly` for the 6.9 pre-release, you can drop back to the stable channel: `wp core update` will move you onto the 7.x stable release. Beta Tester is no longer needed and can be deactivated.

Then install these plugins (Plugins → Add New → search by slug):

1. **AI** (slug: `ai`) — the WP AI Core, ships the Abilities API host
2. **AI Provider for Anthropic** (slug: `ai-provider-for-anthropic`) **OR** **AI Provider for Google** (slug: `ai-provider-for-google`)
   - Activate **only one** provider plugin per site. With multiple active, the AI client auto-selects one — and if its key is empty/depleted, every ability call fails (Anthropic returns `400 credit balance too low`; Gemini returns `400 API key not valid`). To switch providers, deactivate the old plugin first.
   - **Heads-up about Gemini models**: the AI plugin's default preferred model is `gemini-3-flash-preview`, which is **unstable** — `ai/meta-description` in particular times out at the 30s cURL ceiling. If you must use Gemini, pin each affected feature to `gemini-2.5-flash` (see "Pinning a stable model" in Troubleshooting).
3. **(Optional) E2M Custom Abilities** — drop the plugin folder under `~/Local Sites/<sitename>/app/public/wp-content/plugins/e2m-custom-abilities/` and activate it. Registers `e2m/french-translation` and adds save_post hooks for `team_member` and `project` CPTs that auto-populate Short Bio / SEO Description / French Text fields.

### [AI profile only] Connect a provider

1. Open **WP admin → Settings → AI → Connectors** (or the equivalent for your provider plugin).
2. Paste your API key.
3. Click **Test connection** — confirm it returns OK.

### [AI profile only] Enable abilities

In **Settings → AI → Features**, toggle on the abilities you'll use:

- Title Generation
- Meta Description Generation
- Excerpt Generation
- Content Resizing
- Alt Text Generation
- Content Classification
- Summarization
- (others as needed)

Each toggle exposes that ability at `/wp-json/wp-abilities/v1/abilities/<name>/run` and to the MCP `execute_ability` tool.

### Claude assets (agents + skills) Find the repo here, https://github.com/kajale2m/wp-backend-claude/

For Claude Code to behave as a WP backend specialist, drop the `wp-backend` agent and skill into one of:

- **Project-level** (only this site): `~/Local Sites/<sitename>/.claude/agents/wp-backend.md` and `~/Local Sites/<sitename>/.claude/skills/wp-backend/SKILL.md`
- **User-level** (every project on your Mac): `~/.claude/agents/wp-backend.md` and `~/.claude/skills/wp-backend/SKILL.md`

If your team distributes these via a private repo, clone that too. (They're not in this repo — that keeps the MCP server distributable independently.)

---

## Part 1 — Clone wp-backend-mcp

Clone the repo **into the Local site's `app/` folder**, alongside `app/public/`. This keeps each project's MCP isolated with its own `.env`.

```bash
cd "$HOME/Local Sites/<sitename>/app"
git clone <REPO_URL> wp-backend-mcp
cd wp-backend-mcp
npm install
```

After cloning, the layout looks like:

```
~/Local Sites/<sitename>/
├── app/
│   ├── public/                       # WordPress install
│   │   └── wp-content/
│   │       └── mu-plugins/           # ← drop the companion mu-plugin here in Part 2
│   └── wp-backend-mcp/               # ← cloned repo lives here
│       ├── server.js
│       ├── .env.example
│       └── …
└── .claude/                          # Claude project config (optional)
```

---

## Part 2 — Install the companion mu-plugin

The repo ships a single PHP file at `mu-plugins/wp-backend-mcp.php`. Copy it into WordPress's `mu-plugins/`: IF mu-plugins not exist then please create.

```bash
# From inside the cloned repo:
cp mu-plugins/wp-backend-mcp.php \
   "$HOME/Local Sites/<sitename>/app/public/wp-content/mu-plugins/wp-backend-mcp.php"
```

MU-plugins auto-load — no activation step. Verify by visiting **Plugins → Must-Use** in wp-admin; you should see "WP Backend MCP Bridge".

> **It is also safe to commit this file into your WordPress project's repo** under `wp-content/mu-plugins/`. New devs cloning the WP project then don't need this step. Coordinate with your team.

---

## Part 3 — Generate YOUR Application Password

Each developer gets their own — never share Application Passwords.

1. wp-admin → **Users → Your Profile**
2. Scroll to **Application Passwords**
3. Name it `wp-backend-mcp` → click **Add New**
4. WordPress shows a 24-character password **with spaces** — copy it now, it's only shown once.

---

## Part 4 — Configure `.env`

The repo ships `.env.example`. Copy it to `.env` in the same folder:

```bash
cd "$HOME/Local Sites/<sitename>/app/wp-backend-mcp"
cp .env.example .env
```

So your `.env` lives at: `~/Local Sites/<sitename>/app/wp-backend-mcp/.env` — same folder as `server.js`. The Node server reads `.env` relative to its own path, **not** the shell CWD.

Open `.env` and fill in:

```
WP_URL=http://<sitename>.local
WP_USER=<your wp-admin username>
WP_APP_PASSWORD="<paste from Part 3, KEEP the spaces>"
WP_ROOT="$HOME/Local Sites/<sitename>/app/public"
WP_BACKEND_MCP_KEY=<see Part 5>

# Optional — only set when WP_URL uses https:// (Local sometimes auto-enables SSL).
# Off by default; opt-in for trusted dev environments.
WP_INSECURE_TLS=1
```

> **Wrap any value that contains a space in double quotes** — `WP_APP_PASSWORD` always has spaces, and `WP_ROOT` on Local-by-Flywheel does too (`Local Sites/<sitename>/…`). 
---

## Part 5 — Set the MCP shared secret

This guards the companion mu-plugin's REST routes. **One value per WP site, shared by every dev on the team** — keep it in your team password manager.

If your project doesn't have one yet, generate it once:

```bash
openssl rand -hex 24
```

Put the result in two places — they must be byte-identical:

1. `.env` — `WP_BACKEND_MCP_KEY=<value>`
2. `wp-config.php` — **above** the `/* That's all, stop editing! */` line:

```php
define( 'WP_BACKEND_MCP_KEY', 'paste-the-same-string-here' );

// Optional — enables the run_php tool (arbitrary PHP execution).
// Off by default. Only enable for trusted local-dev environments.
// define( 'WP_BACKEND_MCP_ALLOW_EVAL', true );
```

Path: `~/Local Sites/<sitename>/app/public/wp-config.php`

---

## Part 6 — Register the MCP server with Claude Code

Run this from your **Local site root** (the parent of `app/`). The MCP is scoped to whichever directory you run `claude mcp add` from.

```bash
cd "$HOME/Local Sites/<sitename>"
claude mcp add wp-backend node "$HOME/Local Sites/<sitename>/app/wp-backend-mcp/server.js"
```

**Then restart your Claude Code window** (close + reopen, or run "Developer: Reload Window" in VSCode). The MCP server list is read at session start; without a restart the new server stays invisible to Claude.

---

## Part 7 — Verify

### CLI check (from any folder)

```bash
claude mcp list
```

Expected output (somewhere in the list):

```
wp-backend: node /Users/.../app/wp-backend-mcp/server.js - ✓ Connected
```

### Inside Claude Code

Open a new chat in the project. Type `/mcp`. You should see:

- `wp-backend` listed
- 48 tools under it (`discover_env`, `register_cpt`, `create_post`, `execute_ability`, etc.)

---

## Part 8 — Smoke tests

Run from the wp-backend-mcp folder so `.env` is loadable:

```bash
cd "$HOME/Local Sites/<sitename>/app/wp-backend-mcp"
set -a; source .env; set +a   # load env vars into your shell
```
Quick (recommended for Local dev) — add -k to curl
-k (a.k.a. --insecure) tells curl to skip cert verification. Safe for local dev sites.

### Test 1 — mu-plugin reachable + shared secret valid

```bash
curl -i "$WP_URL/wp-json/wp-backend-mcp/v1/discover" \
     -H "X-WP-MCP-Key: $WP_BACKEND_MCP_KEY" | head -40
```
```bash ( Insecure )
curl -ik "$WP_URL/wp-json/wp-backend-mcp/v1/discover" \
     -H "X-WP-MCP-Key: $WP_BACKEND_MCP_KEY" | head -40
```  

Expected: JSON with `wp_version`, `active_theme`, etc. **NOT** `{"code":"forbidden"}` (that means key mismatch).

### Test 2 — Core REST + Application Password OK

```bash
curl -s "$WP_URL/wp-json/wp/v2/users/me" \
     -u "$WP_USER:$(echo $WP_APP_PASSWORD | tr -d ' ')" | python3 -m json.tool | head -10
```
```bash ( Insecure )
curl -sk "$WP_URL/wp-json/wp/v2/users/me" \
     -u "$WP_USER:$(echo $WP_APP_PASSWORD | tr -d ' ')" | python3 -m json.tool | head -10
```  
Expected: JSON with your user's `id`, `name`, `roles`. **NOT** `{"code":"rest_not_logged_in"}` (that means app password wrong).

### Test 3 — [AI profile only] Abilities visible

```bash
curl -s "$WP_URL/wp-json/wp-backend-mcp/v1/abilities" \
     -H "X-WP-MCP-Key: $WP_BACKEND_MCP_KEY" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('Total:', len(d.get('abilities', []))); print('First 5:', [a['name'] for a in d.get('abilities', [])[:5]])"
```
```bash ( Insecure )
curl -sk "$WP_URL/wp-json/wp-backend-mcp/v1/abilities" \
     -H "X-WP-MCP-Key: $WP_BACKEND_MCP_KEY" \
   | python3 -c "import json,sys; d=json.load(sys.stdin); print('Total:', len(d.get('abilities', []))); print('First 5:', [a['name'] for a in d.get('abilities', [])[:5]])"
```

Expected: at least the 3 `core/*` abilities. If the AI plugin + abilities are enabled: also `ai/*` entries. If e2m-custom-abilities is active: `e2m/french-translation` too.

---

## Day-to-day usage

Inside Claude Code, just describe what you want:

> *"Install ACF, create a `service` CPT with `icon` (image), `short_description` (textarea), and `cta_label` (text). Add 3 sample services."*

Claude will route through tools like `mcp__wp-backend__install_plugin`, `register_cpt`, `create_field_group`, `create_post`. You'll see each call rendered as a chip.

**If you only see `Bash` / `curl` / `Edit` chips for a WP request, MCP didn't get used.** Common causes:

- Server not registered for the current project — run `claude mcp list`
- Claude Code window not restarted after `claude mcp add` — close + reopen

---

## Working as a team

- **`.env` is per-developer and per-project.** Never commit it. Each dev runs through Parts 3–4 themselves.
- **`WP_BACKEND_MCP_KEY` is per-project, shared.** Same value goes in everyone's `.env` and in `wp-config.php`. Store it in your team password manager.
- **`mu-plugins/wp-backend-mcp.php` belongs in the WP project's repo** under `wp-content/mu-plugins/`. New devs cloning the WP repo get it for free.
- **Application Passwords are personal.** Don't share them.

---

## Safety opt-ins (off by default)

Both are off until explicitly enabled in `wp-config.php`:

- `define( 'WP_BACKEND_MCP_ALLOW_EVAL', true );` enables the `run_php` tool (arbitrary PHP). Off by default. Only enable for one-off emergencies.
- `search_replace` defaults to `dry_run: true` and refuses `wp_users` / `wp_usermeta` outright.

Destructive deletes (`delete_plugin`, `delete_post`, `delete_user`, `delete_media`) are marked DESTRUCTIVE so Claude pauses before calling.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `claude mcp list` shows `wp-backend: ✗ Failed to connect` | `node` not in PATH for the shell Claude Code launched the MCP from, or the path to `server.js` is wrong. Test with `node /path/to/server.js` — it should print nothing and wait on stdin. Ctrl-C to exit. |
| Tools work but no `mcp__wp-backend__*` chips appear in chat | You added the MCP after this Claude Code window opened. **Restart the window.** |
| 403 forbidden on `/wp-json/wp-backend-mcp/v1/*` | `WP_BACKEND_MCP_KEY` mismatch. The string in `.env` and `wp-config.php` must be byte-identical (no extra whitespace, no quotes). |
| 401 on `/wp-json/wp/v2/users/me` | Wrong Application Password (regenerate at Users → Your Profile) or wrong `WP_USER`. |
| `self-signed certificate` from Node | Your `WP_URL` is https. Either flip to `http://` or set `WP_INSECURE_TLS=1` in `.env`. |
| `Theme folder not found` from filesystem tools | `WP_ROOT` doesn't point at the folder containing `wp-config.php`. |
| ACF tools return `412 no_acf` | ACF plugin isn't active. Run `install_plugin {slug:"advanced-custom-fields", activate:true}` first. |
| `execute_ability` returns `no_ability` | The named ability isn't registered on this site. Run `list_abilities` to see what's actually available. AI abilities require the AI plugin + a configured connector. |
| `execute_ability` returns `Service Unavailable (503)` or `cURL error 28: Operation timed out` for `ai/meta-description` | Almost always a bad model pick: the WP AI plugin's default preferred model is `gemini-3-flash-preview`, which is unreliable. Pin the feature to `gemini-2.5-flash` — see "Pinning a stable model" below. |
| `execute_ability` returns `400 Your credit balance is too low to access the Anthropic API` | The AI client routed to Anthropic, but that key has no credits. If you intended to use a different provider, deactivate `ai-provider-for-anthropic/plugin.php` (or clear the `connectors_ai_anthropic_api_key` option). Multiple active provider plugins → auto-select picks one — there's no "current provider" UI. |
| `execute_ability` returns `429 Quota exceeded ... free_tier_requests` | Gemini free tier is 20 RPM. Wait ~60s with **no** API traffic for the rolling window to clear; retries inside the window keep extending it. |
| `ability_invalid_input` with "input is not of type object" | Your `wp-backend-mcp` repo is older than the args-shape fix. `git pull` to get the latest, then restart Claude Code. |
| Server doesn't load `.env` | `.env` must be in the same folder as `server.js` (the Node server reads relative to its own path, not the CWD). |

---

### Pinning a stable model for an unreliable AI feature

When `ai/meta-description` (or any other AI feature) times out repeatedly on Gemini's preview models, override the model per-feature with the AI plugin's developer-mode option:

```bash
# Replace <feature-id> with the ability's feature id (e.g. meta-description, excerpt-generation, title-generation)
cd "$HOME/Local Sites/<sitename>/app/wp-backend-mcp"
set -a; source .env; set +a
curl -sk "$WP_URL/wp-json/wp-backend-mcp/v1/options/update" \
  -H "X-WP-MCP-Key: $WP_BACKEND_MCP_KEY" \
  -u "$WP_USER:$(echo $WP_APP_PASSWORD | tr -d ' ')" \
  -H "Content-Type: application/json" \
  -d '{"name":"wpai_feature_meta-description_field_developer","value":{"provider":"google","model":"gemini-2.5-flash"}}'
```

Or, from Claude Code: `mcp__wp-backend__update_option { name: 'wpai_feature_meta-description_field_developer', value: { provider: 'google', model: 'gemini-2.5-flash' } }`. The option must be stored as a PHP array; `update_option` in this MU-plugin does the necessary JSON→array conversion automatically (it didn't in versions before this fix — if you see a string `{"provider":...}` saved instead of `a:2:{...}` in `wp_options`, your mu-plugin is stale; re-copy from the repo).

---

## Updating the MU-plugin after `git pull`

Pulling a new version of this repo updates `mu-plugins/wp-backend-mcp.php` in the repo, **but not** the deployed copy under `wp-content/mu-plugins/`. After every pull that touches the mu-plugin, re-copy:

```bash
cp "$HOME/Local Sites/<sitename>/app/wp-backend-mcp/mu-plugins/wp-backend-mcp.php" \
   "$HOME/Local Sites/<sitename>/app/public/wp-content/mu-plugins/wp-backend-mcp.php"
```

If your team commits the deployed copy into the WP repo (recommended), this becomes a `git pull` in the WP repo instead and nobody has to remember a manual copy.

---

## Where to go next

- **Architecture, tool catalogue (48 tools)** → [README.md](README.md)
- **Open an issue / PR** if you find a bug or want a new tool
