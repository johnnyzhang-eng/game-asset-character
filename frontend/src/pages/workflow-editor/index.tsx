import {
  Controls,
  Handle,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'

import {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  type ActionFirstFrameWorkflowNode,
  type ActionFullFrameWorkflowNode,
  type ActionGenerationMethodWorkflowNode,
  type ActionPreset,
  type Character,
  type CharacterSetupWorkflowNode,
  type CharacterTemplateWorkflowNode,
  type Generation,
  type MasterPrecheckReport,
  type MasterWarning,
  type MediaReference,
  type Project,
  type Render3DApis,
  type Render3DAsset,
  type ReviewWorkflowNode,
  type WorkflowGenerationRole,
  type WorkflowNode,
  type WorkflowRun,
} from '@/entities'
import type { WorkflowController } from '@/features/workflow-controller'
import {
  createProgressiveExportModel,
  ExportButton,
  type ExportPackageModel,
} from '@/features/export-package'
import {
  createDefaultRealWorkflowEditorSession,
  loadDefaultActionPresets,
  type WorkflowEditorSession,
} from './runtime'
import './workflow-editor.css'

export interface WorkflowEditorPageProps {
  loadSession?: (runId: string) => Promise<WorkflowEditorSession>
  loadActionPresets?: (signal?: AbortSignal) => Promise<ActionPreset[]>
}

type WorkflowCardData = {
  title: string
  eyebrow: string
  status: WorkflowNode['status']
  content: ReactNode
}

type WorkflowCardNode = Node<WorkflowCardData, 'workflow-card'>
type ActionMenuLevel = 'root' | 'outfits' | 'actions' | 'custom-action'

const ACTION_PRESET_HINT = '预设动作 · 逐帧生成'

/**
 * 自定义动作不在后端预设表里：它没有面向模型的文案可守（描述由用户当场写，走
 * `build_custom_prompt` 那条已有门禁的分支），这里只是通往表单的入口。
 */
const CUSTOM_ACTION_LABEL = '自定义动作'
const CUSTOM_ACTION_HINT = '自由描述 · 可选循环播放'

/** 角色设定与身份母版为所有动作分支共用，归在这条虚拟分支下。 */
const SHARED_BRANCH = 'shared'

/*
  卡片内部复用三次以上的样式串。原来靠 .workflow-card button 这类后代选择器统一施加，
  搬成工具类后写在这里，好处是能看见哪些元素共用同一套外观，而不是被选择器隐式波及。
  nodrag/nopan/nowheel 是 React Flow 的约定类：让卡片内的交互不被画布手势吞掉。
*/
const CARD_STACK = 'grid gap-[17px] nodrag nopan nowheel'

const CARD_BUTTON =
  'min-h-[42px] rounded-lg border border-app-accent bg-app-accent px-3 py-[9px] text-[11px] ' +
  'font-[750] text-app-on-accent enabled:hover:border-app-accent-hover enabled:hover:bg-app-accent-hover ' +
  'aria-pressed:border-app-accent-hover aria-pressed:bg-app-accent-hover disabled:cursor-not-allowed ' +
  'disabled:border-app-line disabled:bg-app-surface-muted disabled:text-app-faint'

/** 缩略图按钮：沿用卡片按钮的尺寸约定，但换成浅底，让图片自己当主角。 */
const THUMB_BUTTON =
  'min-h-[42px] rounded-lg border border-[var(--color-app-line)] bg-app-surface-raised p-1 ' +
  'aria-pressed:border-[var(--color-app-ink)] aria-pressed:bg-app-surface-raised ' +
  'aria-pressed:shadow-app-pulse disabled:cursor-not-allowed'

const THUMB_IMAGE = 'block aspect-square w-full rounded-lg object-cover'

/** 已确认的母版/首帧：像素资产按原样放大，不做平滑。 */
const MASTER_IMAGE =
  'block aspect-square w-full rounded-xl border border-[var(--color-app-line)] bg-app-surface ' +
  'object-cover [image-rendering:pixelated]'

const CARD_SUMMARY =
  'm-0 rounded-[10px] border border-[var(--color-app-line)] bg-app-surface px-3 py-2.5 ' +
  'text-[11px] leading-[1.6] text-[var(--color-app-muted)]'

const CARD_TEXT = 'm-0 text-[11px] leading-[1.6] text-[var(--color-app-muted)]'

/**
 * 三渲二判据只有一条:该造型有没有已确认的绑骨 3D 模型(`Outfit.model3dUrl`)。
 * 没有就不提供这个选项——猜一个"反正总能兜底成 i2v"等于让用户在不知情下换了路线。
 * 建模型本身是按次计费、每造型一次性(图生 3D + 绑骨),且生成后要人工确认模型才能继续绑骨。
 */
const RENDER3D_UNAVAILABLE_HINT =
  '该造型暂无绑骨 3D 模型，暂不能使用三渲二。到「身份母版」卡片上的「建 3D 资产」建一份：' +
  '图生 3D + 自动绑骨，按次计费、每造型一次性，中间有一道人工确认；不合格只能重新生成，不能修改。'

/** 加号菜单里的条目：撑满菜单宽度的两行文字，跟卡片主按钮完全不同。 */
const MENU_ITEM =
  'flex min-h-0 cursor-pointer flex-col gap-0.5 border-0 px-3 py-[9px] text-left ' +
  'text-[var(--color-app-ink)] not-first:border-t not-first:border-t-app-line ' +
  'enabled:hover:bg-app-accent-muted disabled:cursor-not-allowed disabled:opacity-45'

/**
 * 菜单里的头一条：返回上一级，或 root 层的主入口。比其余条目弱一档，
 * 原样式靠 :first-child 选择器实现，这里改成显式挂类，位置换了也不会失灵。
 */
const MENU_ITEM_LEAD = 'font-medium text-[var(--color-app-muted)]'

const MENU_ITEM_TITLE = 'text-xs font-semibold'
const MENU_ITEM_HINT = 'text-[10px] text-[var(--color-app-muted)]'

const nodeTypes = { 'workflow-card': WorkflowCard }

/**
 * 页面只订阅 Controller 的 WorkflowRun 并把它投影为画布；选择、菜单、位置和 busy
 * 都是临时 UI 状态，不会写出第二份流程状态机。
 */
export function WorkflowEditorPage({
  loadSession,
  loadActionPresets,
}: WorkflowEditorPageProps = {}) {
  const { runId } = useParams<{ runId: string }>()
  const [session, setSession] = useState<WorkflowEditorSession | null>(null)
  const [character, setCharacter] = useState<Character | null>(null)
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [generations, setGenerations] = useState<Record<string, Generation | null>>({})
  const [selectedImages, setSelectedImages] = useState<Record<string, string>>({})
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [actionMenuLevel, setActionMenuLevel] = useState<ActionMenuLevel>('root')
  const [selectedOutfitId, setSelectedOutfitId] = useState<string | null>(null)
  /** 正在执行命令的分支。必须是集合：并行分支各自持锁，后起的不能顶掉先起的。 */
  const [busyBranches, setBusyBranches] = useState<ReadonlySet<string>>(() => new Set())
  /** 后端预设。null=还没拿到（加载中或失败），与"拿到了但是空表"必须分得开。 */
  const [actionPresets, setActionPresets] = useState<ActionPreset[] | null>(null)
  const [actionPresetError, setActionPresetError] = useState<string | null>(null)
  /** 递增即重试；只用来把 effect 再跑一遍，值本身没有含义。 */
  const [actionPresetAttempt, setActionPresetAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [generationReadError, setGenerationReadError] = useState<string | null>(null)
  const [canvasNodes, setCanvasNodes] = useState<WorkflowCardNode[]>([])
  /** 当前会话的有效期。换 WorkflowRun 就 abort，所有异步回调只认这一个信号。 */
  const sessionAbortRef = useRef<AbortController | null>(null)
  /** 最近一次生成结果读取。同一会话内被新的读取顶掉时 abort，避免旧结果盖住新结果。 */
  const latestReadAbortRef = useRef<AbortController | null>(null)
  /** 已到终态的生成结果，按 taskId 记住，避免每次推进都重拉一遍。 */
  const settledGenerationsRef = useRef(new Map<Generation['id'], Generation>())

  const requestGenerations = useCallback(
    (targetSession: WorkflowEditorSession, targetRun: WorkflowRun, sessionSignal: AbortSignal) => {
      latestReadAbortRef.current?.abort()
      const readAbort = new AbortController()
      latestReadAbortRef.current = readAbort
      const outdated = () => sessionSignal.aborted || readAbort.signal.aborted
      void readGenerations(targetSession.controller, targetRun, settledGenerationsRef.current)
        .then((results) => {
          if (outdated()) return
          setGenerations(results)
          setGenerationReadError(null)
        })
        .catch((cause: unknown) => {
          if (outdated()) return
          setGenerationReadError(errorMessage(cause, '读取生成结果失败'))
        })
    },
    [],
  )

  const runCommand = useCallback(
    (branchKey: string, command: () => Promise<void>) => {
      // 同一分支内互斥，防重复提交；别的分支照常能操作，也不会被这条命令解锁。
      if (busyBranches.has(branchKey)) return
      const sessionSignal = sessionAbortRef.current?.signal
      setBusyBranches((current) => new Set(current).add(branchKey))
      setError(null)
      void command()
        .catch((cause: unknown) => {
          if (sessionSignal?.aborted) return
          setError(errorMessage(cause, '工作流命令执行失败'))
        })
        .finally(() => {
          if (sessionSignal?.aborted) return
          setBusyBranches((current) => {
            if (!current.has(branchKey)) return current
            const next = new Set(current)
            next.delete(branchKey)
            return next
          })
        })
    },
    [busyBranches],
  )

  useEffect(() => {
    const sessionAbort = new AbortController()
    sessionAbortRef.current = sessionAbort
    latestReadAbortRef.current?.abort()
    settledGenerationsRef.current = new Map()
    setSession(null)
    setCharacter(null)
    setRun(null)
    setGenerations({})
    setSelectedImages({})
    setActionMenuOpen(false)
    setActionMenuLevel('root')
    setSelectedOutfitId(null)
    setBusyBranches(new Set())
    setError(null)
    setResumeError(null)
    setGenerationReadError(null)
    setCanvasNodes([])
    if (!runId) return

    let loaded: WorkflowEditorSession | null = null
    let unsubscribe: () => void = () => undefined
    let unsubscribeErrors: () => void = () => undefined
    const loader = loadSession ?? createDefaultRealWorkflowEditorSession
    const signal = sessionAbort.signal

    void loader(runId)
      .then(async (nextSession) => {
        if (signal.aborted) {
          nextSession.dispose()
          return
        }
        loaded = nextSession
        setSession(nextSession)
        setCharacter(nextSession.character)
        unsubscribeErrors = nextSession.subscribeErrors((nextError) => {
          if (signal.aborted) return
          setError(errorMessage(nextError, '工作流异步处理失败'))
        })
        unsubscribe = nextSession.controller.subscribe((nextRun) => {
          if (signal.aborted) return
          setRun(nextRun)
          requestGenerations(nextSession, nextRun, signal)
        })
        try {
          await nextSession.controller.resume()
        } catch (cause: unknown) {
          if (signal.aborted) return
          setResumeError(errorMessage(cause, '恢复 WorkflowRun 失败'))
        }
      })
      .catch((cause: unknown) => {
        if (signal.aborted) return
        setError(errorMessage(cause, '恢复 WorkflowRun 失败'))
      })

    return () => {
      sessionAbort.abort()
      latestReadAbortRef.current?.abort()
      unsubscribe()
      unsubscribeErrors()
      loaded?.dispose()
    }
  }, [loadSession, requestGenerations, runId])

  useEffect(() => {
    const abort = new AbortController()
    const loader = loadActionPresets ?? loadDefaultActionPresets
    setActionPresets(null)
    setActionPresetError(null)
    void loader(abort.signal)
      .then((presets) => {
        if (abort.signal.aborted) return
        setActionPresets(presets)
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return
        // 只记错误，不落回本地副本：本地副本绕过后端的措辞门禁，且与后端漂移之后
        // 界面上没有任何异常可看，用户是拿着过期文案去付费生成的。
        setActionPresetError(errorMessage(cause, '读取动作预设失败'))
      })
    return () => abort.abort()
  }, [actionPresetAttempt, loadActionPresets])

  const exportModels = useMemo(() => {
    const models = new Map<string, ExportPackageModel>()
    if (!character || !run || !session) return models
    const completedGenerations = Object.values(generations).filter(
      (generation): generation is Generation => generation !== null,
    )
    for (const outfit of character.outfits) {
      try {
        models.set(
          outfit.id,
          createProgressiveExportModel({
            project: session.project,
            character,
            outfitId: outfit.id,
            run,
            generations: completedGenerations,
          }),
        )
      } catch {
        // 造型未达到最低导出条件时不显示导出入口。
      }
    }
    return models
  }, [character, generations, run, session])

  const projected = useMemo(
    () =>
      run && session
        ? projectCanvas({
            run,
            controller: session.controller,
            confirmCharacterTemplate: session.confirmCharacterTemplate,
            uploadReferenceImage: session.uploadReferenceImage,
            publishReviewedAction: session.publishReviewedAction,
            project: session.project,
            render3d: session.render3d,
            character,
            generations,
            exportModels,
            selectedImages,
            actionMenuOpen,
            actionMenuLevel,
            selectedOutfitId,
            actionPresets,
            actionPresetError,
            reloadActionPresets: () => setActionPresetAttempt((attempt) => attempt + 1),
            busyBranches,
            resumeBlocked: Boolean(resumeError),
            setSelectedImages,
            setActionMenuOpen,
            setActionMenuLevel,
            setSelectedOutfitId,
            setCharacter,
            runCommand,
          })
        : { nodes: [] as WorkflowCardNode[], edges: [] as Edge[] },
    [
      actionMenuOpen,
      actionMenuLevel,
      actionPresetError,
      actionPresets,
      busyBranches,
      character,
      exportModels,
      generations,
      run,
      runCommand,
      resumeError,
      selectedImages,
      selectedOutfitId,
      session,
    ],
  )

  useEffect(() => {
    setCanvasNodes((previous) =>
      projected.nodes.map((node) => ({
        ...node,
        position: previous.find((candidate) => candidate.id === node.id)?.position ?? node.position,
      })),
    )
  }, [projected.nodes])

  useEffect(() => {
    if (
      resumeError &&
      run &&
      !run.nodes.some(
        (node) => !node.deletedAt && node.status === 'active' && node.phase === 'generating',
      )
    ) {
      setResumeError(null)
    }
  }, [resumeError, run])

  function onNodesChange(changes: NodeChange<WorkflowCardNode>[]) {
    const safeChanges = changes.filter((change) => change.type !== 'remove')
    setCanvasNodes((nodes) => applyNodeChanges(safeChanges, nodes))
  }

  if (!runId) {
    return <EditorBoundary message="需要从已有 WorkflowRun 进入" />
  }

  if (error && !run) {
    return <EditorBoundary message={error} />
  }

  if (!session || !run) {
    return <EditorBoundary message="正在恢复 WorkflowRun" />
  }

  const constraints = [
    CHARACTER_PERSPECTIVE[session.project.perspective],
    DIRECTIONAL_MOVEMENT[session.project.directionalMovement],
    `${session.project.spriteSize.width} × ${session.project.spriteSize.height}`,
    session.project.gameStyle ?? '未设置画风',
  ]
  const visibleError = error ?? resumeError ?? generationReadError

  return (
    <div className="workflow-editor-shell fixed inset-0 z-30 overflow-hidden bg-[var(--color-app-canvas)] text-[var(--color-app-ink)]">
      <aside
        className="pointer-events-none absolute bottom-[18px] left-[18px] z-15 grid min-w-[250px] max-w-[min(380px,calc(100vw-112px))] gap-1 rounded-[10px] border border-app-line bg-app-surface-raised/90 px-[15px] py-3 shadow-app-menu backdrop-blur-[14px]"
        aria-label="当前项目"
      >
        <div>
          <p className="m-0 mb-[5px] text-[8px] font-extrabold tracking-[0.12em] text-app-faint">
            PROJECT
          </p>
          <h1 className="m-0 text-sm font-bold text-app-ink-soft">{session.project.name}</h1>
        </div>
        <p className="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-[9px] leading-[1.5] text-app-faint">
          {constraints.join(' · ')}
        </p>
        <div className="mt-1 flex justify-end">
          <small className="font-mono text-[8px] font-bold text-[var(--color-app-muted)]">
            Run {run.id} · v{run.version}
          </small>
        </div>
      </aside>
      {visibleError ? (
        <div
          className="absolute left-1/2 top-[150px] z-10 flex -translate-x-1/2 items-center gap-3 border border-app-danger-line bg-app-danger-soft px-[14px] py-2.5 text-xs text-app-danger"
          role="alert"
        >
          <span>{visibleError}</span>
          {!error && !resumeError && generationReadError ? (
            <button
              type="button"
              className="rounded-md border border-current bg-transparent px-2 py-[5px] font-bold text-inherit"
              onClick={() => {
                const signal = sessionAbortRef.current?.signal
                if (signal) requestGenerations(session, run, signal)
              }}
            >
              重试读取生成结果
            </button>
          ) : null}
        </div>
      ) : null}
      <section className="workflow-editor-canvas absolute inset-0" aria-label="WorkflowRun 画布">
        <ReactFlow<WorkflowCardNode>
          nodes={canvasNodes}
          edges={projected.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          nodesDraggable
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.14, maxZoom: 0.82 }}
          minZoom={0.3}
          maxZoom={1.2}
        >
          <FitViewOnNodeSetChange nodeIds={canvasNodes.map((node) => node.id)} />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </section>
    </div>
  )
}

/**
 * 只有画布上的节点增减时才重新取景，让新长出来的分支进入视野。
 * 节点内容变化（生成结果到达、状态推进、版本号增加）一律不动视角——
 * 用户拖过、缩放过的位置是他自己选的，命令执行不该把它拽回全景。
 *
 * 延迟一帧再取景：新节点要等 React Flow 量完尺寸，立刻调会按旧尺寸算错取景框。
 */
function FitViewOnNodeSetChange({ nodeIds }: { nodeIds: string[] }) {
  const { fitView } = useReactFlow()
  const signature = nodeIds.join(',')
  useEffect(() => {
    if (!signature) return
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.14, maxZoom: 0.82, duration: 180 })
    }, 32)
    return () => window.clearTimeout(timer)
  }, [fitView, signature])
  return null
}

