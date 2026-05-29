# wp-backend-mcp
## How it all works (deep dive)

### What is MCP?

**Model Context Protocol** is a small JSON-RPC spec that lets a language-model client (Claude Code, ChatGPT desktop, etc.) call **tools** running in a separate process. The client and tool process talk to each other in one of three transports — `stdio` (most common for local dev), HTTP, or WebSockets — exchanging messages like `tools/list`, `tools/call`, `prompts/list`.

The point: Claude doesn't need to know how to do plugin installs, SSH into servers, or run shell commands. It just sees a list of **tools** with a name, description, and JSON-Schema for input. The Claude client decides "I'll call `register_cpt` with these args", sends one JSON-RPC message, and the MCP server on the other end does the actual work.

So the protocol is just **standardized plumbing for tool discovery and invocation**.

### Three-layer architecture

```
┌──────────────────────┐  JSON-RPC over stdio  ┌──────────────────────┐    HTTPS    ┌───────────────────────┐
│ Claude Code (host)   │ ────────────────────► │ Node MCP server      │ ──────────► │  WordPress            │
│                      │                       │  (server.js)         │             │  (wp-config + plugins)│
│ "register a Post     │ ◄──────────────────── │  48 tool dispatch    │ ◄────────── │   /wp-json/wp/v2/*    │
│  Type called Service"│                       │  + axios + dotenv    │             │   /wp-json/wp-backend-│
└──────────────────────┘                       └──────────────────────┘             │     mcp/v1/*          │
                                                                                    └───────────────────────┘
                                                                                              ▲
                                                                                              │ loaded as
                                                                                              │ a must-use
                                                                                              │ plugin
                                                                                    ┌─────────┴──────────────┐
                                                                                    │ mu-plugins/             │
                                                                                    │  wp-backend-mcp.php     │
                                                                                    │  (companion REST       │
                                                                                    │   routes + safety)     │
                                                                                    └────────────────────────┘
```

| Layer | Process | Job |
|---|---|---|
| **Claude Code** | running on your Mac | Decides which tool to call, with what arguments |
| **Node MCP server** | child process spawned by Claude Code (`node server.js`) | Knows about WordPress; translates each tool call into one or more HTTP requests |
| **WordPress + companion mu-plugin** | nginx + PHP-FPM in your Local stack | Does the actual work: registers CPTs, updates ACF, writes postmeta, executes abilities, etc. |

### Auth model (two layers)

- **WordPress Application Password** (Basic auth) — proves to WP that you're the admin user. Sent on every request to `/wp-json/wp/v2/*` (core REST).
- **`X-WP-MCP-Key` shared secret** — proves the request came from this MCP server (not a random browser hitting `/wp-json/`). Only required on the custom `/wp-json/wp-backend-mcp/v1/*` routes registered by the mu-plugin.

The mu-plugin compares the header to `WP_BACKEND_MCP_KEY` (from `wp-config.php`) using `hash_equals` — constant-time, so timing attacks don't leak the secret.

### File-by-file walkthrough

## File map

```
wp-backend-mcp/
├── package.json
├── .env.example
├── README.md
├── ONBOARDING.md            # end-to-end team setup walkthrough
├── server.js                # MCP entrypoint + dispatcher
├── lib/
│   ├── tools.js             # Tool schemas (the surface Claude sees)
│   ├── wp.js                # axios clients (core REST + MU-plugin REST)
│   └── paths.js             # Filesystem path helpers (WP_ROOT validation, safeJoin)
├── handlers/
│   ├── rest.js              # All REST-backed tool handlers
│   └── fs.js                # All filesystem-backed tool handlers
└── mu-plugins/
    └── wp-backend-mcp.php   # Companion MU-plugin (drop into wp-content/mu-plugins/)
```

#### `server.js` — the entrypoint and dispatcher

Three things at startup:

1. **`dotenv/config`** reads `.env` from the script's own folder (so `WP_URL`, `WP_USER`, `WP_APP_PASSWORD`, `WP_BACKEND_MCP_KEY`, etc. land in `process.env`).
2. **Create an `McpServer` instance** from `@modelcontextprotocol/sdk`. This handles the JSON-RPC framing over stdio.
3. **Wire each tool** with `server.tool(name, schema, dispatcher)`. There's one tiny dispatcher object that maps tool names → handler functions. When Claude calls `tools/call`, the SDK looks up the name and invokes our function.

`server.js` is just the wiring harness — all the actual logic lives in `handlers/`.

#### `lib/tools.js` — tool schemas

This is the **only thing Claude sees** about your server. An exported array, one entry per tool:

```js
{
  name: 'register_cpt',
  description: 'Register a Custom Post Type via ACF…',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Post type slug…' },
      labels: { type: 'object', properties: { singular: {…}, plural: {…} } },
      args: { type: 'object', additionalProperties: true },
    },
    required: ['key'],
  },
}
```

