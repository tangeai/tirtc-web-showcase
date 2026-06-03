import crypto from 'node:crypto'

function toBase64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export function buildUtcTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function sha256Hex(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

export function buildTgServerAuthorization({ path, timestamp, body, accessId, secretKey }) {
  const stringToSign = ['POST', path, '', timestamp, sha256Hex(body)].join('\n')
  const signature = crypto.createHmac('sha256', secretKey).update(stringToSign, 'utf8').digest()
  return `TGServer ${accessId}:${toBase64Url(signature)}`
}
