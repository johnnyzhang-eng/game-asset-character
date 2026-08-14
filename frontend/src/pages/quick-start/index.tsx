import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { ArrowUp, ImageSquare, X } from '@phosphor-icons/react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import {
  type ActionFirstFrameWorkflowNode,
  type CharacterTemplateWorkflowNode,
  type WorkflowRun,
  type WorkflowNode,
  type WorkflowNodeType,
} from '@/entities'
import { ExportButton, type ExportPackageModel } from '@/features/export-package'
import { KineticCopyCycle, type KineticCopyMessage } from '@/shared/ui'
import {
  isCustomActionDescription,
  quickStartService,
  type QuickStartEntryService,
  type QuickStartFrame,
  type QuickStartSession,
} from './service'

export type {
  CreateQuickStartServiceOptions,
  PrepareQuickStartProject,
  QuickStartEntryService,
  QuickStartSession,
} from './service'

const STEP_LABELS: Record<WorkflowNodeType, string> = {
  'character-setup': '角色设定',
  'character-template': '角色图',
  'action-first-frame': '候选选择',
  'action-generation-method': '生成路线',
  'action-full-frame': '动作生成',
  review: '审核',
}

const STYLE_PROMPTS = [
  {
    title: '16-bit 日式 RPG',
    detail: '清晰轮廓 · 明亮配色',
    prompt: '16-bit 日式 RPG 像素风，清晰轮廓，明亮配色',
  },
  {
    title: '暗黑哥特像素',
    detail: '低饱和 · 强烈明暗',
    prompt: '暗黑哥特像素风，低饱和配色，强烈明暗对比',
  },
  {
    title: '温暖手绘像素',
    detail: '柔和色彩 · 纸张质感',
    prompt: '温暖手绘像素风，柔和配色，细腻纸张质感',
  },
] as const

const ROLE_IDEAS = [
  '银色卷发、戴星形单片眼镜的裁缝',
  '长着鹿角、披苔藓斗篷的邮差',
  '戴透明水母帽、穿蓝色雨衣的药剂师',
  '蓬松白胡子、背黄铜工具箱的机械师',
  '紫色短发、戴猫耳耳机的情报员',
  '披白羽斗篷、戴月牙面具的占星师',
  '红色双辫、穿宽大飞行夹克的小飞行员',
  '黑色卷发、戴珊瑚项链的海洋祭司',
] as const

const ROLE_IDEA_MESSAGES: readonly KineticCopyMessage[] = [
  { lines: ['想做一个什么角色？'], className: 'text-app-ink' },
  ...ROLE_IDEAS.map((idea) => ({
    prefix: '试试',
    prefixClassName:
      'mr-3 font-mono text-[10px] font-bold tracking-[0.14em] text-app-faint sm:text-[11px]',
    lines: [idea],
    className: 'text-app-accent',
  })),
]

const ROLE_DEFAULT_MESSAGE: readonly KineticCopyMessage[] = [
  { lines: ['用文字塑造你的角色……'], className: 'text-app-ink' },
]

function playtestPath(characterId: string, outfitId: string, actionId?: string): string {
  const path = `/playtest/${encodeURIComponent(characterId)}/${encodeURIComponent(outfitId)}`
  return actionId ? `${path}?${new URLSearchParams({ actionId })}` : path
}

export interface QuickStartPageProps {
  /**
   * 页面测试与外层组合可以注入同一份服务实例。
   * 未注入时，Quick Start 自己装配真实实体接口，避免 app 层承担流程细节。
   */
  service?: QuickStartEntryService
}

/** Quick Start 独立完成 AI 入口；它不跳转 Workflow Editor。 */
export function QuickStartPage({ service }: QuickStartPageProps) {
  const { runId } = useParams()
  const [searchParams] = useSearchParams()
  const activeService = useMemo(() => {
    return service ?? quickStartService
  }, [service])
  const [createdSession, setCreatedSession] = useState<QuickStartSession | null>(null)
  const characterId = searchParams.get('characterId')
  const outfitId = searchParams.get('outfitId')

  return runId ? (
    <QuickStartRun
      service={activeService}
      runId={runId}
      initialSession={createdSession?.runId === runId ? createdSession : null}
      onSessionCreated={setCreatedSession}
    />
  ) : characterId && outfitId ? (
    <QuickStartActionInput
      service={activeService}
      target={{ characterId, outfitId }}
      onSessionCreated={setCreatedSession}
    />
  ) : (
    <QuickStartInput service={activeService} onSessionCreated={setCreatedSession} />
  )
}

