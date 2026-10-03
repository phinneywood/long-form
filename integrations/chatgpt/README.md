# Long Form ChatGPT integration

Canonical source candidate for the existing Long Form 1.2.0 cloud skill/package, relocated from `phinneywood/chatgpt-plugins@ab571a5c74d481a1efe4bd6e585d6f022ae87f01`.

## Build

From this directory:

```sh
python3 scripts/build_plugin.py long-form-kindle --output dist
```

The archive contains the existing `long-form-kindle` manifest, registered-app mapping and skill resources. Keep the plugin identity and version during source relocation. This source candidate does not replace the separately registered Long Form service or the earlier MCP plugin under `plugin/long-form/`.

## Compatibility and scope

- Existing web UI, API, MCP and delivery implementation continue to own product behavior.
- The `.app.json` registered-service mapping is retained exactly. It is public service wiring, not a credential; other distributors need an authorized registered connection.
- Source updates do not upgrade an installed cloud plugin automatically.
- Personal installation IDs and verification chat URLs stay in private deployment records.
- The copied release record's source revisions refer to the original collection. Previous runtime evidence retains its original scope.
- Merge and validate this integration before removing the collection's source copy or updating deployment pointers.

MIT applies to the original skill/package source in this directory; preserve [the license](LICENSE).

## Relocation verification

Rebuilt 1.2.0 archive SHA-256 `2d0d6538ab04ef0228f3a560ebff874cb2a95ae369b07fb95a66eca41da7294f` matches the installed release. Portable convention checks pass; instruction bytes and service mapping are unchanged. This is package compatibility proof; no new delivery, deployment or fresh installation was performed by the source move.
