#!/usr/bin/env node
/**
 * Real end-to-end smoke: a real listener, a real child carrying
 * DSH_TOOL_CALL_ID, and the plugin's own sampler over the real /proc.
 */
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EgressSampler } from '../lib/sampler.js'
import { resolveSettings } from '../lib/policy.js'

const CALL_ID = 'call_smoke_' + String(process.pid)
const sink = join(tmpdir(), 'dsh-egress-smoke-' + String(process.pid) + '.jsonl')

const server = createServer(socket => { socket.on('data', () => {}) })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const sampler = new EgressSampler(resolveSettings({ sink, intervalMs: 150 }, { home: '/x' }))

const child = spawn(process.execPath, ['-e', `
  const net = require('node:net')
  const c = net.connect(${String(port)}, '127.0.0.1', () => setTimeout(() => process.exit(0), 1500))
  c.on('error', () => process.exit(1))
`], { env: { ...process.env, DSH_TOOL_CALL_ID: CALL_ID, DSH_TOOL_NAME: 'smoke' }, stdio: 'ignore' })

let hit = null
for (let i = 0; i < 25 && hit === null; i += 1) {
  await new Promise(r => setTimeout(r, 150))
  const records = await sampler.sampleOnce()
  hit = records.find(record => record.callId === CALL_ID && record.remote.endsWith(':' + String(port))) ?? null
}

child.kill()
server.close()

if (hit === null) {
  console.error('SMOKE FAIL: attributed egress not observed')
  process.exit(1)
}
const written = await readFile(sink, 'utf8')
console.log('SMOKE OK:', JSON.stringify(hit), '| sink lines:', written.trim().split('\n').length)
