export type ToolName =
  | 'list_files' | 'read_file' | 'search_files' | 'find_replace' | 'apply_patch'
  | 'delete_file' | 'clear_file' | 'create_file' | 'create_folder' | 'move_file'
  | 'move_folder' | 'duplicate_file' | 'fetch_url' | 'multi_fetch' | 'run_javascript'
  | 'mcp_tools' | 'mcp_call'

export type WorkspaceFile = { path: string; content: string }
export type ToolCall = { id?: string; name: ToolName; arguments?: Record<string, unknown> }
export type ToolResult = { ok: boolean; tool: ToolName; data?: unknown; error?: string; operation?: FileOperation }
export type FileOperation = { type: string; path?: string; source?: string; destination?: string; content?: string; reason?: string; requiresApproval?: boolean; risk?: 'low' | 'medium' | 'high' }
export type ApprovalPolicy = { mode?: 'auto' | 'approval'; allow?: string[]; deny?: string[]; requireApprovalFor?: string[] }
export type ClientToolMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content?: unknown; tool_calls?: unknown[]; tool_call_id?: string; name?: string }
export type ClientToolsRequest = {
  prompt?: string; messages?: ClientToolMessage[]; model?: string; systemPrompt?: string
  currentFile?: WorkspaceFile | string; files?: WorkspaceFile[]; fileStructure?: string[]
  images?: Array<{ url?: string; base64?: string; mimeType?: string; detail?: 'low' | 'high' | 'auto' }>
  autoReplace?: boolean; approvalPolicy?: ApprovalPolicy; maxTokens?: number; stream?: boolean; signal?: AbortSignal
}
export type ClientToolsResponse = { model?: string; message?: { role: string; content?: string }; statuses?: string[]; structuredEdits?: FileOperation[]; fileOperations?: FileOperation[]; accessRequests?: unknown[]; rounds?: number; error?: string; [key: string]: unknown }
export type ClientToolsEvent = { type: 'status'; status: string } | { type: 'result'; result: ClientToolsResponse } | { type: 'done' } | { type: 'error'; error: Error }

const TOOL_NAMES: ToolName[] = ['list_files','read_file','search_files','find_replace','apply_patch','delete_file','clear_file','create_file','create_folder','move_file','move_folder','duplicate_file','fetch_url','multi_fetch','run_javascript','mcp_tools','mcp_call']
const WRITE_TOOLS = new Set<ToolName>(['find_replace','apply_patch','delete_file','clear_file','create_file','create_folder','move_file','move_folder','duplicate_file'])
const risk = (name: ToolName): FileOperation['risk'] => name === 'delete_file' || name === 'move_folder' ? 'high' : name === 'clear_file' || name === 'move_file' ? 'medium' : 'low'

export const CLIENT_TOOL_DEFINITIONS = TOOL_NAMES.map((name) => ({ type: 'function', function: { name, description: `Execute the ${name} workspace tool.`, parameters: { type: 'object', additionalProperties: true } } }))
export const GEMINI_TOOL_DECLARATIONS = [{ functionDeclarations: TOOL_NAMES.map((name) => ({ name, description: `Execute the ${name} workspace tool.`, parameters: { type: 'object', properties: {} } })) }]
export const CLIENT_TOOLS_SYSTEM = `You are a workspace coding agent. Available tools: ${TOOL_NAMES.join(', ')}. You may return multiple tool calls and file operations in one response. Never claim a change succeeded unless the client returns a successful tool result. Use exact paths from list_files. Writes are governed by approvalPolicy.`

function filesOf(input: ClientToolsRequest): WorkspaceFile[] { return input.files ? input.files.map((file) => ({ ...file })) : [] }
function pathArg(args: Record<string, unknown>, key = 'file'): string { return String(args[key] || '') }
function matchPath(files: WorkspaceFile[], path: string): WorkspaceFile | undefined { return files.find((file) => file.path === path) }
function operation(name: ToolName, args: Record<string, unknown>): FileOperation { return { type: name, path: pathArg(args), source: String(args.source || args.file || ''), destination: String(args.destination || ''), content: typeof args.content === 'string' ? args.content : undefined, reason: String(args.reason || ''), requiresApproval: WRITE_TOOLS.has(name), risk: risk(name) } }

