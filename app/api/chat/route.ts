import { NextRequest, NextResponse } from 'next/server'

const HERMES_BASE = 'https://hermes.ai.unturf.com/v1'
const MCP_URL = process.env.LEVITY_MCP_URL || 'https://api.levity.click/mcp'

type WorkspaceFile = { path: string; content: string }
type ChatMessage = { role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }

const toolDefinitions = [
  { type: 'function', function: { name: 'list_files', description: 'List files the user authorized for this workspace.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'read_file', description: 'Read one authorized workspace file.', parameters: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] } } },
  { type: 'function', function: { name: 'search_files', description: 'Search authorized files for an exact or regex string.', parameters: { type: 'object', properties: { query: { type: 'string' }, regex: { type: 'boolean' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'find_replace', description: 'Propose an exact replacement in an authorized file. Never applies it automatically.', parameters: { type: 'object', properties: { file: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' }, expectedMatches: { type: 'number' } }, required: ['file', 'find', 'replace', 'expectedMatches'] } } },
  { type: 'function', function: { name: 'apply_patch', description: 'Propose a reviewed patch. The frontend must ask the user before applying the returned diff.', parameters: { type: 'object', properties: { file: { type: 'string' }, content: { type: 'string' }, reason: { type: 'string' } }, required: ['file', 'content', 'reason'] } } },
  { type: 'function', function: { name: 'fetch_url', description: 'Fetch a URL and return status and bounded text.', parameters: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] }, body: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'multi_fetch', description: 'Fetch several URLs in parallel.', parameters: { type: 'object', properties: { requests: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' } }, required: ['url'] } } }, required: ['requests'] } } },
  { type: 'function', function: { name: 'run_javascript', description: 'Run a small pure JavaScript expression for parsing, transformation, or assertions. For network endpoint tests use fetch_url or multi_fetch; process and filesystem access are intentionally unavailable.', parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } } },
  { type: 'function', function: { name: 'mcp_tools', description: 'List tools available from the configured Levity MCP endpoint.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'mcp_call', description: 'Call a tool on the configured Levity MCP endpoint.', parameters: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name'] } } },
]

function safePath(file: string, files: WorkspaceFile[]) { return files.find((item) => item.path === file) }
function bounded(value: string, max = 12000) { return value.length > max ? `${value.slice(0, max)}\n… truncated` : value }

async function executeTool(name: string, args: Record<string, unknown>, files: WorkspaceFile[]): Promise<unknown> {
  if (name === 'list_files') return { files: files.map(({ path, content }) => ({ path, bytes: content.length })) }
  if (name === 'read_file') { const file = safePath(String(args.file), files); return file ? { file: file.path, content: bounded(file.content, 30000) } : { error: 'File is not authorized.' } }
  if (name === 'search_files') {
    const query = String(args.query); let matcher: RegExp
    try { matcher = args.regex ? new RegExp(query, 'g') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') } catch { return { error: 'Invalid regular expression.' } }
    return { matches: files.flatMap((file) => { const lines = file.content.split('\n'); return lines.flatMap((line, index) => matcher.test(line) ? [{ file: file.path, line: index + 1, text: line.slice(0, 500) }] : []) }).slice(0, 100) }
  }
  if (name === 'find_replace') {
    const file = safePath(String(args.file), files); if (!file) return { error: 'File is not authorized.' }
    const find = String(args.find); const matches = file.content.split(find).length - 1
    if (matches !== Number(args.expectedMatches)) return { error: `Expected ${args.expectedMatches} matches but found ${matches}. No change proposed.` }
    return { type: 'diff', file: file.path, before: file.content, after: file.content.replace(find, String(args.replace)), matches, requiresApproval: true }
  }
  if (name === 'apply_patch') return { type: 'diff', file: String(args.file), content: String(args.content), reason: String(args.reason), requiresApproval: true }
  if (name === 'fetch_url') {
    try { const response = await fetch(String(args.url), { method: String(args.method || 'GET'), body: args.body ? String(args.body) : undefined, signal: AbortSignal.timeout(10000) }); return { status: response.status, url: response.url, body: bounded(await response.text()) } } catch (error) { return { error: error instanceof Error ? error.message : 'Fetch failed' } }
  }
  if (name === 'multi_fetch') { const requests = Array.isArray(args.requests) ? args.requests : []; return { results: await Promise.all(requests.slice(0, 8).map((request) => executeTool('fetch_url', request as Record<string, unknown>, files)) ) } }
  if (name === 'run_javascript') { try { const code = String(args.code); if (/[;{}]|(fetch|process|globalThis|require|import|Deno|Bun|eval)/.test(code)) return { error: 'Only simple expressions are allowed.' }; return { result: Function(`"use strict"; return (${code})`)() } } catch (error) { return { error: error instanceof Error ? error.message : 'Execution failed' } } }
  if (name === 'mcp_tools' || name === 'mcp_call') {
    const request = async (method: string, params: Record<string, unknown>) => {
      const response = await fetch(MCP_URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }), signal: AbortSignal.timeout(15000) })
      const text = await response.text()
      if (!response.ok) return { error: `Levity MCP HTTP ${response.status}`, body: bounded(text, 4000) }
      try { return JSON.parse(text) } catch { return { body: bounded(text, 12000) } }
    }
    await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'levity-ai', version: '1.0.0' } })
    await request('notifications/initialized', {})
    return request(name === 'mcp_tools' ? 'tools/list' : 'tools/call', name === 'mcp_tools' ? {} : { name: args.name, arguments: args.arguments || {} })
  }
  return { error: `Unknown tool: ${name}` }
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 10000): Promise<{ response: Response; data: unknown }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  const text = await response.text()
  if (!text.trim()) return { response, data: null }
  try { return { response, data: JSON.parse(text) } } catch { return { response, data: { raw: bounded(text, 4000) } } }
}

async function discoverModel(): Promise<string | null> {
  const { response, data } = await fetchJson(`${HERMES_BASE}/models`)
  if (!response.ok || !data || typeof data !== 'object') return null
  const models = (data as { data?: Array<{ id?: unknown }> }).data
  return Array.isArray(models) && typeof models[0]?.id === 'string' ? models[0].id : null
}

export async function GET() {
  try {
    const modelsResult = await fetchJson(`${HERMES_BASE}/models`, undefined, 5000)
    if (!modelsResult.response.ok) return NextResponse.json({ error: `Hermes models request failed (${modelsResult.response.status})` }, { status: 502 })
    return NextResponse.json({ provider: 'Hermes / Unturf', models: modelsResult.data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Hermes discovery failed' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json(); const files: WorkspaceFile[] = Array.isArray(body.files) ? body.files.filter((file: WorkspaceFile) => file && typeof file.path === 'string' && typeof file.content === 'string').slice(0, 200) : []
    const requestedModel = typeof body.model === 'string' && body.model !== 'loading model…' && body.model !== 'Hermes model unavailable' && body.model !== 'offline' ? body.model : null
    const model = requestedModel || await discoverModel()
    if (!model) return NextResponse.json({ error: 'Hermes did not return an available model.' }, { status: 503 })
    const messages: ChatMessage[] = [{ role: 'system', content: `You are Levity AI, a focused coding agent. Use built-in tools when needed. Workspace access is limited to the authorized files provided. Edits are proposals and require user approval. Be concise. Current model: ${model}. IMPORTANT: when the user says check Levity, inspect Levity through MCP first using mcp_tools, then mcp_call as needed. The Levity MCP endpoint is already configured at ${MCP_URL}; do not tell the user to call Levity MCP or ask them to configure it. If MCP exposes a URL or endpoint, use fetch_url or multi_fetch to inspect it further. Use fetch_url for endpoint testing and network access; do not claim run_javascript can access the process or unrestricted network.` }, ...(Array.isArray(body.messages) ? body.messages : [])]
    for (let round = 0; round < 8; round++) {
      const completionBody = JSON.stringify({ model, messages, tools: toolDefinitions, tool_choice: 'auto', temperature: 0.2, max_tokens: Math.min(Number(body.maxTokens) || 8192, 32768), stream: false })
      let completion: Response | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        completion = await fetch(`${HERMES_BASE}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000), body: completionBody })
        if (completion.status !== 429 || attempt === 2) break
        const retryAfter = Number(completion.headers.get('retry-after'))
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 5000) : 1000 * (attempt + 1)))
      }
      if (!completion || !completion.ok) return NextResponse.json({ error: `Hermes error ${completion?.status || 502}`, detail: bounded(await completion?.text() || 'Upstream request was throttled or unavailable.', 4000) }, { status: 502 })
      const data = await completion.json(); const assistant = data.choices?.[0]?.message; if (!assistant) return NextResponse.json({ error: 'Hermes returned no message.' }, { status: 502 })
      messages.push(assistant)
      if (!assistant.tool_calls?.length) return NextResponse.json({ model, message: assistant, rounds: round + 1 })
      const results = await Promise.all(assistant.tool_calls.map(async (call: { id: string; function: { name: string; arguments: string } }) => { let args: Record<string, unknown>; try { args = JSON.parse(call.function.arguments || '{}') } catch { args = {} }; return { role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(await executeTool(call.function.name, args, files)) } }))
      messages.push(...results)
    }
    return NextResponse.json({ error: 'Tool loop limit reached.' }, { status: 508 })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 }) }
}

export const maxDuration = 60
export const dynamic = 'force-dynamic'
