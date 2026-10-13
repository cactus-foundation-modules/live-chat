'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { FILE_ACCEPT, MAX_MESSAGE_CHARS } from '@/modules/chat/lib/constants'
import { filesProblem } from '@/modules/chat/lib/text'
import type { ClientMessage } from '@/modules/chat/lib/serialise'

// The pieces every chat surface shares: the visitor's widget, the admin bubble
// on the site and the inbox tab. Colours are the site's own tokens throughout,
// so it follows the theme in light and dark without a palette of its own.

export const CHAT_CSS = `
.cch-root{font:inherit;font-size:15px;line-height:1.4;color:var(--color-text)}
.cch-root *{box-sizing:border-box}
.cch-root button{font:inherit;cursor:pointer}
.cch-root :focus-visible{outline:2px solid var(--color-border-focus);outline-offset:2px}
.cch-dock{position:fixed;bottom:calc(20px + var(--cactus-bottom-bar-offset,0px));z-index:2147483000;display:flex;flex-direction:column;gap:10px;max-width:calc(100vw - 32px)}
.cch-dock.right{right:20px;align-items:flex-end}
.cch-dock.left{left:20px;align-items:flex-start}
.cch-launcher{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;background:var(--color-primary);color:var(--color-on-primary);font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.18)}
.cch-launcher:hover{background:var(--color-primary-hover)}
.cch-badge{min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--color-destructive);color:var(--color-on-destructive,#fff);font-size:12px;display:inline-flex;align-items:center;justify-content:center}
.cch-peeks{display:flex;flex-direction:column;gap:8px;width:300px;max-width:100%}
.cch-peek{position:relative;text-align:left;border:1px solid var(--color-border);border-radius:14px;padding:10px 32px 10px 12px;background:var(--color-surface);color:var(--color-text);box-shadow:0 6px 20px rgba(0,0,0,.14);width:100%}
.cch-peek strong{display:block;font-size:13px;margin-bottom:2px}
.cch-peek span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.cch-peek-x{position:absolute;top:4px;right:4px;border:0;background:transparent;color:var(--color-text-muted);width:24px;height:24px;border-radius:999px}
.cch-panel{width:370px;max-width:100%;height:min(580px,calc(100vh - 110px - var(--cactus-bottom-bar-offset,0px)));display:flex;flex-direction:column;background:var(--color-surface);border:1px solid var(--color-border);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);overflow:hidden}
@media (max-width:480px){.cch-dock{bottom:calc(12px + var(--cactus-bottom-bar-offset,0px))}.cch-dock.right{right:12px}.cch-dock.left{left:12px}.cch-panel{width:calc(100vw - 24px);height:calc(100vh - 90px - var(--cactus-bottom-bar-offset,0px))}}
@media (max-width:640px){.cch-dock.hide-mobile .cch-launcher{display:none}}
.cch-head{display:flex;align-items:center;gap:8px;padding:12px 14px;background:var(--color-primary);color:var(--color-on-primary)}
.cch-head h2{flex:1;margin:0;font-size:16px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit}
.cch-head button{border:0;background:transparent;color:inherit;padding:4px 8px;border-radius:8px}
.cch-head button:hover{background:rgba(255,255,255,.15)}
.cch-avail{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--color-border-strong);background:var(--color-surface);color:var(--color-text);border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600;flex:none}
.cch-avail-dot{width:8px;height:8px;border-radius:999px;background:var(--color-text-muted)}
.cch-avail.on .cch-avail-dot{background:var(--color-success)}
.cch-avail.dark{background:transparent;border-color:currentColor;color:inherit}
.cch-avail.dark .cch-avail-dot{background:currentColor;opacity:.5}
.cch-avail.dark.on .cch-avail-dot{background:var(--color-success-bg);opacity:1}
.cch-avail:disabled{opacity:.6;cursor:default}
.cch-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:var(--color-bg-subtle)}
.cch-msg{max-width:82%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}
.cch-msg.mine{align-self:flex-end;background:var(--color-primary);color:var(--color-on-primary);border-bottom-right-radius:4px}
.cch-msg.theirs{align-self:flex-start;background:var(--color-surface);border:1px solid var(--color-border);border-bottom-left-radius:4px}
.cch-msg.mine a{color:inherit}
.cch-meta{font-size:12px;color:var(--color-text-muted);margin:0 4px}
.cch-meta.mine{align-self:flex-end}
.cch-system{align-self:center;font-size:12px;color:var(--color-text-muted);text-align:center}
.cch-file{display:block;margin-top:6px}
.cch-file img{display:block;max-width:220px;max-height:220px;border-radius:8px}
.cch-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:8px}
.cch-card p{margin:0}
.cch-row{display:flex;gap:8px;flex-wrap:wrap}
.cch-btn{border:1px solid var(--color-border-strong);background:var(--color-surface);color:var(--color-text);border-radius:8px;padding:6px 12px}
.cch-btn:hover{background:var(--color-bg-subtle)}
.cch-btn.primary{background:var(--color-primary);border-color:var(--color-primary);color:var(--color-on-primary)}
.cch-btn.primary:hover{background:var(--color-primary-hover)}
.cch-btn.danger{color:var(--color-destructive);border-color:var(--color-destructive-border)}
.cch-btn:disabled{opacity:.55;cursor:default}
.cch-input{width:100%;border:1px solid var(--color-border-strong);background:var(--color-surface);color:var(--color-text);border-radius:8px;padding:8px 10px;font:inherit}
.cch-input::placeholder{color:var(--color-text-muted)}
.cch-composer{border-top:1px solid var(--color-border);background:var(--color-surface);padding:8px;display:flex;flex-direction:column;gap:6px}
.cch-composer-row{display:flex;align-items:flex-end;gap:6px}
.cch-composer textarea{flex:1;resize:none;max-height:120px;min-height:40px}
.cch-icon{border:0;background:transparent;color:var(--color-text-secondary);width:38px;height:38px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.cch-icon:hover{background:var(--color-bg-subtle)}
.cch-send{background:var(--color-primary);color:var(--color-on-primary)}
.cch-send:hover{background:var(--color-primary-hover)}
.cch-chips{display:flex;flex-wrap:wrap;gap:6px}
.cch-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;border:1px solid var(--color-border);border-radius:999px;padding:2px 4px 2px 10px;background:var(--color-bg-subtle)}
.cch-chip button{border:0;background:transparent;color:var(--color-text-muted)}
.cch-error{font-size:13px;color:var(--color-destructive)}
.cch-muted{font-size:13px;color:var(--color-text-muted)}
.cch-list{flex:1;overflow-y:auto;background:var(--color-surface)}
.cch-item{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--color-border);background:transparent;color:var(--color-text);padding:10px 14px}
.cch-item:hover,.cch-item.active{background:var(--color-bg-subtle)}
.cch-item-top{display:flex;justify-content:space-between;gap:8px;font-weight:600}
.cch-item-top time{font-weight:400;font-size:12px;color:var(--color-text-muted);flex:none}
.cch-item-preview{font-size:13px;color:var(--color-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cch-item.unread .cch-item-top span::before{content:'';display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--color-primary);margin-right:6px;vertical-align:middle}
`

