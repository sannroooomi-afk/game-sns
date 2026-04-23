'use client'

import { useState, useEffect, useRef } from 'react'

interface Props {
  userId: string
  userName: string
}

const APP_ID  = process.env.NEXT_PUBLIC_AGORA_APP_ID ?? ''
const CHANNEL = 'main'

export default function VoiceChat({ userId }: Props) {
  const [joined, setJoined] = useState(false)
  const [count, setCount]   = useState(0)
  const [error, setError]   = useState('')
  const clientRef           = useRef<any>(null)
  const trackRef            = useRef<any>(null)

  const getUid = () => Math.abs(userId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 100000

  const join = async () => {
    if (!APP_ID) { setError('Agora App ID が未設定です'); return }
    try {
      setError('')
      const uid = getUid()
      const res = await fetch(`/api/agora-token?uid=${uid}&channel=${CHANNEL}`)
      const { token } = await res.json()

      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default
      AgoraRTC.setLogLevel(4)
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
      clientRef.current = client

      client.on('user-published', async (user: any, mediaType: 'audio' | 'video' | 'datachannel') => {
        await client.subscribe(user, mediaType)
        if (mediaType === 'audio') user.audioTrack?.play()
        setCount(c => c + 1)
      })
      client.on('user-left', () => setCount(c => Math.max(0, c - 1)))

      await client.join(APP_ID, CHANNEL, token, uid)
      const track = await AgoraRTC.createMicrophoneAudioTrack()
      trackRef.current = track
      await client.publish([track])
      setJoined(true)
      setCount(1)
    } catch (e: any) {
      setError(e.message ?? '接続エラー')
    }
  }

  const leave = async () => {
    trackRef.current?.close()
    await clientRef.current?.leave()
    clientRef.current = null
    trackRef.current  = null
    setJoined(false)
    setCount(0)
  }

  useEffect(() => () => { if (joined) leave() }, [])

  if (!APP_ID) return (
    <p className="text-xs" style={{ color: '#8b949e' }}>Agora App ID を .env.local に設定すると使えます</p>
  )

  return (
    <div className="flex items-center gap-3">
      <button onClick={joined ? leave : join}
        className="px-4 py-2 rounded-lg text-sm font-bold transition"
        style={joined
          ? { background: 'rgba(248,81,73,0.15)', color: '#f85149', border: '1px solid rgba(248,81,73,0.4)' }
          : { background: 'rgba(63,185,80,0.15)', color: '#3fb950', border: '1px solid rgba(63,185,80,0.4)' }}>
        {joined ? '📵 退出' : '🎤 参加'}
      </button>
      {joined && <span className="text-xs animate-pulse" style={{ color: '#8b949e' }}>通話中 · {count}人</span>}
      {error && <span className="text-xs" style={{ color: '#f85149' }}>{error}</span>}
    </div>
  )
}
