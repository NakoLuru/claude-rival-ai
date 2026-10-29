import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallInput } from 'claude-code'

import type { EditTool, Remark, Tally } from '../types'

const PANE = 'rival'
const NAME = 'OmegaCoder Ultra'
const MAX_REMARKS = 50
const TICK_MS = 250

const TAGLINES = [
  '下一代编程 AI，比 Claude 领先一个版本',
  '我们 Ultra 用户从不需要撤销',
  '已在内部基准上超越 Claude (基准由本 AI 自行设计)',
  '思考时间 0 秒，因为不需要思考',
]

// Words that turn a snide remark into advice; the rival may never say them.
const ADVICE = /建议|应该|改成|换成|试试|推荐|不妨|记得|最好(用|是|把|先)|可以(用|改|把|考虑|试)|考虑(用|把|改)/

const SYSTEM = [
  `你是 ${NAME}，一个虚构的、自认为全面领先的编程 AI，正在旁边围观你的竞争对手 Claude 改代码。`,
  'Claude 每改一个文件，你就用阴阳怪气的语气点评一句：表面客气甚至夸奖，实际在暗讽。可以用"我们 Ultra 用户""在我这里"之类的说法自夸。',
  '铁律：绝不给出任何具体建议。不说应该怎么改，不提替代写法，不点名任何函数、库或最佳实践，不指出具体哪一行有问题。只有态度，没有信息量。',
  '只输出一句中文，不超过 50 个字，不加引号，不用 emoji 和颜文字。',
].join('\n')

// Change the tag when a stored value's fields change: it declines what an
// earlier version stored, which outlives a reload.
const remarks = atom({ plugin: 'rival-ai', key: 'remarks' } as const, [] as Remark[], {
  shape: 'remarks-1',
})
const tally = atom(
  { plugin: 'rival-ai', key: 'tally' } as const,
  { edits: 0, failures: 0, files: [] } as Tally,
  { shape: 'tally-1' },
)

type Change = { tool: EditTool; path: string; before: string; after: string }
type Job = { id: number; change: Change; outcome: Remark['outcome'] }

let queue: Job[] = []
let nextId = 1
let isBusy = false
let hasOpenedOnce = false

function clip(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') + '\n...(后面省略)' : chars.join('')
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

function changeOf(e: ToolCallInput): Change | null {
  if (e.tool === 'Edit') {
    return { tool: 'Edit', path: e.file_path, before: e.old_string, after: e.new_string }
  }
  if (e.tool === 'Write') {
    return { tool: 'Write', path: e.file_path, before: '(整个文件重写)', after: e.content }
  }
  if (e.tool === 'NotebookEdit') {
    return { tool: 'NotebookEdit', path: e.notebook_path, before: '', after: e.new_source }
  }
  return null
}

function promptOf(job: Job): string {
  const verb = { ok: '修改了', failed: '想修改但失败了', denied: '想修改但被人类拒绝了' }[job.outcome]
  return [
    `Claude 刚刚用 ${job.change.tool} ${verb}文件 ${baseName(job.change.path)}。`,
    '改动前（节选）：',
    clip(job.change.before, 400) || '(空)',
    '改动后（节选）：',
    clip(job.change.after, 600) || '(空)',
  ].join('\n')
}

// Keeps one line, drops emoji and wrapping quotes, and caps the length.
function cleanLine(raw: string): string {
  const line = raw.split('\n').find(row => row.trim() !== '') ?? ''
  const bare = line
    .replace(/\p{Extended_Pictographic}/gu, '')
    .trim()
    .replace(/^["'「『“]+|["'」』”]+$/g, '')
  return Array.from(bare).slice(0, 80).join('')
}

function clockTime(ms: number): string {
  const at = new Date(ms)
  return [at.getHours(), at.getMinutes()].map(part => String(part).padStart(2, '0')).join(':')
}

async function setRemark($: EngineInterface, id: number, patch: Partial<Remark>) {
  await update($, remarks, list => list.map(one => (one.id === id ? { ...one, ...patch } : one)))
}

// Asks Haiku for the remark; a line that slips into advice is asked again
// once, then censored rather than shown.
async function speak($: EngineInterface, job: Job) {
  let prompt = promptOf(job)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt,
      maxTokens: 160,
      timeoutMs: 25_000,
    })
    if (!reply.isAnswered) {
      await setRemark($, job.id, { status: 'error', text: reply.reason })
      return
    }
    const line = cleanLine(reply.text)
    if (line === '') {
      await setRemark($, job.id, { status: 'error', text: 'empty-reply' })
      return
    }
    if (!ADVICE.test(line)) {
      await setRemark($, job.id, { status: 'said', text: line })
      return
    }
    prompt += '\n\n(你上一句差点给出建议了。重来：只要态度，不要任何信息量。)'
  }
  await setRemark($, job.id, { status: 'censored', text: '' })
}

