// A stand-in for the FastAPI AI service in tests: answers /v1/info and /v1/lead-brief, counts calls, keeps what it
// was sent (to check the bundle), and replies as `state.reply` says (default: a valid brief citing the newest item).
import http from 'node:http'

/** The AI service stand-in: counts calls, keeps what it was sent, and answers as `stub.reply` says. */
export function startAiStub() {
  const state = { calls: 0, bodies: [], headers: [], reply: null, delayMs: 0 }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', async () => {
      state.headers.push(req.headers)
      if (req.url === '/v1/info') {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ provider: 'fake', model: 'fake', promptVersion: 'lead-brief/1' }))
      }
      state.calls += 1
      const body = JSON.parse(raw)
      state.bodies.push(body)
      if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs))
      const [status, payload] = state.reply ? state.reply(body) : [200, goodAnswer(body)]
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state })))
}

export const META = {
  provider: 'fake',
  model: 'fake',
  promptVersion: 'lead-brief/1',
  inputTokens: 900,
  outputTokens: 200,
}
export function goodAnswer(body) {
  const ids = body.history.map((h) => h.id)
  return {
    brief: {
      summary: `${body.lead.name} is a ${body.lead.status} lead.`,
      nextAction: { action: 'Call to agree next steps', dueDate: body.today },
      followUpEmail: { subject: 'Following up', body: 'Hi,\n\nShall we talk this week?\n' },
      citations: ids.length ? [{ claim: 'status', sourceIds: [ids[0]] }] : [],
    },
    meta: { ...META, costUsd: 0, latencyMs: 40, firstTokenMs: 10, attempts: 1, citationsRejected: 0 },
  }
}
