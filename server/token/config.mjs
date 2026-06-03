const DEFAULT_OPENAPI_ENDPOINT = 'http://api-test-tirtc.tange365.com'
const DEFAULT_UID = 'uid1'
const DEFAULT_USER_TOKEN_TTL = 36000
const DEFAULT_CHANNEL_TOKEN_TTL = 36000

function ensureText(value, label) {
  const text = String(value || '').trim()
  if (!text) {
    throw Object.assign(new Error(`服务端缺少配置：${label}`), { statusCode: 500 })
  }
  return text
}

function normalizeUrl(value) {
  const text = String(value || '').trim()
  if (!text) return ''

  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw Object.assign(new Error(`无效的 OpenAPI 地址：${text}`), { statusCode: 500 })
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error(`OpenAPI 地址只支持 http(s)：${text}`), { statusCode: 500 })
  }

  return parsed.toString().replace(/\/$/, '')
}

export function inferOpenApiEndpoint(serviceEndpoint) {
  const normalized = normalizeUrl(serviceEndpoint)
  if (!normalized) return ''

  return normalized
    .replace('://ep-', '://api-')
    .replace('://ep.', '://api.')
}

export function resolveTokenConfig({ remoteId, openapiEndpoint, serviceEndpoint }) {
  const appId = ensureText(process.env.TIRTC_APP_ID, 'TIRTC_APP_ID')
  const accessId = ensureText(process.env.TIRTC_ACCESS_KEY_ID, 'TIRTC_ACCESS_KEY_ID')
  const secretKey = ensureText(process.env.TIRTC_SECRET_KEY_ID, 'TIRTC_SECRET_KEY_ID')
  const uid = String(process.env.TIRTC_CLIENT_UID || DEFAULT_UID).trim() || DEFAULT_UID
  const userTokenTtl = Number(process.env.TIRTC_USER_TOKEN_TTL || DEFAULT_USER_TOKEN_TTL)
  const channelTokenTtl = Number(process.env.TIRTC_CHANNEL_TOKEN_TTL || DEFAULT_CHANNEL_TOKEN_TTL)

  const resolvedOpenApiEndpoint =
    normalizeUrl(openapiEndpoint) ||
    inferOpenApiEndpoint(serviceEndpoint) ||
    normalizeUrl(process.env.TIRTC_OPENAPI_ENDPOINT) ||
    inferOpenApiEndpoint(process.env.TIRTC_ENDPOINT) ||
    DEFAULT_OPENAPI_ENDPOINT

  return {
    appId,
    accessId,
    secretKey,
    uid,
    remoteId,
    openapiEndpoint: resolvedOpenApiEndpoint,
    userTokenTtl,
    channelTokenTtl,
  }
}
