import { NextRequest, NextResponse } from 'next/server'
import { RtcTokenBuilder, RtcRole } from 'agora-token'

const APP_ID   = process.env.NEXT_PUBLIC_AGORA_APP_ID!
const APP_CERT = process.env.AGORA_APP_CERTIFICATE!

export async function GET(req: NextRequest) {
  const uid     = req.nextUrl.searchParams.get('uid') ?? '0'
  const channel = req.nextUrl.searchParams.get('channel') ?? 'main'
  const expire  = Math.floor(Date.now() / 1000) + 3600

  const token = RtcTokenBuilder.buildTokenWithUid(
    APP_ID, APP_CERT, channel, Number(uid), RtcRole.PUBLISHER, expire, expire
  )
  return NextResponse.json({ token })
}