function QuickStartActionInput({
  service,
  target,
  onSessionCreated,
}: {
  service: QuickStartEntryService
  target: { characterId: string; outfitId: string }
  onSessionCreated: (session: QuickStartSession) => void
}) {
  const navigate = useNavigate()
  const [description, setDescription] = useState('')
  const [loop, setLoop] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 空描述会被后端当成 custom 动作缺 custom_prompt 拒掉，回来的是一句
  // "请求参数校验失败"；用户不该走到那一步，更不该只看到一个变灰的按钮。
  const missingDescription = !description.trim()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = description.trim()
    if (!prompt || submitting || service.unavailableReason) return
    setSubmitting(true)
    setError(null)
    try {
      const session = await service.startAction(target, prompt, loop)
      onSessionCreated(session)
      navigate(`/quick-start/${encodeURIComponent(session.runId)}`)
    } catch (cause) {
      setError(errorMessage(cause, '创建动作失败，请稍后重试'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="min-h-[560px] border border-app-line bg-app-canvas p-6 text-app-ink sm:p-10">
      <Link
        to={playtestPath(target.characterId, target.outfitId)}
        className="text-xs font-semibold text-app-muted hover:text-app-accent"
      >
        ← 返回当前预览台
      </Link>
      <div className="mx-auto mt-14 max-w-2xl">
        <p className="font-mono text-[10px] font-bold text-app-muted">ADD ACTION</p>
        <h1 className="mt-3 font-serif text-4xl">给当前角色增加动作</h1>
        <p className="mt-3 text-sm text-app-muted">
          新动作会追加到角色 {target.characterId} 的当前造型，不会新建角色或覆盖已有动作。
        </p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block text-xs font-semibold text-app-ink-soft">
            动作描述
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="例如：挥手打招呼、蹲下查看地面、举起画笔作画"
              aria-describedby={missingDescription ? 'quick-start-action-hint' : undefined}
              className="mt-2 min-h-32 w-full resize-y rounded-lg border border-app-line-strong bg-app-surface-raised p-4 text-base outline-none focus:border-app-accent"
            />
          </label>
          {missingDescription ? (
            <p id="quick-start-action-hint" className="text-sm text-app-muted">
              请先描述动作，例如：来回踱步
            </p>
          ) : null}
          {isCustomActionDescription(description) ? (
            <label className="flex items-start gap-2 text-xs text-app-muted">
              <input
                type="checkbox"
                checked={loop}
                onChange={(event) => setLoop(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                循环播放——走路、待机这类能无缝反复播的动作勾选；攻击、跳跃这类只做一次的不要勾
              </span>
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-app-danger">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={missingDescription || submitting || Boolean(service.unavailableReason)}
            className="min-h-11 rounded-lg bg-app-accent px-5 text-sm font-semibold text-app-on-accent disabled:opacity-50"
          >
            {submitting ? '正在开始生成…' : '开始生成新动作'}
          </button>
        </form>
      </div>
    </section>
  )
}

function QuickStartInput({
  service,
  onSessionCreated,
}: {
  service: QuickStartEntryService
  onSessionCreated: (session: QuickStartSession) => void
}) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [actionLoop, setActionLoop] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const submitAbortController = useRef<AbortController | null>(null)
  const unavailableReason = service.unavailableReason
  const hasPrompt = Boolean(prompt.trim())
  const showStylePrompts = !hasPrompt && !templateFile

  useEffect(
    () => () => {
      submitAbortController.current?.abort()
    },
    [],
  )

  function selectTemplateFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    setTemplateFile(selected)
    setError(null)
  }

  function removeTemplateFile() {
    setTemplateFile(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedPrompt = prompt.trim()
    if ((!normalizedPrompt && !templateFile) || submitting || unavailableReason) return

    const abortController = new AbortController()
    submitAbortController.current = abortController
    setSubmitting(true)
    setError(null)
    try {
      const session = templateFile
        ? await service.startWithUploadedTemplate(
            templateFile,
            normalizedPrompt,
            abortController.signal,
            actionLoop,
          )
        : await service.start(normalizedPrompt)
      onSessionCreated(session)
      navigate(`/quick-start/${encodeURIComponent(session.runId)}`)
    } catch (cause) {
      if (!abortController.signal.aborted) {
        setError(errorMessage(cause, '创建失败，请稍后重试'))
      }
    } finally {
      if (submitAbortController.current === abortController) {
        submitAbortController.current = null
        if (!abortController.signal.aborted) setSubmitting(false)
      }
    }
  }

  return (
    <section className="relative min-h-[100dvh] overflow-hidden border border-app-line bg-app-canvas pt-14 text-app-ink shadow-app-page">
      <AmbientGrid />

      <div
        data-layout="quick-start-entry"
        className="relative z-10 grid min-h-[calc(100dvh-3.5rem)] grid-rows-[1fr_auto] gap-6 px-5 py-6 sm:px-8 sm:pb-8 sm:pt-10"
      >
        <div className="mx-auto grid w-full max-w-3xl content-center gap-5 pb-8 sm:gap-6">
          <KineticCopyCycle
            active={!templateFile && !submitting}
            as="h1"
            ariaLabel="想做一个什么角色？"
            motionMode="characters"
            firstCycleMs={2_400}
            loopStartIndex={1}
            messages={hasPrompt ? ROLE_DEFAULT_MESSAGE : ROLE_IDEA_MESSAGES}
            className="min-h-12 text-center font-serif text-[clamp(1.75rem,4vw,2.65rem)] leading-none font-medium tracking-[-0.045em]"
          />

          <div
            data-layout="quick-start-starters"
            data-presence={showStylePrompts ? 'visible' : 'hidden'}
            aria-hidden={!showStylePrompts}
            className={`grid gap-2 transition-[opacity,transform,filter] duration-[460ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none sm:grid-cols-3 ${
              showStylePrompts
                ? 'translate-y-0 scale-100 opacity-100 blur-0'
                : 'pointer-events-none -translate-y-2 scale-[0.985] opacity-0 blur-[6px]'
            }`}
          >
            {STYLE_PROMPTS.map((stylePrompt) => (
              <button
                key={stylePrompt.title}
                type="button"
                disabled={!showStylePrompts}
                aria-label={`${stylePrompt.title}：${stylePrompt.detail}`}
                onClick={() => setPrompt(stylePrompt.prompt)}
                className="group grid min-h-16 content-center gap-1 rounded-xl border border-app-line bg-app-surface/70 px-4 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-app-line-strong hover:bg-app-surface-raised hover:shadow-app-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent motion-reduce:transform-none"
              >
                <strong className="text-sm font-semibold text-app-ink">{stylePrompt.title}</strong>
                <span className="text-[11px] text-app-muted">{stylePrompt.detail}</span>
              </button>
            ))}
          </div>
        </div>

        <div data-layout="quick-start-composer" className="mx-auto w-full max-w-3xl self-end">
          <form
            onSubmit={(event) => void submit(event)}
            className="grid items-center gap-1.5 rounded-xl border border-app-line-strong bg-app-surface-raised p-1.5 shadow-app-panel transition-shadow focus-within:border-app-accent focus-within:shadow-[var(--shadow-app-composer-focus)] sm:grid-cols-[1fr_auto_auto]"
          >
            <label className="min-w-0" htmlFor="quick-start-prompt">
              <span className="sr-only">创作指令</span>
              <input
                id="quick-start-prompt"
                type="text"
                aria-label="创作指令"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  templateFile ? '描述动作，可留空生成待机动作…' : '描述角色的外形、身份和气质…'
                }
                className="h-10 w-full min-w-0 border-0 bg-transparent px-3 text-[15px] text-app-ink outline-none placeholder:text-app-faint"
              />
            </label>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              aria-label="上传角色母版"
              className="sr-only"
              onChange={selectTemplateFile}
            />
            {templateFile ? (
              <span className="flex h-10 min-w-0 max-w-56 items-center rounded-lg bg-app-surface-muted text-xs text-app-ink-soft">
                <button
                  type="button"
                  aria-label={`更换母版 ${templateFile.name}`}
                  onClick={() => fileInput.current?.click()}
                  className="inline-flex h-full min-w-0 items-center gap-2 rounded-l-lg px-2.5 font-semibold transition hover:bg-app-surface hover:text-app-accent focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
                >
                  <ImageSquare aria-hidden="true" size={16} weight="duotone" />
                  <span className="max-w-32 truncate">{templateFile.name}</span>
                </button>
                <button
                  type="button"
                  aria-label="移除图片"
                  onClick={removeTemplateFile}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-app-muted transition hover:bg-app-surface hover:text-app-accent focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
                >
                  <X aria-hidden="true" size={14} weight="bold" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-semibold whitespace-nowrap text-app-muted transition hover:bg-app-surface-muted hover:text-app-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-app-accent"
              >
                <ImageSquare aria-hidden="true" size={17} weight="duotone" />
                添加母版
              </button>
            )}
            <button
              type="submit"
              disabled={
                (!prompt.trim() && !templateFile) || submitting || Boolean(unavailableReason)
              }
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-app-accent px-4 text-sm font-bold whitespace-nowrap text-app-on-accent transition hover:bg-app-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? '正在创建…' : '生成角色'}
              {!submitting ? <ArrowUp aria-hidden="true" size={16} weight="bold" /> : null}
            </button>
          </form>

          {templateFile && isCustomActionDescription(prompt) ? (
            <label className="mt-3 flex items-start gap-2 px-1 text-[11px] text-app-muted">
              <input
                type="checkbox"
                checked={actionLoop}
                onChange={(event) => setActionLoop(event.target.checked)}
                className="mt-0.5"
              />
              <span>循环播放：走路/待机这类可无缝重复的勾选；攻击/跳跃这类做一次的不要勾</span>
            </label>
          ) : null}
          {unavailableReason ? (
            <p className="mt-3 rounded-xl border border-app-warning-line bg-app-warning-soft px-4 py-3 text-sm text-app-warning">
              {unavailableReason}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-app-danger px-4 py-3 text-sm text-app-danger-soft"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function QuickStartRun({
  service,
  runId,
  initialSession,
  onSessionCreated,
}: {
  service: QuickStartEntryService
  runId: string
  initialSession: QuickStartSession | null
  onSessionCreated: (session: QuickStartSession) => void
}) {
  const navigate = useNavigate()
  const [session, setSession] = useState<QuickStartSession | null>(null)
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [selectedFirstFrame, setSelectedFirstFrame] = useState<string | null>(null)
  const [actionDescription, setActionDescription] = useState('')
  const [actionLoop, setActionLoop] = useState(false)
  const [candidates, setCandidates] = useState<readonly string[]>([])
  const [firstFrameCandidates, setFirstFrameCandidates] = useState<readonly QuickStartFrame[]>([])
  const [actionFrames, setActionFrames] = useState<readonly QuickStartFrame[]>([])
  const [exportModel, setExportModel] = useState<ExportPackageModel | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [confirmingCandidate, setConfirmingCandidate] = useState(false)
  const [confirmingFirstFrame, setConfirmingFirstFrame] = useState(false)
  const automaticPublishAttempt = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    let currentSession: QuickStartSession | null = null
    let unsubscribe: () => void = () => undefined
    setRestoring(true)
    setSession(null)
    setRun(null)

    void (async () => {
      const nextSession = initialSession ?? (await service.open(runId))
      if (!active) {
        nextSession.dispose()
        return
      }
      currentSession = nextSession
      setSession(nextSession)
      setRun(nextSession.getWorkflow())
      unsubscribe = nextSession.subscribe((updated) => {
        if (active) {
          setRun(updated)
          setError(null)
        }
      })
      setRun(await nextSession.resume())
      if (active) {
        setError(null)
        setRestoring(false)
      }
    })().catch((cause) => {
      if (active) {
        setError(errorMessage(cause, '恢复生成任务失败'))
        setRestoring(false)
      }
    })

    return () => {
      active = false
      unsubscribe()
      currentSession?.dispose()
    }
  }, [initialSession, runId, service])

  useEffect(() => {
    if (!run || !session) {
      setCandidates([])
      setFirstFrameCandidates([])
      setActionFrames([])
      setExportModel(null)
      return
    }
    let active = true
    void Promise.all([
      session.getTemplateCandidates(),
      session.getFirstFrameCandidates(),
      session.getActionFrames(),
      session.getExportModel(),
    ])
      .then(([nextCandidates, nextFirstFrameCandidates, nextFrames, nextExportModel]) => {
        if (!active) return
        setCandidates(nextCandidates)
        setFirstFrameCandidates(nextFirstFrameCandidates)
        setActionFrames(nextFrames)
        setExportModel(nextExportModel)
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause, '读取生成结果失败'))
      })
    return () => {
      active = false
    }
  }, [run, session])

  const publishToPlaytest = useCallback(async () => {
    if (publishing || !session) return
    setPublishing(true)
    setError(null)
    try {
      const approved = await session.approveReview()
      setRun(approved)
      const info = session.getCharacterInfo() ?? (await session.resolveCharacterInfo())
      if (!info) throw new Error('动作已生成，但没有找到对应的角色资产')
      const approvedAction = latestActionStep(approved)
      const actionId = approvedAction?.type === 'action-full-frame' ? approvedAction.id : undefined
      navigate(playtestPath(info.characterId, info.outfitId, actionId))
    } catch (cause) {
      setError(errorMessage(cause, '导入预览台失败'))
    } finally {
      setPublishing(false)
    }
  }, [navigate, publishing, session])

  useEffect(() => {
    const publishKey = run ? automaticPublishKey(run) : null
    if (publishKey === null || publishing || automaticPublishAttempt.current === publishKey) return

    // 每个版本只自动尝试一次；失败后由页面保留的重试按钮交给用户明确触发。
    automaticPublishAttempt.current = publishKey
    void publishToPlaytest()
  }, [publishToPlaytest, publishing, run])

  if (!run) {
    return (
      <section className="min-h-[520px] rounded-[2rem] border border-app-line bg-app-canvas p-8 text-app-ink">
        <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-app-muted">
          QUICK START / RECOVERY
        </p>
        <h1 className="mt-4 font-serif text-4xl">
          {restoring ? '正在恢复这次创作' : '无法恢复这次创作'}
        </h1>
        {restoring ? (
          <p className="mt-4 max-w-xl text-sm leading-7 text-app-muted">正在读取工作流状态…</p>
        ) : (
          <>
            <p role="alert" className="mt-4 max-w-xl text-sm leading-7 text-app-muted">
              {error || `没有找到运行记录 ${runId}`}
            </p>
            <button
              type="button"
              onClick={() => navigate('/quick-start')}
              className="mt-8 rounded-xl bg-app-accent px-5 py-3 text-sm font-semibold text-app-on-accent"
            >
              返回快速开始
            </button>
          </>
        )}
      </section>
    )
  }

  const revision = run
  const status = describeRun(run, revision)
  const passedCount = revision.nodes.filter((node) => node.status === 'passed').length

  const actionStep = latestActionStep(revision)
  const firstFrameStep = latestActionFirstFrame(revision)
  const templateStep = revision.nodes.find(
    (node): node is CharacterTemplateWorkflowNode => node.type === 'character-template',
  )
  const reviewStep = actionStep ? pairedReviewStep(revision, actionStep.id) : null
  const canPublish =
    actionFrames.length > 0 && (reviewStep?.status === 'active' || reviewStep?.status === 'passed')
  const isActionActive = actionStep?.status === 'active'
  const isActionFailed = actionStep?.status === 'failed'
  const isTemplateSelecting =
    templateStep?.status === 'active' && templateStep.phase === 'selecting'
  const isFirstFrameSelecting =
    firstFrameStep?.status === 'active' && firstFrameStep.phase === 'selecting'
  const isFirstFrameGenerating =
    firstFrameStep?.status === 'active' && firstFrameStep.phase === 'generating'
  const isFirstFrameFailed = firstFrameStep?.status === 'failed'

  async function interrupt() {
    try {
      if (!session) return
      setRun(await session.interrupt())
    } catch (cause) {
      setError(errorMessage(cause, '中断自动制作失败'))
    }
  }

  async function confirmSelection() {
    if (!selectedCandidate || confirmingCandidate) return
    setConfirmingCandidate(true)
    setError(null)
    try {
      if (!session) return
      const updated = await session.confirmCandidate(
        selectedCandidate,
        actionDescription,
        actionLoop,
      )
      setRun(updated)
      setSelectedCandidate(null)
      setActionDescription('')
      setActionLoop(false)
    } catch (cause) {
      setError(errorMessage(cause, '确认选择失败'))
    } finally {
      setConfirmingCandidate(false)
    }
  }

  async function confirmFirstFrame() {
    if (!selectedFirstFrame || confirmingFirstFrame) return
    setConfirmingFirstFrame(true)
    setError(null)
    try {
      if (!session) return
      const updated = await session.confirmFirstFrame(selectedFirstFrame)
      setRun(updated)
      setSelectedFirstFrame(null)
    } catch (cause) {
      setError(errorMessage(cause, '确认动作首帧失败'))
    } finally {
      setConfirmingFirstFrame(false)
    }
  }

  async function regenerate() {
    if (!run) return
    const prompt = workflowPrompt(run)
    if (!prompt) return
    try {
      const newSession = await service.start(prompt)
      onSessionCreated(newSession)
      navigate(`/quick-start/${encodeURIComponent(newSession.runId)}`)
    } catch (cause) {
      setError(errorMessage(cause, '重新生成失败'))
    }
  }

  return (
    <section className="relative min-h-screen overflow-hidden border border-app-line bg-app-canvas text-app-ink shadow-app-page">
      <AmbientGrid />
      <div className="relative z-10 grid min-h-screen grid-rows-[auto_1fr_auto] gap-6 p-5 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-app-muted">
              QUICK START / RUN {run.id}
            </p>
            <h1 className="mt-2 font-serif text-3xl tracking-[-0.03em] sm:text-4xl">
              {workflowPrompt(run) || '未命名角色创作'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {exportModel ? (
              <ExportButton
                model={exportModel}
                className="border-app-accent bg-app-accent text-app-on-accent hover:bg-app-accent-hover"
              />
            ) : null}
            <div
              className="flex items-center gap-3 rounded-xl border border-app-line bg-app-surface-raised/90 px-4 py-3"
              aria-live="polite"
            >
              <i
                className={`h-2.5 w-2.5 rounded-full ${
                  workflowIsActive(run) ? 'animate-pulse bg-app-accent' : 'bg-app-faint'
                } motion-reduce:animate-none`}
                aria-hidden="true"
              />
              <span>
                <small className="block font-mono text-[8px] tracking-[0.12em] text-app-faint">
                  CURRENT STATUS
                </small>
                <b className="text-sm text-app-accent">{status.title}</b>
              </span>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="grid min-h-[340px] place-items-center overflow-hidden rounded-[1.4rem] border border-app-line bg-app-surface/90 p-5">
            {actionFrames.length > 0 ? (
              <div className="grid w-full grid-cols-4 gap-2 sm:grid-cols-8">
                {actionFrames.map((frame, index) => (
                  <img
                    key={`${frame.imageUrl}:${index}`}
                    src={frame.imageUrl}
                    alt={`动作第 ${index + 1} 帧`}
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full border border-app-line bg-app-surface-muted object-contain [image-rendering:pixelated]"
                  />
                ))}
              </div>
            ) : isActionActive ? (
              <div className="grid place-items-center gap-5 text-center">
                <div className="relative grid h-44 w-44 place-items-center rounded-[1.4rem] border border-dashed border-app-line-strong bg-app-surface-muted">
                  <i className="h-12 w-12 animate-pulse rounded-full border border-app-line-strong bg-app-accent-soft shadow-app-pulse motion-reduce:animate-none" />
                </div>
                <span>
                  <b className="block text-base text-app-ink-soft">正在生成动作</b>
                  <small className="mt-2 block max-w-md leading-6 text-app-muted">
                    正在生成动作帧，请稍候…
                  </small>
                </span>
              </div>
            ) : isActionFailed ? (
              <div className="grid place-items-center gap-5 text-center">
                <b className="text-base text-app-danger">动作生成失败</b>
                <small className="max-w-md leading-6 text-app-muted">
                  {typeof actionStep?.error === 'string' ? actionStep.error : '动作生成失败'}
                </small>
              </div>
            ) : isFirstFrameSelecting && firstFrameCandidates.length ? (
              <div className="grid w-full gap-4">
                <div className="mx-auto max-w-xl text-center">
                  <h2 className="text-lg font-semibold text-app-ink-soft">选择动作首帧</h2>
                  <p className="mt-2 text-sm leading-6 text-app-muted">
                    确认首帧后，系统会自动使用视频裁剪路线生成 32 帧完整动作。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {firstFrameCandidates.map((frame, index) => (
                    <button
                      key={`${frame.imageUrl}:${index}`}
                      type="button"
                      onClick={() => setSelectedFirstFrame(frame.imageUrl)}
                      className={`overflow-hidden rounded-xl border-2 p-2 text-left transition ${
                        selectedFirstFrame === frame.imageUrl
                          ? 'border-app-accent bg-app-accent-soft'
                          : 'border-app-line bg-app-surface-muted hover:border-app-line-strong'
                      }`}
                    >
                      <img
                        src={frame.imageUrl}
                        alt={`动作首帧候选 ${index + 1}`}
                        loading="eager"
                        decoding="async"
                        fetchPriority={index === 0 ? 'high' : 'auto'}
                        className="aspect-square w-full object-contain [image-rendering:pixelated]"
                      />
                      <p className="mt-2 font-mono text-[9px] tracking-[0.1em] text-app-muted">
                        FIRST FRAME {String(index + 1).padStart(2, '0')}
                      </p>
                    </button>
                  ))}
                </div>
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => void confirmFirstFrame()}
                    disabled={!selectedFirstFrame || confirmingFirstFrame}
                    className="rounded-xl bg-app-accent px-6 py-3 text-sm font-bold text-app-on-accent transition hover:bg-app-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {confirmingFirstFrame ? '正在确认…' : '确认首帧，生成完整动作'}
                  </button>
                </div>
              </div>
            ) : isFirstFrameGenerating ? (
              <div className="grid place-items-center gap-5 text-center">
                <div className="relative grid h-44 w-44 place-items-center rounded-[1.4rem] border border-dashed border-app-line-strong bg-app-surface-muted">
                  <i className="h-12 w-12 animate-pulse rounded-full border border-app-line-strong bg-app-accent-soft shadow-app-pulse motion-reduce:animate-none" />
                </div>
                <span>
                  <b className="block text-base text-app-ink-soft">正在生成动作首帧</b>
                  <small className="mt-2 block max-w-md leading-6 text-app-muted">
                    首帧就绪后，需要确认一次，再自动生成 32 帧完整动作。
                  </small>
                </span>
              </div>
            ) : isFirstFrameFailed ? (
              <div className="grid place-items-center gap-5 text-center">
                <b className="text-base text-app-danger">动作首帧生成失败</b>
                <small className="max-w-md leading-6 text-app-muted">
                  {typeof firstFrameStep?.error === 'string'
                    ? firstFrameStep.error
                    : '动作首帧生成失败'}
                </small>
              </div>
            ) : isTemplateSelecting && candidates.length ? (
              <div className="grid w-full gap-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {candidates.map((candidateUrl, index) => (
                    <button
                      key={`${candidateUrl}:${index}`}
                      type="button"
                      onClick={() => setSelectedCandidate(candidateUrl)}
                      className={`overflow-hidden rounded-xl border-2 p-2 text-left transition ${
                        selectedCandidate === candidateUrl
                          ? 'border-app-accent bg-app-accent-soft'
                          : 'border-app-line bg-app-surface-muted hover:border-app-line-strong'
                      }`}
                    >
                      <img
                        src={candidateUrl}
                        alt={`角色图候选 ${index + 1}`}
                        loading="eager"
                        decoding="async"
                        fetchPriority={index === 0 ? 'high' : 'auto'}
                        className="aspect-square w-full object-contain [image-rendering:pixelated]"
                      />
                      <p className="mt-2 font-mono text-[9px] tracking-[0.1em] text-app-muted">
                        CANDIDATE {String(index + 1).padStart(2, '0')}
                      </p>
                    </button>
                  ))}
                </div>
                <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
                  <label className="grid gap-1.5" htmlFor="quick-start-action-description">
                    <span className="text-[11px] font-semibold text-app-ink-soft">
                      动作描述（可选，留空生成待机动作）
                    </span>
                    <input
                      id="quick-start-action-description"
                      value={actionDescription}
                      onChange={(event) => setActionDescription(event.target.value)}
                      placeholder="例如：在画板上画画、挥舞灯笼、扫地…"
                      className="rounded-xl border border-app-line bg-app-surface-raised px-4 py-2.5 text-sm text-app-ink outline-none placeholder:text-app-faint focus:border-app-line-strong"
                    />
                  </label>
                  {isCustomActionDescription(actionDescription) ? (
                    <label className="flex items-start gap-2 text-xs text-app-muted">
                      <input
                        type="checkbox"
                        checked={actionLoop}
                        onChange={(event) => setActionLoop(event.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        循环播放——走路、待机这类能无缝反复播的动作勾选；攻击、跳跃这类只做一次的不要勾
                      </span>
                    </label>
                  ) : null}
                  <div className="flex justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => void regenerate()}
                      className="rounded-xl border border-app-line-strong px-5 py-3 text-sm font-semibold text-app-ink-soft transition hover:border-app-line-strong"
                    >
                      重新生成
                    </button>
                    {selectedCandidate ? (
                      <button
                        type="button"
                        onClick={() => void confirmSelection()}
                        disabled={confirmingCandidate}
                        className="rounded-xl bg-app-accent px-6 py-3 text-sm font-bold text-app-on-accent transition hover:bg-app-accent-hover"
                      >
                        {confirmingCandidate ? '正在提交…' : '确认选择，继续下一步'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid place-items-center gap-5 text-center">
                <div className="relative grid h-44 w-44 place-items-center rounded-[1.4rem] border border-dashed border-app-line-strong bg-app-surface-muted">
                  <i className="h-12 w-12 animate-pulse rounded-full border border-app-line-strong bg-app-accent-soft shadow-app-pulse motion-reduce:animate-none" />
                </div>
                <span>
                  <b className="block text-base text-app-ink-soft">{status.title}</b>
                  <small className="mt-2 block max-w-md leading-6 text-app-muted">
                    {status.description}
                  </small>
                </span>
              </div>
            )}
          </section>

          <aside className="rounded-[1.4rem] border border-app-line bg-app-surface-raised/95 p-5">
            <p className="font-mono text-[9px] font-bold tracking-[0.13em] text-app-faint">
              WORKFLOW RUN
            </p>
            <h2 className="mt-2 text-lg font-semibold">制作进度</h2>
            <p className="mt-2 text-xs leading-6 text-app-muted">
              Quick Start 隐藏节点操作，但每一步仍写入同一条 WorkflowRun。
            </p>

            <ol className="mt-5 grid gap-2">
              {revision.nodes.map((node, index) => (
                <li
                  key={node.id}
                  className={`grid grid-cols-[28px_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2 ${
                    node.status === 'active'
                      ? 'border-app-line-strong bg-app-accent-muted'
                      : 'border-app-line bg-app-surface'
                  }`}
                >
                  <i
                    className={`grid h-7 w-7 place-items-center rounded-full text-[9px] not-italic ${
                      node.status === 'passed'
                        ? 'bg-app-accent text-app-on-accent'
                        : node.status === 'active'
                          ? 'border border-app-accent text-app-accent'
                          : 'border border-app-line text-app-faint'
                    }`}
                  >
                    {node.status === 'passed' ? '✓' : String(index + 1).padStart(2, '0')}
                  </i>
                  <span className="text-xs font-semibold text-app-ink-soft">
                    {STEP_LABELS[node.type]}
                  </span>
                  <small className="text-[9px] text-app-faint">{nodeStatusLabel(node)}</small>
                </li>
              ))}
            </ol>
          </aside>
        </div>

        <footer className="rounded-[1.3rem] border border-app-line bg-app-surface-raised/95 p-4 shadow-app-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span>
              <small className="font-mono text-[8px] tracking-[0.12em] text-app-faint">
                {passedCount} / {revision.nodes.length} STEPS PASSED
              </small>
              <b className="mt-1 block text-sm text-app-ink-soft">{status.title}</b>
            </span>
            <div className="flex flex-wrap gap-2">
              {workflowIsActive(run) ? (
                <button
                  type="button"
                  onClick={() => void interrupt()}
                  className="rounded-xl border border-app-line-strong px-4 py-2 text-xs font-semibold text-app-ink-soft"
                >
                  中断自动制作
                </button>
              ) : null}
              {canPublish && (publishing || error) ? (
                <button
                  type="button"
                  onClick={() => void publishToPlaytest()}
                  disabled={publishing}
                  className="rounded-lg bg-app-info px-4 py-2 text-xs font-bold text-app-on-accent transition hover:bg-app-info-hover disabled:cursor-wait disabled:opacity-60"
                >
                  {publishing ? '正在自动导入…' : '重新导入预览台'}
                </button>
              ) : null}
              {candidates.length || workflowHasFailure(run) ? (
                <button
                  type="button"
                  onClick={() => navigate('/quick-start')}
                  className="rounded-xl bg-app-accent px-4 py-2 text-xs font-semibold text-app-on-accent"
                >
                  新建一次创作
                </button>
              ) : null}
            </div>
          </div>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-app-danger">
              {error}
            </p>
          ) : null}
          {status.error ? (
            <p role="alert" className="mt-3 text-sm text-app-danger">
              {status.error}
            </p>
          ) : null}
        </footer>
      </div>
    </section>
  )
}

function AmbientGrid() {
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-50"
      aria-hidden="true"
      style={{
        backgroundImage:
          'linear-gradient(color-mix(in srgb, var(--color-app-accent) 4.5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-app-accent) 4.5%, transparent) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        maskImage: 'linear-gradient(to bottom, black, transparent 84%)',
      }}
    />
  )
}