Two reasons this file is centralized:

- The descriptions are what Claude reads to decide whether to use a tool. Good descriptions = right tool gets chosen.
- The JSON-Schema is enforced by the MCP SDK before your handler ever runs — so by the time `handlers/rest.js` gets called, it can trust the args shape.

(The `args` having `type: 'object'` here matters — without it, some MCP SDKs string-serialize objects.)

#### `lib/wp.js` — HTTP clients

Two pre-configured axios instances:

- **`core`** — for `/wp-json/wp/v2/*`. Adds Basic auth (the Application Password).
- **`mcp`** — for `/wp-json/wp-backend-mcp/v1/*` (custom mu-plugin routes). Adds **both** Basic auth (so WP knows which user) **and** `X-WP-MCP-Key` (so the mu-plugin gate accepts it).

Two helper functions wrap these: `coreRequest(method, path, opts)` and `mcpRequest(method, path, opts)`. Each formats responses uniformly as `{ ok, status, data }` or `{ ok: false, status, error }` so handlers can return a consistent shape to Claude.

Also handles the `WP_INSECURE_TLS=1` opt-in — builds an `https.Agent({ rejectUnauthorized: false })` when set, so Local-by-Flywheel's self-signed certs don't blow up Node.

#### `lib/paths.js` — filesystem path safety

Small but important. All filesystem tools (`write_theme_file`, `create_mu_plugin`, etc.) accept a relative path. If you write theme files, you should write **only** under the theme folder — never escape to `/etc/passwd`. This file:

- Resolves the absolute path of a requested file against the base directory.
- Uses `path.resolve` + a `startsWith()` check to confirm the resolved path is still inside the base.
- Throws if it isn't.

Classic defense against `../../` traversal.

#### `handlers/rest.js` — REST-backed tool implementations

Where the real work happens. Every tool that talks to WordPress is one function here. Two flavors based on which REST namespace they call:

**Core REST tools** (`/wp/v2/…`) — anything WordPress exposes natively. Posts, pages, media, users, taxonomies, plugin activate/deactivate, themes list. These are one-liners that wrap `coreRequest`:

```js
export async function create_post({ type = 'posts', data }) {
  return await coreRequest('POST', `/wp/v2/${type}`, { data });
}
```

**Custom REST tools** (`/wp-backend-mcp/v1/…`) — anything WP doesn't natively support. Plugin install (needs `Plugin_Upgrader`), ACF CPT/field group registration, options, search-replace, transients, abilities, raw PHP eval, etc. These go through `mcpRequest`:

```js
export async function execute_ability({ name, args }) {
  return await mcpRequest('POST', '/wp-backend-mcp/v1/abilities/execute',
    { data: { name, input: args } });
}
```

(Note `input: args` — the workaround for WP REST shadowing the reserved `args` param name.)

#### `handlers/fs.js` — filesystem-backed tool implementations

For tools that touch the local disk directly without going through WordPress:

- `create_child_theme` — scaffolds a child theme folder under `wp-content/themes/` (creates `style.css`, `functions.php`).
- `create_mu_plugin` — writes a file under `wp-content/mu-plugins/`.
- `read_theme_file` / `write_theme_file` / `list_theme_files` — direct filesystem operations on the active (or named) theme folder, gated by `paths.js`.

Why filesystem and not REST? WordPress's REST API doesn't expose write-to-disk operations for theme files (safer for production). For local dev, direct write is fine — and faster than going through PHP.

#### `mu-plugins/wp-backend-mcp.php` — the companion plugin

The MCP server's "sidekick" inside WordPress. One PHP file you drop into `wp-content/mu-plugins/` of every WP site you want Claude to manage.

Its job: register REST routes for everything WP doesn't ship natively. Each route is declared like:

```php
register_rest_route( 'wp-backend-mcp/v1', '/abilities/execute', [
    'methods'             => 'POST',
    'permission_callback' => [ __CLASS__, 'permission' ],  // ← checks shared secret
    'callback'            => [ __CLASS__, 'abilities_execute' ],
] );
```

Notable functions inside the `WP_Backend_MCP_Bridge` class:

| Function | What it does |
|---|---|
| `permission( $request )` | Compares the `X-WP-MCP-Key` header against `WP_BACKEND_MCP_KEY` using `hash_equals` (constant-time). |
| `discover()` | Returns WP version, active theme, plugin list, post types — Claude's "tell me about this site" call. |
| `plugin_install()` | Uses `Plugin_Upgrader` to install from WordPress.org. The only sane way to add plugins programmatically. |
| `acf_register_cpt()` | Calls `acf_update_internal_post_type()` with the right payload, including the title-field fix. |
| `acf_create_field_group()` | Calls `acf_update_field_group()`, then resolves the group key to its numeric ID before saving each field (the parent-ID fix). |
| `acf_update_value()` | Wraps ACF's `update_field()` — writes both the value and the underscore-key pointer row. |
| `abilities_list()` | Triggers `WP_Abilities_Registry::get_instance()` (lazy-init fix), then returns everything from `wp_get_abilities()`. |
| `abilities_execute()` | Pulls `input` (or `args` fallback, or raw-body fallback) — JSON-decodes if it's a string — and calls `$ability->execute($input)`. |
| `sr()` (search-replace) | Defaults to dry-run; refuses `wp_users`/`wp_usermeta`. |
| `php_eval()` | Runs arbitrary PHP — **only** if `WP_BACKEND_MCP_ALLOW_EVAL` is true in `wp-config.php`. Off by default. |

