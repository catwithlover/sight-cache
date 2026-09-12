import { createRemoteJWKSet, jwtVerify } from 'jose'
import { type Bindings } from './contact-sheets'

const keySets = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>()

const isLoopback = (hostname: string) =>
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
    hostname.toLowerCase(),
  )

const normalizeTeamDomain = (value: string) => {
  const candidate = /^https?:\/\//iu.test(value) ? value : `https://${value}`
  const url = new URL(candidate)

  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && isLoopback(url.hostname))
  ) {
    throw new Error('ACCESS_TEAM_DOMAIN must use HTTPS')
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('ACCESS_TEAM_DOMAIN must be an origin')
  }

  return url.origin
}

const getKeySet = (issuer: string) => {
  const existing = keySets.get(issuer)
  if (existing) return existing

  const keySet = createRemoteJWKSet(
    new URL('/cdn-cgi/access/certs', `${issuer}/`),
  )
  keySets.set(issuer, keySet)
  return keySet
}

const accessError = (
  status: 401 | 403 | 503,
  code: 'access_invalid' | 'access_not_configured' | 'access_required',
  message: string,
) =>
  Response.json(
    { error: { code, message } },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  )

export const requireCloudflareAccess = async (
  request: Request,
  env: Bindings,
) => {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim()
  const audience = env.ACCESS_AUD?.trim()

  if (!teamDomain || !audience) {
    return accessError(
      503,
      'access_not_configured',
      'Cloudflare Access authentication is not configured.',
    )
  }

  const assertion = request.headers.get('Cf-Access-Jwt-Assertion')

  if (!assertion) {
    return accessError(
      401,
      'access_required',
      'Cloudflare Access authentication is required.',
    )
  }

  let issuer: string

  try {
    issuer = normalizeTeamDomain(teamDomain)
  } catch {
    return accessError(
      503,
      'access_not_configured',
      'Cloudflare Access authentication is not configured.',
    )
  }

  try {
    const { payload } = await jwtVerify(assertion, getKeySet(issuer), {
      algorithms: ['RS256'],
      audience,
      issuer,
      requiredClaims: ['exp', 'sub'],
    })

    console.log('Authenticated MCP request through Cloudflare Access', {
      email: typeof payload.email === 'string' ? payload.email : null,
      subject: payload.sub,
    })

    return null
  } catch {
    return accessError(
      403,
      'access_invalid',
      'Cloudflare Access authentication is invalid.',
    )
  }
}
