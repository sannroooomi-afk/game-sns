'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'

const VoiceChat = dynamic(() => import('@/components/VoiceChat'), { ssr: false })

interface Presence {
  id: string
  name: string
  status: string
  game: string
  recruiting: boolean
  updated_at: string
}

interface Message {
  id: string
  user_id: string
  user_name: string
  content: string
  created_at: string
}

function initUserId(): string {
  let id = localStorage.getItem('gf_uid')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('gf_uid', id) }
  return id
}

const ONLINE_MS = 2 * 60 * 1000
const isOnline = (p: Presence) => Date.now() - new Date(p.updated_at).getTime() < ONLINE_MS

export default function Page() {
  const [userId, setUserId]       = useState('')
  const [userName, setUserName]   = useState('')
  const [nameInput, setNameInput] = useState('')
  const [ready, setReady]         = useState(false)

  const [statusInput, setStatusInput] = useState('')
  const [gameInput, setGameInput]     = useState('')
  const [recruiting, setRecruiting]   = useState(false)

  const [presences, setPresences] = useState<Presence[]>([])
  const [messages, setMessages]   = useState<Message[]>([])
  const [msgInput, setMsgInput]   = useState('')
  const [sending, setSending]     = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const srRef      = useRef({ status: '', game: '', recruiting: false })

  useEffect(() => {
    const uid  = initUserId()
    const name = localStorage.getItem('gf_name') ?? ''
    setUserId(uid)
    if (name) { setUserName(name); setReady(true) }
  }, [])

  useEffect(() => { srRef.current = { status: statusInput, game: gameInput, recruiting } }, [statusInput, gameInput, recruiting])

  const upsert = useCallback(async (uid: string, name: string, extra?: Partial<Presence>) => {
    await supabase.from('presences').upsert({
      id: uid, name,
      status:     extra?.status     ?? srRef.current.status,
      game:       extra?.game       ?? srRef.current.game,
      recruiting: extra?.recruiting ?? srRef.current.recruiting,
      updated_at: new Date().toISOString(),
    })
  }, [])

  useEffect(() => {
    if (!ready || !userId) return

    supabase.from('messages').select('*').order('created_at').limit(100)
      .then(({ data }) => { if (data) setMessages(data) })

    const ago = new Date(Date.now() - ONLINE_MS).toISOString()
    supabase.from('presences').select('*').gt('updated_at', ago)
      .then(({ data }) => { if (data) setPresences(data) })

    const pSub = supabase.channel('presences-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'presences' },
        ({ eventType, new: n, old: o }) => {
          if (eventType === 'DELETE') {
            setPresences(prev => prev.filter(p => p.id !== (o as Presence).id))
          } else {
            const p = n as Presence
            setPresences(prev => {
              const i = prev.findIndex(x => x.id === p.id)
              if (i >= 0) { const a = [...prev]; a[i] = p; return a }
              return [p, ...prev]
            })
          }
        }).subscribe()

    const mSub = supabase.channel('messages-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        ({ new: n }) => setMessages(prev => [...prev, n as Message]))
      .subscribe()

    upsert(userId, userName)
    timerRef.current = setInterval(() => upsert(userId, userName), 60_000)

    return () => {
      pSub.unsubscribe()
      mSub.unsubscribe()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [ready, userId, userName, upsert])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSetup = () => {
    const n = nameInput.trim().slice(0, 16)
    if (!n) return
    localStorage.setItem('gf_name', n)
    setUserName(n)
    setReady(true)
  }

  const updateStatus = async (override?: Partial<Presence>) => {
    if (!userId) return
    await upsert(userId, userName, override)
  }

  const toggleRecruiting = () => {
    const next = !recruiting
    setRecruiting(next)
    updateStatus({ recruiting: next })
  }

  const sendMessage = async () => {
    const txt = msgInput.trim()
    if (!txt || sending) return
    setSending(true)
    await supabase.from('messages').insert({ user_id: userId, user_name: userName, content: txt })
    setMsgInput('')
    setSending(false)
  }

  const online = presences.filter(p => p.id !== userId && isOnline(p))

  // ── Setup screen ───────────────────────────────────────
  if (!ready) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#0d1117' }}>
      <div className="w-full max-w-sm rounded-2xl p-8" style={{ background: '#161b22', border: '1px solid #30363d' }}>
        <div className="text-4xl text-center mb-2">🎮</div>
        <h1 className="text-xl font-bold text-center mb-1" style={{ color: '#00bcd4' }}>ゲーム友達SNS</h1>
        <p className="text-sm text-center mb-6" style={{ color: '#8b949e' }}>ニックネームを決めよう</p>
        <input
          value={nameInput} onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSetup()}
          placeholder="名前（最大16文字）"
          maxLength={16}
          className="w-full rounded-lg px-4 py-3 mb-4 outline-none text-sm"
          style={{ background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3' }}
        />
        <button onClick={handleSetup}
          className="w-full font-bold py-3 rounded-lg text-sm transition"
          style={{ background: '#00bcd4', color: '#0d1117' }}>
          はじめる
        </button>
      </div>
    </div>
  )

  // ── Main screen ────────────────────────────────────────
  return (
    <div className="min-h-screen max-w-lg mx-auto px-3 pb-10" style={{ background: '#0d1117' }}>

      {/* Header */}
      <div className="flex items-center justify-between py-4 mb-4" style={{ borderBottom: '1px solid #30363d' }}>
        <span className="font-bold text-lg" style={{ color: '#00bcd4' }}>🎮 ゲーム友達SNS</span>
        <span className="text-sm" style={{ color: '#8b949e' }}>
          <span style={{ color: '#3fb950' }}>●</span> {userName}
        </span>
      </div>

      {/* My status */}
      <section className="rounded-xl p-4 mb-4" style={{ background: '#161b22', border: '1px solid #30363d' }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#8b949e' }}>自分のステータス</p>
        <input value={gameInput} onChange={e => setGameInput(e.target.value)}
          placeholder="ゲーム名（例: Roblox）"
          className="w-full rounded-lg px-3 py-2 text-sm mb-2 outline-none"
          style={{ background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3' }}
        />
        <input value={statusInput} onChange={e => setStatusInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && updateStatus()}
          placeholder="今何してる？（例: フレンドバトルしてる）"
          className="w-full rounded-lg px-3 py-2 text-sm mb-3 outline-none"
          style={{ background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3' }}
        />
        <div className="flex gap-2">
          <button onClick={() => updateStatus()}
            className="flex-1 font-bold py-2 rounded-lg text-sm"
            style={{ background: '#00bcd4', color: '#0d1117' }}>
            更新
          </button>
          <button onClick={toggleRecruiting}
            className="flex-1 font-bold py-2 rounded-lg text-sm transition"
            style={{
              background: recruiting ? 'rgba(63,185,80,0.15)' : 'transparent',
              border: `1px solid ${recruiting ? '#3fb950' : '#30363d'}`,
              color: recruiting ? '#3fb950' : '#8b949e',
            }}>
            {recruiting ? '✋ 募集中！' : '一緒にやる募集'}
          </button>
        </div>
      </section>

      {/* Friends */}
      <section className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: '#8b949e' }}>
          オンライン{online.length > 0 ? ` (${online.length}人)` : ''}
        </p>
        {online.length === 0 ? (
          <p className="text-sm p-4 rounded-xl" style={{ background: '#161b22', border: '1px solid #30363d', color: '#8b949e' }}>
            まだ誰もいないよ。URLを友達に送ろう！
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {online.map(p => (
              <div key={p.id} className="rounded-xl p-3 flex items-center gap-3"
                style={{ background: '#161b22', border: `1px solid ${p.recruiting ? '#3fb950' : '#30363d'}` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                  style={{ background: 'rgba(0,188,212,0.15)', color: '#00bcd4' }}>
                  {p.name[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm truncate" style={{ color: '#e6edf3' }}>{p.name}</span>
                    {p.recruiting && (
                      <span className="text-xs px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: 'rgba(63,185,80,0.15)', color: '#3fb950' }}>募集中</span>
                    )}
                  </div>
                  <p className="text-xs truncate" style={{ color: '#8b949e' }}>
                    {p.game && <span style={{ color: '#00bcd4' }}>{p.game} · </span>}
                    {p.status || 'オンライン'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Voice */}
      <section className="rounded-xl p-4 mb-4" style={{ background: '#161b22', border: '1px solid #30363d' }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#8b949e' }}>🎤 ボイスチャット</p>
        <VoiceChat userId={userId} userName={userName} />
      </section>

      {/* Chat */}
      <section className="rounded-xl p-4" style={{ background: '#161b22', border: '1px solid #30363d' }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#8b949e' }}>💬 チャット</p>
        <div className="h-72 overflow-y-auto flex flex-col gap-2 mb-3 pr-1">
          {messages.length === 0 && (
            <p className="text-xs text-center py-8" style={{ color: '#8b949e' }}>まだメッセージがないよ</p>
          )}
          {messages.map(m => (
            <div key={m.id} className={`flex gap-2 ${m.user_id === userId ? 'flex-row-reverse' : ''}`}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ background: m.user_id === userId ? 'rgba(0,188,212,0.2)' : '#30363d',
                         color: m.user_id === userId ? '#00bcd4' : '#8b949e' }}>
                {m.user_name[0]?.toUpperCase()}
              </div>
              <div className={`max-w-[75%] flex flex-col gap-0.5 ${m.user_id === userId ? 'items-end' : 'items-start'}`}>
                <span className="text-[10px] px-1" style={{ color: '#8b949e' }}>{m.user_name}</span>
                <div className="px-3 py-2 rounded-2xl text-sm break-words"
                  style={m.user_id === userId
                    ? { background: '#00bcd4', color: '#0d1117', borderTopRightRadius: 4 }
                    : { background: '#0d1117', color: '#e6edf3', border: '1px solid #30363d', borderTopLeftRadius: 4 }}>
                  {m.content}
                </div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="flex gap-2">
          <input value={msgInput} onChange={e => setMsgInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="メッセージを入力..."
            className="flex-1 rounded-xl px-4 py-2 text-sm outline-none"
            style={{ background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3' }}
          />
          <button onClick={sendMessage} disabled={sending || !msgInput.trim()}
            className="font-bold px-4 rounded-xl text-sm shrink-0 transition disabled:opacity-40"
            style={{ background: '#00bcd4', color: '#0d1117' }}>
            送信
          </button>
        </div>
      </section>
    </div>
  )
}
