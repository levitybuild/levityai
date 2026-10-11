# Levity AI editor protocol

The live documentation for the editor is this file: `docs/api-tool-calling.md`.

## Workspace visibility defaults

The frontend sends the selected `currentFile` and `fileStructure` on every request. By default, the API receives only the selected file's content plus the tree of paths. Contents of other files are not sent until the model requests them with `read_file`. The frontend must show that request and explicitly grant the file by sending its content in a follow-up request.

```json
{
  "currentFile": { "path": "src/App.tsx", "content": "..." },
  "fileStructure": ["src/App.tsx", "src/styles.css"],
  "files": [{ "path": "src/App.tsx", "content": "..." }]
}
```

## Structured find and replace

AI edit output is machine-readable in `structuredEdits`. The assistant may also describe the change in `message.content`, but the frontend should use the structured object for applying edits.

```json
{
  "type": "find_replace",
  "file": "src/App.tsx",
  "find": "<h1>Hello from Levity</h1>",
  "replace": "<h1>Yodel Leviathan</h1>",
  "expectedMatches": 1,
  "before": "...",
  "after": "...",
  "requiresApproval": true,
  "autoReplaceEligible": true
}
```

The API validates the exact match count before returning a proposal. Normal mode renders a review card and waits for Apply. Auto-replace mode may apply only `autoReplaceEligible` proposals and should still display the resulting status and file path.

For transport-oriented consumers, the same intent can be represented as XML-like blocks in assistant text:

```xml
<find file="src/App.tsx"><![CDATA[<h1>Hello from Levity</h1>]]></find>
<replace file="src/App.tsx"><![CDATA[<h1>Yodel Leviathan</h1>]]></replace>
```

Clients should prefer `structuredEdits`; parse text blocks only as a compatibility fallback. Never apply a replacement without exact-match validation.

## Read requests

A file read returns:

```json
{
  "type": "file_access_request",
  "action": "read",
  "file": "src/styles.css",
  "requiresFrontendGrant": true
}
```

The client presents a Grant access control. After approval, it resubmits the request with that file in `files`. The server remains bounded to the payload and never reads the browser filesystem itself.

## Status events

Every response includes `statuses`, ordered from oldest to newest. The UI should render the latest value while work is active: `thinking`, `reading current file and file structure`, `requesting file access`, `searching files`, `preparing edit`, `fetching endpoint`, `running JavaScript`, and `ready`. A client may use these values for a progress label, activity log, or accessibility live region.

## Frontend integration checklist

1. Send current file and path tree by default; omit unrelated contents.
2. Render `accessRequests` as an explicit permission prompt.
3. Render `structuredEdits` as a reviewable find/replace card.
4. Apply only after approval, unless the user enabled auto-replace.
5. Keep `before`, `after`, `file`, and status visible so the edit is auditable.
6. Keep API credentials and MCP credentials server-side.

The preview implementation is in `app/page.tsx`; the API contract is in `app/api/chat/route.ts`.

## Example request

```json
{
  "model": "provider/model",
  "autoReplace": false,
  "currentFile": { "path": "src/App.tsx", "content": "..." },
  "fileStructure": ["src/App.tsx", "package.json"],
  "files": [{ "path": "src/App.tsx", "content": "..." }],
  "messages": [{ "role": "user", "content": "Change the heading" }]
}
```

The response includes `message`, `rounds`, `statuses`, `structuredEdits`, and `accessRequests`.