const noSubscribe = () => () => {}

/** The bubble and its panel, mounted on <body> rather than where the block was
 *  placed. The block lives in the header, and a header can hide, fade or stack
 *  what is inside it - core's "hide what scrolls away" marks a zero-height box in
 *  the top strip as away and sets visibility:hidden on it, which a fixed child
 *  inherits, so the chat opened invisibly on phones once the page had scrolled.
 *  On <body> nothing the header does can reach it. Nothing renders on the server:
 *  the bubble is fixed to the screen, so it was never part of the page's layout. */
export function BodyPortal({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false)
  return mounted ? createPortal(children, document.body) : null
}

export function ChatStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CHAT_CSS }} />
}

export function timeLabel(iso: string): string {
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export async function readError(res: Response): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: string } | null
  return json?.error ?? 'Something went wrong. Please try again.'
}

/** Messages in order, oldest first. `mine` says which side is drawn on the
 *  right: the visitor's own words in their widget, ours in the admin's. */
export function MessageList({
  messages,
  mine,
  intro,
  children,
}: {
  messages: ClientMessage[]
  mine: 'visitor' | 'agent'
  intro?: string | null
  children?: React.ReactNode
}) {
  const end = useRef<HTMLDivElement>(null)
  const last = messages[messages.length - 1]?.id ?? 0
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [last, children])

  return (
    <div className="cch-body" role="log" aria-live="polite">
      {intro ? <div className="cch-msg theirs">{intro}</div> : null}
      {messages.map((m, i) => {
        if (m.sender === 'system') return <div key={m.id} className="cch-system">{m.body}</div>
        const isMine = m.sender === mine
        const prev = messages[i - 1]
        const showMeta = !prev || prev.sender !== m.sender || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000
        const who = m.sender === 'visitor' ? (mine === 'visitor' ? 'You' : 'Visitor') : (m.authorName ?? 'Us')
        return (
          <div key={m.id} style={{ display: 'contents' }}>
            {showMeta ? <div className={`cch-meta${isMine ? ' mine' : ''}`}>{who} · {timeLabel(m.createdAt)}</div> : null}
            <div className={`cch-msg ${isMine ? 'mine' : 'theirs'}`}>
              {m.body}
              {m.attachments.map((a) => (
                <a key={a.id} className="cch-file" href={a.url} target="_blank" rel="noopener noreferrer">
                  {a.contentType.startsWith('image/') && !a.contentType.includes('heic')
                    // eslint-disable-next-line @next/next/no-img-element -- a private, signed file; next/image cannot optimise it
                    ? <img src={a.url} alt={a.filename} loading="lazy" />
                    : <>📎 {a.filename}</>}
                </a>
              ))}
            </div>
          </div>
        )
      })}
      {children}
      <div ref={end} />
    </div>
  )
}