interface ProjectionInput {
  run: WorkflowRun
  controller: WorkflowController
  confirmCharacterTemplate(
    nodeId: CharacterTemplateWorkflowNode['id'],
    selectedImageUrl: string,
  ): Promise<Character>
  uploadReferenceImage(file: File, signal?: AbortSignal): Promise<MediaReference>
  publishReviewedAction(reviewNodeId: ReviewWorkflowNode['id']): Promise<Character>
  project: Project
  character: Character | null
  /** 母版预检与建 3D 资产；页面不直连适配器，替身注入只有会话这一个入口。 */
  render3d: Render3DApis
  generations: Record<string, Generation | null>
  exportModels: ReadonlyMap<string, ExportPackageModel>
  selectedImages: Record<string, string>
  actionMenuOpen: boolean
  actionMenuLevel: ActionMenuLevel
  selectedOutfitId: string | null
  /** null = 还没拿到；与 actionPresetError 一起决定菜单显示加载中还是失败。 */
  actionPresets: ActionPreset[] | null
  actionPresetError: string | null
  reloadActionPresets(): void
  busyBranches: ReadonlySet<string>
  resumeBlocked: boolean
  setSelectedImages: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setActionMenuOpen(open: boolean): void
  setActionMenuLevel(level: ActionMenuLevel): void
  setSelectedOutfitId(outfitId: string | null): void
  setCharacter(character: Character): void
  runCommand(branchKey: string, command: () => Promise<void>): void
}

