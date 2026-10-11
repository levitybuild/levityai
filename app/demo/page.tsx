'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, ChevronRight, Code2, FilePlus2, Folder, FolderPlus, Loader2, Play, Plus, RefreshCw, Send, Sparkles, Trash2, X } from 'lucide-react'

const API_BASE = 'https://levityai-three.vercel.app'
type FileItem = { path: string; content: string }
type Activity = { label: string; detail: string; tone?: 'done' | 'active' | 'muted' }
type ApiPayload = { model?: string; message?: { content?: string }; statuses?: string[]; structuredEdits?: { file: string; find: string; replace: string; after?: string; autoReplaceEligible?: boolean }[]; fileOperations?: { operation: string; path: string; destination?: string; content?: string }[]; accessRequests?: { file: string }[]; error?: string }

const initialFiles: FileItem[] = [
  { path: 'index.html', content: '<main>\n  <h1>Hello from Levity</h1>\n  <p>Edit this static page with AI.</p>\n</main>' },
  { path: 'styles.css', content: 'body {\n  font-family: system-ui;\n  padding: 3rem;\n  color: #172326;\n}' },
  { path: 'script.js', content: "document.querySelector('h1')?.addEventListener('click', () => alert('Hello'));" },
]

function operationIcon(operation: string) {
  if (operation === 'delete' || operation === 'clear') return <Trash2 size={13} />
  if (operation === 'create') return <FilePlus2 size={13} />
  if (operation.includes('folder')) return <FolderPlus size={13} />
  return <ChevronRight size={13} />
}

