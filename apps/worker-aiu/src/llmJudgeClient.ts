export type JudgeRequest = {
  model: string
  systemPrompt: string
  userPrompt: string
}

// Calls api-llm-gateway's internal-only judge route - the single place that
// ever talks to OpenRouter, so the key stays there. Auth is a shared secret
// (JWT_SECRET, already provisioned to this worker) since the caller is a
// background job, not a candidate/admin.
export async function callJudge(
  gatewayUrl: string,
  jwtSecret: string,
  req: JudgeRequest,
): Promise<string> {
  const res = await fetch(`${gatewayUrl}/api/v1/llm/judge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': jwtSecret },
    body: JSON.stringify(req),
  })

  if (!res.ok) {
    throw new Error(`llm-gateway judge call failed with status ${res.status}`)
  }

  const data = (await res.json()) as { data?: { content?: string } }
  const content = data.data?.content
  if (!content) {
    throw new Error('llm-gateway judge call returned empty content')
  }
  return content
}
