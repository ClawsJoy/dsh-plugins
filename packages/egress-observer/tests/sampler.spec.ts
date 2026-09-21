/**
 * Sampler tests with an injected filesystem: the same code path the plugin runs,
 * without needing a live /proc.
 */
import { describe, expect, it } from 'vitest'
import { EgressSampler, type ProcFs } from '../src/sampler.ts'
import { resolveSettings } from '../src/policy.ts'

const TCP = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 111 1 0 100 0 0 10 0',
  '   1: 0100007F:C350 5DB8D822:01BB 01 00000000:00000000 00:00000000 00000000  1000 0 222 1 0 20 4 30 10 -1',
].join('\n')

function fakeFs(options: { environ: Record<number, string>; inodes: Record<number, string[]>; sinkFile?: { data: string } }): ProcFs {
  return {
    readdir: async (path: string) => {
      if (path === '/proc') return Object.keys(options.environ)
      const pid = /^\/proc\/(\d+)\/fd$/.exec(path)?.[1]
      if (pid !== undefined) return (options.inodes[Number(pid)] ?? []).map((_, i) => String(i))
      throw new Error('ENOENT ' + path)
    },
    readlink: async (path: string) => {
      const match = /^\/proc\/(\d+)\/fd\/(\d+)$/.exec(path)
      const inode = match === null ? undefined : options.inodes[Number(match[1])]?.[Number(match[2])]
      if (inode === undefined) throw new Error('ENOENT')
      return `socket:[${inode}]`
    },
    readFile: async (path: string) => {
      if (path === '/proc/net/tcp') return TCP
      if (path === '/proc/net/tcp6') throw new Error('ENOENT')
      const pid = /^\/proc\/(\d+)\/environ$/.exec(path)?.[1]
      if (pid !== undefined && options.environ[Number(pid)] !== undefined) return options.environ[Number(pid)]!
      throw new Error('ENOENT')
    },
    appendFile: async (_path, data) => { options.sinkFile ??= { data: '' }; options.sinkFile.data += data },
    mkdir: async () => {},
    dirname: path => path.replace(/\/[^/]*$/, ''),
  }
}

describe('EgressSampler', () => {
  it('records the attributed remote once and skips LISTEN rows', async () => {
    const sinkFile = { data: '' }
    const fs = fakeFs({
      environ: { 42: 'PATH=/bin\u0000DSH_TOOL_CALL_ID=call_1\u0000DSH_TOOL_NAME=bash\u0000' },
      inodes: { 42: ['222', 'not-a-socket'] },
      sinkFile,
    })
    const sampler = new EgressSampler(resolveSettings({}, { home: '/x' }), fs, () => 'T')
    const first = await sampler.sampleOnce()
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ callId: 'call_1', toolName: 'bash', pid: 42, remote: '34.216.184.93:443', state: 'ESTABLISHED' })
    expect(sinkFile.data).toContain('"plugin":"egress-observer"')
    const second = await sampler.sampleOnce()
    expect(second).toHaveLength(0) // steady connection is written once
  })

  it('negative control: attributed mode ignores a pid without the attribution variable', async () => {
    const fs = fakeFs({ environ: { 7: 'PATH=/bin\u0000' }, inodes: { 7: ['222'] } })
    const sampler = new EgressSampler(resolveSettings({}, { home: '/x' }), fs, () => 'T')
    await expect(sampler.sampleOnce()).resolves.toEqual([])
  })

  it('all mode records ownerless egress without inventing an owner', async () => {
    const fs = fakeFs({ environ: { 7: 'PATH=/bin\u0000' }, inodes: { 7: ['222'] } })
    const sampler = new EgressSampler(resolveSettings({ mode: 'all' }, { home: '/x' }), fs, () => 'T')
    const records = await sampler.sampleOnce()
    expect(records).toHaveLength(1)
    expect(records[0]?.callId).toBeUndefined()
  })

  it('never throws when /proc is unavailable', async () => {
    const fs = fakeFs({ environ: {}, inodes: {} })
    const sampler = new EgressSampler(resolveSettings({}, { home: '/x' }), fs, () => 'T')
    await expect(sampler.sampleOnce()).resolves.toEqual([])
  })
})
