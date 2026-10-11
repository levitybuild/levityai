# Levity AI Editor API

This guide is the complete contract for integrating Levity AI into another JavaScript frontend. The public documentation page is:

**`/docs`** — for example, `https://your-domain.example/docs`

The API endpoint is `POST /api/chat`.

## 1. What the API does

Your frontend owns the workspace. The API does not directly mutate browser files. It receives the active file, a path-only file tree, and only the additional file contents your frontend has chosen to share. The AI returns:

- assistant text;
- ordered status strings;
- structured find/replace proposals;
- file-read permission requests;
- file-operation proposals such as create, delete, clear, move, duplicate, and folder operations.

Your frontend applies approved operations to its own editor or filesystem model.

## 2. CORS and endpoint discovery

`OPTIONS`, `GET`, and `POST /api/chat` include open CORS headers:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,POST,OPTIONS
Access-Control-Allow-Headers: content-type, authorization
```

Check available models:

```js
const response = await fetch('https://your-domain.example/api/chat')
const { provider, models } = await response.json()
console.log(provider, models)
```

Open CORS is intended for personal frontends. Add authentication, origin restrictions, rate limiting, and server-side authorization before exposing a real repository to untrusted users.

## 3. Sending a chat request

Always send the current file and its complete content. Send the file tree as paths only by default. Do not send every file's contents: the AI can request another file and your frontend can ask the user for permission.

```js
async function askLevity({ prompt, currentFile, fileTree, model }) {
  const response = await fetch('https://your-domain.example/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model, // optional; the API discovers one when omitted
      autoReplace: false,
      currentFile: {
        path: currentFile.path,
        content: currentFile.content,
      },
      fileStructure: fileTree, // string[] of workspace-relative paths
      files: [
        // Only files already granted to the AI belong here.
        { path: currentFile.path, content: currentFile.content },
      ],
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) throw new Error(await response.text())
  return response.json()
}

const result = await askLevity({
  prompt: 'Rename the heading to Yodel Leviathan',
  currentFile: { path: 'src/App.tsx', content: appSource },
  fileTree: ['src/App.tsx', 'src/styles.css', 'src/lib/api.js'],
})
```

`currentFile` may also be sent as a path string, but the object form is recommended because it makes the current content explicit.

## 4. Response shape

A successful response looks like this:

```js
{
  model: 'provider/model',
  message: { role: 'assistant', content: 'I found the heading...' },
  statuses: [
    'thinking',
    'reading current file and file structure',
    'preparing edit'
  ],
  structuredEdits: [],
  fileOperations: [],
  accessRequests: [],
  rounds: 2
}
```

`statuses` is ordered from oldest to newest. For a completed request, show the final status as `ready` in your UI. During a request, show the latest status rather than an animated generic "thinking" label:

```js
function statusLabel(result, isRunning) {
  if (!isRunning) return 'ready'
  const statuses = result?.statuses ?? []
  return statuses.at(-1) ?? 'thinking'
}

const response = await askLevity(request)
statusElement.textContent = statusLabel(response, false)
```

If you display progress while the HTTP request is pending, use `Sending request…`; replace it with `result.statuses.at(-1)` as soon as the response arrives. The API returns statuses after its tool loop completes, not as an SSE stream.

## 5. File read requests and permission flow

The AI can see the current file and path-only tree by default. It must not receive unrelated file content until your frontend grants it. When it needs another file, `accessRequests` contains an item like:

```js
{
  type: 'file_access_request',
  action: 'read',
  file: 'src/styles.css',
  requiresFrontendGrant: true
}
```

Show a permission prompt, then resubmit the conversation with that file in `files`. A browser client should read from its own editor model:

```js
async function continueAfterReadGrant({ request, previousMessages, workspace }) {
  const requestedPath = request.file
  const file = workspace.get(requestedPath)
  if (!file) throw new Error(`Unknown workspace file: ${requestedPath}`)

  return fetch('https://your-domain.example/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      currentFile: workspace.currentFile(),
      fileStructure: workspace.paths(),
      files: [
        { path: workspace.currentFile().path, content: workspace.currentFile().content },
        { path: file.path, content: file.content },
      ],
      messages: previousMessages,
    }),
  }).then((r) => r.json())
}

const requested = result.accessRequests?.[0]
if (requested) {
  const approved = window.confirm(`Allow Levity AI to read ${requested.file}?`)
  if (approved) result = await continueAfterReadGrant({
    request: requested,
    previousMessages: messages,
    workspace,
  })
}
```

Keep the assistant message and prior user messages when continuing. Do not put a file into `files` merely because it appears in `fileStructure`.

## 6. Find/replace proposals

A find/replace tool result is returned in `structuredEdits`:

```js
{
  type: 'find_replace',
  file: 'src/App.tsx',
  find: 'Hello from Levity',
  replace: 'Yodel Leviathan',
  expectedMatches: 1,
  before: '...',
  after: '...',
  requiresApproval: true,
  autoReplaceEligible: true
}
```

Apply only an exact match and verify the expected count immediately before changing the file:

```js
function applyFindReplace(workspace, edit) {
  const file = workspace.get(edit.file)
  if (!file) throw new Error(`File is missing: ${edit.file}`)

  const matches = file.content.split(edit.find).length - 1
  if (matches !== edit.expectedMatches) {
    throw new Error(`Expected ${edit.expectedMatches} matches, found ${matches}`)
  }

  workspace.update(edit.file, file.content.replace(edit.find, edit.replace))
}