function NodeExportButton({ model }: { model: ExportPackageModel | undefined }) {
  return model ? (
    <ExportButton model={model} className={`${CARD_BUTTON} nodrag nopan nowheel`} />
  ) : null
}

/** 卡片自己所属的分支；命令与禁用判断都以它为准。 */
function branchKeyOf(node: WorkflowNode, input: ProjectionInput): string {
  return branchKeyFor(node, new Map(input.run.nodes.map((candidate) => [candidate.id, candidate])))
}

function projectCanvas(input: ProjectionInput): {
  nodes: WorkflowCardNode[]
  edges: Edge[]
} {
  const activeNodes = input.run.nodes.filter((node) => !node.deletedAt)
  const actionRootIds = activeNodes
    .filter((node) => node.type === 'action-first-frame')
    .map((node) => node.id)
  const nodesById = new Map(activeNodes.map((node) => [node.id, node]))
  const nodes = activeNodes.map((node) =>
    toCanvasNode(node, branchIndexFor(branchKeyFor(node, nodesById), actionRootIds), input),
  )
  const edges: Edge[] = activeNodes.flatMap((node) => {
    const confirmed = node.status === 'passed'
    return node.dependsOnNodeIds.map((source) => ({
      id: `${source}->${node.id}`,
      source,
      target: node.id,
      selectable: false,
      deletable: false,
      className: confirmed ? 'workflow-edge--confirmed' : 'workflow-edge--flowing',
    }))
  })

  return { nodes, edges }
}

function toCanvasNode(
  node: WorkflowNode,
  branchIndex: number,
  input: ProjectionInput,
): WorkflowCardNode {
  return {
    id: node.id,
    type: 'workflow-card',
    position: positionFor(node.type, branchIndex),
    zIndex: node.type === 'character-template' && input.actionMenuOpen ? 1000 : 0,
    draggable: true,
    dragHandle: '.workflow-card__handle',
    deletable: false,
    data: {
      eyebrow: CARD_LABELS[node.type].eyebrow,
      title: CARD_LABELS[node.type].title,
      status: node.status,
      content: contentFor(node, input),
    },
  }
}

function contentFor(node: WorkflowNode, input: ProjectionInput): ReactNode {
  if (node.type === 'character-setup') return <CharacterSetupContent node={node} input={input} />
  if (node.type === 'character-template') {
    return <CharacterTemplateContent node={node} input={input} />
  }
  if (node.type === 'action-first-frame') return <FirstFrameContent node={node} input={input} />
  if (node.type === 'action-generation-method') return <MethodContent node={node} input={input} />
  if (node.type === 'action-full-frame') return <AnimationContent node={node} input={input} />
  return <ReviewContent node={node} input={input} />
}