export class ClientTools {
  readonly endpoint: string
  constructor(baseUrl: string) { this.endpoint = `${baseUrl.replace(/\/$/, '')}/api/chat` }

  static toolNames(): ToolName[] { return [...TOOL_NAMES] }
  static openAITools() { return CLIENT_TOOL_DEFINITIONS }
  static geminiTools() { return GEMINI_TOOL_DECLARATIONS }

  async execute(name: ToolName, args: Record<string, unknown>, input: ClientToolsRequest): Promise<ToolResult> {
    const files = filesOf(input); const file = pathArg(args); const target = matchPath(files, file)
    if (name === 'list_files') return { ok: true, tool: name, data: input.fileStructure || files.map((item) => item.path) }
    if (name === 'read_file') return target ? { ok: true, tool: name, data: target } : { ok: false, tool: name, error: `File not found: ${file}` }
    if (name === 'search_files') { const query = String(args.query || ''); const regex = Boolean(args.regex); let pattern: RegExp | null = null; try { pattern = regex ? new RegExp(query, args.flags === 'i' ? 'i' : '') : null } catch (error) { return { ok: false, tool: name, error: String(error) } }; const hits = files.flatMap((item) => { const found = pattern ? pattern.test(item.content) : item.content.includes(query); return found ? [{ path: item.path, matches: item.content.split('\n').map((line, index) => ({ line: index + 1, text: line })).filter((line) => pattern ? pattern!.test(line.text) : line.text.includes(query)) }] : [] }); return { ok: true, tool: name, data: hits } }
    if (name === 'fetch_url') { const response = await fetch(String(args.url), { method: String(args.method || 'GET'), body: typeof args.body === 'string' ? args.body : undefined, signal: input.signal }); return { ok: true, tool: name, data: { status: response.status, headers: Object.fromEntries(response.headers), text: (await response.text()).slice(0, 50000) } } }
    if (name === 'multi_fetch') { const requests = Array.isArray(args.requests) ? args.requests as Array<Record<string, unknown>> : []; const data = await Promise.all(requests.map((request) => this.execute('fetch_url', request, input))); return { ok: data.every((item) => item.ok), tool: name, data } }
    if (name === 'mcp_tools' || name === 'mcp_call' || name === 'run_javascript') return { ok: false, tool: name, error: `${name} is server-executed by the API; use request() or stream() so the sandbox remains enforced.` }
    if (WRITE_TOOLS.has(name)) return { ok: true, tool: name, operation: operation(name, args) }
    return { ok: false, tool: name, error: `Unknown tool: ${name}` }
  }

  async request(input: ClientToolsRequest): Promise<ClientToolsResponse> { const response = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, signal: input.signal, body: JSON.stringify({ ...input, messages: input.messages?.length ? input.messages : [{ role: 'user', content: input.prompt || '' }], systemPrompt: [CLIENT_TOOLS_SYSTEM, input.systemPrompt].filter(Boolean).join('\n\n'), toolChoice: 'auto' }) }); const data = await response.json().catch(() => ({})) as ClientToolsResponse; if (!response.ok) throw new Error(data.error || `ClientTools request failed (${response.status})`); return data }

  async *stream(input: ClientToolsRequest): AsyncGenerator<ClientToolsEvent> { try { const response = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, signal: input.signal, body: JSON.stringify({ ...input, stream: true, messages: input.messages?.length ? input.messages : [{ role: 'user', content: input.prompt || '' }], systemPrompt: [CLIENT_TOOLS_SYSTEM, input.systemPrompt].filter(Boolean).join('\n\n'), toolChoice: 'auto' }) }); if (!response.ok) throw new Error(`ClientTools request failed (${response.status})`); if (!response.body) throw new Error('ClientTools response has no stream body'); const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; while (true) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() || ''; for (const block of blocks) { const event = block.match(/^event:\s*(.+)$/m)?.[1]; const raw = block.match(/^data:\s*(.+)$/m)?.[1]; if (!raw) continue; const value = JSON.parse(raw); if (event === 'status') yield { type: 'status', status: String(value.status) }; else if (event === 'result') yield { type: 'result', result: value }; else if (event === 'done') yield { type: 'done' }; } } } catch (error) { yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)) } } }
}

