# Long Form MCP

Production MCP endpoint:

`https://reader.antonioskilton.com/api/mcp`

## Tool model

Long Form keeps the model-facing surface intentionally narrow. The MCP does not expose SQL, generic HTTP requests, or arbitrary user IDs.

| Tool | Scope | Effect |
| --- | --- | --- |
| `get_profile` | `reader:read` | Identify the connected account |
| `list_sources`, `find_feeds`, `preview_sources` | `reader:read` | Inspect recurring sources and chronological candidates |
| `add_source` | `reader:read reader:write` | Add a recurring website/feed |
| `get_editorial_brief`, `get_editor_settings` | `reader:read` | Read explicit editorial preferences |
| `update_editorial_brief`, `update_editor_settings` | `reader:read reader:write` | Apply explicitly requested preferences within fixed product rules |
| `get_delivery_history`, `get_packet_status` | `reader:read` | Retrieve actual delivery records and packet status |
| `send_packet`, `send_now` | `reader:read reader:write` | Queue explicitly requested standalone or recurring delivery |
| `list_publications` | `reader:read` | List finite editions, featured paths and preparation status |
| `read_publication_article` | `reader:read` | Retrieve the actual original, numbered paragraphs and reading state |
| `discuss_reading` | `reader:read reader:write` | Persist discussion grounded in edition, article, source/library and delivery context; steering remains temporary |
| `compose_reading_edition` | `reader:read reader:write` | Prepare Tonight’s Reading without sending |
| `send_publication` | `reader:read reader:write` | Send the reviewed edition’s exact frozen EPUB |
| `get_publication_status` | `reader:read` | Observe preparation/delivery status and omissions |

Publication capabilities delegate to the same authenticated application routes used by Long Form. The server derives tenant identity from OAuth and creates a short-lived internal session; callers cannot supply another user ID. No arbitrary database or HTTP tool is exposed.

Composition, discussion and sending use stable `request_key` values for retries. Composition never sends automatically. Clients must inspect the prepared edition, wait for an explicit user send instruction, and then observe the returned delivery job. `sent` and `partial` indicate email-provider acceptance, not confirmed Kindle arrival. A `partial` result may describe preparation/media notes; clients must read those notes before claiming an article was omitted.

Daily editions retain every deterministically eligible subscribed original. The featured path is a finite view; sending a daily edition includes Further reading. Tonight’s Reading sends the selected originals in their composed order. Neither path replaces original authors with generated summaries.

Durable nighttime preference proposals require the separate confirmation in Long Form. `discuss_reading` does not silently apply them. Existing explicit settings tools remain available for user-authorized settings changes; fixed eligibility and delivery rules cannot be overridden.

## OAuth

The protected resource is the exact MCP URL. The authorization server is the Long Form custom domain.

The flow:
1. Client discovers protected-resource metadata.
2. Client discovers authorization-server metadata.
3. Client presents a CIMD client ID and registered redirect URI.
4. Long Form requires PKCE S256.
5. User signs in with the existing email-code flow and approves requested scopes.
6. The authorization code is exchanged for an opaque access token and rotating refresh token.
7. The MCP hashes the presented token and validates resource, expiry, revocation, scopes, and user identity before tool execution.

## Test coverage completed during implementation

Production-domain smoke tests exercised:
- MCP `initialize`
- `tools/list` and tool schemas/annotations
- OAuth protected-resource and authorization-server metadata
- PKCE/redirect validation on the authorization endpoint
- unauthenticated linking challenge
- read-only token rejection for write tools
- `get_profile`
- `list_editions`
- `create_edition`
- `find_feeds`
- `add_source`
- `preview_edition`
- cross-tenant edition access rejection
- `send_now` through the real backend precondition path

A complete ChatGPT-host OAuth callback/token exchange remains the final host-level smoke test.
