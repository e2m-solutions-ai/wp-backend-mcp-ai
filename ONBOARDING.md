# Onboarding — wp-backend-mcp

End-to-end setup for using `wp-backend-mcp` with [Claude Code](https://docs.claude.com/en/docs/claude-code) on a Local-by-Flywheel WordPress install (or any other local stack).

This guide covers two profiles:

- **Full profile** — WordPress nightly + WP AI Core + a connector + custom abilities. You get `mcp__wp-backend__execute_ability`, `list_abilities`, the e2m French-translation ability, auto-save hooks, etc.
- **Lite profile** — vanilla WordPress 6.5+, no AI plugins. You still get the 43 non-ability tools (CPT/ACF, plugins, themes, content, media, users, options, search-replace, child-theme + mu-plugin scaffolding, theme file r/w). Use this for projects where you only need backend automation.

If you only need the lite profile, skip every step labelled **[AI profile only]**.

---

## Paths used throughout

All examples assume a Local site named `<sitename>` on macOS. Substitute your own name.

| What | Path |
|---|---|
| Local site root | `~/Local Sites/<sitename>/` |
| WP install (contains `wp-config.php`) | `~/Local Sites/<sitename>/app/public/` |
| `wp-content/plugins/` | `~/Local Sites/<sitename>/app/public/wp-content/plugins/` |
| `wp-content/mu-plugins/` (plural!) | `~/Local Sites/<sitename>/app/public/wp-content/mu-plugins/` |
| Where you clone this repo | `~/Local Sites/<sitename>/app/wp-backend-mcp/` |
| Your `.env` | `~/Local Sites/<sitename>/app/wp-backend-mcp/.env` |
| `wp-config.php` | `~/Local Sites/<sitename>/app/public/wp-config.php` |
| Project Claude assets | `~/Local Sites/<sitename>/.claude/` |
| User-wide Claude assets | `~/.claude/` |

> **Note:** the **repo** ships a folder called `mu-plugin/` (singular — it holds one file). The **WordPress folder** you copy that file *into* is `mu-plugins/` (plural). Don't typo it; the plural folder is the one WordPress auto-loads.

> **Non-Local users:** any stack (MAMP, DDEV, plain LAMP, remote SSH) works. Wherever your WordPress install lives, that's `WP_ROOT`. The Node MCP server reads `.env` from its own folder; the mu-plugin lives in `<WP_ROOT>/wp-content/mu-plugins/`.

---

## Prerequisites

### System tools (all profiles)

- **Node.js 18 or newer** — `node -v` to confirm
- **Local-by-Flywheel** (or your local stack of choice)
- **Claude Code** — `claude --version`
- **Git** — to clone this repo
- **openssl** — for generating the MCP shared secret (ships with macOS)

### WordPress baseline (all profiles)

You need a working WordPress install with:

- An **admin user**
- Permalinks set to *Post name* (or any non-default) — required for the REST API to register pretty routes

### [AI profile only] WordPress version & plugins

The WP Abilities API ships in **WordPress 6.9** and isn't in the stable 6.8 release yet. For now you need a nightly:

```bash
# From Local: right-click your site → Open Site Shell, then:
wp core update --version=nightly --force
```

Easier alternative if you don't want WP-CLI: install the **WordPress Beta Tester** plugin from the directory, switch the channel to "Bleeding edge" (or "Beta/RC"), then **Dashboard → Updates → Update to <nightly>**.

Then install these plugins (Plugins → Add New → search by slug):

1. **AI** (slug: `ai`) — the WP AI Core, ships the Abilities API host
2. **AI Provider for Anthropic** (slug: `ai-provider-for-anthropic`) **OR** **AI Provider for Google** (slug: `ai-provider-for-google`)
   - Anthropic is more reliable for the `ai/meta-description` ability — Google Gemini's free tier frequently hits the 30s cURL timeout on that endpoint
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

### Claude assets (agents + skills)

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

Concrete example for site `coreai`:

```bash
cd "$HOME/Local Sites/coreai/app"
git clone <REPO_URL> wp-backend-mcp
cd wp-backend-mcp
npm install
```

After cloning, the layout looks like:

```
~/Local Sites/coreai/
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

The repo ships a single PHP file at `mu-plugin/wp-backend-mcp.php`. Copy it into WordPress's `mu-plugins/` (PLURAL):

```bash
# From inside the cloned repo:
cp mu-plugin/wp-backend-mcp.php \
   "$HOME/Local Sites/<sitename>/app/public/wp-content/mu-plugins/wp-backend-mcp.php"
```

Concrete example for site `coreai`:

```bash
cp mu-plugin/wp-backend-mcp.php \
   "$HOME/Local Sites/coreai/app/public/wp-content/mu-plugins/wp-backend-mcp.php"
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
WP_APP_PASSWORD=<paste from Part 3, KEEP the spaces>
WP_ROOT=$HOME/Local Sites/<sitename>/app/public
WP_BACKEND_MCP_KEY=<see Part 5>

# Optional — only set when WP_URL uses https:// (Local sometimes auto-enables SSL).
# Off by default; opt-in for trusted dev environments.
WP_INSECURE_TLS=1
```

Concrete example for site `coreai`:

```
WP_URL=http://coreai.local
WP_USER=admin
WP_APP_PASSWORD=ze4K dbHo 1LDs hMte FVlu 6mBq
WP_ROOT=/Users/yourname/Local Sites/coreai/app/public
WP_BACKEND_MCP_KEY=a3e9f1d7e8b24ea91c2e7d2b4f8a6c1
```

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

Concrete example for site `coreai`:

```bash
cd "$HOME/Local Sites/coreai"
claude mcp add wp-backend node "$HOME/Local Sites/coreai/app/wp-backend-mcp/server.js"
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
- 45+ tools under it (`discover_env`, `register_cpt`, `create_post`, `execute_ability`, etc.)

---

## Part 8 — Smoke tests

Run from the wp-backend-mcp folder so `.env` is loadable:

```bash
cd "$HOME/Local Sites/<sitename>/app/wp-backend-mcp"
set -a; source .env; set +a   # load env vars into your shell
```

Concrete example for site `coreai`:

```bash
cd "$HOME/Local Sites/coreai/app/wp-backend-mcp"
set -a; source .env; set +a
```

### Test 1 — mu-plugin reachable + shared secret valid

```bash
curl -s "$WP_URL/wp-json/wp-backend-mcp/v1/discover" \
     -H "X-WP-MCP-Key: $WP_BACKEND_MCP_KEY" | python3 -m json.tool | head -20
```

Expected: JSON with `wp_version`, `active_theme`, etc. **NOT** `{"code":"forbidden"}` (that means key mismatch).

### Test 2 — Core REST + Application Password OK

```bash
curl -s "$WP_URL/wp-json/wp/v2/users/me" \
     -u "$WP_USER:$(echo $WP_APP_PASSWORD | tr -d ' ')" | python3 -m json.tool | head -10
```

Expected: JSON with your user's `id`, `name`, `roles`. **NOT** `{"code":"rest_not_logged_in"}` (that means app password wrong).

### Test 3 — [AI profile only] Abilities visible

```bash
curl -s "$WP_URL/wp-json/wp-backend-mcp/v1/abilities" \
     -H "X-WP-MCP-Key: $WP_BACKEND_MCP_KEY" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('Total:', len(d.get('abilities', []))); print('First 5:', [a['name'] for a in d.get('abilities', [])[:5]])"
```

Expected: at least the 3 `core/*` abilities. If the AI plugin + abilities are enabled: also `ai/*` entries. If e2m-custom-abilities is active: `e2m/french-translation` too.

All three tests passing = your install is wired correctly.

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
- **`mu-plugin/wp-backend-mcp.php` belongs in the WP project's repo** under `wp-content/mu-plugins/`. New devs cloning the WP repo get it for free.
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
| `execute_ability` returns `Service Unavailable (503)` or `cURL error 28: Operation timed out` for `ai/meta-description` | Upstream AI provider is slow/overloaded (we've seen this consistently with Gemini's free tier — 30s cURL ceiling inside the WP AI Client). Retry, or switch to Anthropic in **Settings → AI → Connectors**. |
| `ability_invalid_input` with "input is not of type object" | Your `wp-backend-mcp` repo is older than the args-shape fix. `git pull` to get the latest, then restart Claude Code. |
| Server doesn't load `.env` | `.env` must be in the same folder as `server.js` (the Node server reads relative to its own path, not the CWD). |

---

## Where to go next

- **Architecture, tool catalogue (45 tools)** → [README.md](README.md)
- **Open an issue / PR** if you find a bug or want a new tool
