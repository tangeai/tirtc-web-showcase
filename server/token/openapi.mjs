import { buildTgServerAuthorization, buildUtcTimestamp } from './signature.mjs'
import { resolveTokenConfig } from './config.mjs'

async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      ...headers,
    },
    body,
  })

  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }

  if (!response.ok) {
    throw Object.assign(new Error(`POST ${new URL(url).pathname} HTTP ${response.status}: ${text}`), {
      statusCode: 502,
    })
  }

  return { json, text }
}

function extractDataString(payload, fieldName, pathLabel) {
  if (!payload || typeof payload !== 'object') {
    throw Object.assign(new Error(`${pathLabel} 返回不是合法 JSON`), { statusCode: 502 })
  }

  const code = 'code' in payload ? payload.code : undefined
  if (typeof code === 'number' && code !== 0 && code !== 200) {
    const message = typeof payload.message === 'string' ? payload.message : '未知错误'
    throw Object.assign(new Error(`${pathLabel} 业务失败：code=${code} message=${message}`), {
      statusCode: 502,
    })
  }

  const data = payload.data
  if (!data || typeof data !== 'object') {
    throw Object.assign(new Error(`${pathLabel} 缺少 data 字段`), { statusCode: 502 })
  }

  const value = data[fieldName]
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`${pathLabel} 缺少 data.${fieldName}`), { statusCode: 502 })
  }

  return value.trim()
}

async function requestUserToken(config) {
  const path = '/v1/user_token'
  const body = JSON.stringify({
    access_id: config.accessId,
    uid: config.uid,
    ttl: config.userTokenTtl,
  })
  const timestamp = buildUtcTimestamp()
  const authorization = buildTgServerAuthorization({
    path,
    timestamp,
    body,
    accessId: config.accessId,
    secretKey: config.secretKey,
  })

  const { json } = await postJson(`${config.openapiEndpoint}${path}`, {
    Authorization: authorization,
    'X-TG-Timestamp': timestamp,
  }, body)

  return extractDataString(json, 'user_token', path)
}

async function requestClientToken(config, userToken) {
  const path = '/v1/token'
  const body = JSON.stringify({
    device_id: config.remoteId,
    ttl: config.channelTokenTtl,
  })

  const { json } = await postJson(`${config.openapiEndpoint}${path}`, {
    Authorization: `Bearer ${userToken}`,
  }, body)

  return extractDataString(json, 'token', path)
}

export async function issueClientToken({ remoteId, openapiEndpoint, serviceEndpoint }) {
  const config = resolveTokenConfig({ remoteId, openapiEndpoint, serviceEndpoint })
  const userToken = await requestUserToken(config)
  const token = await requestClientToken(config, userToken)

  return {
    appId: config.appId,
    payload: null,
    remoteId: config.remoteId,
    source: 'openapi',
    token,
  }
}
