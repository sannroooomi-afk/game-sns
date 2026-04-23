'use client'

import { useState, useEffect, useRef } from 'react'

interface VoiceMember { uid: number; name: string }
interface SimplePresence { id: string; name: string }

interface Props {
  userId: string
  userName: string
  channel: string
  presences: SimplePresence[]
}

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID ?? ''

function uidFromId(id: string): number {
  return Math.abs(id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 100000
}

export default function VoiceChat({ userId, userName, channel, presences }: Props) {
  const [joined, setJoined]   = useState(false)
  const [members, setMembers] = useState<VoiceMember[]>([])
  const [error, setError]     = useState('')
  const clientRef = useRef<any>(null)
  const trackRef  = useRef<any>(null)
  const joinedRef = useRef(false)
  const myUid     = uidFromId(userId)

  const findName = (uid: number) =>
    presences.find(p => uidFromId(p.id) === uid)?.name ?? `?${uid}`

  const leave = async () => {
    trackRef.current?.close()
    await clientRef.current?.leave()
    clientRef.current = null
    trackRef.current  = null
    joinedRef.current = false
    setJoined(false)
    setMembers([])
  }

  const join = async () => {
    if (!APP_ID) { setError('App ID 未設定'); return }
    try {
      setError('')
      const res = await fetch(`/api/agora-token?uid=${myUid}&channel=${channel}`)
      const { token } = await res.json()

      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default
      AgoraRTC.setLogLevel(4)
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
      clientRef.current = client

      client.on('user-published', async (user: any, mediaType: 'audio' | 'video' | 'datachannel') => {
        if (user.uid === myUid) return
        await client.subscribe(user, mediaType)
        if (mediaType === 'audio') user.audioTrack?.play()
        setMembers(prev =>
          prev.some(m => m.uid === user.uid) ? prev : [...prev, { uid: user.uid, name: findName(user.uid) }]
        )
      })

      client.on('user-left', (user: any) => {
        setMembers(prev => prev.filter(m => m.uid !== user.uid))
      })

      await client.join(APP_ID, channel, token, myUid)
      const track = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true })
      trackRef.current = track
      await client.publish([track])
      joinedRef.current = true
      setJoined(true)
      setMembers([{ uid: myUid, name: userName }])
    } catch (e: any) {
      setError(e.message ?? '接続エラー')
    }
  }

  useEffect(() => () => { if (joinedRef.current) leave() }, [])

  if (!APP_ID) return (
    <p className="text-xs" style={{ color: '#8b949e' }}>Agora App ID を .env.local に設定すると使えます</p>
  )

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <button onClick={joined ? leave : join}
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={joined
            ? { background: 'rgba(248,81,73,0.15)', color: '#f85149', border: '1px solid rgba(248,81,73,0.4)' }
            : { background: 'rgba(63,185,80,0.15)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.4)' }}>
          {joined ? '📵 退出' : '🎤 参加'}
        </button>
        {joined && <span className="text-xs animate-pulse" style={{ color: '#8b949e' }}>通話中</span>}
        {error && <span className="text-xs" style={{ color: '#f85149' }}>{error}</span>}
      </div>

      {joined && members.length > 0 && (
        <div className="flex items-end gap-3 flex-wrap">
          {members.map(m => (
            <div key={m.uid} className="flex flex-col items-center gap-1">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold relative"
                style={{
                  background: m.uid === myUid ? 'rgba(0,188,212,0.2)' : 'rgba(63,185,80,0.15)',
                  color:      m.uid === myUid ? '#00bcd4' : '#3fb950',
                  border:    `2px solid ${m.uid === myUid ? '#00bcd4' : '#3fb950'}`,
                }}>
                {m.name[0]?.toUpperCase()}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                  style={{ background: '#3fb950', border: '2px solid #161b22' }} />
              </div>
              <span className="text-[9px] max-w-[40px] truncate text-center" style={{ color: '#8b949e' }}>
                {m.uid === myUid ? 'あなた' : m.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
