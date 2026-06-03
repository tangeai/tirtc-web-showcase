export interface IssueTokenInput {
  remoteId: string
  endpoint?: string
  openapiEndpoint?: string
}

export interface IssueTokenResult {
  appId: string
  payload: Record<string, unknown> | null
  remoteId: string
  source: string
  token: string
}

interface ApiErrorPayload {
  message?: string
}

export async function issueToken(input: IssueTokenInput): Promise<IssueTokenResult> {
  const response = await fetch('/api/token/issue', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  const payload = (await response.json()) as IssueTokenResult | ApiErrorPayload

  if (!response.ok) {
    throw new Error(('message' in payload && payload.message) || 'Token 接口调用失败')
  }

  return payload as IssueTokenResult
}