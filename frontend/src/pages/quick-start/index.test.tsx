import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { QuickStartEntryService, QuickStartSession } from './service'
import type { WorkflowRun } from '@/entities'
import type { ExportPackageModel } from '@/features/export-package'
import { QuickStartPage } from './index'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function workflow(nodes: WorkflowRun['nodes'], id = 'run-1'): WorkflowRun {
  return { id, projectId: 'project-1', version: 1, storageStatus: 'active', nodes }
}

function setupAndTemplate(
  template: Partial<Extract<WorkflowRun['nodes'][number], { type: 'character-template' }>> = {},
): WorkflowRun['nodes'] {
  return [
    {
      id: 'character-setup',
      type: 'character-setup',
      status: 'passed',
      phase: 'completed',
      dependsOnNodeIds: [],
      generations: [],
      error: null,
      input: { characterId: 'character-1', prompt: '像素骑士', referenceMedia: [] },
    },
    {
      id: 'character-template',
      type: 'character-template',
      status: 'active',
      phase: 'selecting',
      dependsOnNodeIds: ['character-setup'],
      generations: [{ taskId: 'template-task', role: 'character_template' }],
      error: null,
      selectedImageUrl: null,
      ...template,
    },
  ]
}

function actionWorkflow(
  options: {
    firstStatus?: 'active' | 'passed' | 'failed'
    firstPhase?: 'generating' | 'selecting' | 'completed'
    fullStatus?: 'locked' | 'active' | 'passed' | 'failed'
    reviewStatus?: 'locked' | 'active' | 'passed'
    error?: string | null
  } = {},
) {
  const firstStatus = options.firstStatus ?? 'passed'
  const fullStatus = options.fullStatus ?? 'locked'
  return workflow([
    ...setupAndTemplate({ status: 'passed', phase: 'completed', selectedImageUrl: 'template.png' }),
    {
      id: 'action-first',
      type: 'action-first-frame',
      status: firstStatus,
      phase: options.firstPhase ?? (firstStatus === 'passed' ? 'completed' : 'selecting'),
      dependsOnNodeIds: ['character-template'],
      generations: [{ taskId: 'first-task', role: 'first_frame' }],
      error: firstStatus === 'failed' ? (options.error ?? '首帧失败') : null,
      input: { outfitId: 'outfit-1', name: '挥手', type: 'custom', prompt: '挥手', fps: 12 },
      selectedFirstFrameUrl: firstStatus === 'passed' ? 'first.png' : null,
    },
    {
      id: 'method',
      type: 'action-generation-method',
      status: firstStatus === 'passed' ? 'passed' : 'locked',
      phase: firstStatus === 'passed' ? 'completed' : 'selecting',
      dependsOnNodeIds: ['action-first'],
      generations: [],
      error: null,
      method: firstStatus === 'passed' ? 'video-cropping' : null,
    },
    {
      id: 'action-full',
      type: 'action-full-frame',
      status: fullStatus,
      phase:
        fullStatus === 'passed' ? 'completed' : fullStatus === 'active' ? 'generating' : 'ready',
      dependsOnNodeIds: ['method'],
      generations:
        fullStatus === 'locked' ? [] : [{ taskId: 'full-task', role: 'complete_animation' }],
      error: fullStatus === 'failed' ? (options.error ?? '完整动作失败') : null,
    },
    {
      id: 'review',
      type: 'review',
      status: options.reviewStatus ?? 'locked',
      phase: options.reviewStatus === 'passed' ? 'completed' : 'reviewing',
      dependsOnNodeIds: ['action-full'],
      generations: [],
      error: null,
    },
  ])
}

type QuickStartMock = QuickStartEntryService & QuickStartSession