for (const edit of result.structuredEdits ?? []) {
  if (edit.type !== 'find_replace') continue
  const approved = edit.autoReplaceEligible && autoReplaceEnabled
    ? true
    : window.confirm(`Apply replacement in ${edit.file}?`)
  if (approved) applyFindReplace(workspace, edit)
}
```

The API may also include compatibility XML in assistant text for text-only clients:

```xml
<find file="src/App.tsx"><![CDATA[Hello from Levity]]></find>
<replace file="src/App.tsx"><![CDATA[Yodel Leviathan]]></replace>
```

Prefer `structuredEdits`. Only parse XML when `structuredEdits` is unavailable, and require matching `file` values plus an exact match count.

## 7. Auto find/replace mode

Enable automatic application by sending `autoReplace: true`:

```js
const result = await askLevity({
  prompt: 'Update the heading',
  currentFile,
  fileTree,
  autoReplace: true,
})
```

The API marks ordinary exact find/replace edits with `autoReplaceEligible: true`. Your frontend still performs the final exact-match validation. Never auto-apply a general diff or a destructive file operation. A safe dispatcher is:

```js
function applyResult(result, workspace, { autoReplace }) {
  for (const edit of result.structuredEdits ?? []) {
    if (edit.type !== 'find_replace') continue
    if (!autoReplace || !edit.autoReplaceEligible) continue
    applyFindReplace(workspace, edit)
  }
}
```

For a production product, make auto mode an explicit user setting and show an activity log of every applied edit.

## 8. File operations

All file operations are returned as approval-required proposals. The API never changes your frontend workspace. Each item has `type: 'file_operation'`, an `operation`, and workspace-relative paths.

```js
{
  type: 'file_operation',
  operation: 'create',
  path: 'src/utils/format.js',
  content: 'export function format() {}',
  requiresApproval: true,
  autoReplaceEligible: false
}
```

Supported operations:

| Operation | Fields | Meaning |
|---|---|---|
| `create` | `path`, `content` | Create a new file. |
| `clear` | `path` | Preserve the file and replace content with `''`. |
| `delete` | `path` | Delete a file. |
| `create_folder` | `path` | Create a folder entry. |
| `move` | `path`, `destination` | Move or rename one file. |
| `move_folder` | `path`, `destination` | Move every descendant path. |
| `duplicate` | `path`, `destination` | Copy a file and preserve the source. |

Apply them only after confirmation and validate paths/collisions:

```js
function validatePath(path) {
  if (!path || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error(`Unsafe workspace path: ${path}`)
  }
}

function applyOperation(workspace, operation) {
  validatePath(operation.path)
  if (operation.destination) validatePath(operation.destination)

  switch (operation.operation) {
    case 'create':
      if (workspace.has(operation.path)) throw new Error('Destination already exists')
      workspace.create(operation.path, operation.content ?? '')
      break
    case 'clear':
      workspace.update(operation.path, '')
      break
    case 'delete':
      workspace.delete(operation.path)
      break
    case 'create_folder':
      workspace.createFolder(operation.path)
      break
    case 'move':
      workspace.move(operation.path, operation.destination)
      break
    case 'move_folder':
      workspace.moveFolder(operation.path, operation.destination)
      break
    case 'duplicate':
      if (workspace.has(operation.destination)) throw new Error('Destination already exists')
      workspace.duplicate(operation.path, operation.destination)
      break
    default:
      throw new Error(`Unsupported operation: ${operation.operation}`)
  }
}

for (const operation of result.fileOperations ?? []) {
  const approved = window.confirm(`Allow ${operation.operation} ${operation.path}?`)
  if (approved) applyOperation(workspace, operation)
}
```

Do not treat `autoReplace: true` as permission to auto-apply these operations. They are destructive or structural and remain approval-required. Keep undo support and an audit log.

## 9. Complete integration loop

This is a compact controller showing the recommended order: send the current file, display statuses, grant reads, review edits, and apply approved operations.

```js
async function runLevity(prompt, workspace, options = {}) {
  const request = {
    autoReplace: Boolean(options.autoReplace),
    currentFile: workspace.currentFile(),
    fileStructure: workspace.paths(),
    files: workspace.grantedFiles(),
    messages: [{ role: 'user', content: prompt }],
  }

  setStatus('Sending request…')
  let result = await fetch('https://your-domain.example/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  }).then(async (response) => {
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  })

  setStatus(result.statuses?.at(-1) ?? 'ready')

  for (const readRequest of result.accessRequests ?? []) {
    if (!await askPermission(`Read ${readRequest.file}?`)) continue
    workspace.grant(readRequest.file)
    // Re-run with the same conversation and newly granted file content.
    result = await runLevity(prompt, workspace, options)
  }

  applyResult(result, workspace, options)
  for (const operation of result.fileOperations ?? []) {
    if (await askPermission(`Apply ${operation.operation} to ${operation.path}?`)) {
      applyOperation(workspace, operation)
    }
  }

  setStatus('ready')
  return result
}
```

In a real implementation, preserve the conversation messages and add a loop guard when continuing after a read request; the example focuses on the event flow.

## 10. Security requirements

- Treat every path as workspace-relative. Reject absolute paths and `..` traversal.
- Do not expose upstream provider credentials in browser code.
- Do not auto-apply delete, clear, move, move-folder, duplicate, create, or folder operations.
- Check source existence and destination collisions before applying.
- Keep an undo stack and an audit log.
- Add authentication and rate limiting before using the open-CORS endpoint with real repositories.
- The API's JavaScript tool has bounded network access through its provided `fetch`; it does not have filesystem or process access.

The browser-facing implementation in this project is `app/page.tsx`. The server contract is `app/api/chat/route.ts`. This page is the canonical, untruncated integration reference: **`/docs`**.