/** The writing box: words, up to a few files, Enter to send. */
export function Composer({
  onSend,
  disabled,
  placeholder,
  allowFiles = true,
  autoFocus,
}: {
  onSend: (body: string, files: File[]) => Promise<boolean>
  disabled?: boolean
  placeholder?: string
  allowFiles?: boolean
  autoFocus?: boolean
}) {
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (busy || disabled) return
    if (!body.trim() && files.length === 0) return
    const problem = filesProblem(files)
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    const ok = await onSend(body.trim(), files).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'That did not send. Please try again.')
      return false
    })
    if (ok) { setBody(''); setFiles([]) }
    setBusy(false)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <form className="cch-composer" onSubmit={submit}>
      {files.length > 0 ? (
        <div className="cch-chips">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="cch-chip">
              {f.name}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <div className="cch-error" role="alert">{error}</div> : null}
      <div className="cch-composer-row">
        {allowFiles ? (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              hidden
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
                const next = [...files, ...picked]
                setError(filesProblem(next) ?? '')
                setFiles(next)
                e.target.value = ''
              }}
            />
            <button type="button" className="cch-icon" aria-label="Attach a file" title="Attach a file" disabled={disabled || busy} onClick={() => picker.current?.click()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
            </button>
          </>
        ) : null}
        <textarea
          className="cch-input"
          rows={1}
          value={body}
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={placeholder ?? 'Type a message…'}
          aria-label="Message"
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="submit" className="cch-icon cch-send" aria-label="Send" title="Send" disabled={disabled || busy || (!body.trim() && files.length === 0)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
        </button>
      </div>
    </form>
  )
}

/** Posts a message as multipart when files go with it, JSON otherwise. */
export function messageRequest(fields: Record<string, string | null | undefined>, files: File[], headers: Record<string, string> = {}): RequestInit {
  if (files.length > 0) {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v)
    for (const f of files) form.append('files', f)
    return { method: 'POST', body: form, headers }
  }
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) if (v) clean[k] = v
  return { method: 'POST', body: JSON.stringify(clean), headers: { ...headers, 'content-type': 'application/json' } }
}
