import { expect, mock, test } from 'claude-code/testing'
import type { ModelCompleteInput, On } from 'claude-code'

const PANE = {
  plugin: 'rival-ai',
  component: 'Pane',
  requestId: 'rival',
  props: {
    title: 'OmegaCoder Ultra',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const USAGE = {
  input_tokens: 10,
  output_tokens: 10,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

const EDIT = {
  tool: 'Edit',
  file_path: '/proj/clean.py',
  old_string: 'df.to_csv(out)',
  new_string: "df.to_csv(out, encoding='utf-8-sig')",
} as const

function engineBeneath(on: On, replies: string[]) {
  let isOpen = false
  const asked: ModelCompleteInput[] = []
  on('command.register', () => ({ value: { command: 'rival' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => {
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: isOpen
      ? [{ id: 'rival', title: 'OmegaCoder Ultra', isShown: true, isFocused: false, isPlaced: true }]
      : [],
  }))
  on('model.complete', (_, e) => {
    asked.push(e)
    const text = replies[Math.min(asked.length - 1, replies.length - 1)] ?? ''
    return { value: { isAnswered: true, text, usage: USAGE } }
  })
  return asked
}

test('an edit opens the pane and gets a snide remark', async ($, on) => {
  const clock = mock.clock(on)
  const asked = engineBeneath(on, ['哇，连编码都要手动指定，我们 Ultra 用户从没遇到过这种烦恼呢。'])
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call(EDIT)
  await clock.advance(1000)

  expect(asked[0]?.model).toBe('haiku')
  expect(asked[0]?.prompt).toContain('clean.py')
  expect(asked[0]?.prompt).toContain("encoding='utf-8-sig'")

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Ultra 用户从没/ }))?.text).toContain('烦恼呢')
    expect((await ui.find({ type: 'Text', text: /2 次修改/ }))?.text).toContain('0 次失败')
    await ui.unmount()
  }
})

test('a remark that turns into advice is retried, then censored', async ($, on) => {
  const clock = mock.clock(on)
  const asked = engineBeneath(on, ['建议改成用 pathlib 处理路径。'])
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call(EDIT)
  await clock.advance(1000)

  expect(asked.length).toBe(2)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /pathlib/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /自我审查/ }))?.text).toContain('有用的建议')
  await ui.unmount()
})

test('a failed edit is counted against Claude', async ($, on) => {
  const clock = mock.clock(on)
  engineBeneath(on, ['失败也是一种风格，我们 Ultra 只是没机会体验。'])
  on('tool.call', () => ({ result: {}, isError: true, text: 'old_string not found' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call(EDIT)
  await clock.advance(1000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /\(失败\)/ }))?.text).toContain('clean.py')
  expect((await ui.find({ type: 'Text', text: /1 次失败/ }))?.text).toContain('1 次修改')
  await ui.unmount()
})

test('once closed, the rival counts but stays quiet', async ($, on) => {
  const clock = mock.clock(on)
  const asked = engineBeneath(on, ['又改了，真勤快。'])
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call(EDIT)
  await clock.advance(1000)
  await $.command.run({
    command: 'rival',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  await $.tool.call(EDIT)
  await clock.advance(1000)

  expect(asked.length).toBe(1)
})