function serviceFor(run: WorkflowRun | null, overrides: Partial<QuickStartMock> = {}) {
  const fallbackRun = run ?? workflow(setupAndTemplate(), 'run-new')
  const service: QuickStartMock = {
    unavailableReason: null,
    runId: fallbackRun.id,
    start: vi.fn(async () => service),
    startWithUploadedTemplate: vi.fn(async () => service),
    open: vi.fn(async () => {
      if (!run) throw new Error('not found')
      return service
    }),
    continueWithUploadedTemplate: vi.fn(async () => run!),
    startAction: vi.fn(async () => service),
    getWorkflow: vi.fn(() => fallbackRun),
    subscribe: vi.fn(() => () => undefined),
    resume: vi.fn(async () => fallbackRun),
    interrupt: vi.fn(async () => fallbackRun),
    dispose: vi.fn(),
    confirmCandidate: vi.fn(async () => fallbackRun),
    getFirstFrameCandidates: vi.fn(async () => []),
    confirmFirstFrame: vi.fn(async () => fallbackRun),
    approveReview: vi.fn(async () => fallbackRun),
    getCharacterInfo: vi.fn(() => ({ characterId: 'character-1', outfitId: 'outfit-1' })),
    resolveCharacterInfo: vi.fn(async () => ({ characterId: 'character-1', outfitId: 'outfit-1' })),
    getTemplateCandidates: vi.fn(async () => []),
    getActionFrames: vi.fn(async () => []),
    getExportModel: vi.fn(async () => null),
    ...overrides,
  }
  Object.assign(service, overrides)
  return service
}