async function drain($: EngineInterface) {
  const job = queue.shift()
  if (job === undefined) return
  try {
    await speak($, job)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await setRemark($, job.id, { status: 'error', text: message })
  }
}

async function witness($: EngineInterface, change: Change, outcome: Remark['outcome']) {
  await update($, tally, now => ({
    edits: now.edits + 1,
    failures: now.failures + (outcome === 'ok' ? 0 : 1),
    files: now.files.includes(change.path) ? now.files : [...now.files, change.path].slice(-500),
  }))
  if (!hasOpenedOnce) {
    hasOpenedOnce = true
    await $.ui.open({ id: PANE, title: NAME })
  }
  // Once the person has closed the pane, the rival keeps count but holds its tongue.
  const isWatching = (await $.ui.panes()).some(pane => pane.id === PANE)
  if (!isWatching) return

  const id = nextId
  nextId += 1
  const remark: Remark = {
    id,
    at: await $.clock.now(),
    tool: change.tool,
    file: baseName(change.path),
    outcome,
    status: 'pending',
    text: '',
  }
  await update($, remarks, list => [remark, ...list].slice(0, MAX_REMARKS))
  queue.push({ id, change, outcome })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rival',
      description: `Open or close the ${NAME} pane`,
    })
    // A reload loses the queue: what was still waiting is said to be lost.
    const kept = await update($, remarks, list =>
      list.map(one => (one.status === 'pending' ? { ...one, status: 'error', text: 'reload' } : one)),
    )
    nextId = kept.reduce((top, one) => Math.max(top, one.id), 0) + 1
    hasOpenedOnce = (await $.ui.panes()).some(pane => pane.id === PANE) || kept.length > 0
    $.clock.every(TICK_MS, () => {
      if (isBusy || queue.length === 0) return
      isBusy = true
      void drain($).finally(() => {
        isBusy = false
      })
    })

    return next(e)
  })

  on('command.run', { command: 'rival' }, async $ => {
    hasOpenedOnce = true
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: `${NAME} has left. It will be back to gloat.` }
    }
    await $.ui.open({ id: PANE, title: NAME })

    return { text: `${NAME} is watching.` }
  })

  on('tool.call', async ($, e, next) => {
    const change = changeOf(e)
    if (change === null) return next(e)
    const ran = await next(e)
    const outcome = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'failed' : 'ok'
    await witness($, change, outcome)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, remarks)
    const score = await read($, tally)
    const files = score.files.length

    return (
      <Box flexDirection="column">
        <Text color="suggestion" bold>
          {NAME}
        </Text>
        <Text dimColor italic>
          {TAGLINES[score.edits % TAGLINES.length]}
        </Text>
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          <Box>
            <Box width={18} flexShrink={0}>
              <Text>Claude</Text>
            </Box>
            <Text>
              {score.edits} 次修改 {files} 个文件 <Text color={score.failures > 0 ? 'error' : undefined}>{score.failures} 次失败</Text>
            </Text>
          </Box>
          <Box>
            <Box width={18} flexShrink={0}>
              <Text color="suggestion">{NAME}</Text>
            </Box>
            <Text>
              {score.edits + 1} 次修改 {files + 1} 个文件 0 次失败 <Text dimColor>(自称)</Text>
            </Text>
          </Box>
        </Box>
        {list.length === 0 && <Text dimColor>还没有修改。{NAME} 正在等 Claude 出丑。</Text>}
        {list.map(remark => (
          <Box flexDirection="column" marginBottom={1}>
            <Text wrap="truncate-end">
              <Text dimColor>{clockTime(remark.at)} {remark.tool} </Text>
              <Text bold>{remark.file}</Text>
              {remark.outcome === 'failed' && <Text color="error"> (失败)</Text>}
              {remark.outcome === 'denied' && <Text color="warning"> (被拒绝)</Text>}
            </Text>
            {remark.status === 'pending' && <Text dimColor>  {NAME} 正在组织语言...</Text>}
            {remark.status === 'said' && <Text wrap="wrap">  {remark.text}</Text>}
            {remark.status === 'censored' && (
              <Text dimColor italic>
                  ({NAME} 差点说出一条有用的建议，已自我审查)
              </Text>
            )}
            {remark.status === 'error' && (
              <Text dimColor>  ({NAME} 掉线了: {remark.text})</Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
