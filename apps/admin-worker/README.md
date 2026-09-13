<div align="center">
  <h1>Sight Cache Admin Worker</h1>
  <p><em>Manage Sight Cache collector devices and their access tokens.</em></p>
  <p>English · <a href="README.zh-TW.md" lang="zh-Hant-TW">繁體中文</a></p>
</div>

**Sight Cache Admin Worker** manages the devices that send captures to Sight
Cache. Administrators can create devices, rotate collector tokens, and disable
devices to revoke access.

## How it works

```text
Administrator browser
        |
        v
Cloudflare Access
        |
        +--> Hono: /admin and /api/* --> D1
```

- Hono renders `/admin` on the server and handles the device API.
- A complete bearer token is returned only when a device is created or its
  token is rotated. D1 stores only its SHA-256 hash and masked hint.
- Disabling a device preserves its record while revoking its active token.

## Bindings

| Name | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 | Stores devices and token hashes |
| `ASSETS` | Workers Static Assets | Serves files from `public/` |
| `ACCESS_TEAM_DOMAIN` | Variable | Cloudflare Access team URL, such as `https://team.cloudflareaccess.com` |
| `ACCESS_AUD` | Variable | Audience tag for the admin Access application |

## Security model

- The production admin hostname must be protected by the matching Cloudflare
  Access application.
- `LOCAL_ADMIN_BYPASS` is for loopback development only and must not be
  configured in production.

## Database migrations

Versioned SQL migration files live in `migrations/`. Apply pending migrations
explicitly from this directory:

```sh
# Local D1
npm run dev:migrate

# Remote D1
npm run prod:migrate
```

D1 records applied files in its migration table, so each command applies only
pending migrations.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin` | Render the administration interface |
| `GET` | `/api/devices` | List devices |
| `POST` | `/api/devices` | Create a device and token |
| `POST` | `/api/devices/:id/token` | Revoke the old token and create a new one |
| `DELETE` | `/api/devices/:id` | Disable a device and revoke its token |

## Local development

Install dependencies and create the ignored `.dev.vars` file from
`.dev.vars.example`. The default template enables the local authentication
bypass and supplies a local administrator email.