function CharacterSetupContent({
  node,
  input,
}: {
  node: CharacterSetupWorkflowNode
  input: ProjectionInput
}) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  const [prompt, setPrompt] = useState(node.input.prompt)
  const [uploadingReference, setUploadingReference] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setPrompt(node.input.prompt)
  }, [node.id, node.input.prompt])
  useEffect(() => () => uploadAbortRef.current?.abort(), [])

  function uploadReferenceImage(file: File) {
    const uploadAbort = new AbortController()
    uploadAbortRef.current = uploadAbort
    setUploadingReference(true)
    setUploadError(null)
    void input
      .uploadReferenceImage(file, uploadAbort.signal)
      .then((reference) => {
        if (uploadAbort.signal.aborted) return
        return input.controller.updateCharacterSetup(node.id, {
          prompt,
          referenceMedia: [reference],
        })
      })
      .catch((cause: unknown) => {
        if (uploadAbort.signal.aborted) return
        setUploadError(errorMessage(cause, '上传参考图失败'))
      })
      .finally(() => {
        if (uploadAbort.signal.aborted) return
        uploadAbortRef.current = null
        setUploadingReference(false)
      })
  }

  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.status === 'passed') return <p className={CARD_SUMMARY}>角色描述已确认</p>
  return (
    <div className={CARD_STACK}>
      <label className="grid gap-[7px]">
        <span className="text-[9px] font-[750] text-app-muted">角色描述</span>
        <textarea
          aria-label="角色描述"
          rows={4}
          className="min-h-[84px] w-full resize-y rounded-lg border border-[var(--color-app-line)] bg-app-surface-raised px-3 py-2.5 font-[inherit] text-[11px] leading-[1.55] text-[var(--color-app-ink)] focus:border-app-accent focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-app-accent-soft"
          value={prompt}
          disabled={branchBusy || uploadingReference}
          onChange={(event) => setPrompt(event.target.value)}
        />
        {node.input.referenceMedia.length > 0 ? (
          <small className="text-[9px] font-[750] text-app-muted">
            已关联 {node.input.referenceMedia.length} 个参考媒体
          </small>
        ) : null}
      </label>
      <div className="grid gap-[7px]">
        <span className="text-[9px] font-[750] text-app-muted">角色参考图（选填）</span>
        <input
          type="file"
          accept="image/*"
          aria-label="角色参考图"
          className="block w-full rounded-lg border border-[var(--color-app-line)] bg-app-surface text-[10px] text-[var(--color-app-muted)] file:mr-3 file:border-0 file:border-r file:border-[var(--color-app-line)] file:bg-transparent file:px-3 file:py-2 file:text-[10px] file:font-[700] file:text-[var(--color-app-ink)]"
          disabled={branchBusy || uploadingReference}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) uploadReferenceImage(file)
          }}
        />
        {uploadingReference ? (
          <small role="status" className="text-[9px] font-[750] text-app-muted">
            正在上传参考图…
          </small>
        ) : null}
        {uploadError ? (
          <p
            role="alert"
            className="m-0 rounded-lg border border-app-danger-line bg-app-danger-soft px-2.5 py-2 text-[9px] leading-[1.5] text-app-danger"
          >
            {uploadError}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy || uploadingReference || !prompt.trim()}
        onClick={() =>
          input.runCommand(branchKey, () =>
            input.controller.generateCharacterTemplate(node.id, {
              spriteWidth: input.project.spriteSize.width,
              spriteHeight: input.project.spriteSize.height,
              input: {
                prompt,
                referenceMedia: node.input.referenceMedia,
              },
            }),
          )
        }
      >
        生成角色候选
      </button>
    </div>
  )
}

function CharacterTemplateContent({
  node,
  input,
}: {
  node: CharacterTemplateWorkflowNode
  input: ProjectionInput
}) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'ready' && node.status === 'active') {
    const setupNode = findDependency(input.run, node, 'character-setup')
    return (
      <button
        type="button"
        className={`${CARD_BUTTON} nodrag nopan nowheel`}
        disabled={!setupNode || branchBusy}
        onClick={() => {
          if (!setupNode) return
          input.runCommand(branchKey, () =>
            input.controller.generateCharacterTemplate(setupNode.id, {
              spriteWidth: input.project.spriteSize.width,
              spriteHeight: input.project.spriteSize.height,
            }),
          )
        }}
      >
        生成角色候选
      </button>
    )
  }
  if (node.phase === 'selecting') {
    const result = input.generations[generationKey(node.id, 'character_template')]?.result
    const images = result?.type === 'character_template' ? result.images : []
    const selectedImageUrl =
      images.find((image) => image.url === input.selectedImages[node.id])?.url ?? null
    return (
      <div className={CARD_STACK}>
        <div className="grid grid-cols-2 gap-[7px]">
          {images.map((image, index) => (
            <button
              type="button"
              key={image.url}
              className={THUMB_BUTTON}
              aria-label={`选择角色候选 ${index + 1}`}
              aria-pressed={selectedImageUrl === image.url}
              onClick={() =>
                input.setSelectedImages((selected) => ({
                  ...selected,
                  [node.id]: image.url,
                }))
              }
            >
              <img className={THUMB_IMAGE} src={image.url} alt={`角色候选 ${index + 1}`} />
            </button>
          ))}
        </div>
        {selectedImageUrl ? (
          <MasterGate
            node={node}
            input={input}
            imageUrl={selectedImageUrl}
            branchKey={branchKey}
            branchBusy={branchBusy}
          />
        ) : (
          <p className={CARD_TEXT}>先选一张候选，再决定是否把它定为母版。</p>
        )}
      </div>
    )
  }
  if (node.status === 'passed' && node.selectedImageUrl) {
    const outfit =
      input.character?.outfits.find(
        (candidate) => candidate.previewUrl === node.selectedImageUrl,
      ) ?? input.character?.outfits[0]
    return (
      <div className={CARD_STACK}>
        <img className={MASTER_IMAGE} src={node.selectedImageUrl} alt="已确认身份母版" />
        <span className="text-center text-[11px] text-[var(--color-app-muted)]">身份已锁定</span>
        {input.character && outfit ? (
          <Render3DAssetPanel
            input={input}
            characterId={input.character.id}
            outfitId={outfit.id}
            hasModel={Boolean(outfit.model3dUrl)}
          />
        ) : null}
        {outfit ? <NodeExportButton model={input.exportModels.get(outfit.id)} /> : null}
        <button
          type="button"
          className="absolute -bottom-4 -right-4 z-8 grid h-8 min-h-8 w-8 place-items-center rounded-full border border-[var(--color-app-ink)] bg-app-surface-raised p-0 text-[15px] leading-none text-[var(--color-app-ink)] shadow-[var(--shadow-app-panel)] hover:bg-[var(--color-app-ink)] hover:text-app-on-accent"
          aria-label="添加动作分支"
          onClick={() => {
            input.setActionMenuLevel('root')
            input.setSelectedOutfitId(null)
            input.setActionMenuOpen(!input.actionMenuOpen)
          }}
        >
          ＋
        </button>
        {input.actionMenuOpen ? (
          <div className="absolute left-[calc(100%+24px)] top-[calc(100%-16px)] z-7 flex min-w-[190px] flex-col overflow-hidden rounded-xl border border-[var(--color-app-line)] bg-app-surface-raised shadow-[var(--shadow-app-panel)]">
            <ActionMenu input={input} templateNodeId={node.id} />
          </div>
        ) : null}
      </div>
    )
  }
  return <StatusText node={node} input={input} />
}

/**
 * 母版确认闸：挑中候选之后、把它当母版用之前的那个停点。
 *
 * 为什么这道闸值得存在：一张母版约 ¥0.29，图生 3D 一次 ¥2.40，而混元的模型**生成即
 * 最终**（拓扑、绑点在生成那一步定死，事后改不动）。母版不合格 → 模型必然不合格 →
 * 只能整个重来。所以要在最便宜的位置纠错，而不是等模型出来再看。
 *
 * 闸上摆的是**零成本就能判的**那几条（后端 master_check）。判不了的（画的是不是这个
 * 角色、朝向对不对、画面里有没有文字）由人自己看放大图 —— 所以放大图是这道闸的主体，
 * 预检只是旁证。
 */
