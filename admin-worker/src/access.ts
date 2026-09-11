import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export type AccessUser = {
  email: string
  subject: string
}

export type AppEnv = {
  Bindings: {
    DB: D1Database
    ACCESS_TEAM_DOMAIN: string
    ACCESS_AUD: string
    LOCAL_ADMIN_BYPASS?: string
    LOCAL_ADMIN_EMAIL?: string
  }
  Variables: {
    accessUser: AccessUser
  }
}

const keySets = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>()

const normalizeTeamDomain = (value: string) => {
  const candidate = /^https:\/\//i.test(value) ? value : `https://${value}`
  const url = new URL(candidate)

  if (url.protocol !== 'https:') {
    throw new Error('ACCESS_TEAM_DOMAIN must use HTTPS')
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

const isLoopback = (hostname: string) =>
  ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
    hostname.toLowerCase(),
  )

export const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  const hostname = new URL(c.req.url).hostname

  if (
    c.env.LOCAL_ADMIN_BYPASS?.trim().toLowerCase() === 'true' &&
    isLoopback(hostname)
  ) {
    c.set('accessUser', {
      email: c.env.LOCAL_ADMIN_EMAIL?.trim() || 'local@sight-cache.test',
      subject: 'local-development',
    })
    await next()
    return
  }

  const teamDomain = c.env.ACCESS_TEAM_DOMAIN?.trim()
  const audience = c.env.ACCESS_AUD?.trim()
  const isApiRequest = c.req.path.startsWith('/api/')

  if (!teamDomain || !audience) {
    if (isApiRequest) {
      return c.json(
        {
          error: {
            code: 'access_not_configured',
            message: 'Admin authentication is not configured.',
          },
        },
        503,
      )
    }

    return c.text('Admin authentication is not configured.', 503)
  }

  const assertion = c.req.header('cf-access-jwt-assertion')
  if (!assertion) {
    c.header('WWW-Authenticate', 'Bearer')

    if (isApiRequest) {
      return c.json(
        {
          error: {
            code: 'access_required',
            message: 'Cloudflare Access authentication is required.',
          },
        },
        401,
      )
    }

    return c.text('Cloudflare Access authentication is required.', 401)
  }

  let issuer: string
  try {
    issuer = normalizeTeamDomain(teamDomain)
  } catch {
    if (isApiRequest) {
      return c.json(
        {
          error: {
            code: 'access_not_configured',
            message: 'Admin authentication is not configured.',
          },
        },
        503,
      )
    }

    return c.text('Admin authentication is not configured.', 503)
  }

  try {
    const { payload } = await jwtVerify(assertion, getKeySet(issuer), {
      issuer,
      audience,
      algorithms: ['RS256'],
    })

    if (typeof payload.email !== 'string' || !payload.email || !payload.sub) {
      if (isApiRequest) {
        return c.json(
          {
            error: {
              code: 'access_invalid',
              message: 'Cloudflare Access authentication is invalid.',
            },
          },
          403,
        )
      }

      return c.text('Cloudflare Access authentication is invalid.', 403)
    }

    c.set('accessUser', {
      email: payload.email,
      subject: payload.sub,
    })
  } catch {
    if (isApiRequest) {
      return c.json(
        {
          error: {
            code: 'access_invalid',
            message: 'Cloudflare Access authentication is invalid.',
          },
        },
        403,
      )
    }

    return c.text('Cloudflare Access authentication is invalid.', 403)
  }

  await next()
})