function renderAt(path: string, service: QuickStartEntryService) {
  function PlaytestLocation() {
    const location = useLocation()
    return <h1>{`${location.pathname}${location.search}`}</h1>
  }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/quick-start" element={<QuickStartPage service={service} />} />
        <Route path="/quick-start/:runId" element={<QuickStartPage service={service} />} />
        <Route path="/playtest/:characterId/:outfitId" element={<PlaytestLocation />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('QuickStartPage', () => {
  it('reserves the fixed app header height before the creation entry', () => {
    const entry = renderAt('/quick-start', serviceFor(null))
    const entrySection = entry.getByLabelText('创作指令').closest('section')

    expect(entrySection?.className).toContain('min-h-[100dvh]')
    expect(entrySection?.className).toContain('pt-14')
  })

  it('uses a centered creation desk with style prompts before the composer', () => {
    const entry = renderAt('/quick-start', serviceFor(null))
    const entrySection = entry.getByLabelText('创作指令').closest('section')
    const entryLayout = entrySection?.querySelector('[data-layout="quick-start-entry"]')
    const composer = entrySection?.querySelector('[data-layout="quick-start-composer"]')
    const starters = entrySection?.querySelector('[data-layout="quick-start-starters"]')

    expect(entryLayout?.className).toContain('min-h-[calc(100dvh-3.5rem)]')
    expect(entryLayout?.className).toContain('grid-rows-[1fr_auto]')
    expect(composer?.className).toContain('max-w-3xl')
    expect(composer?.querySelector('form')).toBeTruthy()
    expect(composer?.querySelector('form')?.className).toContain('sm:grid-cols-[1fr_auto_auto]')
    expect(starters).toBeTruthy()
    expect(
      Boolean(
        starters &&
        composer &&
        starters.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
  })

  it('removes non-actionable explanatory copy from the creation workspace', () => {
    renderAt('/quick-start', serviceFor(null))

    expect(screen.queryByText('QUICK START / CREATE CHARACTER')).toBeNull()
    expect(screen.queryByText(/用一句角色设定/u)).toBeNull()
    expect(screen.queryByText('AI 快捷创作')).toBeNull()
    expect(screen.queryByText('文字创建')).toBeNull()
    expect(screen.queryByText('角色图生成后仍需人工选择候选')).toBeNull()
  })

  it('cycles from the opening question into character-only role ideas', () => {
    vi.useFakeTimers()
    const entry = renderAt('/quick-start', serviceFor(null))
    const heading = screen.getByRole('heading', { name: '想做一个什么角色？' })
    const cycle = () => entry.container.querySelector<HTMLElement>('[data-copy-phase]')

    expect(heading.textContent).toBe('想做一个什么角色？')

    act(() => vi.advanceTimersByTime(2_399))
    expect(heading.textContent).toBe('想做一个什么角色？')

    act(() => vi.advanceTimersByTime(1))
    expect(cycle()?.dataset.copyPhase).toBe('exiting')

    act(() => vi.advanceTimersByTime(460))
    expect(cycle()?.dataset.copyPhase).toBe('entering')
    expect(heading.textContent).toBe('试试银色卷发、戴星形单片眼镜的裁缝')

    act(() => vi.advanceTimersByTime(4_200 * 8))
    expect(heading.textContent).toBe('试试银色卷发、戴星形单片眼镜的裁缝')
    expect(heading.textContent).not.toContain('想做一个什么角色？')
  })

  it('animates back to the persistent default heading while the user writes', () => {
    vi.useFakeTimers()
    const entry = renderAt('/quick-start', serviceFor(null))
    const heading = screen.getByRole('heading', { name: '想做一个什么角色？' })
    const cycle = () => entry.container.querySelector<HTMLElement>('[data-copy-phase]')

    act(() => vi.advanceTimersByTime(3_400))
    expect(heading.textContent).toContain('银色卷发、戴星形单片眼镜的裁缝')

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '戴银色面具的游侠' },
    })
    expect(cycle()?.dataset.copyMotionMode).toBe('characters')
    expect(cycle()?.dataset.copyPhase).toBe('exiting')

    act(() => vi.advanceTimersByTime(460))
    expect(cycle()?.dataset.copyPhase).toBe('entering')
    expect(heading.textContent).toBe('用文字塑造你的角色……')

    act(() => vi.advanceTimersByTime(10_000))
    expect(heading.textContent).toBe('用文字塑造你的角色……')
  })

  it('keeps style prompt space stable while dissolving the cards once creation begins', () => {
    const entry = renderAt('/quick-start', serviceFor(null))
    const entrySection = entry.getByLabelText('创作指令').closest('section')
    const starters = entrySection?.querySelector('[data-layout="quick-start-starters"]')

    expect(starters?.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByRole('button', { name: /16-bit 日式 RPG/u })).toBeTruthy()
    expect(screen.getByRole('button', { name: /暗黑哥特像素/u })).toBeTruthy()
    expect(screen.getByRole('button', { name: /温暖手绘像素/u })).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: '创作指令' }), {
      target: { value: '戴银色面具的游侠' },
    })
    expect(entrySection?.querySelector('[data-layout="quick-start-starters"]')).toBe(starters)
    expect(starters?.getAttribute('data-presence')).toBe('hidden')
    expect(starters?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('button', { name: /暗黑哥特像素/u })).toBeNull()
  })

  it('按当前 Run 完成度显示统一导出入口', async () => {
    const run = workflow(setupAndTemplate({ selectedImageUrl: '/master.png' }))
    const model: ExportPackageModel = {
      stage: 'character',
      characterId: 'character-1',
      characterName: '像素骑士',
      characterImageUrl: '/master.png',
      outfitId: 'outfit-1',
      outfitName: '默认造型',
      canvas: { width: 32, height: 40 },
      source: { workflowRunId: run.id, generationIds: [] },
      firstFrames: [],
      actions: [],
      playtest: null,
    }
    renderAt('/quick-start/run-1', serviceFor(run, { getExportModel: vi.fn(async () => model) }))

    expect(await screen.findByRole('button', { name: '导出角色母版' })).toBeTruthy()
  })

  it('keeps the entry and run canvases at least viewport height', async () => {
    const entry = renderAt('/quick-start', serviceFor(null))
    expect(entry.getByLabelText('创作指令').closest('section')?.className).toContain(
      'min-h-[100dvh]',
    )

    entry.unmount()
    const run = workflow(setupAndTemplate())
    const runView = renderAt('/quick-start/run-1', serviceFor(run))
    expect(
      (await runView.findByRole('heading', { name: '像素骑士' })).closest('section')?.className,
    ).toContain('min-h-screen')
  })

  it('keeps the natural-language creation entry visible when no run is selected', () => {
    render(
      <MemoryRouter>
        <QuickStartPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('textbox', { name: '创作指令' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /16-bit 日式 RPG/u }))
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      '16-bit 日式 RPG 像素风，清晰轮廓，明亮配色',
    )
    expect(screen.queryByRole('button', { name: /暗黑哥特像素/u })).toBeNull()
  })

  it('shows first-frame confirmation instead of stale character candidates after a template is confirmed', async () => {
    const run = actionWorkflow({ firstStatus: 'active', firstPhase: 'selecting' })
    const service = serviceFor(run, {
      getTemplateCandidates: vi.fn(async () => ['stale-template.png']),
      getFirstFrameCandidates: vi.fn(async () => [
        { index: 0, imageUrl: 'first-frame.png', durationMs: null },
      ]),
    })
    const view = renderAt('/quick-start/run-1', service)

    await waitFor(() => {
      expect(view.getByRole('heading', { name: '选择动作首帧' })).toBeTruthy()
    })
    const firstFrame = view.getByRole('img', { name: '动作首帧候选 1' })
    expect(firstFrame.getAttribute('loading')).toBe('eager')
    expect(firstFrame.getAttribute('decoding')).toBe('async')
    expect(firstFrame.getAttribute('fetchpriority')).toBe('high')
    expect(view.queryByRole('img', { name: '角色图候选 1' })).toBeNull()
  })

  it('submits both text and uploaded-template creation from the natural-language entry', async () => {
    const service = serviceFor(null)
    const view = renderAt('/quick-start', service)

    fireEvent.click(screen.getByRole('button', { name: /16-bit 日式 RPG/u }))
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    await waitFor(() =>
      expect(service.start).toHaveBeenCalledWith('16-bit 日式 RPG 像素风，清晰轮廓，明亮配色'),
    )
    expect(service.open).not.toHaveBeenCalled()

    view.unmount()
    renderAt('/quick-start', service)
    const file = new File(['pixels'], 'hero.png', { type: 'image/png' })
    fireEvent.click(screen.getByRole('button', { name: '添加母版' }))
    fireEvent.change(screen.getByLabelText('上传角色母版'), { target: { files: [file] } })
    expect(screen.getByText('hero.png')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('创作指令'), { target: { value: '挥手' } })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    await waitFor(() =>
      expect(service.startWithUploadedTemplate).toHaveBeenCalledWith(
        file,
        '挥手',
        expect.any(AbortSignal),
        false,
      ),
    )
  })

  it('offers the loop toggle beside the composer once an uploaded template gets a custom action', async () => {
    const service = serviceFor(null)
    renderAt('/quick-start', service)
    const file = new File(['pixels'], 'hero.png', { type: 'image/png' })

    fireEvent.change(screen.getByLabelText('创作指令'), { target: { value: '来回走动' } })
    expect(screen.queryByText(/循环播放/u)).toBeNull()

    fireEvent.change(screen.getByLabelText('上传角色母版'), { target: { files: [file] } })
    const loopCheckbox = await screen.findByRole('checkbox')
    fireEvent.click(loopCheckbox)
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))

    await waitFor(() =>
      expect(service.startWithUploadedTemplate).toHaveBeenCalledWith(
        file,
        '来回走动',
        expect.any(AbortSignal),
        true,
      ),
    )
  })

  it('hands the created session to the run page under the production StrictMode lifecycle', async () => {
    const service = serviceFor(null)
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/quick-start']}>
          <Routes>
            <Route path="/quick-start" element={<QuickStartPage service={service} />} />
            <Route path="/quick-start/:runId" element={<QuickStartPage service={service} />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    )

    fireEvent.change(screen.getByLabelText('创作指令'), { target: { value: '像素骑士' } })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))

    await waitFor(() => expect(service.resume).toHaveBeenCalled())
    expect(service.open).not.toHaveBeenCalled()
    expect(service.dispose).toHaveBeenCalled()
  })

  it('shows entry errors and supports removing an uploaded template', async () => {
    const service = serviceFor(null, {
      start: vi.fn(async () => Promise.reject(new Error('服务繁忙'))),
    })
    renderAt('/quick-start', service)
    const file = new File(['pixels'], 'hero.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('上传角色母版'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '移除图片' }))
    expect(screen.queryByText('hero.png')).toBeNull()
    fireEvent.change(screen.getByLabelText('创作指令'), { target: { value: '骑士' } })
    fireEvent.click(screen.getByRole('button', { name: '生成角色' }))
    expect((await screen.findByRole('alert')).textContent).toContain('服务繁忙')
  })

  it('keeps the uploaded template controls in the single-line composer', () => {
    renderAt('/quick-start', serviceFor(null))
    const file = new File(['pixels'], 'hero.png', { type: 'image/png' })

    fireEvent.change(screen.getByLabelText('上传角色母版'), { target: { files: [file] } })

    const composer = screen.getByLabelText('创作指令').closest('form')
    expect(composer?.textContent).toContain('hero.png')
    expect(screen.getByRole('button', { name: '移除图片' }).closest('form')).toBe(composer)
    expect(composer?.querySelector('[data-layout="quick-start-attachment-row"]')).toBeNull()
  })

  it('adds an action to an existing character and reports submission errors', async () => {
    const service = serviceFor(null)
    const view = renderAt('/quick-start?characterId=character-1&outfitId=outfit-1', service)
    fireEvent.change(screen.getByLabelText('动作描述'), { target: { value: '挥手' } })
    fireEvent.click(screen.getByRole('button', { name: '开始生成新动作' }))
    await waitFor(() =>
      expect(service.startAction).toHaveBeenCalledWith(
        { characterId: 'character-1', outfitId: 'outfit-1' },
        '挥手',
        false,
      ),
    )

    view.unmount()
    const failed = serviceFor(null, {
      startAction: vi.fn(async () => Promise.reject(new Error('动作创建失败'))),
    })
    renderAt('/quick-start?characterId=character-1&outfitId=outfit-1', failed)
    fireEvent.change(screen.getByLabelText('动作描述'), { target: { value: '挥手' } })
    fireEvent.click(screen.getByRole('button', { name: '开始生成新动作' }))
    expect((await screen.findByRole('alert')).textContent).toContain('动作创建失败')
  })

  it('blocks an empty action description and says what to type instead', async () => {
    // 空描述会被后端当成 custom 动作缺 custom_prompt 拒掉，回来的是一句
    // "请求参数校验失败"。这里断言用户根本走不到那一步。
    const service = serviceFor(null)
    renderAt('/quick-start?characterId=character-1&outfitId=outfit-1', service)

    const submit = screen.getByRole('button', { name: '开始生成新动作' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('请先描述动作，例如：来回踱步')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('动作描述'), { target: { value: '   ' } })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('请先描述动作，例如：来回踱步')).toBeTruthy()
    fireEvent.click(submit)
    fireEvent.submit(submit.closest('form')!)
    await waitFor(() => expect(service.startAction).not.toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('动作描述'), { target: { value: '来回踱步' } })
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText('请先描述动作，例如：来回踱步')).toBeNull()
    fireEvent.click(submit)
    await waitFor(() => expect(service.startAction).toHaveBeenCalledTimes(1))
  })

  it('only shows the loop checkbox for a custom action description, and sends the checked value', async () => {
    const service = serviceFor(null)
    renderAt('/quick-start?characterId=character-1&outfitId=outfit-1', service)

    fireEvent.change(screen.getByLabelText('动作描述'), { target: { value: '攻击' } })
    expect(screen.queryByText(/循环播放/u)).toBeNull()

    fireEvent.change(screen.getByLabelText('动作描述'), { target: { value: '来回走动' } })
    const loopCheckbox = await screen.findByRole('checkbox')
    expect((loopCheckbox as HTMLInputElement).checked).toBe(false)
    fireEvent.click(loopCheckbox)
    fireEvent.click(screen.getByRole('button', { name: '开始生成新动作' }))

    await waitFor(() =>
      expect(service.startAction).toHaveBeenCalledWith(
        { characterId: 'character-1', outfitId: 'outfit-1' },
        '来回走动',
        true,
      ),
    )
  })

  it('recovers missing runs and returns to the creation entry', async () => {
    const service = serviceFor(null)
    renderAt('/quick-start/missing', service)
    expect(await screen.findByRole('heading', { name: '无法恢复这次创作' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回快速开始' }))
    expect(screen.getByRole('textbox', { name: '创作指令' })).toBeTruthy()
  })

  it('opens a recoverable run once and accepts its session update', async () => {
    const run = workflow(setupAndTemplate())
    const service = serviceFor(run, {
      subscribe: vi.fn((listener) => {
        listener(run)
        return () => undefined
      }),
    })
    renderAt('/quick-start/run-1', service)
    await waitFor(() => expect(service.open).toHaveBeenCalledWith('run-1'))
    expect(service.resume).toHaveBeenCalledWith()
  })

  it('selects, confirms, and regenerates a character candidate', async () => {
    const run = workflow(setupAndTemplate())
    const service = serviceFor(run, {
      getTemplateCandidates: vi.fn(async () => ['https://example.test/candidate.png']),
      confirmCandidate: vi.fn(async () => Promise.reject(new Error('候选确认失败'))),
      start: vi.fn(async () => Promise.reject(new Error('重新生成失败'))),
    })
    renderAt('/quick-start/run-1', service)
    const candidate = await screen.findByRole('img', { name: '角色图候选 1' })
    fireEvent.click(candidate)
    fireEvent.change(screen.getByLabelText(/动作描述/u), { target: { value: '挥手' } })
    fireEvent.click(screen.getByRole('button', { name: '确认选择，继续下一步' }))
    await waitFor(() =>
      expect(service.confirmCandidate).toHaveBeenCalledWith(
        'https://example.test/candidate.png',
        '挥手',
        false,
      ),
    )
    expect((await screen.findByRole('alert')).textContent).toContain('候选确认失败')
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(service.start).toHaveBeenCalledWith('像素骑士'))
    expect((await screen.findByRole('alert')).textContent).toContain('重新生成失败')
    fireEvent.click(screen.getByRole('button', { name: '新建一次创作' }))
    expect(screen.getByRole('textbox', { name: '创作指令' })).toBeTruthy()
  })

  it('confirms a generated first frame before starting the full animation', async () => {
    const run = actionWorkflow({ firstStatus: 'active', firstPhase: 'selecting' })
    const service = serviceFor(run, {
      getFirstFrameCandidates: vi.fn(async () => [
        { index: 4, imageUrl: 'https://example.test/first.png', durationMs: 80 },
      ]),
      confirmFirstFrame: vi.fn(async () => Promise.reject(new Error('首帧确认失败'))),
    })
    renderAt('/quick-start/run-1', service)
    fireEvent.click(await screen.findByRole('img', { name: '动作首帧候选 1' }))
    fireEvent.click(screen.getByRole('button', { name: '确认首帧，生成完整动作' }))
    await waitFor(() =>
      expect(service.confirmFirstFrame).toHaveBeenCalledWith('https://example.test/first.png'),
    )
    expect((await screen.findByRole('alert')).textContent).toContain('首帧确认失败')
  })

  it('renders generating and failed states for both first-frame and full animation tasks', async () => {
    const states = [
      [actionWorkflow({ firstStatus: 'active', firstPhase: 'generating' }), '正在生成动作首帧'],
      [actionWorkflow({ firstStatus: 'failed', error: '首帧服务失败' }), '动作首帧生成失败'],
      [actionWorkflow({ fullStatus: 'active' }), '正在生成动作'],
      [actionWorkflow({ fullStatus: 'failed', error: '动作服务失败' }), '动作生成失败'],
    ] as const

    for (const [run, label] of states) {
      const view = renderAt('/quick-start/run-1', serviceFor(run))
      expect((await screen.findAllByText(label, { selector: 'b' })).length).toBeGreaterThan(0)
      view.unmount()
    }
  })

  it('automatically approves a completed animation and opens its Playtest action', async () => {
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'active' })
    const approved = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' })
    const service = serviceFor(run, {
      approveReview: vi.fn(async () => approved),
      getActionFrames: vi.fn(async () => [
        { index: 0, imageUrl: 'https://example.test/frame-0.png', durationMs: 80 },
        { index: 1, imageUrl: 'https://example.test/frame-1.png', durationMs: 80 },
      ]),
    })
    renderAt('/quick-start/run-1', service)
    expect(
      await screen.findByRole('heading', {
        name: '/playtest/character-1/outfit-1?actionId=action-full',
      }),
    ).toBeTruthy()
    expect(service.approveReview).toHaveBeenCalledWith()
  })

  it('keeps a completed run recoverable when its character binding is missing', async () => {
    const run = actionWorkflow({ fullStatus: 'passed', reviewStatus: 'active' })
    const service = serviceFor(run, {
      approveReview: vi.fn(async () =>
        actionWorkflow({ fullStatus: 'passed', reviewStatus: 'passed' }),
      ),
      getCharacterInfo: vi.fn(() => null),
      resolveCharacterInfo: vi.fn(async () => null),
      getActionFrames: vi.fn(async () => [
        { index: 0, imageUrl: 'https://example.test/frame.png', durationMs: 80 },
      ]),
    })
    renderAt('/quick-start/run-1', service)
    expect((await screen.findByRole('alert')).textContent).toContain('没有找到对应的角色资产')
    fireEvent.click(screen.getByRole('button', { name: '重新导入预览台' }))
    await waitFor(() => expect(service.approveReview).toHaveBeenCalledTimes(2))
  })

  it('interrupts an active run and surfaces interruption failures', async () => {
    const run = actionWorkflow({ fullStatus: 'active' })
    const service = serviceFor(run, {
      interrupt: vi.fn(async () => Promise.reject(new Error('无法中断'))),
    })
    renderAt('/quick-start/run-1', service)
    fireEvent.click(await screen.findByRole('button', { name: '中断自动制作' }))
    expect((await screen.findByRole('alert')).textContent).toContain('无法中断')
  })
})
// @vitest-environment jsdom