function MasterGate({
  node,
  input,
  imageUrl,
  branchKey,
  branchBusy,
}: {
  node: CharacterTemplateWorkflowNode
  input: ProjectionInput
  imageUrl: string
  branchKey: string
  branchBusy: boolean
}) {
  const precheck = useMasterPrecheck(input, imageUrl)
  const setupNode = findDependency(input.run, node, 'character-setup')
  const rejected = precheck.status === 'done' && !precheck.report.accepted

  return (
    <div className={CARD_STACK}>
      <img className={MASTER_IMAGE} src={imageUrl} alt="待确认定妆母版" />
      <MasterPrecheckReadout state={precheck} />
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy || rejected}
        title={rejected ? precheck.report.detail : undefined}
        onClick={() =>
          input.runCommand(branchKey, async () => {
            const character = await input.confirmCharacterTemplate(node.id, imageUrl)
            input.setCharacter(character)
          })
        }
      >
        确认为定妆母版
      </button>
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy || !setupNode}
        onClick={() => {
          if (!setupNode) return
          input.setSelectedImages((selected) => {
            const next = { ...selected }
            delete next[node.id]
            return next
          })
          // 先复位再重生成：不复位的话新的三张会挂在一个仍处于 selecting 的节点上，
          // 页面会把旧的选择当成对新候选的选择。
          input.runCommand(branchKey, async () => {
            await input.controller.restartFromNode(node.id)
            await input.controller.generateCharacterTemplate(setupNode.id, {
              spriteWidth: input.project.spriteSize.width,
              spriteHeight: input.project.spriteSize.height,
            })
          })
        }}
      >
        重新生成三张
      </button>
    </div>
  )
}

type MasterPrecheckState =
  | { status: 'loading' }
  | { status: 'done'; report: MasterPrecheckReport }
  | { status: 'error'; message: string }

/** 预检失败不影响确认：它是旁证，不是准入条件。判据坏了不该连带把人挡在外面。 */
function useMasterPrecheck(input: ProjectionInput, imageUrl: string): MasterPrecheckState {
  const [state, setState] = useState<MasterPrecheckState>({ status: 'loading' })
  const { render3d } = input
  const { width, height } = input.project.spriteSize

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void render3d
      .precheckMaster(imageUrl, { width, height })
      .then((report) => {
        if (!cancelled) setState({ status: 'done', report })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorMessage(cause, '母版预检失败') })
      })
    return () => {
      cancelled = true
    }
  }, [height, imageUrl, render3d, width])

  return state
}

const WARNING_TITLE: Record<MasterWarning['code'], string> = {
  limbs_fused: '双腿可能粘连',
  extra_component: '画面里还有别的东西',
}

function MasterPrecheckReadout({ state }: { state: MasterPrecheckState }) {
  if (state.status === 'loading') {
    return (
      <p className={CARD_SUMMARY} role="status">
        正在预检母版…
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <p className={CARD_SUMMARY}>
        母版预检没跑成：{state.message}。这不影响确认，但下一步的形态问题得你自己看。
      </p>
    )
  }
  const { report } = state
  if (!report.accepted) {
    return (
      <p
        role="alert"
        className="m-0 rounded-[10px] border border-app-danger-line bg-app-danger-soft px-3 py-2.5 text-[11px] leading-[1.6] text-app-danger"
      >
        这张不能用：{report.detail}
      </p>
    )
  }
  return (
    <div className={CARD_STACK}>
      <p className={CARD_SUMMARY}>{report.detail}</p>
      {report.warnings.map((warning) => (
        <p key={warning.code} className={CARD_SUMMARY}>
          <b>{WARNING_TITLE[warning.code]}</b>
          <br />
          {warning.detail}
        </p>
      ))}
    </div>
  )
}

/**
 * 建 3D 资产：把 `Render3DAssetBuilder` 那条链交到用户手里。
 *
 * 三件事不能省：
 *  - **成本先说**。图生 3D + 绑骨按次计费，每造型一次性；数字由后端从计费实现取，
 *    这里不抄常量。用户不知情就触发按次计费是红线。
 *  - **人工确认闸不能自动放行**。模型出来后停在 `awaiting_review`，等人点头才绑骨。
 *  - **不装进度条**。没有 3D 预览能力，就给状态、给模型下载地址、给怎么看的说明，
 *    而不是转一个和真实进度无关的圈。
 */
