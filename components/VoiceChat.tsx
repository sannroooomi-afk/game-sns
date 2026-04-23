'use client'

import { useState, useEffect, useRef } from 'react'

interface VoiceMember { uid: number; name: string; muted?: boolean; hasVideo?: boolean }
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
  const [muted, setMuted]     = useState(false)
  const [videoOn, setVideoOn] = useState(false)

  const clientRef    = useRef<any>(null)
  const trackRef     = useRef<any>(null)
  const videoRef     = useRef<any>(null)
  const joinedRef    = useRef(false)
  const presencesRef = useRef<SimplePresence[]>(presences)
  const myUid        = uidFromId(userId)

  useEffect(() => {
    presencesRef.current = presences
    setMembers(prev => prev.map(m => {
      const name = presencesRef.current.find(p => uidFromId(p.id) === m.uid)?.name
      return name ? { ...m, name } : m
    }))
  }, [presences])

  const findName = (uid: number) =>
    presencesRef.current.find(p => uidFromId(p.id) === uid)?.name ?? `?${uid}`

  const leave = async () => {
    videoRef.current?.close()
    trackRef.current?.close()
    await clientRef.current?.leave()
    clientRef.current = null
    trackRef.current  = null
    videoRef.current  = null
    joinedRef.current = false
    setJoined(false); setMembers([]); setMuted(false); setVideoOn(false)
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
        if (mediaType === 'video') {
          setTimeout(() => {
            const el = document.getElementById(`vc-${user.uid}`)
            if (el) user.videoTrack?.play(el)
          }, 200)
        }
        setMembers(prev =>
          prev.some(m => m.uid === user.uid)
            ? prev.map(m => m.uid === user.uid ? { ...m, hasVideo: mediaType === 'video' || m.hasVideo } : m)
            : [...prev, { uid: user.uid, name: findName(user.uid), hasVideo: mediaType === 'video' }]
        )
      })

      client.on('user-unpublished', (user: any, mediaType: 'audio' | 'video' | 'datachannel') => {
        if (mediaType === 'video')
          setMembers(prev => prev.map(m => m.uid === user.uid ? { ...m, hasVideo: false } : m))
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

  const toggleMute = () => {
    if (!trackRef.current) return
    const next = !muted
    trackRef.current.setEnabled(!next)
    setMuted(next)
    setMembers(prev => prev.map(m => m.uid === myUid ? { ...m, muted: next } : m))
  }

  const toggleVideo = async () => {
    if (!clientRef.current) return
    if (!videoOn) {
      try {
        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default
        const vt = await AgoraRTC.createCameraVideoTrack()
        videoRef.current = vt
        await clientRef.current.publish([vt])
        setVideoOn(true)
        setMembers(prev => prev.map(m => m.uid === myUid ? { ...m, hasVideo: true } : m))
        setTimeout(() => {
          const el = document.getElementById(`vc-${myUid}`)
          if (el) vt.play(el)
        }, 200)
      } catch (e: any) { setError(e.message ?? 'カメラエラー') }
    } else {
      await clientRef.current.unpublish([videoRef.current])
      videoRef.current?.close()
      videoRef.current = null
      setVideoOn(false)
      setMembers(prev => prev.map(m => m.uid === myUid ? { ...m, hasVideo: false } : m))
    }
  }

  useEffect(() => () => { if (joinedRef.current) leave() }, [])

  if (!APP_ID) return (
    <p style={{ fontSize: 12, color: '#8b949e' }}>Agora App ID を .env.local に設定すると使えます</p>
  )

  const btnBase: React.CSSProperties = { padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={joined ? leave : join} style={{ ...btnBase,
          ...(joined
            ? { background: 'rgba(248,81,73,0.15)', color: '#f85149', border: '1px solid rgba(248,81,73,0.4)' }
            : { background: 'rgba(63,185,80,0.15)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.4)' }) }}>
          {joined ? '📵 退出' : '🎤 参加'}
        </button>

        {joined && <>
          <button onClick={toggleMute} title={muted ? 'ミュート解除' : 'ミュート'} style={{ ...btnBase,
            ...(muted
              ? { background: 'rgba(248,81,73,0.15)', color: '#f85149', border: '1px solid rgba(248,81,73,0.4)' }
              : { background: 'rgba(139,148,158,0.1)', color: '#8b949e', border: '1px solid rgba(139,148,158,0.3)' }) }}>
            {muted ? '🔇 解除' : '🎤 ミュート'}
          </button>

          <button onClick={toggleVideo} title={videoOn ? 'カメラOFF' : 'カメラON'} style={{ ...btnBase,
            ...(videoOn
              ? { background: 'rgba(0,188,212,0.15)', color: '#00bcd4', border: '1px solid rgba(0,188,212,0.4)' }
              : { background: 'rgba(139,148,158,0.1)', color: '#8b949e', border: '1px solid rgba(139,148,158,0.3)' }) }}>
            {videoOn ? '📷 OFF' : '📷 カメラ'}
          </button>

          <span style={{ fontSize: 11, color: '#8b949e' }} className="animate-pulse">通話中</span>
        </>}

        {error && <span style={{ fontSize: 11, color: '#f85149' }}>{error}</span>}
      </div>

      {joined && members.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {members.map(m => (
            <div key={m.uid} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              {m.hasVideo ? (
                <div id={`vc-${m.uid}`} style={{ width: 80, height: 56, borderRadius: 8, overflow: 'hidden', background: '#000', border: `2px solid ${m.uid === myUid ? '#00bcd4' : '#3fb950'}` }} />
              ) : (
                <div style={{ position: 'relative', width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0,
                  background: m.uid === myUid ? 'rgba(0,188,212,0.2)' : 'rgba(63,185,80,0.15)',
                  color:      m.uid === myUid ? '#00bcd4' : '#3fb950',
                  border:    `2px solid ${m.uid === myUid ? '#00bcd4' : '#3fb950'}`,
                  opacity: m.muted ? 0.5 : 1 }}>
                  {m.name[0]?.toUpperCase()}
                  {m.muted && <span style={{ position: 'absolute', top: -4, right: -4, fontSize: 10 }}>🔇</span>}
                  <span style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: '#3fb950', border: '2px solid #161b22' }} />
                </div>
              )}
              <span style={{ fontSize: 9, maxWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#8b949e', textAlign: 'center' }}>
                {m.uid === myUid ? 'あなた' : m.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