export function createClientTools(baseUrl: string) { return new ClientTools(baseUrl) }
export const createGeminiClientTools = createClientTools
export const createUnturfClientTools = createClientTools
export default createClientTools
export { TOOL_NAMES as CLIENT_TOOL_NAMES }
export type { ToolName as ClientToolName }
export const clientToolsContract = { names: TOOL_NAMES, definitions: CLIENT_TOOL_DEFINITIONS, gemini: GEMINI_TOOL_DECLARATIONS, writes: [...WRITE_TOOLS] }
export type ClientToolsContract = typeof clientToolsContract
export { normalizeToolArguments }
function normalizeToolArguments(value: unknown): Record<string, unknown> { if (typeof value === 'string') { try { return JSON.parse(value) } catch { return {} } } return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
export async function executeClientTool(client: ClientTools, call: ToolCall, input: ClientToolsRequest): Promise<ToolResult> { return client.execute(call.name, normalizeToolArguments(call.arguments), input) }
export function toolResultMessage(result: ToolResult): ClientToolMessage { return { role: 'tool', name: result.tool, tool_call_id: result.tool, content: JSON.stringify(result) } }
export function operationsFromResponse(response: ClientToolsResponse): FileOperation[] { return [...(response.structuredEdits || []), ...(response.fileOperations || [])] }
export function applyOperations(files: WorkspaceFile[], operations: FileOperation[]): WorkspaceFile[] { const next = files.map((file) => ({ ...file })); for (const item of operations) { const source = item.source || item.path || ''; const index = next.findIndex((file) => file.path === source); if (item.type === 'create_file' && item.destination && item.content !== undefined) next.push({ path: item.destination, content: item.content }); else if (item.type === 'clear_file' && index >= 0) next[index].content = ''; else if (item.type === 'delete_file' && index >= 0) next.splice(index, 1); else if ((item.type === 'move_file' || item.type === 'duplicate_file') && index >= 0 && item.destination) { const copy = { path: item.destination, content: next[index].content }; if (item.type === 'move_file') next.splice(index, 1); next.push(copy) } else if ((item.type === 'find_replace' || item.type === 'apply_patch') && index >= 0 && item.content !== undefined) next[index].content = item.content } return next }

export const tools = { names: TOOL_NAMES, definitions: CLIENT_TOOL_DEFINITIONS, gemini: GEMINI_TOOL_DECLARATIONS, create: createClientTools, execute: executeClientTool, applyOperations }
export type ClientToolsApi = ReturnType<typeof createClientTools>
export type ClientToolFunctionDeclaration = (typeof CLIENT_TOOL_DEFINITIONS)[number]
export type GeminiToolDeclaration = (typeof GEMINI_TOOL_DECLARATIONS)[number]
export type ToolExecutionResult = Awaited<ReturnType<ClientTools['execute']>>
export type ToolStream = ReturnType<ClientTools['stream']>
export type ToolRequest = ClientToolsRequest
export type ToolResponse = ClientToolsResponse
export type ToolEvent = ClientToolsEvent
export type ToolOperation = FileOperation
export type ToolApprovalPolicy = ApprovalPolicy
export const TOOL_CALLING_VERSION = '1.0.0'
export const TOOL_CALLING_CAPABILITIES = { multiToolCalls: true, multiFileEdits: true, streamingStatuses: true, images: true, approvals: true, transactions: false, verification: true } as const
export function hasTool(name: string): name is ToolName { return (TOOL_NAMES as string[]).includes(name) }
export function isWriteTool(name: string): boolean { return WRITE_TOOLS.has(name as ToolName) }
export function toolRisk(name: string): FileOperation['risk'] { return risk(name as ToolName) }
export function buildToolPrompt(prompt: string, input: ClientToolsRequest = {}): ClientToolsMessage[] { return [{ role: 'system', content: [CLIENT_TOOLS_SYSTEM, input.systemPrompt].filter(Boolean).join('\n\n') }, { role: 'user', content: prompt }] }
type ClientToolsMessage = ClientToolMessage
export function toolCall(name: ToolName, args: Record<string, unknown> = {}, id = name): ToolCall { return { id, name, arguments: args } }
export function toolCallsMessage(calls: ToolCall[]): ClientToolMessage { return { role: 'assistant', tool_calls: calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } })) } }
export function toolResultsMessage(results: ToolResult[]): ClientToolMessage[] { return results.map(toolResultMessage) }
export function getToolDefinition(name: ToolName) { return CLIENT_TOOL_DEFINITIONS.find((definition) => definition.function.name === name) }
export function getGeminiDeclaration(name: ToolName) { return GEMINI_TOOL_DECLARATIONS[0].functionDeclarations.find((definition) => definition.name === name) }
export function operationRequiresApproval(name: ToolName, policy: ApprovalPolicy = {}) { return WRITE_TOOLS.has(name) && policy.mode !== 'auto' && !policy.allow?.includes(name) }
export function createToolMessage(name: ToolName, result: unknown): ClientToolMessage { return { role: 'tool', name, content: JSON.stringify(result) } }
export function createToolCall(name: ToolName, args: Record<string, unknown> = {}): ToolCall { return toolCall(name, args) }
export const ALL_TOOLS = TOOL_NAMES
export const READ_TOOLS = TOOL_NAMES.filter((name) => !WRITE_TOOLS.has(name))
export const WRITE_TOOL_NAMES = [...WRITE_TOOLS]
export function serializeToolContract() { return JSON.stringify(clientToolsContract) }
export function parseToolCall(call: unknown): ToolCall | null { if (!call || typeof call !== 'object') return null; const value = call as Record<string, unknown>; const fn = value.function as Record<string, unknown> | undefined; const name = String(value.name || fn?.name || ''); return hasTool(name) ? { id: String(value.id || name), name, arguments: normalizeToolArguments(value.arguments || fn?.arguments) } : null }
export async function executeToolCalls(client: ClientTools, calls: ToolCall[], input: ClientToolsRequest) { return Promise.all(calls.map((call) => executeClientTool(client, call, input))) }
export function createToolRegistry(client: ClientTools, input: ClientToolsRequest) { return Object.fromEntries(TOOL_NAMES.map((name) => [name, (args: Record<string, unknown>) => client.execute(name, args, input)])) as Record<ToolName, (args: Record<string, unknown>) => Promise<ToolResult>> }
export function createGeminiFunctionDeclarations() { return GEMINI_TOOL_DECLARATIONS }
export function createOpenAIToolDefinitions() { return CLIENT_TOOL_DEFINITIONS }
export function createUnturfToolPayload(input: ClientToolsRequest) { return { ...input, systemPrompt: [CLIENT_TOOLS_SYSTEM, input.systemPrompt].filter(Boolean).join('\n\n'), toolChoice: 'auto' } }
export function createGeminiToolPayload(input: ClientToolsRequest) { return { contents: input.messages || [{ role: 'user', parts: [{ text: input.prompt || '' }] }], tools: GEMINI_TOOL_DECLARATIONS } }
export function createOpenAIToolPayload(input: ClientToolsRequest) { return { ...input, messages: input.messages || [{ role: 'user', content: input.prompt || '' }], tools: CLIENT_TOOL_DEFINITIONS, tool_choice: 'auto' } }
export function redactToolResult(result: ToolResult): ToolResult { return { ...result, data: typeof result.data === 'string' ? result.data.slice(0, 50000) : result.data } }
export function assertKnownTool(name: string): asserts name is ToolName { if (!hasTool(name)) throw new Error(`Unknown ClientTools tool: ${name}`) }
export function toolDocumentation() { return TOOL_NAMES.map((name) => ({ name, write: WRITE_TOOLS.has(name), risk: risk(name), definition: getToolDefinition(name) })) }
export function createToolLoop(client: ClientTools, input: ClientToolsRequest) { return { async run(calls: ToolCall[]) { return executeToolCalls(client, calls, input) } } }
export const universal = { openai: createOpenAIToolDefinitions, gemini: createGeminiFunctionDeclarations, unturf: createUnturfToolPayload }
export const supportedProviders = ['universal', 'openai', 'gemini', 'unturf'] as const
export type SupportedProvider = typeof supportedProviders[number]
export function providerTools(provider: SupportedProvider) { return provider === 'gemini' ? GEMINI_TOOL_DECLARATIONS : CLIENT_TOOL_DEFINITIONS }
export const features = ['multi-file edits','automatic find-replace','file lifecycle operations','URL fetch','parallel fetch','sandboxed JavaScript','MCP forwarding','streamed status events','image input','approval policy'] as const
export type ClientToolFeature = typeof features[number]
export function supportsFeature(feature: string): feature is ClientToolFeature { return (features as readonly string[]).includes(feature) }
export const version = TOOL_CALLING_VERSION