function Render3DAssetPanel({
  input,
  characterId,
  outfitId,
  hasModel,
}: {
  input: ProjectionInput
  characterId: string
  outfitId: string
  hasModel: boolean
}) {
  const { render3d } = input
  const [asset, setAsset] = useState<Render3DAsset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const inFlight = asset?.state === 'building' || asset?.state === 'rigging'

  useEffect(() => {
    let cancelled = false
    const read = () =>
      render3d
        .getOutfitAsset(characterId, outfitId)
        .then((next) => {
          if (!cancelled) setAsset(next)
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(errorMessage(cause, '读取 3D 资产状态失败'))
        })
    void read()
    // 两段付费调用各要几十秒到几分钟，跑在后端线程上，只能轮询。停在闸上时不轮询——
    // 那个状态只会因为人点按钮而改变，轮询它纯属浪费。
    if (!inFlight) return () => {
      cancelled = true
    }
    const timer = window.setInterval(() => void read(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [characterId, inFlight, outfitId, refreshKey, render3d])

  const act = (operation: () => Promise<Render3DAsset>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    void operation()
      .then((next) => setAsset(next))
      .catch((cause: unknown) => setError(errorMessage(cause, '操作 3D 资产失败')))
      .finally(() => {
        setBusy(false)
        setRefreshKey((key) => key + 1)
      })
  }

  if (!asset) {
    return <p className={CARD_SUMMARY}>{error ?? '正在读取 3D 资产状态…'}</p>
  }

  const cost = asset.cost
  const costLine =
    `图生 3D ${cost.model3dCredits} 积分 + 绑骨 ${cost.autorigCredits} 积分 = ` +
    `${cost.totalCredits} 积分（后付费约 ¥${cost.totalCny}）。每造型一次性，做多少个动作都不再收。`

  return (
    <section className={CARD_STACK} aria-label="三渲二 3D 资产">
      {error ? <p className={CARD_SUMMARY}>{error}</p> : null}
      {asset.state === 'absent' || asset.state === 'failed' ? (
        <>
          <p className={CARD_SUMMARY}>{costLine}</p>
          {asset.state === 'failed' && asset.error ? (
            <p className={CARD_SUMMARY}>上次没建成：{asset.error}</p>
          ) : null}
          <button
            type="button"
            className={CARD_BUTTON}
            disabled={busy}
            onClick={() => act(() => render3d.buildOutfitAsset(characterId, outfitId))}
          >
            建 3D 资产（{cost.totalCredits} 积分 · 约 ¥{cost.totalCny}）
          </button>
        </>
      ) : null}

      {asset.state === 'building' ? (
        <p className={CARD_SUMMARY} role="status">
          正在图生 3D（{cost.model3dCredits} 积分已计费）。这一步几十秒到几分钟，
          出来后会停下来等你确认，不会自己接着绑骨。
        </p>
      ) : null}

      {asset.state === 'awaiting_review' ? (
        <>
          <p className={CARD_SUMMARY}>
            模型已生成，等你确认。<b>混元的模型改不动</b>——不合格只能重新生成，
            所以这一步别放水：绑骨还要再花 {cost.autorigCredits} 积分。
          </p>
          {asset.reviewModelUrl ? (
            <p className={CARD_TEXT}>
              <a href={asset.reviewModelUrl} target="_blank" rel="noreferrer">
                下载待审模型（.glb）
              </a>
              ：用 Blender 或任意 glTF 查看器打开，看四肢有没有粘连、有没有多出来的物体。
            </p>
          ) : (
            <p className={CARD_TEXT}>待审模型暂时取不到地址，先别放行。</p>
          )}
          <button
            type="button"
            className={CARD_BUTTON}
            disabled={busy}
            onClick={() => act(() => render3d.approveOutfitAsset(characterId, outfitId))}
          >
            通过 · 继续绑骨（{cost.autorigCredits} 积分）
          </button>
          <button
            type="button"
            className={CARD_BUTTON}
            disabled={busy}
            onClick={() => act(() => render3d.discardOutfitAsset(characterId, outfitId))}
          >
            不合格 · 重新生成（再花 {cost.model3dCredits} 积分）
          </button>
        </>
      ) : null}

      {asset.state === 'rigging' ? (
        <p className={CARD_SUMMARY} role="status">
          正在自动绑骨（{cost.autorigCredits} 积分已计费）。完成后这个造型就能选三渲二了。
        </p>
      ) : null}

      {asset.state === 'ready' ? (
        <p className={CARD_SUMMARY}>
          3D 资产已就绪，这个造型可以走三渲二了{hasModel ? '' : '（刷新后生效）'}。
        </p>
      ) : null}
    </section>
  )
}

function ActionMenu({ input, templateNodeId }: { input: ProjectionInput; templateNodeId: string }) {
  const outfits = input.character?.outfits ?? []
  const selectedOutfit = outfits.find((outfit) => outfit.id === input.selectedOutfitId) ?? null
  // 菜单挂在身份母版上，新增分支属于共享区的操作。
  const branchBusy = input.busyBranches.has(SHARED_BRANCH)

  if (input.actionMenuLevel === 'root') {
    return (
      <div className="contents">
        <button
          type="button"
          className={`${MENU_ITEM} ${MENU_ITEM_LEAD}`}
          disabled={outfits.length === 0 || branchBusy}
          onClick={() => {
            if (outfits.length === 1) {
              input.setSelectedOutfitId(outfits[0]!.id)
              input.setActionMenuLevel('actions')
              return
            }
            input.setActionMenuLevel('outfits')
          }}
        >
          <b className={MENU_ITEM_TITLE}>生成动作 ›</b>
        </button>
        <button type="button" className={MENU_ITEM} disabled>
          <b className={MENU_ITEM_TITLE}>生成静态资产</b>
          <small className={MENU_ITEM_HINT}>本期不做，需单独提案</small>
        </button>
        <button type="button" className={MENU_ITEM} disabled>
          <b className={MENU_ITEM_TITLE}>导出</b>
          <small className={MENU_ITEM_HINT}>完成审核后打包动作</small>
        </button>
      </div>
    )
  }

  if (input.actionMenuLevel === 'outfits') {
    return (
      <div className="contents">
        <button
          type="button"
          className={`${MENU_ITEM} ${MENU_ITEM_LEAD}`}
          onClick={() => input.setActionMenuLevel('root')}
        >
          ← 选择造型
        </button>
        {outfits.map((outfit) => (
          <button
            type="button"
            key={outfit.id}
            className={MENU_ITEM}
            aria-label={`选择造型 ${outfit.name}`}
            onClick={() => {
              input.setSelectedOutfitId(outfit.id)
              input.setActionMenuLevel('actions')
            }}
          >
            <b className={MENU_ITEM_TITLE}>{outfit.name}</b>
            <small className={MENU_ITEM_HINT}>{outfit.description ?? '使用此造型生成动作'}</small>
          </button>
        ))}
      </div>
    )
  }

  if (input.actionMenuLevel === 'custom-action') {
    return (
      <CustomActionForm
        input={input}
        templateNodeId={templateNodeId}
        selectedOutfit={selectedOutfit}
        branchBusy={branchBusy}
      />
    )
  }

  return (
    <div className="contents">
      <button
        type="button"
        className={`${MENU_ITEM} ${MENU_ITEM_LEAD}`}
        onClick={() => input.setActionMenuLevel(outfits.length > 1 ? 'outfits' : 'root')}
      >
        ← 生成动作
      </button>
      <ActionPresetItems
        input={input}
        templateNodeId={templateNodeId}
        selectedOutfit={selectedOutfit}
        branchBusy={branchBusy}
      />
      <button
        type="button"
        className={MENU_ITEM}
        disabled={!selectedOutfit || branchBusy}
        onClick={() => {
          if (!selectedOutfit) return
          input.setActionMenuLevel('custom-action')
        }}
      >
        <b className={MENU_ITEM_TITLE}>{CUSTOM_ACTION_LABEL}</b>
        <small className={MENU_ITEM_HINT}>{CUSTOM_ACTION_HINT}</small>
      </button>
    </div>
  )
}

/** 预设条目全部来自后端；取不到就摆明说取不到并给重试，不落回本地副本。 */
function ActionPresetItems({
  input,
  templateNodeId,
  selectedOutfit,
  branchBusy,
}: {
  input: ProjectionInput
  templateNodeId: string
  selectedOutfit: Character['outfits'][number] | null
  branchBusy: boolean
}) {
  if (input.actionPresetError) {
    return (
      <button type="button" className={MENU_ITEM} onClick={input.reloadActionPresets}>
        <b className={MENU_ITEM_TITLE}>重试读取动作预设</b>
        <small className={MENU_ITEM_HINT}>{input.actionPresetError}</small>
      </button>
    )
  }

  if (!input.actionPresets) {
    return (
      <button type="button" className={MENU_ITEM} disabled>
        <b className={MENU_ITEM_TITLE}>正在读取动作预设</b>
        <small className={MENU_ITEM_HINT}>{ACTION_PRESET_HINT}</small>
      </button>
    )
  }

  return (
    <div className="contents">
      {input.actionPresets.map((preset) => (
        <button
          type="button"
          key={preset.type}
          className={MENU_ITEM}
          disabled={!selectedOutfit || branchBusy}
          onClick={() => {
            if (!selectedOutfit) return
            input.runCommand(SHARED_BRANCH, () =>
              input.controller.addAction({
                dependsOnNodeIds: [templateNodeId],
                input: {
                  outfitId: selectedOutfit.id,
                  name: preset.name,
                  type: preset.type,
                  prompt: preset.description,
                  fps: 12,
                },
              }),
            )
            input.setActionMenuOpen(false)
            input.setActionMenuLevel('root')
            input.setSelectedOutfitId(null)
          }}
        >
          <b className={MENU_ITEM_TITLE}>{preset.label}</b>
          <small className={MENU_ITEM_HINT}>{ACTION_PRESET_HINT}</small>
        </button>
      ))}
    </div>
  )
}

/** 自由文本 + 循环勾选；表单只在展开时挂载，切走一次就丢弃未提交的草稿。 */
function CustomActionForm({
  input,
  templateNodeId,
  selectedOutfit,
  branchBusy,
}: {
  input: ProjectionInput
  templateNodeId: string
  selectedOutfit: Character['outfits'][number] | null
  branchBusy: boolean
}) {
  const [prompt, setPrompt] = useState('')
  const [loop, setLoop] = useState(false)

  return (
    <div className="contents">
      <button
        type="button"
        className={`${MENU_ITEM} ${MENU_ITEM_LEAD}`}
        onClick={() => input.setActionMenuLevel('actions')}
      >
        ← 自定义动作
      </button>
      <div className="grid gap-2 px-3 py-[9px]">
        <textarea
          aria-label="自定义动作描述"
          rows={3}
          value={prompt}
          disabled={branchBusy}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：来回走动、蹲下捡起地上的东西"
          className="w-full resize-y rounded-lg border border-[var(--color-app-line)] bg-app-surface-raised px-2.5 py-2 text-[11px] leading-[1.5] text-[var(--color-app-ink)] focus:border-app-accent focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-app-accent-soft"
        />
        <label className="flex items-start gap-2 text-[10px] leading-[1.5] text-app-muted">
          <input
            type="checkbox"
            checked={loop}
            disabled={branchBusy}
            onChange={(event) => setLoop(event.target.checked)}
          />
          <span>
            循环播放——走路、待机这类能无缝反复播的动作勾选；攻击、跳跃这类只做一次的不要勾
          </span>
        </label>
        <button
          type="button"
          className={CARD_BUTTON}
          disabled={!selectedOutfit || branchBusy || !prompt.trim()}
          onClick={() => {
            if (!selectedOutfit) return
            const description = prompt.trim()
            input.runCommand(SHARED_BRANCH, () =>
              input.controller.addAction({
                dependsOnNodeIds: [templateNodeId],
                input: {
                  outfitId: selectedOutfit.id,
                  name: description.slice(0, 20),
                  type: 'custom',
                  prompt: description,
                  fps: 12,
                  loop,
                },
              }),
            )
            input.setActionMenuOpen(false)
            input.setActionMenuLevel('root')
            input.setSelectedOutfitId(null)
          }}
        >
          创建自定义动作
        </button>
      </div>
    </div>
  )
}

function FirstFrameContent({
  node,
  input,
}: {
  node: ActionFirstFrameWorkflowNode
  input: ProjectionInput
}) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  const result = input.generations[generationKey(node.id, 'first_frame')]?.result
  const images = result?.type === 'first_frame' ? result.images : []
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'configuring') {
    const character = characterOwningOutfit(input.character, node.input.outfitId)
    return (
      <div className={CARD_STACK}>
        <p className={CARD_TEXT}>
          {node.input.name} · {node.input.fps} FPS
        </p>
        <p className={CARD_TEXT}>{node.input.prompt ?? '无额外动作描述'}</p>
        <button
          type="button"
          className={CARD_BUTTON}
          disabled={!character || branchBusy}
          onClick={() => {
            if (!character) return
            input.runCommand(branchKey, () =>
              input.controller.generateFirstFrame(node.id, {
                spriteWidth: input.project.spriteSize.width,
                spriteHeight: input.project.spriteSize.height,
              }),
            )
          }}
        >
          生成动作首帧
        </button>
      </div>
    )
  }
  if (node.phase === 'selecting' && images.length > 0) {
    const selectedImageUrl = images.some((image) => image.url === input.selectedImages[node.id])
      ? input.selectedImages[node.id]!
      : null
    return (
      <div className={CARD_STACK}>
        <div className="grid grid-cols-3 gap-2">
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              className={THUMB_BUTTON}
              aria-label={`选择动作首帧 ${index + 1}`}
              aria-pressed={selectedImageUrl === image.url}
              onClick={() =>
                input.setSelectedImages((selected) => ({
                  ...selected,
                  [node.id]: image.url,
                }))
              }
            >
              <img className={THUMB_IMAGE} src={image.url} alt={`动作首帧候选 ${index + 1}`} />
            </button>
          ))}
        </div>
        <button
          type="button"
          className={CARD_BUTTON}
          disabled={!selectedImageUrl || branchBusy}
          onClick={() =>
            input.runCommand(branchKey, () =>
              input.controller.confirmFirstFrame(node.id, selectedImageUrl!),
            )
          }
        >
          确认动作首帧
        </button>
      </div>
    )
  }
  if (node.phase === 'completed' && node.selectedFirstFrameUrl) {
    return (
      <div className={CARD_STACK}>
        <img className={MASTER_IMAGE} src={node.selectedFirstFrameUrl} alt="已确认动作首帧" />
        <NodeExportButton model={input.exportModels.get(node.input.outfitId)} />
      </div>
    )
  }
  return <StatusText node={node} input={input} />
}