**New here? Read [ONBOARDING.md](ONBOARDING.md) first — it walks through Local-by-Flywheel setup, the WordPress 7 + PHP 8 baseline, AI plugin install, connector, abilities, mu-plugin install, `.env`, claude mcp add, verify, and smoke tests, in copy-pasteable steps.**

## Tool catalogue (48 tools)

| Group        | Tool names |
|--------------|-----------|
| Discovery    | `discover_env` |
| Plugins      | `list_plugins`, `install_plugin`, `activate_plugin`, `deactivate_plugin`, `delete_plugin` |
| Themes       | `list_themes`, `activate_theme`, `get_active_theme_info` |
| CPT/ACF      | `register_cpt`, `register_taxonomy`, `create_field_group`, `add_field`, `list_acf`, `update_acf_field_value` |
| Content      | `list_posts`, `get_post`, `create_post`, `update_post`, `delete_post`, `set_post_meta` |
| Media        | `list_media`, `upload_media`, `update_media`, `delete_media` |
| Taxonomies   | `list_terms`, `create_term`, `assign_terms_to_post` |
| Options      | `get_option`, `update_option` |
| Menus        | `list_menus`, `create_menu`, `assign_menu_location` |
| Users        | `list_users`, `create_user`, `update_user`, `delete_user` |
| Maintenance  | `search_replace`, `flush_rewrite_rules`, `clear_transients`, `run_php` |
| Abilities    | `list_abilities`, `execute_ability` |
| Filesystem   | `create_child_theme`, `create_mu_plugin`, `read_theme_file`, `write_theme_file`, `list_theme_files` |


### A request lifecycle, end-to-end

Let's trace **"create a post titled X"**:

1. **You type in Claude Code:** "Create a post titled 'Hello' on this site."
2. **Claude picks a tool.** It scans the `tools.js` descriptions, finds `create_post` matches, and emits a JSON-RPC `tools/call` over stdin to our Node process.
3. **MCP SDK** decodes the message, finds `create_post` in our dispatcher, and calls our handler with `{ type: 'posts', data: { title: 'Hello', status: 'publish' } }`.
4. **`handlers/rest.js`'s `create_post`** calls `coreRequest('POST', '/wp/v2/posts', { data })`.
5. **`lib/wp.js`'s `coreRequest`** constructs `https://yoursite.local/wp-json/wp/v2/posts`, adds `Authorization: Basic <base64 of user:app_password>`, and `await core.request(...)`.
6. **HTTPS round trip.** WordPress receives the request. Core REST routing → `WP_REST_Posts_Controller::create_item()` → `wp_insert_post()` → save_post hooks fire (including any of e2m's auto-AI hooks).
7. **WP responds** with the created post as JSON.
8. **`coreRequest`** formats it as `{ ok: true, status: 201, data: {…} }`.
9. **Handler returns to MCP SDK**, SDK frames it as a JSON-RPC response, writes to stdout.
10. **Claude Code reads the result**, sees `id: 123, status: 'publish'`, and tells you "Created post 123."

For abilities (`execute_ability`), the same flow — but step 4 goes through `mcpRequest` to `/wp-backend-mcp/v1/abilities/execute`, which lands in the mu-plugin's `abilities_execute` method, which calls `$ability->execute(...)` — and that internally hits Anthropic/Google via `wp_ai_client_prompt()`.

## Example: end-to-end ("install ACF, make a `service` CPT with 3 fields, add a sample post")

What Claude would call:

1. `discover_env` — checks ACF status.
2. `install_plugin { slug: "advanced-custom-fields", activate: true }`
3. `register_cpt { key: "service", labels: { singular: "Service", plural: "Services" } }`
4. `create_field_group {
     title: "Service Fields",
     location: [[{ param: "post_type", operator: "==", value: "service" }]],
     fields: [
       { name: "icon",              type: "image",    return_format: "id" },
       { name: "short_description", type: "textarea" },
       { name: "cta_label",         type: "text",     default_value: "Learn more" }
     ]
   }`
5. `flush_rewrite_rules`
6. `create_post { type: "service", data: { title: "Web Design", status: "publish", acf: { short_description: "...", cta_label: "Get a quote" } } }`