function describeRun(_run: WorkflowRun, workflow: WorkflowRun) {
  const failedStep = workflow.nodes.find((node) => node.status === 'failed' && !node.deletedAt)
  if (failedStep) {
    return {
      title: '生成失败',
      description: '这次失败已保存在当前运行记录中，不会自动创建第二次任务。',
      error: failedStep?.error || '角色图生成失败',
    }
  }

  const actionStep = latestActionStep(workflow)
  if (actionStep?.status === 'active') {
    return {
      title: '正在生成动作',
      description: '角色图已确认，正在生成动作帧…',
      error: null,
    }
  }
  if (actionStep?.status === 'passed') {
    return {
      title: '动作生成完成',
      description: '动作帧已回传，正在自动写入并载入预览台。',
      error: null,
    }
  }
  if (actionStep?.status === 'failed') {
    return {
      title: '动作生成失败',
      description: typeof actionStep.error === 'string' ? actionStep.error : '动作生成失败',
      error: typeof actionStep.error === 'string' ? actionStep.error : '动作生成失败',
    }
  }

  const firstFrameStep = latestActionFirstFrame(workflow)
  if (firstFrameStep?.status === 'active' && firstFrameStep.phase === 'generating') {
    return {
      title: '正在生成动作首帧',
      description: '首帧生成完成后，请确认一张帧图，再自动生成完整动作。',
      error: null,
    }
  }
  if (firstFrameStep?.status === 'active' && firstFrameStep.phase === 'selecting') {
    return {
      title: '请选择动作首帧',
      description: '确认首帧后，将自动提交视频裁剪路线的 32 帧完整动作生成。',
      error: null,
    }
  }

  const templateNode = workflow.nodes.find(
    (n): n is CharacterTemplateWorkflowNode => n.type === 'character-template',
  )
  if (templateNode?.status === 'active') {
    return {
      title: templateNode.generations.length > 0 ? '正在生成角色图' : '正在创建生成任务',
      description:
        templateNode.generations.length > 0
          ? '任务 ID 已保存，刷新页面后仍可恢复同一次生成。'
          : '正在等待生成服务返回可追踪的任务 ID。',
      error: null,
    }
  }

  return {
    title: '正在理解角色设定',
    description: '正在把创作指令整理成角色资料。',
    error: null,
  }
}