function MethodContent({
  node,
  input,
}: {
  node: ActionGenerationMethodWorkflowNode
  input: ProjectionInput
}) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'completed') {
    return <p className={CARD_SUMMARY}>{node.method === '3d-to-2d' ? '三渲二' : '视频裁剪'}</p>
  }
  if (node.status !== 'active') return <StatusText node={node} input={input} />

  const firstFrameNode = findDependency(input.run, node, 'action-first-frame')
  const outfit = firstFrameNode
    ? input.character?.outfits.find((candidate) => candidate.id === firstFrameNode.input.outfitId)
    : null
  const render3dReady = Boolean(outfit?.model3dUrl)

  return (
    <div className={CARD_STACK}>
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy}
        onClick={() =>
          input.runCommand(branchKey, () =>
            input.controller.selectActionGenerationMethod(node.id, 'video-cropping'),
          )
        }
      >
        视频裁剪
      </button>
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy || !render3dReady}
        title={render3dReady ? undefined : RENDER3D_UNAVAILABLE_HINT}
        onClick={() =>
          input.runCommand(branchKey, () =>
            input.controller.selectActionGenerationMethod(node.id, '3d-to-2d'),
          )
        }
      >
        三渲二{render3dReady ? '' : ' · 需先建 3D 模型'}
      </button>
      {render3dReady ? null : <p className={CARD_TEXT}>{RENDER3D_UNAVAILABLE_HINT}</p>}
    </div>
  )
}

function AnimationContent({
  node,
  input,
}: {
  node: ActionFullFrameWorkflowNode
  input: ProjectionInput
}) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  const result = input.generations[generationKey(node.id, 'complete_animation')]?.result
  const frames = result?.type === 'complete_animation' ? result.frames : []
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'ready' && node.status === 'active') {
    // 依赖链是 首帧 → 生产方式 → 完整动画，所以要往上翻两层才拿得到首帧的造型。
    const methodNode = findDependency(input.run, node, 'action-generation-method')
    const firstFrameNode = methodNode
      ? findDependency(input.run, methodNode, 'action-first-frame')
      : null
    const character = firstFrameNode
      ? characterOwningOutfit(input.character, firstFrameNode.input.outfitId)
      : null
    return (
      <button
        type="button"
        className={`${CARD_BUTTON} nodrag nopan nowheel`}
        disabled={!character || branchBusy}
        onClick={() => {
          if (!character) return
          input.runCommand(branchKey, () =>
            input.controller.generateCompleteAnimation(node.id, {
              characterId: character.id,
              referenceMedia: [],
              loop: firstFrameNode?.input.loop,
            }),
          )
        }}
      >
        生成完整动画
      </button>
    )
  }
  if (node.phase === 'completed' && frames.length) {
    const methodNode = findDependency(input.run, node, 'action-generation-method')
    const firstFrameNode = methodNode
      ? findDependency(input.run, methodNode, 'action-first-frame')
      : null
    return (
      <div className={CARD_STACK}>
        <div className="nodrag nopan nowheel grid max-h-40 grid-cols-8 gap-[3px] overflow-auto">
          {frames.map((frame, index) => (
            <img
              key={`${frame.url}-${index}`}
              className="block aspect-square w-full rounded border border-[var(--color-app-line)] object-cover"
              src={frame.url}
              alt={`动画帧 ${index + 1}`}
            />
          ))}
        </div>
        {firstFrameNode ? (
          <NodeExportButton model={input.exportModels.get(firstFrameNode.input.outfitId)} />
        ) : null}
      </div>
    )
  }
  return <StatusText node={node} input={input} />
}

