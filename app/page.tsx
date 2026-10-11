'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, ChevronDown, Code2, FileCode2, FolderOpen, GitBranch, History, Menu, Play, Plus, RefreshCw, Send, Settings2, Sparkles, Terminal, Wand2, X } from 'lucide-react'

type FileItem = { path: string; content: string }
type Message = { role: 'user' | 'assistant'; content: string; tool?: string }
type ApiResult = { model?: string; message?: { content?: string; tool_calls?: unknown[] }; error?: string; statuses?: string[] }

const starterFiles: FileItem[] = [
  { path: 'src/App.tsx', content: `export default function App() {\n  return (\n    <main className="app">\n      <h1>Hello from Levity</h1>\n      <p>Start building with your AI pair programmer.</p>\n    </main>\n  )\n}` },
  { path: 'src/styles.css', content: `.app {\n  font-family: system-ui;\n  padding: 3rem;\n  color: #1d2528;\n}` },
  { path: 'package.json', content: `{\n  "name": "levity-project",\n  "private": true,\n  "scripts": { "dev": "vite" }\n}` },
]

export default function Page() {
  const [files, setFiles] = useState(starterFiles)
  const [activePath, setActivePath] = useState('src/App.tsx')
  const [draft, setDraft] = useState(starterFiles[0].content)
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: 'I’m ready. I can inspect authorized files, diagnose preview issues, fetch reference APIs, and propose safe diffs.' }])
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('loading model…')
  const [thinking, setThinking] = useState(false)
  const [status, setStatus] = useState('ready')
  const [aiOpen, setAiOpen] = useState(true)
  const [mobilePane, setMobilePane] = useState<'code' | 'preview'>('code')
  const active = useMemo(() => files.find((file) => file.path === activePath)!, [files, activePath])
  const dirty = draft !== active.content

  useEffect(() => { fetch('/api/chat').then((response) => response.json()).then((data) => setModel(data.models?.data?.[0]?.id || 'Hermes model unavailable')).catch(() => setModel('offline')) }, [])
  useEffect(() => { setDraft(active.content) }, [activePath])

  function saveDraft() { setFiles((current) => current.map((file) => file.path === activePath ? { ...file, content: draft } : file)) }
  async function sendPrompt() {
    if (!prompt.trim() || thinking) return
    const text = prompt.trim(); setPrompt(''); setStatus('thinking'); setMessages((current) => [...current, { role: 'user', content: text }]); setThinking(true)
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, files, currentFile: { path: activePath, content: draft }, fileStructure: files.map((file) => file.path), messages: [{ role: 'user', content: text }] }) })
      const data: ApiResult = await response.json(); const tool = data.message?.tool_calls?.length ? `${data.message.tool_calls.length} tool call${data.message.tool_calls.length === 1 ? '' : 's'}` : undefined
      setStatus(data.statuses?.at(-1) || 'ready')
      setMessages((current) => [...current, { role: 'assistant', content: data.message?.content || data.error || 'No response received.', tool }])
    } catch { setMessages((current) => [...current, { role: 'assistant', content: 'Network unavailable. The editor is still available offline.' }]) } finally { setThinking(false) }
  }

  return <main className="levity-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Sparkles size={16} /></div><strong>Levity</strong><span className="brand-ai">AI</span><span className="crumb">/</span><span className="project-name">untitled-project</span><ChevronDown size={14} /></div>
      <div className="top-actions"><span className="connection"><i /> Hermes connected</span><button className="icon-button" aria-label="Settings"><Settings2 size={16} /></button><button className="avatar">AV</button></div>
    </header>
    <div className="mobile-toggle"><button className={mobilePane === 'code' ? 'active' : ''} onClick={() => setMobilePane('code')}><Code2 size={15} /> Code</button><button className={mobilePane === 'preview' ? 'active' : ''} onClick={() => setMobilePane('preview')}><Play size={15} /> Preview</button></div>
    <div className="workspace">
      <aside className="sidebar"><div className="side-heading"><span>EXPLORER</span><div><button aria-label="New file"><Plus size={15} /></button><button aria-label="More"><Menu size={15} /></button></div></div><div className="tree-root"><FolderOpen size={14} /> untitled-project</div>{files.map((file) => <button className={`file-row ${file.path === activePath ? 'selected' : ''}`} key={file.path} onClick={() => { setActivePath(file.path); setMobilePane('code') }}><FileCode2 size={14} /><span>{file.path}</span></button>)}<div className="side-footer"><div><GitBranch size={14} /> main</div><div><History size={14} /> Local drafts</div></div></aside>
      <section className={`editor-column ${mobilePane === 'preview' ? 'mobile-hidden' : ''}`}>
        <div className="tabs"><div className="tab active"><FileCode2 size={14} />{activePath.split('/').pop()} {dirty && <span className="dirty-dot" />}</div><button className="tab-add"><Plus size={15} /></button><div className="editor-actions"><span>{activePath.endsWith('tsx') ? 'TypeScript React' : 'JSON'}</span><button onClick={saveDraft} disabled={!dirty}>{dirty ? 'Save' : 'Saved'}</button></div></div>
        <div className="code-editor"><div className="line-numbers">{draft.split('\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea aria-label="Code editor" spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} /></div>
        <div className="preview-panel"><div className="panel-toolbar"><div className="panel-title"><Play size={14} /> Live preview <span className="live-dot" /></div><div className="preview-tools"><span>Desktop</span><button aria-label="Refresh preview"><RefreshCw size={14} /></button><button aria-label="Open preview"><Code2 size={14} /></button></div></div><div className="preview-canvas"><div className="preview-card"><div className="preview-logo"><Sparkles size={18} /></div><h2>Preview is ready</h2><p>Your authorized project will render here.</p><button onClick={() => setPrompt('Read the selected file and improve the preview')}>Ask Levity to build <Wand2 size={14} /></button></div></div></div>
      </section>
      {aiOpen ? <aside className="ai-panel"><div className="ai-header"><div><div className="ai-title"><Bot size={17} /> Levity AI</div><div className="ai-model"><span className="status-dot" /> {model} · {thinking ? status : 'ready'}</div></div><button className="icon-button" onClick={() => setAiOpen(false)} aria-label="Close AI panel"><X size={16} /></button></div><div className="chat-scroll">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}>{message.role === 'assistant' && <div className="message-avatar"><Sparkles size={13} /></div>}<div className="message-body"><p>{message.content}</p>{message.tool && <div className="tool-pill"><Terminal size={12} /> {message.tool}</div>}</div></div>)}{thinking && <div className="message assistant"><div className="message-avatar"><Sparkles size={13} /></div><div className="thinking"><i /><i /><i /></div></div>}</div><div className="prompt-area"><div className="prompt-box"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); sendPrompt() } }} placeholder="Ask Levity to build…" /><button onClick={sendPrompt} disabled={!prompt.trim() || thinking} aria-label="Send prompt"><Send size={16} /></button></div><div className="prompt-meta"><span><span className="key">⌘</span> Enter to send</span><span>Files are authorized locally</span></div></div></aside> : <button className="ai-collapsed" onClick={() => setAiOpen(true)}><Bot size={16} /> AI</button>}
    </div>
  </main>
}
