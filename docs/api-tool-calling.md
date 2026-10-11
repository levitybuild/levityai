# Levity API tool calling

All model requests and tool execution live in `POST /api/chat`; the browser is only a permissioned workspace client and renderer.

## Workspace payload

The frontend sends:

- `files`: authorized `{ path, content }` entries.
- `currentFile`: the selected file `{ path, content }`.
- `fileStructure`: paths visible to the agent.
- `messages`: the conversation.

The API cannot read files that are not in this payload. File tools return a `file_access_request` shape so a future client can explicitly grant access before exposing new content. Edit tools always return proposals and require user approval.

## Built-in tools

`list_files`, `read_file`, `search_files`, `find_replace`, `apply_patch`, `fetch_url`, `multi_fetch`, `run_javascript`, `mcp_tools`, and `mcp_call`.

When the user says “check Levity”, the server checks `https://api.levity.click/mcp` (or `LEVITY_MCP_URL`) first, lists tools, and calls the relevant MCP tool. If MCP returns another URL, the agent can inspect it with `fetch_url` or `multi_fetch`. MCP credentials stay server-side.

`fetch_url` is the network tool for endpoint testing and project creation APIs. `run_javascript` is deliberately limited to safe expressions; arbitrary process, filesystem, and unrestricted code execution are not exposed from a public API. Do not add those capabilities without authentication, isolation, resource limits, and an explicit security review.

## Status and CORS

Responses include `statuses`, such as `thinking`, `reading current file and file structure`, `checking Levity MCP`, `fetching endpoint`, or `running JavaScript`. The frontend renders the latest status while a request is active. `OPTIONS` and API responses allow cross-origin requests with `Access-Control-Allow-Origin: *`; add authentication before exposing write-capable tools publicly.

## Request example

```json
{
  "model": "provider/model",
  "currentFile": { "path": "src/App.tsx", "content": "..." },
  "fileStructure": ["src/App.tsx", "package.json"],
  "files": [{ "path": "src/App.tsx", "content": "..." }],
  "messages": [{ "role": "user", "content": "Check Levity" }]
}
```

The API performs the model/tool loop server-side and returns `message`, `rounds`, and `statuses`.