export default function DemoPage() {
  const [files, setFiles] = useState(initialFiles)
  const [activePath, setActivePath] = useState('index.html')
  const [draft, setDraft] = useState(initialFiles[0].content)
  const [prompt, setPrompt] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('You are a precise static-site editor. Prefer small, valid HTML, CSS, and JavaScript edits.')
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([{ role: 'assistant', content: 'Ready. I can edit, create, clear, delete, move, duplicate, and make folders. All returned write actions are applied automatically.' }])
  const [activities, setActivities] = useState<Activity[]>([{ label: 'Ready', detail: 'Waiting for a prompt', tone: 'done' }])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [model, setModel] = useState('Discovering model…')
  const [showSettings, setShowSettings] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [imageInput, setImageInput] = useState('')
  const [imageData, setImageData] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/chat`, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        const data = await response.json() as { models?: { data?: Array<{ id?: string }> } | Array<{ id?: string }> }
        const models = Array.isArray(data.models) ? data.models : data.models?.data
        const discovered = models?.find((item) => item.id)?.id
        if (!cancelled) setModel(discovered ?? 'Hermes model unavailable')
      })
      .catch(() => { if (!cancelled) setModel('Hermes model unavailable') })
    return () => { cancelled = true }
  }, [])

  const active = useMemo(() => files.find((file) => file.path === activePath) ?? files[0], [files, activePath])
  const dirty = draft !== active.content
  const lines = draft.split('\n')

  function selectFile(path: string) { setActivePath(path); setDraft(files.find((file) => file.path === path)?.content ?? '') }
  function saveDraft() { setFiles((current) => current.map((file) => file.path === activePath ? { ...file, content: draft } : file)); setStatus('Saved') }
  function applyEdit(edit: NonNullable<ApiPayload['structuredEdits']>[number]) {
    const next = edit.after ?? active.content.replace(edit.find, edit.replace)
    setFiles((current) => current.map((file) => file.path === edit.file ? { ...file, content: next } : file))
    if (edit.file === activePath) setDraft(next)
  }
  function applyOperation(op: NonNullable<ApiPayload['fileOperations']>[number]) {
    setFiles((current) => {
      if (op.operation === 'delete') return current.filter((file) => file.path !== op.path)
      if (op.operation === 'clear') return current.map((file) => file.path === op.path ? { ...file, content: '' } : file)
      if (op.operation === 'create') return current.some((file) => file.path === op.path) ? current : [...current, { path: op.path, content: op.content ?? '' }]
      if (op.operation === 'duplicate' && op.destination) { const source = current.find((file) => file.path === op.path); return source ? [...current, { path: op.destination, content: source.content }] : current }
      if (op.operation === 'move' && op.destination) return current.map((file) => file.path === op.path ? { ...file, path: op.destination! } : file)
      if (op.operation === 'create_folder') return current
      if (op.operation === 'move_folder' && op.destination) return current.map((file) => file.path.startsWith(`${op.path}/`) ? { ...file, path: `${op.destination}/${file.path.slice(op.path.length + 1)}` } : file)
      return current
    })
    if (op.operation === 'delete' && op.path === activePath) { const fallback = files.find((file) => file.path !== op.path); if (fallback) selectFile(fallback.path) }
  }
  async function send() {
    if (!prompt.trim() || busy) return
    const request = prompt.trim(); setPrompt(''); setBusy(true); setStatus('Sending prompt'); setActivities([{ label: 'Sending prompt', detail: 'Preparing current file and tree', tone: 'active' }]); setMessages((current) => [...current, { role: 'user', content: request }])
    try {
      const response = await fetch(`${API_BASE}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ prompt: request, systemPrompt, autoReplace: true, fileReplacement: true, currentFile: { path: activePath, content: draft }, files: files.map((file) => file.path === activePath ? { ...file, content: draft } : file), fileStructure: files.map((file) => file.path), images: imageData || imageInput ? [{ url: imageInput || undefined, data: imageData || undefined, mediaType: imageData?.match(/^data:([^;]+)/)?.[1] }] : [], messages: [{ role: 'user', content: request }] }) })
      const data: ApiPayload = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Request failed')
      const nextActivities: Activity[] = (data.statuses ?? ['AI response received']).map((label, index, all) => ({ label, detail: index === all.length - 1 ? 'Completed' : 'API event', tone: index === all.length - 1 ? 'done' : 'muted' }))
      if (data.accessRequests?.length) nextActivities.push({ label: 'Read requested', detail: data.accessRequests.map((item) => item.file).join(', '), tone: 'active' })
      data.structuredEdits?.forEach(applyEdit); data.fileOperations?.forEach(applyOperation)
      if (data.model) setModel(data.model)
      setActivities(nextActivities); setStatus(data.statuses?.at(-1) ?? 'Complete'); setMessages((current) => [...current, { role: 'assistant', content: data.message?.content ?? 'Applied the AI response.' }])
    } catch (error) { setStatus('Request failed'); setActivities([{ label: 'Request failed', detail: error instanceof Error ? error.message : 'Network error', tone: 'active' }]); setMessages((current) => [...current, { role: 'assistant', content: error instanceof Error ? error.message : 'Network error' }]) } finally { setBusy(false) }
  }

  return <main className="demo-shell">
    <header className="demo-topbar"><div className="demo-brand"><span className="demo-mark"><Sparkles size={15} /></span><strong>Levity</strong><span className="demo-slash">/</span><span>Static editor</span><span className="demo-live"><i /> API connected</span></div><div className="demo-header-actions"><span className="demo-endpoint">{API_BASE}</span><button className="demo-icon-button" onClick={() => setShowSettings((value) => !value)} aria-label="Open settings">Settings</button></div></header>
    <div className="demo-layout">
      <aside className="demo-files"><div className="demo-section-label"><span>FILES</span><button onClick={() => setFiles((current) => [...current, { path: `new-${current.length}.html`, content: '' }])} aria-label="Create file"><Plus size={15} /></button></div><div className="demo-project"><Folder size={14} /> demo-project</div>{files.map((file) => <button key={file.path} className={`demo-file ${file.path === activePath ? 'selected' : ''}`} onClick={() => selectFile(file.path)}><Code2 size={14} /><span>{file.path}</span></button>)}<div className="demo-file-hint">AI write actions are applied automatically.</div></aside>
      <section className="demo-workspace"><div className="demo-toolbar"><div><span className="demo-file-title">{activePath}</span>{dirty && <span className="demo-unsaved">unsaved</span>}</div><div className="demo-toolbar-actions"><button onClick={saveDraft} disabled={!dirty}>{dirty ? 'Save' : 'Saved'}</button><button onClick={() => setShowPreview((value) => !value)}><Play size={13} /> {showPreview ? 'Editor' : 'Preview'}</button></div></div>{showPreview ? <div className="demo-preview"><div dangerouslySetInnerHTML={{ __html: activePath.endsWith('.html') ? draft : '<p>Preview available for HTML files.</p>' }} /></div> : <div className="demo-code"><div className="demo-line-numbers">{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} aria-label="Static file editor" /></div>}<div className="demo-image-controls"><label>Image URL <input value={imageInput} onChange={(event) => setImageInput(event.target.value)} placeholder="https://…" /></label><label className="demo-upload">Upload image<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setImageData(typeof reader.result === 'string' ? reader.result : null); reader.readAsDataURL(file) }} /></label>{(imageInput || imageData) && <button onClick={() => { setImageInput(''); setImageData(null) }}>Clear image</button>}</div><div className="demo-commandbar"><span className={busy ? 'demo-spinner' : ''}>{busy ? <Loader2 size={14} /> : <Check size={14} />}</span><input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) send() }} placeholder="Ask AI to edit or manage files…" /><button onClick={send} disabled={busy || !prompt.trim()} aria-label="Send prompt"><Send size={15} /></button></div></section>
      <aside className="demo-ai"><div className="demo-ai-head"><div><div className="demo-ai-title"><Bot size={17} /> AI activity</div><div className="demo-status"><i className={busy ? 'active' : ''} /> {status}</div><div className="demo-model">Model: {model}</div></div><button className="demo-icon-button" onClick={() => setShowSettings((value) => !value)} aria-label="Toggle system prompt">{showSettings ? <X size={15} /> : 'Prompt'}</button></div>{showSettings && <div className="demo-settings"><label htmlFor="system-prompt">System prompt</label><textarea id="system-prompt" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} /><small>Sent with every request. Auto file replacement is always on.</small></div>}<div className="demo-activity">{activities.map((item, index) => <div className={`demo-activity-row ${item.tone ?? ''}`} key={`${item.label}-${index}`}><span className="demo-activity-icon">{item.tone === 'active' ? <Loader2 className="demo-spinner" size={14} /> : <Check size={14} />}</span><div><strong>{item.label}</strong><span>{item.detail}</span></div></div>)}</div><div className="demo-chat">{messages.map((message, index) => <div className={`demo-chat-message ${message.role}`} key={index}><span>{message.role === 'assistant' ? <Sparkles size={12} /> : 'You'}</span><p>{message.content}</p></div>)}</div><div className="demo-api-note"><strong>Automatic mode</strong><span>Reads the active file by default, then applies edits, creates, clears, deletes, moves, duplicates, and folder actions from the API response.</span></div></aside>
    </div>
  </main>
}
