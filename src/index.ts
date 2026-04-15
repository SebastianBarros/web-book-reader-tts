interface Env {
  GOOGLE_API_KEY: string
  ALLOWED_ORIGINS: string
}

interface TTSRequest {
  text: string
  voice?: string
  lang?: string
  rate?: number
  pitch?: number
}

interface GoogleVoice {
  name: string
  languageCodes: string[]
  ssmlGender: string
  naturalSampleRateHertz: number
}

const MAX_TEXT_LENGTH = 5000
const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const GOOGLE_VOICES_URL = 'https://texttospeech.googleapis.com/v1/voices'

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const allow = origin && allowed.includes(origin) ? origin : allowed[0] ?? '*'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

async function handleSynthesize(
  req: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  let body: TTSRequest
  try {
    body = (await req.json()) as TTSRequest
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400, cors)
  }

  const text = (body.text ?? '').trim()
  if (!text) return jsonResponse({ error: 'text is required' }, 400, cors)
  if (text.length > MAX_TEXT_LENGTH)
    return jsonResponse({ error: `text exceeds ${MAX_TEXT_LENGTH} chars` }, 413, cors)

  const voice = body.voice || 'en-US-Neural2-C'
  const lang = body.lang || voice.split('-').slice(0, 2).join('-')
  const rate = clamp(body.rate ?? 1.0, 0.25, 4.0)
  const pitch = clamp(body.pitch ?? 0.0, -20, 20)

  const googleReq = {
    input: { text },
    voice: { languageCode: lang, name: voice },
    audioConfig: { audioEncoding: 'MP3', speakingRate: rate, pitch },
  }

  const googleRes = await fetch(`${GOOGLE_TTS_URL}?key=${env.GOOGLE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(googleReq),
  })

  if (!googleRes.ok) {
    const err = await googleRes.text()
    return jsonResponse({ error: 'upstream error', detail: err }, googleRes.status, cors)
  }

  const { audioContent } = (await googleRes.json()) as { audioContent: string }
  const bytes = Uint8Array.from(atob(audioContent), (c) => c.charCodeAt(0))
  return new Response(bytes, {
    headers: {
      ...cors,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}

async function handleVoices(
  req: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const url = new URL(req.url)
  const languageCode = url.searchParams.get('languageCode') ?? ''
  const google = new URL(GOOGLE_VOICES_URL)
  google.searchParams.set('key', env.GOOGLE_API_KEY)
  if (languageCode) google.searchParams.set('languageCode', languageCode)

  const res = await fetch(google.toString())
  if (!res.ok) {
    const detail = await res.text()
    return jsonResponse({ error: 'upstream error', detail }, res.status, cors)
  }
  const data = (await res.json()) as { voices?: GoogleVoice[] }
  return jsonResponse({ voices: data.voices ?? [] }, 200, {
    ...cors,
    'Cache-Control': 'public, max-age=3600',
  })
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin')
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    const cors = corsHeaders(origin, allowed)

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

    if (origin && !allowed.includes(origin))
      return jsonResponse({ error: 'forbidden' }, 403, cors)

    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === '/tts')
      return handleSynthesize(req, env, cors)
    if (req.method === 'GET' && url.pathname === '/voices')
      return handleVoices(req, env, cors)
    if (req.method === 'GET' && url.pathname === '/')
      return new Response('web-book-reader-tts worker is running.\n', {
        headers: { ...cors, 'Content-Type': 'text/plain' },
      })

    return jsonResponse({ error: 'not found' }, 404, cors)
  },
}