function ReviewContent({ node, input }: { node: ReviewWorkflowNode; input: ProjectionInput }) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  if (node.status === 'failed') return <StatusText node={node} input={input} />
  if (node.phase === 'completed') {
    const fullFrame = findDependency(input.run, node, 'action-full-frame')
    const method = fullFrame
      ? findDependency(input.run, fullFrame, 'action-generation-method')
      : null
    const firstFrame = method ? findDependency(input.run, method, 'action-first-frame') : null
    return (
      <div className={CARD_STACK}>
        <p className={CARD_SUMMARY}>审核已通过</p>
        {firstFrame ? (
          <NodeExportButton model={input.exportModels.get(firstFrame.input.outfitId)} />
        ) : null}
      </div>
    )
  }
  if (node.status !== 'active') return <StatusText node={node} input={input} />
  return (
    <div className={CARD_STACK}>
      <p className={CARD_TEXT}>确认完整动画后完成本动作审核。</p>
      <button
        type="button"
        className={CARD_BUTTON}
        disabled={branchBusy}
        onClick={() =>
          input.runCommand(branchKey, async () => {
            const character = await input.publishReviewedAction(node.id)
            input.setCharacter(character)
            await input.controller.approveReview(node.id)
          })
        }
      >
        审核通过
      </button>
    </div>
  )
}

function WorkflowCard({ data }: NodeProps<WorkflowCardNode>) {
  return (
    <article
      className={[
        'w-[368px] overflow-visible rounded-xl border border-[var(--color-app-line)] bg-app-surface-raised/98 shadow-[var(--shadow-app-panel)]',
        data.status === 'failed' ? 'border-dashed' : 'border-solid',
        data.status === 'locked' ? 'opacity-45' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <header className="workflow-card__handle grid min-h-[62px] cursor-grab select-none content-center gap-0.5 rounded-t-[11px] bg-app-accent px-[18px] py-3 text-app-on-accent active:cursor-grabbing">
        <span className="text-[8px] font-extrabold tracking-[0.12em] text-app-line">
          {data.eyebrow}
        </span>
        <strong className="text-sm font-bold">{data.title}</strong>
      </header>
      <div className="rounded-b-[11px] bg-app-surface-raised/98 p-[21px]">{data.content}</div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </article>
  )
}

function StatusText({ node, input }: { node: WorkflowNode; input: ProjectionInput }) {
  const branchKey = branchKeyOf(node, input)
  const branchBusy = input.busyBranches.has(branchKey)
  const resumeBlocked =
    input.resumeBlocked && node.status === 'active' && node.phase === 'generating'
  if (node.status === 'failed' || resumeBlocked) {
    return (
      <div className={CARD_STACK}>
        <p className={CARD_SUMMARY}>
          {node.status === 'failed' ? (node.error ?? '生成失败') : '生成任务恢复失败'}
        </p>
        <button
          type="button"
          className={CARD_BUTTON}
          disabled={branchBusy}
          onClick={() => {
            input.setSelectedImages({})
            input.runCommand(branchKey, () => input.controller.restartFromNode(node.id))
          }}
        >
          从此节点重做
        </button>
      </div>
    )
  }
  const label =
    node.status === 'locked' ? '等待上游节点' : node.phase === 'generating' ? '生成中…' : '处理中…'
  return <p className={CARD_SUMMARY}>{label}</p>
}

function EditorBoundary({ message }: { message: string }) {
  return (
    <div className="grid min-h-screen place-content-center gap-2 bg-app-canvas text-center">
      <p className="m-0 text-[10px] font-extrabold tracking-[0.16em] text-app-muted">
        MANUAL WORKFLOW
      </p>
      <h1 className="m-0 text-3xl font-semibold">工作流编辑器</h1>
      <span className="m-0 text-[13px] text-app-muted">{message}</span>
    </div>
  )
}

/**
 * 一个节点可以同时挂多个角色的生成任务，所以字典的键必须带上角色，
 * 只用节点 ID 会让后读到的那条静默覆盖前一条。已删节点不再读取。
 */
function generationKey(nodeId: WorkflowNode['id'], role: WorkflowGenerationRole) {
  return `${nodeId}:${role}`
}

/**
 * 读取节点的生成结果。WorkflowRun 每推进一步都会 emit，而已经到终态的任务不会再变，
 * 所以按 taskId 记住它们；只有还在跑的任务才值得重新问后端。
 */
async function readGenerations(
  controller: WorkflowController,
  run: WorkflowRun,
  settled: Map<Generation['id'], Generation>,
): Promise<Record<string, Generation | null>> {
  const entries = await Promise.all(
    run.nodes
      .filter((node) => !node.deletedAt)
      .flatMap((node) =>
        node.generations.map(async (reference) => {
          const key = generationKey(node.id, reference.role)
          const cached = settled.get(reference.taskId)
          if (cached) return [key, cached] as const
          const generation = await controller.getGeneration(node.id, reference.role)
          if (generation && (generation.status === 'completed' || generation.status === 'failed')) {
            settled.set(generation.id, generation)
          }
          return [key, generation] as const
        }),
      ),
  )
  return Object.fromEntries(entries)
}

/**
 * 节点属于哪条动作分支：顺着依赖往上爬到本分支的首帧节点，用它的 ID 当分支标识。
 * 角色设定与身份母版为所有分支共用，爬不到首帧，归到 SHARED_BRANCH。
 */
function branchKeyFor(node: WorkflowNode, nodesById: ReadonlyMap<string, WorkflowNode>): string {
  let current: WorkflowNode | undefined = node
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.type === 'action-first-frame') return current.id
    current = current.dependsOnNodeIds
      .map((dependencyId) => nodesById.get(dependencyId))
      .find((dependency) => dependency?.type !== 'character-template')
  }
  return SHARED_BRANCH
}

/** 分支在画布上排第几行。共享节点与找不到根的节点都落在第 0 行。 */
function branchIndexFor(branchKey: string, actionRootIds: string[]): number {
  return Math.max(0, actionRootIds.indexOf(branchKey))
}

function positionFor(type: WorkflowNode['type'], branchIndex: number) {
  const x: Record<WorkflowNode['type'], number> = {
    'character-setup': 70,
    'character-template': 510,
    'action-first-frame': 950,
    'action-generation-method': 1390,
    'action-full-frame': 1820,
    review: 2250,
  }
  const isActionBranch = type.startsWith('action') || type === 'review'
  return {
    x: x[type],
    y: isActionBranch ? 60 + branchIndex * 510 : 280,
  }
}

/** 卡片抬头文案。序号是流程顺序，与 positionFor 的横向排布一致。 */
const CARD_LABELS: Record<WorkflowNode['type'], { eyebrow: string; title: string }> = {
  'character-setup': { eyebrow: '01 · ORIGIN', title: '角色设定' },
  'character-template': { eyebrow: '02 · MASTER', title: '身份母版' },
  'action-first-frame': { eyebrow: '03 · FIRST FRAME', title: '动作首帧' },
  'action-generation-method': { eyebrow: '04 · METHOD', title: '生产方式' },
  'action-full-frame': { eyebrow: '05 · ANIMATION', title: '完整动画' },
  review: { eyebrow: '06 · REVIEW', title: '动画审核' },
}

/**
 * 造型属于当前角色时返回该角色，否则返回 null。
 * 一条 WorkflowRun 只绑定一个角色，所以这里不是查找，是归属校验。
 */
function characterOwningOutfit(character: Character | null, outfitId: string) {
  return character?.outfits.some((outfit) => outfit.id === outfitId) ? character : null
}

function findDependency<T extends WorkflowNode['type']>(
  run: WorkflowRun,
  node: WorkflowNode,
  type: T,
): Extract<WorkflowNode, { type: T }> | null {
  const dependencies = run.nodes.filter((candidate) => node.dependsOnNodeIds.includes(candidate.id))
  const match = dependencies.find((candidate) => candidate.type === type)
  return (match as Extract<WorkflowNode, { type: T }> | undefined) ?? null
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
