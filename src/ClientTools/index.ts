export type ClientToolRole = 'system' | 'user' | 'assistant' | 'tool'
export type WorkspaceFile = { path: string; content: string }
export type ClientToolMessage = { role: ClientToolRole; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string; name?: string }
export type ClientToolsRequest = {
  prompt?: string
  messages?: ClientToolMessage[]
  model?: string
  systemPrompt?: string
  currentFile?: WorkspaceFile | string
  files?: WorkspaceFile[]
  fileStructure?: string[]
  images?: Array<{ url?: string; base64?: string; mimeType?: string; detail?: 'low' | 'high' | 'auto' }>
  autoReplace?: boolean
  approvalPolicy?: { mode?: 'auto' | 'approval'; allow?: string[]; deny?: string[]; requireApprovalFor?: string[] }
  maxTokens?: number
  stream?: boolean
  signal?: AbortSignal
}
export type ClientToolsResponse = {
  model?: string
  message?: { role: string; content?: string }
  statuses?: string[]
  structuredEdits?: Array<Record<string, unknown>>
  fileOperations?: Array<Record<string, unknown>>
  accessRequests?: Array<Record<string, unknown>>
  rounds?: number
  error?: string
  [key: string]: unknown
}
export type ClientToolsEvent =
  | { type: 'status'; status: string }
  | { type: 'result'; result: ClientToolsResponse }
  | { type: 'done' }
  | { type: 'error'; error: Error }

export const CLIENT_TOOL_DEFINITIONS = [
  'list_files', 'read_file', 'search_files', 'find_replace', 'apply_patch',
  'delete_file', 'clear_file', 'create_file', 'create_folder', 'move_file',
  'move_folder', 'duplicate_file', 'fetch_url', 'multi_fetch', 'run_javascript',
  'mcp_tools', 'mcp_call',
] as const

export const CLIENT_TOOLS_SYSTEM = `Levity AI exposes workspace-safe tools: ${CLIENT_TOOL_DEFINITIONS.join(', ')}. The client owns files and applies returned edits according to requiresApproval, autoReplaceEligible, and risk. Only files included in files are readable; fileStructure contains paths only.`

function normalizeMessages(request: ClientToolsRequest): ClientToolMessage[] {
  if (request.messages?.length) return request.messages
  return [{ role: 'user', content: request.prompt || '' }]
}

export function createClientTools(baseUrl: string) {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/chat`
  async function request(input: ClientToolsRequest): Promise<ClientToolsResponse> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      signal: input.signal,
      body: JSON.stringify({ ...input, messages: normalizeMessages(input), systemPrompt: [CLIENT_TOOLS_SYSTEM, input.systemPrompt].filter(Boolean).join('\\n\\n') }),
    })
    const data = await response.json().catch(() => ({})) as ClientToolsResponse
    if (!response.ok) throw new Error(data.error || `ClientTools request failed (${response.status})`)
    return data
  }
  async function* stream(input: ClientToolsRequest): AsyncGenerator<ClientToolsEvent> {
    let response: Response
    try {
      response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, signal: input.signal, body: JSON.stringify({ ...input, stream: true, messages: normalizeMessages(input), systemPrompt: [CLIENT_TOOLS_SYSTEM, input.systemPrompt].filter(Boolean).join('\\n\\n') }) })
      if (!response.ok) throw new Error(`ClientTools request failed (${response.status})`)
      if (!response.body) throw new Error('ClientTools response has no stream body')
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        const blocks = buffer.split(/\\r?\\n\\r?\\n/); buffer = blocks.pop() || ''
        for (const block of blocks) {
          const event = block.match(/^event:\s*(.+)$/m)?.[1]; const raw = block.match(/^data:\s*(.+)$/m)?.[1]
          if (!raw) continue
          const value = JSON.parse(raw)
          if (event === 'status') yield { type: 'status', status: value.status }
          else if (event === 'result') yield { type: 'result', result: value }
          else if (event === 'done') yield { type: 'done' }
        }
      }
    } catch (error) { yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)) } }
  }
  return { endpoint, request, stream }
}

export const createGeminiClientTools = createClientTools
export const createUnturfClientTools = createClientTools
export default createClientTools
