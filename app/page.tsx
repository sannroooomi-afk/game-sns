'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { moderate } from '@/lib/moderate'

const VoiceChat = dynamic(() => import('@/components/VoiceChat'), { ssr: false })

interface Presence {
  id: string; name: string; status: string; game: string
  recruiting: boolean; updated_at: string; server: number
}
interface Message {
  id: string; user_id: string; user_name: string; content: string; created_at: string
  dm_to: string | null; group_id: string | null; server_id: number | null
}
interface Friendship { id: string; requester_id: string; addressee_id: string; status: string }
interface FriendUser { id: string; username: string }
interface Group { id: string; name: string; owner_id: string }
type Tab = 'all' | 'friends' | 'groups'

const ONLINE_MS = 2 * 60 * 1000
const isOnlineP = (p: Presence) => Date.now() - new Date(p.updated_at).getTime() < ONLINE_MS

function initUserId() {
  let id = localStorage.getItem('gf_uid')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('gf_uid', id) }
  return id
}

const C = { bg: '#0d1117', card: '#161b22', border: '#30363d', accent: '#00bcd4', muted: '#8b949e', text: '#e6edf3' }

export default function Page() {
  const [ready, setReady]         = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameError, setNameError] = useState('')
  const [userName, setUserName]   = useState('')
  const [tab, setTab]             = useState<Tab>('all')
  const [server, setServer]       = useState(1)

  const [statusInput, setStatusInput] = useState('')
  const [gameInput, setGameInput]     = useState('')
  const [recruiting, setRecruiting]   = useState(false)
  const [presences, setPresences]     = useState<Presence[]>([])
  const [globalMsgs, setGlobalMsgs]   = useState<Message[]>([])
  const [globalInput, setGlobalInput] = useState('')

  const [friends, setFriends]         = useState<Friendship[]>([])
  const [friendUsers, setFriendUsers] = useState<Record<string, FriendUser>>({})
  const [addInput, setAddInput]       = useState('')
  const [addError, setAddError]       = useState('')
  const [selFriend, setSelFriend]     = useState<string | null>(null)
  const [dmMsgs, setDmMsgs]           = useState<Message[]>([])
  const [dmInput, setDmInput]         = useState('')

  const [groups, setGroups]               = useState<Group[]>([])
  const [groupMemCount, setGroupMemCount] = useState<Record<string, number>>({})
  const [selGroup, setSelGroup]           = useState<string | null>(null)
  const [groupMsgs, setGroupMsgs]         = useState<Message[]>([])
  const [groupInput, setGroupInput]       = useState('')
  const [newGroupName, setNewGroupName]   = useState('')
  const [inviteInput, setInviteInput]     = useState('')
  const [inviteError, setInviteError]     = useState('')

  const userIdRef    = useRef('')
  const userNameRef  = useRef('')
  const serverRef    = useRef(1)
  const selFriendRef = useRef<string | null>(null)
  const selGroupRef  = useRef<string | null>(null)
  const srRef        = useRef({ status: '', game: '', recruiting: false })
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const globalEndRef = useRef<HTMLDivElement>(null)
  const dmEndRef     = useRef<HTMLDivElement>(null)
  const groupEndRef  = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const uid  = initUserId()
    userIdRef.current = uid
    const name = localStorage.getItem('gf_name') ?? ''
    if (name) { userNameRef.current = name; setUserName(name); setReady(true) }
  }, [])

  // マイク権限を事前に取得（毎回ポップアップが出ないように）
  useEffect(() => {
    if (!ready) return
    navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => {})
  }, [ready])

  useEffect(() => { srRef.current = { status: statusInput, game: gameInput, recruiting } }, [statusInput, gameInput, recruiting])
  useEffect(() => { globalEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [globalMsgs])
  useEffect(() => { dmEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [dmMsgs])
  useEffect(() => { groupEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [groupMsgs])

  const upsert = useCallback(async (extra?: Partial<Presence>) => {
    await supabase.from('presences').upsert({
      id: userIdRef.current, name: userNameRef.current,
      server:     extra?.server     ?? serverRef.current,
      status:     extra?.status     ?? srRef.current.status,
      game:       extra?.game       ?? srRef.current.game,
      recruiting: extra?.recruiting ?? srRef.current.recruiting,
      updated_at: new Date().toISOString(),
    })
  }, [])

  const loadFriends = useCallback(async () => {
    const uid = userIdRef.current
    const { data } = await supabase.from('friendships')
      .select('*').or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
    if (!data) return
    setFriends(data)
    const ids = data.map(f => f.requester_id === uid ? f.addressee_id : f.requester_id)
    if (ids.length === 0) return
    const { data: users } = await supabase.from('users').select('*').in('id', ids)
    if (users) {
      const map: Record<string, FriendUser> = {}
      users.forEach(u => { map[u.id] = u })
      setFriendUsers(map)
    }
  }, [])

  const loadGroups = useCallback(async () => {
    const uid = userIdRef.current
    const { data: mems } = await supabase.from('group_members').select('group_id').eq('user_id', uid)
    if (!mems || mems.length === 0) { setGroups([]); return }
    const ids = mems.map((m: any) => m.group_id)
    const { data: gs } = await supabase.from('groups').select('*').in('id', ids)
    if (gs) setGroups(gs)
    const { data: allMems } = await supabase.from('group_members').select('*').in('group_id', ids)
    if (allMems) {
      const cnt: Record<string, number> = {}
      allMems.forEach((m: any) => { cnt[m.group_id] = (cnt[m.group_id] ?? 0) + 1 })
      setGroupMemCount(cnt)
    }
  }, [])

  const loadGlobalMsgs = useCallback(async (srv: number) => {
    const { data } = await supabase.from('messages').select('*')
      .is('dm_to', null).is('group_id', null).eq('server_id', srv)
      .order('created_at').limit(100)
    if (data) setGlobalMsgs(data)
  }, [])

  useEffect(() => {
    if (!ready) return
    const uid = userIdRef.current
    const ago = new Date(Date.now() - ONLINE_MS).toISOString()

    supabase.from('presences').select('*').gt('updated_at', ago)
      .then(({ data }) => { if (data) setPresences(data) })
    loadGlobalMsgs(1)
    loadFriends()
    loadGroups()

    const pSub = supabase.channel('pres-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'presences' },
        ({ eventType, new: n, old: o }) => {
          if (eventType === 'DELETE') setPresences(prev => prev.filter(p => p.id !== (o as any).id))
          else {
            const p = n as Presence
            setPresences(prev => {
              const i = prev.findIndex(x => x.id === p.id)
              if (i >= 0) { const a = [...prev]; a[i] = p; return a }
              return [p, ...prev]
            })
          }
        }).subscribe()

    const mSub = supabase.channel('msg-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        ({ new: n }) => {
          const msg = n as Message
          if (!msg.dm_to && !msg.group_id && msg.server_id === serverRef.current) {
            setGlobalMsgs(prev => [...prev, msg])
          } else if (msg.dm_to && (msg.user_id === uid || msg.dm_to === uid)) {
            const other = msg.user_id === uid ? msg.dm_to : msg.user_id
            if (selFriendRef.current === other) setDmMsgs(prev => [...prev, msg])
          } else if (msg.group_id && msg.group_id === selGroupRef.current) {
            setGroupMsgs(prev => [...prev, msg])
          }
        }).subscribe()

    const fSub = supabase.channel('friend-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' },
        () => loadFriends()).subscribe()

    upsert()
    timerRef.current = setInterval(() => upsert(), 60_000)

    return () => {
      pSub.unsubscribe(); mSub.unsubscribe(); fSub.unsubscribe()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [ready, loadFriends, loadGroups, loadGlobalMsgs, upsert])

  const changeServer = (s: number) => {
    setServer(s)
    serverRef.current = s
    setGlobalMsgs([])
    loadGlobalMsgs(s)
    upsert()
  }

  const handleSetup = async () => {
    const raw = nameInput.trim().slice(0, 16)
    if (!raw) return
    const uid = userIdRef.current
    const { data: existing } = await supabase.from('users').select('id').eq('username', raw).single()
    if (existing && existing.id !== uid) { setNameError('この名前はすでに使われています'); return }
    const modded = moderate(raw)
    await supabase.from('users').upsert({ id: uid, username: modded })
    localStorage.setItem('gf_name', modded)
    userNameRef.current = modded
    setUserName(modded); setNameError(''); setReady(true)
  }

  const handleLogout = () => {
    localStorage.removeItem('gf_name')
    userNameRef.current = ''
    if (timerRef.current) clearInterval(timerRef.current)
    setUserName(''); setNameInput(''); setReady(false)
    setSelFriend(null); selFriendRef.current = null
    setSelGroup(null);  selGroupRef.current  = null
    setServer(1); serverRef.current = 1
    setTab('all')
  }

  const sendGlobal = async () => {
    const txt = moderate(globalInput.trim())
    if (!txt) return
    await supabase.from('messages').insert({
      user_id: userIdRef.current, user_name: userNameRef.current,
      content: txt, dm_to: null, group_id: null, server_id: serverRef.current,
    })
    setGlobalInput('')
  }

  const sendFriendReq = async () => {
    const target = addInput.trim()
    if (!target) return
    setAddError('')
    const uid = userIdRef.current
    if (target === userNameRef.current) { setAddError('自分には送れないよ'); return }
    const { data: tu } = await supabase.from('users').select('*').eq('username', target).single()
    if (!tu) { setAddError('ユーザーが見つかりません'); return }
    const { data: ex } = await supabase.from('friendships').select('id')
      .or(`and(requester_id.eq.${uid},addressee_id.eq.${tu.id}),and(requester_id.eq.${tu.id},addressee_id.eq.${uid})`)
    if (ex && ex.length > 0) { setAddError('すでに申請済みか友達です'); return }
    await supabase.from('friendships').insert({ requester_id: uid, addressee_id: tu.id })
    setAddInput(''); loadFriends()
  }

  const acceptFriend = async (id: string) => {
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id)
    loadFriends()
  }

  const removeFriend = async (id: string) => {
    await supabase.from('friendships').delete().eq('id', id)
    setSelFriend(null); selFriendRef.current = null
    loadFriends()
  }

  const openDm = async (fuid: string) => {
    setSelFriend(fuid); selFriendRef.current = fuid
    const uid = userIdRef.current
    const { data } = await supabase.from('messages').select('*')
      .or(`and(user_id.eq.${uid},dm_to.eq.${fuid}),and(user_id.eq.${fuid},dm_to.eq.${uid})`)
      .order('created_at').limit(100)
    if (data) setDmMsgs(data)
  }

  const sendDm = async () => {
    const txt = moderate(dmInput.trim())
    if (!txt || !selFriend) return
    await supabase.from('messages').insert({
      user_id: userIdRef.current, user_name: userNameRef.current, content: txt, dm_to: selFriend,
    })
    setDmInput('')
  }

  const createGroup = async () => {
    const name = newGroupName.trim()
    if (!name) return
    const uid = userIdRef.current
    const { data } = await supabase.from('groups').insert({ name, owner_id: uid }).select().single()
    if (!data) return
    await supabase.from('group_members').insert({ group_id: data.id, user_id: uid })
    setNewGroupName(''); loadGroups()
  }

  const openGroup = async (gid: string) => {
    setSelGroup(gid); selGroupRef.current = gid
    const { data } = await supabase.from('messages').select('*')
      .eq('group_id', gid).order('created_at').limit(100)
    if (data) setGroupMsgs(data)
  }

  const sendGroupMsg = async () => {
    const txt = moderate(groupInput.trim())
    if (!txt || !selGroup) return
    await supabase.from('messages').insert({
      user_id: userIdRef.current, user_name: userNameRef.current, content: txt, group_id: selGroup,
    })
    setGroupInput('')
  }

  const inviteToGroup = async () => {
    const target = inviteInput.trim()
    if (!target || !selGroup) return
    setInviteError('')
    const { data: tu } = await supabase.from('users').select('*').eq('username', target).single()
    if (!tu) { setInviteError('ユーザーが見つかりません'); return }
    const isFriend = friends.some(f => f.status === 'accepted' &&
      (f.requester_id === tu.id || f.addressee_id === tu.id))
    if (!isFriend) { setInviteError('友達のみ招待できます'); return }
    await supabase.from('group_members').upsert({ group_id: selGroup, user_id: tu.id })
    setInviteInput(''); loadGroups()
  }

  const getFriendId   = (f: Friendship) => f.requester_id === userIdRef.current ? f.addressee_id : f.requester_id
  const getFriendName = (id: string) => friendUsers[id]?.username ?? '...'

  const online   = presences.filter(p => p.id !== userIdRef.current && isOnlineP(p) && p.server === server)
  const pending  = friends.filter(f => f.status === 'pending' && f.addressee_id === userIdRef.current)
  const accepted = friends.filter(f => f.status === 'accepted')

  // ── Setup screen ──────────────────────────────────────────
  if (!ready) return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: C.bg }}>
      <div className="w-full max-w-sm rounded-2xl p-8" style={{ background: C.card, border: `1px solid ${C.border}` }}>
        <div className="text-4xl text-center mb-2">🎮</div>
        <h1 className="text-xl font-bold text-center mb-1" style={{ color: C.accent }}>ゲーム友達SNS</h1>
        <p className="text-sm text-center mb-6" style={{ color: C.muted }}>ニックネームを決めよう（世界で一つだけ）</p>
        <input value={nameInput} onChange={e => { setNameInput(e.target.value); setNameError('') }}
          onKeyDown={e => e.key === 'Enter' && handleSetup()}
          placeholder="名前（最大16文字）" maxLength={16}
          className="w-full rounded-lg px-4 py-3 mb-2 outline-none text-sm"
          style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }} />
        {nameError && <p className="text-xs mb-2" style={{ color: '#f85149' }}>{nameError}</p>}
        <button onClick={handleSetup} className="w-full font-bold py-3 rounded-lg text-sm mt-2"
          style={{ background: C.accent, color: C.bg }}>はじめる</button>
      </div>
    </div>
  )

  // ── Main screen ───────────────────────────────────────────
  return (
    <div className="flex flex-col" style={{ background: C.bg, minHeight: '100dvh', maxWidth: 480, margin: '0 auto' }}>

      {/* Header */}
      <div className="sticky top-0 z-20" style={{ background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-bold" style={{ color: C.accent }}>🎮 ゲーム友達</span>
          <div className="flex items-center gap-3">
            <span className="text-sm" style={{ color: C.muted }}>
              <span style={{ color: '#3fb950' }}>●</span> {userName}
            </span>
            <button onClick={handleLogout} className="text-xs px-3 py-1 rounded-lg"
              style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>
              ログアウト
            </button>
          </div>
        </div>

        {/* Server tabs */}
        <div className="flex px-3 pb-2 gap-1.5">
          {[1, 2, 3, 4, 5].map(s => (
            <button key={s} onClick={() => changeServer(s)}
              className="flex-1 py-1.5 rounded-lg text-xs font-bold transition"
              style={{
                background: server === s ? C.accent : 'transparent',
                color:      server === s ? C.bg : C.muted,
                border:    `1px solid ${server === s ? C.accent : C.border}`,
              }}>
              サーバー{s}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-20">

        {/* ── 全体 ── */}
        {tab === 'all' && <>
          <section className="rounded-xl p-4 mb-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.muted }}>自分のステータス</p>
            <input value={gameInput} onChange={e => setGameInput(e.target.value)}
              placeholder="ゲーム名" className="w-full rounded-lg px-3 py-2 text-sm mb-2 outline-none"
              style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }} />
            <input value={statusInput} onChange={e => setStatusInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && upsert()}
              placeholder="今何してる？" className="w-full rounded-lg px-3 py-2 text-sm mb-3 outline-none"
              style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }} />
            <div className="flex gap-2">
              <button onClick={() => upsert()} className="flex-1 font-bold py-2 rounded-lg text-sm"
                style={{ background: C.accent, color: C.bg }}>更新</button>
              <button onClick={() => { const n = !recruiting; setRecruiting(n); upsert({ recruiting: n }) }}
                className="flex-1 font-bold py-2 rounded-lg text-sm"
                style={{ background: recruiting ? 'rgba(63,185,80,0.15)' : 'transparent', border: `1px solid ${recruiting ? '#3fb950' : C.border}`, color: recruiting ? '#3fb950' : C.muted }}>
                {recruiting ? '✋ 募集中！' : '一緒に募集'}
              </button>
            </div>
          </section>

          <p className="text-xs font-semibold uppercase tracking-wide mb-2 px-1" style={{ color: C.muted }}>
            オンライン {online.length > 0 && `(${online.length})`}
          </p>
          {online.length === 0
            ? <p className="text-sm p-4 rounded-xl mb-3" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.muted }}>まだ誰もいないよ！URLを友達に送ろう</p>
            : <div className="flex flex-col gap-2 mb-3">{online.map(p => (
              <div key={p.id} className="rounded-xl p-3 flex items-center gap-3"
                style={{ background: C.card, border: `1px solid ${p.recruiting ? '#3fb950' : C.border}` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                  style={{ background: 'rgba(0,188,212,0.15)', color: C.accent }}>{p.name[0]?.toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm truncate" style={{ color: C.text }}>{p.name}</span>
                    {p.recruiting && <span className="text-xs px-2 py-0.5 rounded-full shrink-0"
                      style={{ background: 'rgba(63,185,80,0.15)', color: '#3fb950' }}>募集中</span>}
                  </div>
                  <p className="text-xs truncate" style={{ color: C.muted }}>
                    {p.game && <span style={{ color: C.accent }}>{p.game} · </span>}{p.status || 'オンライン'}
                  </p>
                </div>
              </div>
            ))}</div>
          }

          <section className="rounded-xl p-4 mb-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.muted }}>
              🎤 ボイスチャット — サーバー{server}
            </p>
            <VoiceChat
              key={server}
              userId={userIdRef.current}
              userName={userName}
              channel={`server-${server}`}
              presences={presences}
            />
          </section>

          <section className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.muted }}>
              💬 全体チャット — サーバー{server}
            </p>
            <div className="h-64 overflow-y-auto flex flex-col gap-2 mb-3">
              {globalMsgs.length === 0 && <p className="text-xs text-center py-8" style={{ color: C.muted }}>まだメッセージがないよ</p>}
              {globalMsgs.map(m => <Bubble key={m.id} m={m} myId={userIdRef.current} />)}
              <div ref={globalEndRef} />
            </div>
            <CInput value={globalInput} onChange={setGlobalInput} onSend={sendGlobal} />
          </section>
        </>}

        {/* ── 友達 ── */}
        {tab === 'friends' && <>
          {selFriend ? <>
            <button onClick={() => { setSelFriend(null); selFriendRef.current = null }}
              className="text-sm mb-3 flex items-center gap-1" style={{ color: C.muted }}>← 戻る</button>
            <section className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <p className="font-semibold text-sm mb-3" style={{ color: C.text }}>
                💬 {getFriendName(selFriend)} とのDM
              </p>
              <div className="h-[420px] overflow-y-auto flex flex-col gap-2 mb-3">
                {dmMsgs.length === 0 && <p className="text-xs text-center py-8" style={{ color: C.muted }}>まだメッセージがないよ</p>}
                {dmMsgs.map(m => <Bubble key={m.id} m={m} myId={userIdRef.current} />)}
                <div ref={dmEndRef} />
              </div>
              <CInput value={dmInput} onChange={setDmInput} onSend={sendDm} />
            </section>
          </> : <>
            <section className="rounded-xl p-4 mb-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.muted }}>友達を追加</p>
              <div className="flex gap-2">
                <input value={addInput} onChange={e => { setAddInput(e.target.value); setAddError('') }}
                  onKeyDown={e => e.key === 'Enter' && sendFriendReq()}
                  placeholder="ユーザー名を入力" className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }} />
                <button onClick={sendFriendReq} className="px-4 py-2 rounded-lg text-sm font-bold"
                  style={{ background: C.accent, color: C.bg }}>送信</button>
              </div>
              {addError && <p className="text-xs mt-2" style={{ color: '#f85149' }}>{addError}</p>}
            </section>

            {pending.length > 0 && (
              <section className="rounded-xl p-4 mb-3" style={{ background: C.card, border: '1px solid #f0883e' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: '#f0883e' }}>
                  申請が届いてるよ ({pending.length})
                </p>
                {pending.map(f => (
                  <div key={f.id} className="flex items-center justify-between py-2">
                    <span className="text-sm" style={{ color: C.text }}>{getFriendName(f.requester_id)}</span>
                    <div className="flex gap-2">
                      <button onClick={() => acceptFriend(f.id)} className="text-xs px-3 py-1 rounded-lg font-bold"
                        style={{ background: 'rgba(63,185,80,0.15)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.4)' }}>承認</button>
                      <button onClick={() => removeFriend(f.id)} className="text-xs px-3 py-1 rounded-lg"
                        style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)' }}>拒否</button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            <section className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.muted }}>
                友達 ({accepted.length})
              </p>
              {accepted.length === 0
                ? <p className="text-sm text-center py-6" style={{ color: C.muted }}>まだ友達がいないよ</p>
                : <div className="flex flex-col">{accepted.map(f => {
                  const fid   = getFriendId(f)
                  const fname = getFriendName(fid)
                  const on    = presences.some(p => p.id === fid && isOnlineP(p))
                  return (
                    <div key={f.id} className="flex items-center justify-between py-3"
                      style={{ borderBottom: `1px solid ${C.border}` }}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0"
                          style={{ background: 'rgba(0,188,212,0.15)', color: C.accent }}>{fname[0]?.toUpperCase()}</div>
                        <div>
                          <p className="text-sm font-semibold" style={{ color: C.text }}>{fname}</p>
                          <p className="text-xs" style={{ color: on ? '#3fb950' : C.muted }}>{on ? 'オンライン' : 'オフライン'}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openDm(fid)} className="text-xs px-3 py-1 rounded-lg"
                          style={{ background: 'rgba(0,188,212,0.1)', color: C.accent, border: `1px solid rgba(0,188,212,0.3)` }}>DM</button>
                        <button onClick={() => removeFriend(f.id)} className="text-xs px-3 py-1 rounded-lg"
                          style={{ background: 'transparent', color: C.muted, border: `1px solid ${C.border}` }}>削除</button>
                      </div>
                    </div>
                  )
                })}</div>
              }
            </section>
          </>}
        </>}

        {/* ── グループ ── */}
        {tab === 'groups' && <>
          {selGroup ? <>
            <button onClick={() => { setSelGroup(null); selGroupRef.current = null }}
              className="text-sm mb-3 flex items-center gap-1" style={{ color: C.muted }}>← 戻る</button>
            <section className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <p className="font-semibold text-sm mb-2" style={{ color: C.text }}>
                {groups.find(g => g.id === selGroup)?.name}
              </p>
              {groups.find(g => g.id === selGroup)?.owner_id === userIdRef.current && (
                <div className="mb-3">
                  <div className="flex gap-2">
                    <input value={inviteInput} onChange={e => { setInviteInput(e.target.value); setInviteError('') }}
                      onKeyDown={e => e.key === 'Enter' && inviteToGroup()}
                      placeholder="友達のユーザー名を招待" className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
                      style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }} />
                    <button onClick={inviteToGroup} className="text-xs px-3 py-1.5 rounded-lg font-bold"
                      style={{ background: C.accent, color: C.bg }}>招待</button>
                  </div>
                  {inviteError && <p className="text-xs mt-1" style={{ color: '#f85149' }}>{inviteError}</p>}
                </div>
              )}
              <div className="h-80 overflow-y-auto flex flex-col gap-2 mb-3">
                {groupMsgs.length === 0 && <p className="text-xs text-center py-8" style={{ color: C.muted }}>まだメッセージがないよ</p>}
                {groupMsgs.map(m => <Bubble key={m.id} m={m} myId={userIdRef.current} />)}
                <div ref={groupEndRef} />
              </div>
              <CInput value={groupInput} onChange={setGroupInput} onSend={sendGroupMsg} />
            </section>
          </> : <>
            <section className="rounded-xl p-4 mb-3" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.muted }}>グループを作成</p>
              <div className="flex gap-2">
                <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createGroup()}
                  placeholder="グループ名" className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }} />
                <button onClick={createGroup} className="px-4 py-2 rounded-lg text-sm font-bold"
                  style={{ background: C.accent, color: C.bg }}>作成</button>
              </div>
            </section>
            <section className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.muted }}>
                グループ ({groups.length})
              </p>
              {groups.length === 0
                ? <p className="text-sm text-center py-6" style={{ color: C.muted }}>まだグループがないよ</p>
                : <div className="flex flex-col gap-2">{groups.map(g => (
                  <button key={g.id} onClick={() => openGroup(g.id)}
                    className="flex items-center gap-3 p-3 rounded-xl text-left w-full"
                    style={{ background: C.bg, border: `1px solid ${C.border}` }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0"
                      style={{ background: 'rgba(0,188,212,0.15)', color: C.accent }}>{g.name[0]?.toUpperCase()}</div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: C.text }}>{g.name}</p>
                      <p className="text-xs" style={{ color: C.muted }}>{groupMemCount[g.id] ?? 0}人</p>
                    </div>
                  </button>
                ))}</div>
              }
            </section>
          </>}
        </>}
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 flex z-20"
        style={{ background: C.card, borderTop: `1px solid ${C.border}` }}>
        {(['all', 'friends', 'groups'] as Tab[]).map(t => {
          const labels: Record<Tab, string> = { all: '全体', friends: '友達', groups: 'グループ' }
          const icons:  Record<Tab, string> = { all: '🌐', friends: '👥', groups: '💬' }
          const badge = t === 'friends' && pending.length > 0 ? pending.length : 0
          return (
            <button key={t} onClick={() => setTab(t)}
              className="flex-1 flex flex-col items-center py-3 gap-0.5 relative"
              style={{ color: tab === t ? C.accent : C.muted }}>
              <span className="text-xl">{icons[t]}</span>
              <span className="text-[10px] font-semibold">{labels[t]}</span>
              {badge > 0 && (
                <span className="absolute top-1.5 right-[28%] w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
                  style={{ background: '#f85149', color: 'white' }}>{badge}</span>
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function Bubble({ m, myId }: { m: Message; myId: string }) {
  const me = m.user_id === myId
  return (
    <div className={`flex gap-2 ${me ? 'flex-row-reverse' : ''}`}>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{ background: me ? 'rgba(0,188,212,0.2)' : '#30363d', color: me ? '#00bcd4' : '#8b949e' }}>
        {m.user_name[0]?.toUpperCase()}
      </div>
      <div className={`max-w-[75%] flex flex-col gap-0.5 ${me ? 'items-end' : 'items-start'}`}>
        <span className="text-[10px] px-1" style={{ color: '#8b949e' }}>{m.user_name}</span>
        <div className="px-3 py-2 rounded-2xl text-sm break-words"
          style={me ? { background: '#00bcd4', color: '#0d1117', borderTopRightRadius: 4 }
                   : { background: '#0d1117', color: '#e6edf3', border: '1px solid #30363d', borderTopLeftRadius: 4 }}>
          {m.content}
        </div>
      </div>
    </div>
  )
}

function CInput({ value, onChange, onSend }: { value: string; onChange: (v: string) => void; onSend: () => void }) {
  return (
    <div className="flex gap-2">
      <input value={value} onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && onSend()}
        placeholder="メッセージを入力..."
        className="flex-1 rounded-xl px-4 py-2 text-sm outline-none"
        style={{ background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3' }} />
      <button onClick={onSend} disabled={!value.trim()}
        className="font-bold px-4 rounded-xl text-sm shrink-0 disabled:opacity-40"
        style={{ background: '#00bcd4', color: '#0d1117' }}>送信</button>
    </div>
  )
}
