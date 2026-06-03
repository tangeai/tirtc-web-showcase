export interface ConnectionFailureInput {
  connectionMode: string
  elapsedMs: number
  environment: string
  peerFailureMessage: string
  rawMessage: string
  remoteId: string
  tokenSource: string
}

export function normalizeOptionalUrl(value: string) {
  return value.trim()
}

export function validateStreamId(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > 15) {
    throw new Error(`${label} 需要是 0 到 15 之间的整数`)
  }
}

export function classifyConnectFailure(message: string, remoteId: string, elapsedMs: number) {
  const normalized = message.toLowerCase()
  const elapsedSeconds = (elapsedMs / 1000).toFixed(1)

  if (normalized.includes('timeout')) {
    return `连接超时（${elapsedSeconds}s）。优先检查设备 ${remoteId} 是否已启动到 SYS_STARTED，且与当前 test 环境一致。`
  }

  if (normalized.includes('token') || normalized.includes('credential') || normalized.includes('auth')) {
    return `连接被鉴权拒绝。请检查 deviceId=${remoteId} 是否与 token 签发目标一致，以及 token 是否仍然有效。`
  }

  if (normalized === '连接失败') {
    return `连接建立失败（${elapsedSeconds}s）。官方排查顺序：1) 设备 ${remoteId} 是否已启动并收到 SYS_STARTED；2) 当前传入的 remote_id 是否就是 ${remoteId}；3) token 是否匹配当前目标且未过期。`
  }

  return `连接失败（${elapsedSeconds}s）：${message}`
}

export function buildConnectionFailureMessage(input: ConnectionFailureInput) {
  const elapsedSeconds = (input.elapsedMs / 1000).toFixed(1)
  const readableReason = classifyConnectFailure(input.rawMessage, input.remoteId, input.elapsedMs)

  return [
    `deviceId=${input.remoteId}`,
    `env=${input.environment}`,
    `tokenSource=${input.tokenSource}`,
    input.connectionMode !== '未知' ? `mode=${input.connectionMode}` : '',
    `耗时=${elapsedSeconds}s`,
    readableReason,
    input.peerFailureMessage ? `peer=${input.peerFailureMessage}` : '',
    `原始错误=${input.rawMessage}`,
  ].filter(Boolean).join(' | ')
}
