# Levity AI editor API

The API route is `POST /api/chat`. The complete implementation is in `app/api/chat/route.ts`. The preview client is `app/page.tsx`.

## CORS

`OPTIONS`, `GET`, and `POST` responses include open CORS headers:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET,POST,OPTIONS`
- `Access-Control-Allow-Headers: content-type, authorization`

This allows a personal frontend hosted on another origin to call the route. Keep upstream credentials on the server; never send Hermes or MCP secrets from the browser.

## Workspace visibility

Send the current file and path-only tree by default. Do not send unrelated file contents until the user grants a `read_file` request.

```json
{
  "model": "provider/model",
  "autoReplace": false,
  "currentFile": { "path": "src/App.tsx", "content": "..." },
  "fileStructure": ["src/App.tsx", "src/styles.css", "src/lib/api.ts"],
  "files": [{ "path": "src/App.tsx", "content": "..." }],
  "messages": [{ "role": "user", "content": "Rename the heading" }]
}
```

## Response envelope

```json
{
  "message": { "role": "assistant", "content": "..." },
  "statuses": ["thinking", "reading current file and file structure", "preparing edit"],
  "structuredEdits": [],
  "fileOperations": [],
  "accessRequests": [],
  "rounds": 1,
  "model": "provider/model"
}
```

`statuses` is ordered oldest to newest. Render the last value while the request is active, and render `ready` after applying or approving a result.

## Find and replace

A `find_replace` tool call returns a `structuredEdits` item with `file`, exact `find`, `replace`, `expectedMatches`, `before`, `after`, `requiresApproval`, and `autoReplaceEligible`. Validate the exact match count in your client before applying. In normal mode show a review card. In auto mode apply only when `autoReplaceEligible` is true.

For text-only clients, the assistant may also emit compatibility blocks:

```xml
<find file="src/App.tsx"><![CDATA[old text]]></find>
<replace file="src/App.tsx"><![CDATA[new text]]></replace>
```

Prefer JSON `structuredEdits` over parsing assistant text.

## Read requests

The API only returns content for files included in `files`. A request for another file returns:

```json
{ "type": "file_access_request", "action": "read", "file": "src/styles.css", "requiresFrontendGrant": true }
```

Show a permission prompt. After approval, resubmit the request with that file added to `files`; the server does not read the browser filesystem.

## File operations

The model can request these operations. Every operation is returned in `fileOperations` and is approval-required by default:

- `delete`: remove `path`.
- `clear`: preserve `path` and replace its content with an empty string.
- `create`: add `path` with `content`.
- `create_folder`: create an empty folder marker or directory entry in your own workspace model.
- `move`: rename one file from `path` to `destination`.
- `move_folder`: rewrite every descendant path from `path/` to `destination/`.
- `duplicate`: copy `path` to `destination` without changing the source.

Example:

```json
{
  "type": "file_operation",
  "operation": "duplicate",
  "path": "src/App.tsx",
  "destination": "src/App.backup.tsx",
  "requiresApproval": true,
  "autoReplaceEligible": false
}
```

A client should either render an approval card and apply the operation after confirmation, or explicitly enable an operation policy for its own trusted environment. The preview uses the same `autoReplace` switch for convenience, but destructive operations are never marked auto-replace eligible by the API, so a production client should require a separate explicit policy for them.

## Client application rules

1. Treat paths as workspace-relative and reject traversal such as `../`.
2. Verify source existence and destination collisions before applying.
3. Keep operations auditable in an activity log.
4. Apply the operation to the client workspace only; the API returns intent and never mutates the browser filesystem.
5. Keep credentials server-side and enforce authentication/rate limits before exposing this route publicly.

## Example fetch

```js
const response = await fetch('https://your-app.example.com/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    autoReplace: false,
    currentFile: { path: 'src/App.tsx', content },
    fileStructure: ['src/App.tsx', 'src/styles.css'],
    files: [{ path: 'src/App.tsx', content }],
    messages: [{ role: 'user', content: 'Create src/utils.ts and move styles.css into src/ui/' }]
  })
})
const data = await response.json()
for (const operation of data.fileOperations ?? []) {
  // Show approval UI, then apply operation to your own file model.
  console.log(operation)
}
```

This documentation lives at `docs/api-tool-calling.md`.

## Security note

Open CORS is intentionally configured for personal frontend use. It is not authentication. Add authentication, origin restrictions, rate limiting, and server-side path validation before using this route for untrusted users or real repositories.

The API also exposes bounded network fetch and JavaScript evaluation through its tools. JavaScript receives the server-provided `fetch` function for network access, but has no filesystem, process, imports, or dynamic code-generation access.
