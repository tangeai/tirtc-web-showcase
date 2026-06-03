import { issueClientToken } from '../server/token/openapi.mjs'

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Origin', '*')
}

function normalizeRemoteId(value) {
  const remoteId = String(value || '').trim()
  if (!remoteId) {
    throw Object.assign(new Error('remoteId 不能为空'), { statusCode: 400 })
  }
  if (remoteId.length > 128) {
    throw Object.assign(new Error('remoteId 过长，请检查输入'), { statusCode: 400 })
  }
  return remoteId
}

function normalizeOptionalUrl(value, label) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  let parsedUrl
  try {
    parsedUrl = new URL(raw)
  } catch {
    throw Object.assign(new Error(`${label} 不是合法的 URL`), { statusCode: 400 })
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw Object.assign(new Error(`${label} 只支持 http(s)`), { statusCode: 400 })
  }

  return parsedUrl.toString().replace(/\/$/, '')
}

export default async function handler(request, response) {
  setCorsHeaders(response)

  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }

  if (request.method !== 'POST') {
    response.status(405).json({ message: 'Method Not Allowed' })
    return
  }

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {}
    const token = await issueClientToken({
      remoteId: normalizeRemoteId(body.remoteId),
      openapiEndpoint: normalizeOptionalUrl(body.openapiEndpoint, 'openapiEndpoint'),
      serviceEndpoint: normalizeOptionalUrl(body.endpoint, 'endpoint'),
    })

    response.status(200).json(token)
  } catch (error) {
    const statusCode = typeof error === 'object' && error && 'statusCode' in error
      ? Number(error.statusCode)
      : 500
    response.status(statusCode).json({
      message: error instanceof Error ? error.message : '未知错误',
    })
  }
}
