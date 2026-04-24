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
  dm_to: string | null; group_id: string | null; server_id: number | null; edited?: boolean
}
interface Friendship { id: string; requester_id: string; addressee_id: string; status: string }
interface FriendUser { id: string; username: string; display_name?: string; bio?: string }
interface Group { id: string; name: string; owner_id: string }
interface ProfileData { id: string; username: string; display_name: string; bio: string; presence?: Presence; isOwn?: boolean }
type Tab = 'all' | 'friends' | 'groups'
type ChatType = 'global' | 'dm' | 'group'

function avatarColor(name: string) {
  const colors = ['#5865f2','#eb459e','#3ba55d','#faa81a','#ed4245','#00bcd4','#f0883e']
  return colors[(name || '?').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length]
}

const ADMIN = 'user'
const ONLINE_MS = 2 * 60 * 1000
const isOnlineP = (p: Presence) => Date.now() - new Date(p.updated_at).getTime() < ONLINE_MS
function initUserId() {
  let id = localStorage.getItem('gf_uid')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('gf_uid', id) }
  return id
}

const BG   = '#0d1117'
const CARD = '#161b22'
const SIDE = '#0d1117'
const BD   = '#30363d'
const ACC  = '#00bcd4'
const MUT  = '#8b949e'
const TXT  = '#e6edf3'