/** 只有完整动作和可审核状态同时具备时，才允许自动发布当前版本。 */
function automaticPublishKey(run: WorkflowRun): string | null {
  const actionStep = latestActionStep(run)
  const reviewStep = actionStep ? pairedReviewStep(run, actionStep.id) : null
  const hasFrames = actionStep?.type === 'action-full-frame' && actionStep.status === 'passed'
  const reviewReady = reviewStep?.status === 'active' || reviewStep?.status === 'passed'

  return hasFrames && reviewReady && actionStep ? `${run.id}:${actionStep.id}` : null
}

function workflowPrompt(run: WorkflowRun): string {
  const setup = run.nodes.find((node) => node.type === 'character-setup')
  return setup?.type === 'character-setup' ? setup.input.prompt : ''
}

function workflowHasFailure(run: WorkflowRun): boolean {
  return run.nodes.some((node) => !node.deletedAt && node.status === 'failed')
}

function workflowIsActive(run: WorkflowRun): boolean {
  return (
    run.nodes.some((node) => !node.deletedAt && node.status === 'active') &&
    !workflowHasFailure(run)
  )
}

/** 返回当前 Run 最后追加且未删除的动作；旧动作只保留作历史结果。 */
function latestActionStep(workflow: WorkflowRun) {
  return (
    workflow.nodes.findLast((node) => node.type === 'action-full-frame' && !node.deletedAt) ?? null
  )
}

/** 每条 Action 分支都有一张首帧节点；页面只操作最新且未归档的一条。 */
function latestActionFirstFrame(workflow: WorkflowRun): ActionFirstFrameWorkflowNode | null {
  return (
    workflow.nodes.findLast(
      (node): node is ActionFirstFrameWorkflowNode =>
        node.type === 'action-first-frame' && !node.deletedAt,
    ) ?? null
  )
}

/** 动作与依赖它的审核组成一对；数组顺序不属于工作流图契约。 */
function pairedReviewStep(workflow: WorkflowRun, actionStepId: string) {
  return (
    workflow.nodes.find(
      (node) =>
        node.type === 'review' && !node.deletedAt && node.dependsOnNodeIds.includes(actionStepId),
    ) ?? null
  )
}

function nodeStatusLabel(node: WorkflowNode) {
  if (node.deletedAt) return '已删除'
  if (node.status === 'passed') return '完成'
  if (node.status === 'active') return '当前'
  if (node.status === 'failed') return '失败'
  return '等待'
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message.trim() ? cause.message.trim() : fallback
}