export default function Page() {
  const [ready, setReady]         = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameError, setNameError] = useState('')
  const [userName, setUserName]   = useState('')
  const [tab, setTab]             = useState<Tab>('all')
  const [server, setServer]       = useState(1)
  const [chatType, setChatType]   = useState<ChatType>('global')
  const [isDesktop, setIsDesktop] = useState(false)

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
  const [friendsView, setFriendsView]     = useState<'online'|'all'|'pending'|'add'>('online')
  const [userHandle, setUserHandle]       = useState('')
  const [userBio, setUserBio]             = useState('')
  const [viewProfile, setViewProfile]     = useState<ProfileData | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [editDispName, setEditDispName]   = useState('')
  const [editBio, setEditBio]             = useState('')

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
    const uid = initUserId(); userIdRef.current = uid
    const name   = localStorage.getItem('gf_name') ?? ''
    const handle = localStorage.getItem('gf_handle') ?? ''
    if (name) {
      userNameRef.current = name; setUserName(name)
      setUserHandle(handle || name)
      supabase.from('users').select('bio').eq('id', uid).single().then(({ data }) => {
        if (data?.bio) setUserBio(data.bio)
      })
      setReady(true)
    }
  }, [])
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 768)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  useEffect(() => { if (!ready) return; navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => {}) }, [ready])
  useEffect(() => { srRef.current = { status: statusInput, game: gameInput, recruiting } }, [statusInput, gameInput, recruiting])
  useEffect(() => { globalEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [globalMsgs])
  useEffect(() => { dmEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [dmMsgs])
  useEffect(() => { groupEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [groupMsgs])

  const upsert = useCallback(async (extra?: Partial<Presence>) => {
    await supabase.from('presences').upsert({
      id: userIdRef.current, name: userNameRef.current,
      server: extra?.server ?? serverRef.current,
      status: extra?.status ?? srRef.current.status,
      game:   extra?.game   ?? srRef.current.game,
      recruiting: extra?.recruiting ?? srRef.current.recruiting,
      updated_at: new Date().toISOString(),
    })
  }, [])

  const loadFriends = useCallback(async () => {
    const uid = userIdRef.current
    const { data } = await supabase.from('friendships').select('*')
      .or(`requester_id.eq.${uid},addressee_id.eq.${uid}`)
    if (!data) return
    setFriends(data)
    const ids = data.map(f => f.requester_id === uid ? f.addressee_id : f.requester_id)
    if (!ids.length) return
    const { data: users } = await supabase.from('users').select('id,username,display_name,bio').in('id', ids)
    if (users) { const m: Record<string, FriendUser> = {}; users.forEach(u => { m[u.id] = u }); setFriendUsers(m) }
  }, [])

  const loadGroups = useCallback(async () => {
    const uid = userIdRef.current
    const { data: mems } = await supabase.from('group_members').select('group_id').eq('user_id', uid)
    if (!mems?.length) { setGroups([]); return }
    const ids = mems.map((m: any) => m.group_id)
    const { data: gs } = await supabase.from('groups').select('*').in('id', ids)
    if (gs) setGroups(gs)
    const { data: am } = await supabase.from('group_members').select('*').in('group_id', ids)
    if (am) { const c: Record<string, number> = {}; am.forEach((m: any) => { c[m.group_id] = (c[m.group_id] ?? 0) + 1 }); setGroupMemCount(c) }
  }, [])

  const loadGlobal = useCallback(async (srv: number) => {
    const { data } = await supabase.from('messages').select('*')
      .is('dm_to', null).is('group_id', null).eq('server_id', srv)
      .order('created_at').limit(100)
    if (data) setGlobalMsgs(data)
  }, [])

  useEffect(() => {
    if (!ready) return
    const uid = userIdRef.current
    const ago = new Date(Date.now() - ONLINE_MS).toISOString()
    supabase.from('presences').select('*').gt('updated_at', ago).then(({ data }) => { if (data) setPresences(data) })
    loadGlobal(1); loadFriends(); loadGroups()

    const pSub = supabase.channel('pres-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'presences' },
      ({ eventType, new: n, old: o }) => {
        if (eventType === 'DELETE') setPresences(p => p.filter(x => x.id !== (o as any).id))
        else { const p = n as Presence; setPresences(prev => { const i = prev.findIndex(x => x.id === p.id); if (i >= 0) { const a = [...prev]; a[i] = p; return a } return [p, ...prev] }) }
      }).subscribe()

    const mSub = supabase.channel('msg-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'messages' },
      ({ eventType, new: n, old: o }) => {
        if (eventType === 'INSERT') {
          const msg = n as Message
          // Replace matching temp message (same user+content) OR dedup by real ID
          const addMsg = (prev: Message[]) => {
            const withoutTemp = prev.filter(m => !(m.id.startsWith('~') && m.user_id === msg.user_id && m.content === msg.content))
            return withoutTemp.some(m => m.id === msg.id) ? withoutTemp : [...withoutTemp, msg]
          }
          if (!msg.dm_to && !msg.group_id && msg.server_id === serverRef.current) setGlobalMsgs(addMsg)
          else if (msg.dm_to && (msg.user_id === uid || msg.dm_to === uid)) {
            const other = msg.user_id === uid ? msg.dm_to : msg.user_id
            if (selFriendRef.current === other) setDmMsgs(addMsg)
          } else if (msg.group_id && msg.group_id === selGroupRef.current) setGroupMsgs(addMsg)
        } else if (eventType === 'UPDATE') {
          const msg = n as Message
          const upd = (msgs: Message[]) => msgs.map(m => m.id === msg.id ? { ...m, content: msg.content, edited: msg.edited } : m)
          setGlobalMsgs(upd); setDmMsgs(upd); setGroupMsgs(upd)
        } else if (eventType === 'DELETE') {
          const id = (o as any).id
          setGlobalMsgs(p => p.filter(m => m.id !== id))
          setDmMsgs(p => p.filter(m => m.id !== id))
          setGroupMsgs(p => p.filter(m => m.id !== id))
        }
      }).subscribe()

    const fSub = supabase.channel('friend-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => loadFriends()).subscribe()
    const gSub = supabase.channel('grpmem-rt').on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' },
      ({ eventType, new: n, old: o }) => {
        const row = (eventType === 'DELETE' ? o : n) as any
        if (row?.user_id === uid) loadGroups()
      }).subscribe()

    upsert(); timerRef.current = setInterval(() => upsert(), 60_000)
    return () => { pSub.unsubscribe(); mSub.unsubscribe(); fSub.unsubscribe(); gSub.unsubscribe(); if (timerRef.current) clearInterval(timerRef.current) }
  }, [ready, loadFriends, loadGroups, loadGlobal, upsert])

  const changeServer = (s: number) => { setServer(s); serverRef.current = s; setGlobalMsgs([]); loadGlobal(s); upsert() }
  const handleLogout = async () => {
    const uid = userIdRef.current
    if (timerRef.current) clearInterval(timerRef.current)
    localStorage.removeItem('gf_name'); localStorage.removeItem('gf_uid'); localStorage.removeItem('gf_handle')
    userNameRef.current = ''
    await Promise.all([
      supabase.from('messages').delete().eq('user_id', uid),
      supabase.from('friendships').delete().or(`requester_id.eq.${uid},addressee_id.eq.${uid}`),
      supabase.from('group_members').delete().eq('user_id', uid),
      supabase.from('presences').delete().eq('id', uid),
      supabase.from('users').delete().eq('id', uid),
    ])
    setUserName(''); setNameInput(''); setReady(false)
    setSelFriend(null); selFriendRef.current = null; setSelGroup(null); selGroupRef.current = null
    setServer(1); serverRef.current = 1; setTab('all'); setChatType('global')
    userIdRef.current = crypto.randomUUID(); localStorage.setItem('gf_uid', userIdRef.current)
  }
  const handleSetup = async () => {
    const raw = nameInput.trim().slice(0, 16)
    if (!raw) return
    if (raw.length < 3) { setNameError('3文字以上で入力してください'); return }
    const uid = userIdRef.current
    const { data: ban } = await supabase.from('bans').select('user_id').eq('user_id', uid).single()
    if (ban) { setNameError('このアカウントはBANされています'); return }
    const { data: ex } = await supabase.from('users').select('id').eq('username', raw).single()
    if (ex && ex.id !== uid) { setNameError('このIDはすでに使われています'); return }
    const modded = moderate(raw)
    await supabase.from('users').upsert({ id: uid, username: modded, display_name: modded })
    localStorage.setItem('gf_handle', modded)
    localStorage.setItem('gf_name', modded)
    userNameRef.current = modded
    setUserName(modded); setUserHandle(modded); setNameError(''); setReady(true)
  }
  const sendGlobal = async () => {
    const txt = moderate(globalInput.trim()); if (!txt) return
    setGlobalInput('')
    const tempId = `~${Date.now()}`
    setGlobalMsgs(p => [...p, { id: tempId, user_id: userIdRef.current, user_name: userNameRef.current, content: txt, dm_to: null, group_id: null, server_id: serverRef.current, created_at: new Date().toISOString() }])
    const { error } = await supabase.from('messages').insert({ user_id: userIdRef.current, user_name: userNameRef.current, content: txt, dm_to: null, group_id: null, server_id: serverRef.current })
    if (error) setGlobalMsgs(p => p.filter(m => m.id !== tempId))
  }
  const sendFriendReq = async () => {
    const target = addInput.trim(); if (!target) return; setAddError('')
    const uid = userIdRef.current
    if (target === userHandle) { setAddError('自分には送れないよ'); return }
    const { data: tu } = await supabase.from('users').select('*').eq('username', target).single()
    if (!tu) { setAddError('ユーザーが見つかりません'); return }
    const { data: ex } = await supabase.from('friendships').select('id').or(`and(requester_id.eq.${uid},addressee_id.eq.${tu.id}),and(requester_id.eq.${tu.id},addressee_id.eq.${uid})`)
    if (ex?.length) { setAddError('すでに申請済みか友達です'); return }
    await supabase.from('friendships').insert({ requester_id: uid, addressee_id: tu.id })
    setAddInput(''); loadFriends()
  }
  const acceptFriend = async (id: string) => { await supabase.from('friendships').update({ status: 'accepted' }).eq('id', id); loadFriends() }
  const removeFriend = async (id: string) => { await supabase.from('friendships').delete().eq('id', id); setSelFriend(null); selFriendRef.current = null; loadFriends() }
  const openDm = async (fuid: string) => {
    setSelFriend(fuid); selFriendRef.current = fuid; setChatType('dm')
    const uid = userIdRef.current
    const { data } = await supabase.from('messages').select('*').or(`and(user_id.eq.${uid},dm_to.eq.${fuid}),and(user_id.eq.${fuid},dm_to.eq.${uid})`).order('created_at').limit(100)
    if (data) setDmMsgs(data)
  }
  const sendDm = async () => {
    const txt = moderate(dmInput.trim()); if (!txt || !selFriend) return
    setDmInput('')
    const sf = selFriend; const uid = userIdRef.current
    const tempId = `~${Date.now()}`
    setDmMsgs(p => [...p, { id: tempId, user_id: uid, user_name: userNameRef.current, content: txt, dm_to: sf, group_id: null, server_id: null, created_at: new Date().toISOString() }])
    const { error } = await supabase.from('messages').insert({ user_id: uid, user_name: userNameRef.current, content: txt, dm_to: sf })
    if (error) setDmMsgs(p => p.filter(m => m.id !== tempId))
  }
  const createGroup = async () => {
    const name = newGroupName.trim(); if (!name) return
    const uid = userIdRef.current
    const { data } = await supabase.from('groups').insert({ name, owner_id: uid }).select().single()
    if (!data) return
    await supabase.from('group_members').insert({ group_id: data.id, user_id: uid })
    setNewGroupName(''); loadGroups()
  }
  const openGroup = async (gid: string) => {
    setSelGroup(gid); selGroupRef.current = gid; setChatType('group')
    const { data } = await supabase.from('messages').select('*').eq('group_id', gid).order('created_at').limit(100)
    if (data) setGroupMsgs(data)
  }
  const sendGroupMsg = async () => {
    const txt = moderate(groupInput.trim()); if (!txt || !selGroup) return
    setGroupInput('')
    const sg = selGroup
    const tempId = `~${Date.now()}`
    setGroupMsgs(p => [...p, { id: tempId, user_id: userIdRef.current, user_name: userNameRef.current, content: txt, dm_to: null, group_id: sg, server_id: null, created_at: new Date().toISOString() }])
    const { error } = await supabase.from('messages').insert({ user_id: userIdRef.current, user_name: userNameRef.current, content: txt, group_id: sg })
    if (error) setGroupMsgs(p => p.filter(m => m.id !== tempId))
  }
  const deleteMsg = async (msgId: string) => {
    await supabase.from('messages').delete().eq('id', msgId)
    setGlobalMsgs(p => p.filter(m => m.id !== msgId))
    setDmMsgs(p => p.filter(m => m.id !== msgId))
    setGroupMsgs(p => p.filter(m => m.id !== msgId))
  }
  const editMsg = async (msgId: string, content: string) => {
    const txt = moderate(content.trim()); if (!txt) return
    await supabase.from('messages').update({ content: txt, edited: true }).eq('id', msgId)
    const upd = (msgs: Message[]) => msgs.map(m => m.id === msgId ? { ...m, content: txt, edited: true } : m)
    setGlobalMsgs(upd); setDmMsgs(upd); setGroupMsgs(upd)
  }
  const banUser = async (targetId: string, targetName: string) => {
    if (!window.confirm(`${targetName} をBANしますか？`)) return
    await Promise.all([
      supabase.from('bans').insert({ user_id: targetId, reason: '管理者によるBAN' }),
      supabase.from('presences').delete().eq('id', targetId),
      supabase.from('messages').delete().eq('user_id', targetId),
      supabase.from('friendships').delete().or(`requester_id.eq.${targetId},addressee_id.eq.${targetId}`),
      supabase.from('users').delete().eq('id', targetId),
    ])
  }
  const kickUser = async (targetId: string, targetName: string) => {
    if (!window.confirm(`${targetName} をKICKしますか？`)) return
    await supabase.from('presences').delete().eq('id', targetId)
  }
  const warnUser = async (targetId: string, targetName: string) => {
    const reason = window.prompt(`${targetName} への警告内容:`)
    if (!reason) return
    await supabase.from('messages').insert({
      user_id: userIdRef.current, user_name: '⚠️ 管理者',
      content: `[警告] ${targetName}: ${reason}`,
      dm_to: null, group_id: null, server_id: serverRef.current,
    })
  }

  const inviteToGroup = async () => {
    const target = inviteInput.trim(); if (!target || !selGroup) return; setInviteError('')
    const { data: tu } = await supabase.from('users').select('*').eq('username', target).single()
    if (!tu) { setInviteError('ユーザーが見つかりません'); return }
    if (!friends.some(f => f.status === 'accepted' && (f.requester_id === tu.id || f.addressee_id === tu.id))) { setInviteError('友達のみ招待できます'); return }
    await supabase.from('group_members').upsert({ group_id: selGroup, user_id: tu.id })
    setInviteInput(''); loadGroups()
  }

  const getFId   = (f: Friendship) => f.requester_id === userIdRef.current ? f.addressee_id : f.requester_id
  const getFName = (id: string) => { const u = friendUsers[id]; return u ? (u.display_name || u.username) : '...' }

  const openProfile = async (targetId: string) => {
    const { data } = await supabase.from('users').select('*').eq('id', targetId).single()
    if (!data) return
    const presence = presences.find(p => p.id === targetId)
    const isOwn = targetId === userIdRef.current
    const dn = data.display_name || data.username
    setViewProfile({ id: targetId, username: data.username, display_name: dn, bio: data.bio || '', presence, isOwn })
    if (isOwn) { setEditDispName(dn); setEditBio(data.bio || '') }
    setEditingProfile(false)
  }
  const saveProfile = async () => {
    const uid = userIdRef.current
    const dn  = moderate(editDispName.trim()).slice(0, 32); if (!dn) return
    const bio = moderate(editBio.trim()).slice(0, 200)
    await supabase.from('users').update({ display_name: dn, bio }).eq('id', uid)
    localStorage.setItem('gf_name', dn); userNameRef.current = dn
    setUserName(dn); setUserBio(bio); upsert()
    setEditingProfile(false)
    setViewProfile(prev => prev ? { ...prev, display_name: dn, bio } : null)
  }
  const online   = presences.filter(p => p.id !== userIdRef.current && isOnlineP(p) && p.server === server)
  const pending  = friends.filter(f => f.status === 'pending' && f.addressee_id === userIdRef.current)
  const accepted     = friends.filter(f => f.status === 'accepted')
  const friendsOnline = accepted.filter(f => presences.some(p => p.id === getFId(f) && isOnlineP(p)))
  const isAdmin      = userName === ADMIN

  const chatTitle = chatType === 'global' ? `# 全体 · サーバー${server}` : chatType === 'dm' ? `@ ${getFName(selFriend!)}` : `# ${groups.find(g => g.id === selGroup)?.name ?? ''}`

  // ── Setup ────────────────────────────────────────────────
  if (!ready) return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG, padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 360, background: CARD, border: `1px solid ${BD}`, borderRadius: 20, padding: 32 }}>
        <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>🎮</div>
        <h1 style={{ color: ACC, fontWeight: 700, fontSize: 20, textAlign: 'center', marginBottom: 4 }}>ゲーム友達SNS</h1>
        <p style={{ color: MUT, fontSize: 13, textAlign: 'center', marginBottom: 24 }}>IDを決めよう（3〜16文字・変更不可）</p>
        <input value={nameInput} onChange={e => { setNameInput(e.target.value); setNameError('') }}
          onKeyDown={e => e.key === 'Enter' && handleSetup()} placeholder="ID（3〜16文字）" maxLength={16}
          style={{ width: '100%', background: BG, border: `1px solid ${BD}`, borderRadius: 10, padding: '12px 16px', color: TXT, fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
        {nameError && <p style={{ color: '#f85149', fontSize: 12, marginBottom: 8 }}>{nameError}</p>}
        <button onClick={handleSetup} style={{ width: '100%', background: ACC, color: BG, fontWeight: 700, fontSize: 14, padding: '12px 0', borderRadius: 10, border: 'none', cursor: 'pointer', marginTop: 4 }}>
          はじめる
        </button>
      </div>
    </div>
  )

  // ── List panel content ────────────────────────────────────
  const ListPanel = (
    <div style={{ width: isDesktop ? 240 : '100%', flexShrink: 0, background: CARD, borderRight: isDesktop ? `1px solid ${BD}` : 'none', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Panel header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: `1px solid ${BD}`, flexShrink: 0 }}>
        <p style={{ color: TXT, fontWeight: 700, fontSize: 14 }}>
          {tab === 'all' ? `サーバー ${server}` : tab === 'friends' ? '友達' : 'グループ'}
        </p>
        {tab === 'all' && <p style={{ color: MUT, fontSize: 11, marginTop: 2 }}>{online.length}人オンライン</p>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* ── 全体 list ── */}
        {tab === 'all' && (
          <div style={{ padding: 8 }}>
            {/* Global chat button */}
            <button onClick={() => setChatType('global')}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: chatType === 'global' ? 'rgba(0,188,212,0.12)' : 'transparent', border: 'none', cursor: 'pointer', marginBottom: 4 }}>
              <span style={{ fontSize: 18 }}>💬</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: chatType === 'global' ? ACC : MUT }}>全体チャット</span>
            </button>

            <p style={{ fontSize: 10, fontWeight: 700, color: MUT, padding: '10px 10px 4px', textTransform: 'uppercase', letterSpacing: 1 }}>
              オンライン — {online.length}
            </p>
            {online.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8 }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div onClick={() => openProfile(p.id)} style={{ width: 34, height: 34, borderRadius: '50%', background: avatarColor(p.name || '?'), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    {p.name?.[0]?.toUpperCase()}
                  </div>
                  <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: '#3fb950', border: '2px solid ' + CARD }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: TXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                  <p style={{ fontSize: 11, color: MUT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.game ? `${p.game} · ` : ''}{p.status || 'オンライン'}
                  </p>
                </div>
                {p.recruiting && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 10, background: 'rgba(63,185,80,0.15)', color: '#3fb950', flexShrink: 0 }}>募集</span>}
                {isAdmin && (
                  <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                    <button onClick={() => warnUser(p.id, p.name)} title="警告" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 2, opacity: 0.7 }}>⚠️</button>
                    <button onClick={() => kickUser(p.id, p.name)} title="キック" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 2, opacity: 0.7 }}>👢</button>
                    <button onClick={() => banUser(p.id, p.name)} title="BAN" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 2, opacity: 0.7 }}>🔨</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── 友達 list (Discord DM style) ── */}
        {tab === 'friends' && (
          <div style={{ padding: '8px 6px' }}>
            {/* Mobile only: add friend */}
            {!isDesktop && (
              <div style={{ padding: '4px 6px 8px' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={addInput} onChange={e => { setAddInput(e.target.value); setAddError('') }}
                    onKeyDown={e => e.key === 'Enter' && sendFriendReq()} placeholder="ユーザー名で追加"
                    style={{ flex: 1, background: BG, border: `1px solid ${BD}`, borderRadius: 8, padding: '7px 10px', color: TXT, fontSize: 12, outline: 'none' }} />
                  <button onClick={sendFriendReq} style={{ background: ACC, color: BG, border: 'none', borderRadius: 8, padding: '0 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>追加</button>
                </div>
                {addError && <p style={{ color: '#f85149', fontSize: 11, marginTop: 4 }}>{addError}</p>}
              </div>
            )}

            {/* Pending */}
            {pending.length > 0 && (
              <>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#f0883e', padding: '4px 8px 6px', textTransform: 'uppercase', letterSpacing: 1 }}>申請 {pending.length}</p>
                {pending.map(f => {
                  const fname = getFName(f.requester_id)
                  return (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 8, marginBottom: 2 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(240,136,62,0.15)', color: '#f0883e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                        {fname[0]?.toUpperCase()}
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: TXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fname}</span>
                      <button onClick={() => acceptFriend(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 }}>✅</button>
                      <button onClick={() => removeFriend(f.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 }}>❌</button>
                    </div>
                  )
                })}
              </>
            )}

            {/* DM list */}
            <p style={{ fontSize: 10, fontWeight: 700, color: MUT, padding: '8px 8px 4px', textTransform: 'uppercase', letterSpacing: 1 }}>ダイレクトメッセージ</p>
            {accepted.map(f => {
              const fid = getFId(f); const fname = getFName(fid)
              const on = presences.some(p => p.id === fid && isOnlineP(p))
              const fp = presences.find(p => p.id === fid)
              const active = chatType === 'dm' && selFriend === fid
              return (
                <button key={f.id} onClick={() => openDm(fid)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, background: active ? 'rgba(0,188,212,0.15)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', marginBottom: 1 }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div onClick={e => { e.stopPropagation(); openProfile(fid) }} style={{ width: 36, height: 36, borderRadius: '50%', background: avatarColor(fname), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                      {fname[0]?.toUpperCase()}
                    </div>
                    <span style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: '50%', background: on ? '#3fb950' : '#6e7681', border: '2px solid ' + CARD }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: active ? ACC : TXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fname}</p>
                    <p style={{ fontSize: 11, color: MUT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {on ? (fp?.game || fp?.status || 'オンライン') : 'オフライン'}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* ── グループ list ── */}
        {tab === 'groups' && (
          <div style={{ padding: 8 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createGroup()} placeholder="グループ名を作成"
                style={{ flex: 1, background: BG, border: `1px solid ${BD}`, borderRadius: 8, padding: '8px 10px', color: TXT, fontSize: 12, outline: 'none' }} />
              <button onClick={createGroup} style={{ background: ACC, color: BG, border: 'none', borderRadius: 8, padding: '0 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>作成</button>
            </div>
            <p style={{ fontSize: 10, fontWeight: 700, color: MUT, padding: '4px 4px 6px', textTransform: 'uppercase', letterSpacing: 1 }}>グループ — {groups.length}</p>
            {groups.map(g => {
              const active = chatType === 'group' && selGroup === g.id
              return (
                <button key={g.id} onClick={() => openGroup(g.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: active ? 'rgba(0,188,212,0.1)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', marginBottom: 2 }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(0,188,212,0.15)', color: ACC, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                    {g.name?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: active ? ACC : TXT }}>{g.name}</p>
                    <p style={{ fontSize: 11, color: MUT }}>{groupMemCount[g.id] ?? 0}人</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Voice - bottom of list panel (desktop) */}
      {isDesktop && (
        <div style={{ borderTop: `1px solid ${BD}`, padding: 12, flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: MUT, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>🎤 ボイス · サーバー{server}</p>
          <VoiceChat key={server} userId={userIdRef.current} userName={userName} channel={`server-${server}`} presences={presences} />
        </div>
      )}

      {/* User bar - Discord style */}
      <div style={{ borderTop: `1px solid ${BD}`, padding: '8px 8px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, background: '#111618' }}>
        <div style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }} onClick={() => openProfile(userIdRef.current)}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarColor(userHandle || userName), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
            {userName[0]?.toUpperCase()}
          </div>
          <span style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: '50%', background: '#3fb950', border: '2px solid #111618' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => openProfile(userIdRef.current)}>
          <p style={{ fontSize: 13, fontWeight: 700, color: TXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</p>
          <p style={{ fontSize: 11, color: MUT }}>@{userHandle}</p>
        </div>
        <button onClick={handleLogout} title="ログアウト"
          style={{ width: 30, height: 30, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: MUT, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, flexShrink: 0 }}>🚪</button>
      </div>
    </div>
  )

  // ── Chat area ────────────────────────────────────────────
  const ChatArea = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Chat header */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: CARD }}>
        {!isDesktop && (
          <button onClick={() => { setSelFriend(null); selFriendRef.current = null; setSelGroup(null); selGroupRef.current = null }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUT, fontSize: 18, paddingRight: 4 }}>‹</button>
        )}
        <p style={{ fontWeight: 700, fontSize: 14, color: TXT }}>{chatTitle}</p>

        {/* Group invite (header) */}
        {chatType === 'group' && selGroup && groups.find(g => g.id === selGroup)?.owner_id === userIdRef.current && isDesktop && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <input value={inviteInput} onChange={e => { setInviteInput(e.target.value); setInviteError('') }}
              onKeyDown={e => e.key === 'Enter' && inviteToGroup()} placeholder="友達を招待"
              style={{ background: BG, border: `1px solid ${BD}`, borderRadius: 8, padding: '5px 10px', color: TXT, fontSize: 12, outline: 'none', width: 140 }} />
            <button onClick={inviteToGroup} style={{ background: ACC, color: BG, border: 'none', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>招待</button>
            {inviteError && <span style={{ fontSize: 11, color: '#f85149', alignSelf: 'center' }}>{inviteError}</span>}
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0 4px', display: 'flex', flexDirection: 'column' }}>
        {chatType === 'global' && <>
          {globalMsgs.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.5 }}>
              <span style={{ fontSize: 40 }}>💬</span>
              <p style={{ color: MUT, fontSize: 13 }}>ここがサーバー{server}の全体チャットだよ</p>
            </div>
          )}
          {globalMsgs.map(m => <Bubble key={m.id} m={m} myId={userIdRef.current} isAdmin={isAdmin} onDelete={deleteMsg} onEdit={editMsg} onAvatarClick={openProfile} />)}
          <div ref={globalEndRef} />
        </>}
        {chatType === 'dm' && <>
          {dmMsgs.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.5 }}>
              <span style={{ fontSize: 40 }}>✉️</span>
              <p style={{ color: MUT, fontSize: 13 }}>{getFName(selFriend!)} との最初のメッセージを送ろう</p>
            </div>
          )}
          {dmMsgs.map(m => <Bubble key={m.id} m={m} myId={userIdRef.current} isAdmin={isAdmin} onDelete={deleteMsg} onEdit={editMsg} onAvatarClick={openProfile} />)}
          <div ref={dmEndRef} />
        </>}
        {chatType === 'group' && <>
          {groupMsgs.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.5 }}>
              <span style={{ fontSize: 40 }}>👥</span>
              <p style={{ color: MUT, fontSize: 13 }}>グループの最初のメッセージを送ろう</p>
            </div>
          )}
          {groupMsgs.map(m => <Bubble key={m.id} m={m} myId={userIdRef.current} isAdmin={isAdmin} onDelete={deleteMsg} onEdit={editMsg} onAvatarClick={openProfile} />)}
          <div ref={groupEndRef} />
        </>}
      </div>

      {/* Input */}
      <div style={{ padding: '8px 16px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 0, background: '#21262d', borderRadius: 14, border: `1px solid ${BD}`, alignItems: 'center', overflow: 'hidden' }}>
          <input
            value={chatType === 'global' ? globalInput : chatType === 'dm' ? dmInput : groupInput}
            onChange={e => chatType === 'global' ? setGlobalInput(e.target.value) : chatType === 'dm' ? setDmInput(e.target.value) : setGroupInput(e.target.value)}
            onKeyDown={e => { if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return; chatType === 'global' ? sendGlobal() : chatType === 'dm' ? sendDm() : sendGroupMsg() }}
            placeholder={`${chatTitle} にメッセージ…`}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: TXT, fontSize: 14, padding: '12px 16px' }} />
          <button onClick={chatType === 'global' ? sendGlobal : chatType === 'dm' ? sendDm : sendGroupMsg}
            style={{ background: ACC, color: BG, border: 'none', padding: '12px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0, letterSpacing: 0.5 }}>
            ↑
          </button>
        </div>
      </div>
    </div>
  )

  // ── Profile modal ─────────────────────────────────────────
  const ProfileModal = viewProfile ? (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={() => setViewProfile(null)}>
      <div style={{ width: 340, background: '#1e2530', borderRadius: 20, overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.7)' }}
        onClick={e => e.stopPropagation()}>
        {/* Banner */}
        <div style={{ height: 90, background: `linear-gradient(135deg, ${avatarColor(viewProfile.username)}, ${avatarColor(viewProfile.username)}66)`, position: 'relative' }}>
          <button onClick={() => setViewProfile(null)}
            style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.3)', border: 'none', borderRadius: '50%', width: 28, height: 28, color: 'white', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
        {/* Avatar */}
        <div style={{ padding: '0 20px', marginTop: -44 }}>
          <div style={{ width: 88, height: 88, borderRadius: '50%', background: avatarColor(viewProfile.username), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 36, border: '5px solid #1e2530' }}>
            {(viewProfile.display_name || viewProfile.username)?.[0]?.toUpperCase()}
          </div>
        </div>
        {/* Info */}
        <div style={{ padding: '10px 20px 20px' }}>
          {viewProfile.isOwn && editingProfile ? (
            <div style={{ marginBottom: 4 }}>
              <input value={editDispName} onChange={e => setEditDispName(e.target.value)} maxLength={32}
                style={{ width: '100%', background: '#0d1117', border: `1px solid ${ACC}`, borderRadius: 8, padding: '6px 10px', color: TXT, fontSize: 18, fontWeight: 700, outline: 'none', boxSizing: 'border-box' }} />
            </div>
          ) : (
            <p style={{ fontSize: 22, fontWeight: 800, color: TXT, marginBottom: 2 }}>{viewProfile.display_name || viewProfile.username}</p>
          )}
          <p style={{ fontSize: 13, color: MUT, marginBottom: 12 }}>@{viewProfile.username}</p>

          {/* Bio */}
          <div style={{ background: '#0d1117', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: MUT, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>プロフィール</p>
            {viewProfile.isOwn && editingProfile ? (
              <textarea value={editBio} onChange={e => setEditBio(e.target.value)} maxLength={200} rows={3}
                style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: TXT, fontSize: 13, resize: 'none', boxSizing: 'border-box' }} />
            ) : (
              <p style={{ fontSize: 13, color: viewProfile.bio ? TXT : MUT }}>{viewProfile.bio || 'プロフィール未設定'}</p>
            )}
          </div>

          {/* Status */}
          {viewProfile.presence && (viewProfile.presence.game || viewProfile.presence.status) && (
            <div style={{ background: '#0d1117', borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: MUT, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>アクティビティ</p>
              {viewProfile.presence.game && <p style={{ fontSize: 13, color: TXT, marginBottom: 2 }}>🎮 {viewProfile.presence.game}</p>}
              {viewProfile.presence.status && <p style={{ fontSize: 12, color: MUT }}>{viewProfile.presence.status}</p>}
            </div>
          )}

          {/* Actions */}
          {viewProfile.isOwn ? (
            editingProfile ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveProfile}
                  style={{ flex: 1, background: ACC, color: BG, border: 'none', borderRadius: 10, padding: '10px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>保存</button>
                <button onClick={() => setEditingProfile(false)}
                  style={{ flex: 1, background: '#30363d', color: TXT, border: 'none', borderRadius: 10, padding: '10px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>キャンセル</button>
              </div>
            ) : (
              <button onClick={() => setEditingProfile(true)}
                style={{ width: '100%', background: '#30363d', color: TXT, border: 'none', borderRadius: 10, padding: '10px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>✏️ プロフィールを編集</button>
            )
          ) : (
            <button onClick={() => { openDm(viewProfile.id); setViewProfile(null) }}
              style={{ width: '100%', background: ACC, color: BG, border: 'none', borderRadius: 10, padding: '10px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>💬 メッセージを送る</button>
          )}
        </div>
      </div>
    </div>
  ) : null

  // ── Friends main area (Discord style) ───────────────────────
  const FriendsMainArea = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '0 16px', height: 48, borderBottom: `1px solid ${BD}`, display: 'flex', alignItems: 'center', gap: 6, background: CARD, flexShrink: 0 }}>
        <span style={{ fontSize: 18, marginRight: 4 }}>👥</span>
        <span style={{ fontWeight: 700, color: TXT, fontSize: 15 }}>フレンド</span>
        <div style={{ width: 1, height: 20, background: BD, margin: '0 6px' }} />
        {(['online','all','pending','add'] as const).map(v => {
          const label = v === 'online' ? 'オンライン' : v === 'all' ? '全て表示' : v === 'pending' ? `申請中${pending.length > 0 ? ` (${pending.length})` : ''}` : 'フレンドに追加'
          return (
            <button key={v} onClick={() => setFriendsView(v)}
              style={{ padding: '4px 10px', borderRadius: 6, fontSize: 13, fontWeight: friendsView === v ? 700 : 500, cursor: 'pointer', border: 'none',
                background: friendsView === v ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: friendsView === v ? TXT : MUT }}>
              {label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 30px' }}>
        {friendsView === 'add' ? (
          <div style={{ maxWidth: 600 }}>
            <p style={{ color: TXT, fontWeight: 700, fontSize: 16, marginBottom: 4 }}>フレンドを追加</p>
            <p style={{ color: MUT, fontSize: 13, marginBottom: 16 }}>ユーザー名で検索してフレンド申請を送れます。</p>
            <div style={{ display: 'flex', gap: 8, background: '#21262d', borderRadius: 10, padding: '4px 4px 4px 16px', border: `1px solid ${addError ? '#f85149' : BD}` }}>
              <input value={addInput} onChange={e => { setAddInput(e.target.value); setAddError('') }}
                onKeyDown={e => e.key === 'Enter' && sendFriendReq()} placeholder="ユーザー名を入力..."
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: TXT, fontSize: 14, padding: '8px 0' }} />
              <button onClick={sendFriendReq}
                style={{ background: ACC, color: BG, border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>申請を送る</button>
            </div>
            {addError && <p style={{ color: '#f85149', fontSize: 12, marginTop: 8 }}>{addError}</p>}
          </div>
        ) : (
          <>
            <p style={{ fontSize: 11, fontWeight: 700, color: MUT, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              {friendsView === 'online' ? `オンライン — ${friendsOnline.length}` : friendsView === 'all' ? `全てのフレンド — ${accepted.length}` : `保留中 — ${pending.length}`}
            </p>
            {(friendsView === 'online' ? friendsOnline : friendsView === 'all' ? accepted : pending).map(f => {
              const isPending = friendsView === 'pending'
              const fid = isPending ? f.requester_id : getFId(f)
              const fname = getFName(fid)
              const on = presences.some(p => p.id === fid && isOnlineP(p))
              const fp = presences.find(p => p.id === fid)
              return (
                <div key={f.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', borderRadius: 10, marginBottom: 2, cursor: isPending ? 'default' : 'pointer', borderTop: `1px solid ${BD}` }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#21262d')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => !isPending && openDm(fid)}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,188,212,0.15)', color: ACC, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18 }}>
                      {fname[0]?.toUpperCase()}
                    </div>
                    <span style={{ position: 'absolute', bottom: 0, right: 0, width: 13, height: 13, borderRadius: '50%', background: on ? '#3fb950' : '#6e7681', border: '2px solid ' + BG }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: TXT }}>{fname}</p>
                    <p style={{ fontSize: 12, color: MUT }}>{on ? (fp?.game || fp?.status || 'オンライン') : 'オフライン'}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                    {isPending ? (
                      <>
                        <button onClick={() => acceptFriend(f.id)} style={{ width: 34, height: 34, borderRadius: '50%', background: '#21262d', border: 'none', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✅</button>
                        <button onClick={() => removeFriend(f.id)} style={{ width: 34, height: 34, borderRadius: '50%', background: '#21262d', border: 'none', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>❌</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => openDm(fid)} title="メッセージ" style={{ width: 34, height: 34, borderRadius: '50%', background: '#21262d', border: 'none', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💬</button>
                        <button onClick={() => removeFriend(f.id)} title="フレンド解除" style={{ width: 34, height: 34, borderRadius: '50%', background: '#21262d', border: 'none', cursor: 'pointer', fontSize: 14, color: '#f85149', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )

  // ── Status panel (right side on mobile 全体 tab) ──────────
  const StatusPanel = (
    <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BD}`, background: CARD, flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input value={gameInput} onChange={e => setGameInput(e.target.value)} placeholder="ゲーム名"
          style={{ flex: 1, background: BG, border: `1px solid ${BD}`, borderRadius: 8, padding: '7px 10px', color: TXT, fontSize: 12, outline: 'none' }} />
        <input value={statusInput} onChange={e => setStatusInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && upsert()} placeholder="今何してる？"
          style={{ flex: 2, background: BG, border: `1px solid ${BD}`, borderRadius: 8, padding: '7px 10px', color: TXT, fontSize: 12, outline: 'none' }} />
        <button onClick={() => upsert()} style={{ background: ACC, color: BG, border: 'none', borderRadius: 8, padding: '0 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>更新</button>
        <button onClick={() => { const n = !recruiting; setRecruiting(n); upsert({ recruiting: n }) }}
          style={{ background: recruiting ? 'rgba(63,185,80,0.15)' : 'transparent', color: recruiting ? '#3fb950' : MUT, border: `1px solid ${recruiting ? '#3fb950' : BD}`, borderRadius: 8, padding: '0 10px', fontSize: 12, cursor: 'pointer', flexShrink: 0, fontWeight: 600 }}>
          {recruiting ? '✋募集中' : '募集'}
        </button>
      </div>
    </div>
  )

  // ── DESKTOP layout ────────────────────────────────────────
  if (isDesktop) return (
    <div style={{ height: '100dvh', display: 'flex', background: BG }}>
    {ProfileModal}

      {/* Icon sidebar */}
      <div style={{ width: 60, background: SIDE, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 6, borderRight: `1px solid ${BD}`, flexShrink: 0 }}>
        {/* Servers */}
        {[1,2,3,4,5].map(s => (
          <button key={s} onClick={() => changeServer(s)} title={`サーバー${s}`}
            style={{ position: 'relative', width: 42, height: 42, borderRadius: server === s ? 14 : '50%', background: server === s ? ACC : CARD, color: server === s ? BG : MUT, fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-radius 0.15s' }}>
            {s}
            {server === s && <span style={{ position: 'absolute', left: -10, top: '50%', transform: 'translateY(-50%)', width: 4, height: 28, borderRadius: '0 3px 3px 0', background: 'white' }} />}
          </button>
        ))}

        {/* Divider */}
        <div style={{ width: 30, height: 2, borderRadius: 1, background: BD, margin: '2px 0' }} />

        {/* Nav icons */}
        {([['all','🌐','全体'],['friends','👥','友達'],['groups','💬','グループ']] as [Tab,string,string][]).map(([t, icon, label]) => {
          const badge = t === 'friends' && pending.length > 0 ? pending.length : 0
          return (
            <button key={t} onClick={() => { setTab(t); if (t === 'all') { setChatType('global'); setSelGroup(null); selGroupRef.current = null } }} title={label}
              style={{ position: 'relative', width: 42, height: 42, borderRadius: tab === t ? 14 : '50%', background: tab === t ? 'rgba(0,188,212,0.2)' : CARD, border: 'none', cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-radius 0.15s' }}>
              {icon}
              {badge > 0 && <span style={{ position: 'absolute', top: -2, right: -2, width: 16, height: 16, borderRadius: '50%', background: '#f85149', color: 'white', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{badge}</span>}
            </button>
          )
        })}
      </div>

      {/* List panel */}
      {ListPanel}

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'friends' && chatType !== 'dm'
          ? FriendsMainArea
          : <>
              {chatType === 'global' && StatusPanel}
              {ChatArea}
            </>
        }
      </div>
    </div>
  )

  // ── MOBILE layout ─────────────────────────────────────────
  const showList = chatType === 'global' || (chatType === 'dm' && !selFriend) || (chatType === 'group' && !selGroup) || (tab === 'friends' && chatType !== 'dm') || (tab === 'groups' && chatType !== 'group')
  const inChat = (chatType === 'dm' && !!selFriend) || (chatType === 'group' && !!selGroup)

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: BG }}>
      {ProfileModal}
      {/* Mobile header */}
      <div style={{ background: CARD, borderBottom: `1px solid ${BD}`, flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 8px' }}>
          <span style={{ fontWeight: 700, color: ACC, fontSize: 16 }}>🎮 ゲーム友達</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#3fb950', fontSize: 12 }}>● {userName}</span>
            <button onClick={handleLogout} style={{ background: 'rgba(248,81,73,0.1)', color: '#f85149', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>ログアウト</button>
          </div>
        </div>
        {/* Mobile server tabs */}
        <div style={{ display: 'flex', gap: 6, padding: '0 12px 10px' }}>
          {[1,2,3,4,5].map(s => (
            <button key={s} onClick={() => changeServer(s)}
              style={{ flex: 1, padding: '6px 0', borderRadius: 8, background: server === s ? ACC : 'transparent', color: server === s ? BG : MUT, border: `1px solid ${server === s ? ACC : BD}`, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {s}
            </button>
          ))}
        </div>
        {/* Mobile status bar */}
        {!inChat && tab === 'all' && (
          <div style={{ padding: '0 12px 10px', display: 'flex', gap: 6 }}>
            <input value={gameInput} onChange={e => setGameInput(e.target.value)} placeholder="ゲーム"
              style={{ flex: 1, background: BG, border: `1px solid ${BD}`, borderRadius: 8, padding: '6px 8px', color: TXT, fontSize: 12, outline: 'none' }} />
            <input value={statusInput} onChange={e => setStatusInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && upsert()} placeholder="今何してる？"
              style={{ flex: 2, background: BG, border: `1px solid ${BD}`, borderRadius: 8, padding: '6px 8px', color: TXT, fontSize: 12, outline: 'none' }} />
            <button onClick={() => upsert()} style={{ background: ACC, color: BG, border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>更新</button>
          </div>
        )}
      </div>

      {/* Mobile body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {inChat ? ChatArea : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {tab === 'all' && (
              <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 70 }}>
                {/* Global chat button */}
                <div style={{ padding: '8px 12px 0' }}>
                  <button onClick={() => setChatType('global')}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, background: CARD, border: `1px solid ${BD}`, cursor: 'pointer', marginBottom: 8 }}>
                    <span style={{ fontSize: 24 }}>💬</span>
                    <div style={{ textAlign: 'left' }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: TXT }}>全体チャット</p>
                      <p style={{ fontSize: 11, color: MUT }}>サーバー{server}の全体</p>
                    </div>
                  </button>
                </div>
                {/* Voice */}
                <div style={{ padding: '0 12px 8px' }}>
                  <div style={{ background: CARD, border: `1px solid ${BD}`, borderRadius: 12, padding: '12px 16px' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: MUT, textTransform: 'uppercase', marginBottom: 8 }}>🎤 ボイス · サーバー{server}</p>
                    <VoiceChat key={server} userId={userIdRef.current} userName={userName} channel={`server-${server}`} presences={presences} />
                  </div>
                </div>
                {/* Online */}
                <div style={{ padding: '0 12px' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: MUT, textTransform: 'uppercase', marginBottom: 8 }}>オンライン — {online.length}</p>
                  {online.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, background: CARD, border: `1px solid ${p.recruiting ? '#3fb950' : BD}`, marginBottom: 6 }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div onClick={() => openProfile(p.id)} style={{ width: 38, height: 38, borderRadius: '50%', background: avatarColor(p.name || '?'), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>{p.name?.[0]?.toUpperCase()}</div>
                        <span style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: '50%', background: '#3fb950', border: '2px solid ' + CARD }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: TXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                        <p style={{ fontSize: 12, color: MUT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.game ? `${p.game} · ` : ''}{p.status || 'オンライン'}</p>
                      </div>
                      {p.recruiting && <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, background: 'rgba(63,185,80,0.15)', color: '#3fb950' }}>募集中</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {tab !== 'all' && (
              <div style={{ flex: 1, overflow: 'hidden', paddingBottom: 70 }}>
                {ListPanel}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile bottom nav */}
      {!inChat && (
        <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, display: 'flex', background: CARD, borderTop: `1px solid ${BD}`, zIndex: 20 }}>
          {([['all','🌐','全体'],['friends','👥','友達'],['groups','💬','グループ']] as [Tab,string,string][]).map(([t, icon, label]) => {
            const badge = t === 'friends' && pending.length > 0 ? pending.length : 0
            return (
              <button key={t} onClick={() => { setTab(t); if (t === 'all') { setChatType('global'); setSelGroup(null); selGroupRef.current = null } }}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0 6px', gap: 2, background: 'none', border: 'none', cursor: 'pointer', position: 'relative', color: tab === t ? ACC : MUT }}>
                <span style={{ fontSize: 22 }}>{icon}</span>
                <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
                {badge > 0 && <span style={{ position: 'absolute', top: 6, right: '28%', width: 16, height: 16, borderRadius: '50%', background: '#f85149', color: 'white', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{badge}</span>}
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}

function Bubble({ m, myId, isAdmin, onDelete, onEdit, onAvatarClick }: {
  m: Message; myId: string; isAdmin: boolean
  onDelete: (id: string) => void; onEdit: (id: string, content: string) => void
  onAvatarClick: (uid: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(m.content)
  const [hover, setHover] = useState(false)
  const me = m.user_id === myId
  const system = m.user_id === 'system' || (m.user_name?.startsWith('⚠️') ?? false)
  const isTemp = m.id.startsWith('~')
  const color = system ? '#f0883e' : avatarColor(m.user_name || '?')
  const time = new Date(m.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const canDelete = !isTemp && (me || isAdmin || (!m.dm_to && !m.group_id))
  const canEdit = !isTemp && me

  if (system) return (
    <div style={{ padding: '6px 16px', textAlign: 'center' }}>
      <span style={{ fontSize: 11, color: '#f0883e', background: 'rgba(240,136,62,0.08)', border: '1px solid rgba(240,136,62,0.2)', padding: '4px 14px', borderRadius: 20 }}>{m.content}</span>
    </div>
  )

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 12, padding: '3px 16px',
        background: hover ? 'rgba(255,255,255,0.025)' : 'transparent',
        position: 'relative', opacity: isTemp ? 0.6 : 1,
        transition: 'background 0.1s',
      }}>

      {/* Avatar */}
      <div onClick={() => onAvatarClick(m.user_id)}
        style={{ width: 38, height: 38, borderRadius: '50%', background: color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15, flexShrink: 0, cursor: 'pointer', marginTop: 3 }}>
        {m.user_name?.[0]?.toUpperCase()}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: me ? ACC : TXT }}>{m.user_name}</span>
          <span style={{ fontSize: 11, color: MUT }}>{time}</span>
          {m.edited && <span style={{ fontSize: 10, color: MUT, fontStyle: 'italic' }}>(編集済)</span>}
          {isTemp && <span style={{ fontSize: 10, color: MUT }}>送信中…</span>}
        </div>

        {editing ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={editVal} onChange={e => setEditVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) { onEdit(m.id, editVal); setEditing(false) }
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
              style={{ flex: 1, background: '#161b22', border: `1px solid ${ACC}`, borderRadius: 8, padding: '7px 12px', color: TXT, fontSize: 14, outline: 'none' }} />
            <button onClick={() => { onEdit(m.id, editVal); setEditing(false) }}
              style={{ background: ACC, color: BG, border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>保存</button>
            <button onClick={() => setEditing(false)}
              style={{ background: '#30363d', color: MUT, border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>✕</button>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: '#cdd9e5', lineHeight: 1.55, wordBreak: 'break-word', margin: 0 }}>{m.content}</p>
        )}
      </div>

      {/* Floating toolbar on hover */}
      {!editing && (canDelete || canEdit) && hover && (
        <div style={{
          position: 'absolute', right: 16, top: -2,
          display: 'flex', gap: 1,
          background: '#1e2530', border: `1px solid ${BD}`,
          borderRadius: 9, padding: '2px 3px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          zIndex: 10,
        }}>
          {canEdit && (
            <button onClick={() => { setEditVal(m.content); setEditing(true) }} title="編集"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 7px', borderRadius: 6, color: MUT, fontSize: 14 }}>✏️</button>
          )}
          {canDelete && (
            <button onClick={() => onDelete(m.id)} title="削除"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 7px', borderRadius: 6, color: '#f85149', fontSize: 14 }}>🗑️</button>
          )}
        </div>
      )}
    </div>
  )
}
