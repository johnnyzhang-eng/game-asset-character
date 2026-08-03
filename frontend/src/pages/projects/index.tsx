import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import {
  CHARACTER_PERSPECTIVE,
  DIRECTIONAL_MOVEMENT,
  SPRITE_SIZES,
  type Character,
  type CharacterApis,
  type ProjectApis,
} from '@/entities'
import { AmbientGrid } from '@/shared/ui/ambient-grid'

/**
 * 项目资产工作台。
 *
 * 外壳沿用团队版的「项目→角色→造型→动作」四分区信息架构，但不走子路由：分区切换在组件内部用
 * React state 完成，路由仍是单一的 /projects。其中「角色资产」分区接入我们真实的角色选择器——
 * 后端列举角色需要 project_id（GET /characters?project_id=…），没有「列出全部角色」的端点，因此
 * 先取项目（ProjectApis.list），再按项目取角色（CharacterApis.listByProject），汇聚成一张可点击
 * 进入试玩的角色卡片网格（链接到 /playtest/:characterId/:outfitId）。
 */
export interface CharacterSelectorApis {
  projects: Pick<ProjectApis, 'list'>
  characters: Pick<CharacterApis, 'listByProject'>
}

export interface ProjectsPageProps {
  apis?: CharacterSelectorApis
}

/** 一张角色卡所需的展示数据；已保证含可进入试玩的 outfitId。 */
interface CharacterCard {
  characterId: string
  outfitId: string
  title: string
  description: string
  thumbnailUrl: string | null
  outfitName: string
  actionCount: number
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; cards: CharacterCard[] }

function firstPlayableOutfit(character: Character) {
  return character.outfits.find((outfit) => outfit.id.length > 0) ?? null
}

/** 汇聚项目与其角色，展平成可直接进入试玩的角色卡片列表。 */
async function loadCharacterCards(apis: CharacterSelectorApis): Promise<CharacterCard[]> {
  const projects = await apis.projects.list({ page: 1, pageSize: 100 })

  const perProject = await Promise.all(
    projects.items.map(async (project) => {
      const characters = await apis.characters.listByProject(project.id)
      const cards: CharacterCard[] = []
      for (const character of characters) {
        const outfit = firstPlayableOutfit(character)
        // 没有造型的角色进不了 /playtest/:characterId/:outfitId，选择器里直接跳过。
        if (outfit === null) continue
        cards.push({
          characterId: character.id,
          outfitId: outfit.id,
          title: project.name || `角色 #${character.id}`,
          description: character.description?.trim() || outfit.name || '未命名角色',
          thumbnailUrl: outfit.characterTemplateUrl ?? character.referenceImageUrl ?? null,
          outfitName: outfit.name,
          actionCount: outfit.actions.length,
        })
      }
      return cards
    }),
  )

  return perProject.flat()
}

/** 工作台分区标识；不再是路由段，而是组件内部的 tab 状态。 */
type ProjectWorkspaceSection = 'overview' | 'projects' | 'characters' | 'outfits' | 'actions'

interface WorkspaceSection {
  id: ProjectWorkspaceSection
  label: string
  eyebrow: string
  title: string
  description: string
  fields?: readonly string[]
}

const WORKSPACE_SECTIONS: readonly WorkspaceSection[] = [
  {
    id: 'overview',
    label: '工作台概览',
    eyebrow: 'PROJECT ASSET WORKSPACE',
    title: '项目资产工作台',
    description: '从项目进入角色、造型与动作，让同一套生成约束贯穿完整资产链路。',
  },
  {
    id: 'projects',
    label: '全部项目',
    eyebrow: 'ALL PROJECTS',
    title: '全部项目',
    description: '查看项目状态、资产规模与最近编辑记录。',
    fields: ['项目约束', '资产规模', '最近编辑'],
  },
  {
    id: 'characters',
    label: '角色资产',
    eyebrow: 'CHARACTER ASSETS',
    title: '角色资产',
    description: '从所有项目汇聚可试玩的角色，点选任意角色即可进入试玩预览台。',
    fields: ['稳定身份', '角色母版', '历史版本'],
  },
  {
    id: 'outfits',
    label: '造型资产',
    eyebrow: 'OUTFIT ASSETS',
    title: '造型资产',
    description: '按角色整理默认造型、多视角结果与穿戴组合。',
    fields: ['默认造型', '多视角', '穿戴组合'],
  },
  {
    id: 'actions',
    label: '动作资产',
    eyebrow: 'ACTION ASSETS',
    title: '动作资产',
    description: '检查动作实例、生成记录与最终进入项目的正式帧。',
    fields: ['动作实例', '生成记录', '正式帧'],
  },
] as const

const ASSET_DIRECTORY: readonly (readonly [string, string, string, ProjectWorkspaceSection])[] = [
  ['01', '项目', '生成约束与画风', 'projects'],
  ['02', '角色', '稳定身份与母版', 'characters'],
  ['03', '造型', '穿戴与多视角', 'outfits'],
  ['04', '动作', '实例、记录与帧', 'actions'],
] as const

const PRODUCTION_FLOW = [
  ['01', '确认项目', '锁定画风、视角与尺寸'],
  ['02', '建立角色', '保存稳定身份和母版'],
  ['03', '扩展造型', '继承角色并生成穿戴'],
  ['04', '制作动作', '检查动作实例与正式帧'],
] as const

export function ProjectsPage({ apis }: ProjectsPageProps) {
  const [section, setSection] = useState<ProjectWorkspaceSection>('overview')
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    if (apis === undefined) {
      setState({ status: 'error', message: '角色接口尚未配置' })
      return
    }

    let cancelled = false
    setState({ status: 'loading' })
    loadCharacterCards(apis).then(
      (cards) => {
        if (!cancelled) setState({ status: 'ready', cards })
      },
      () => {
        if (!cancelled) setState({ status: 'error', message: '角色列表读取失败，请确认后端已启动' })
      },
    )

    return () => {
      cancelled = true
    }
  }, [apis])

  const activeSection =
    WORKSPACE_SECTIONS.find((workspaceSection) => workspaceSection.id === section) ??
    WORKSPACE_SECTIONS[0]

  return (
    // AppShell 的 <main> 会把内容限制在 max-w-5xl / px-6 / pt-24 / pb-8 内，
    // 这里全出血到视口宽度并抵消上下内边距，让工作台占满整屏。
    <div className="relative left-1/2 -mb-8 -mt-24 w-screen -translate-x-1/2 overflow-hidden">
      <section className="relative min-h-screen overflow-hidden bg-[#dfe3df] pt-24 text-[#171817] md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
        <AmbientGrid />
        <WorkspaceSidebar activeSection={activeSection.id} onSelect={setSection} />

        <div className="relative z-10 min-w-0">
          <header className="flex flex-col gap-8 border-b border-[#bdc7bf] px-6 py-9 sm:flex-row sm:items-end sm:justify-between sm:px-10 sm:py-11">
            <div>
              <p className="font-mono text-[9px] font-bold tracking-[0.18em] text-[#687069]">
                {activeSection.eyebrow}
              </p>
              <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.04em] sm:text-5xl">
                {activeSection.title}
              </h1>
              <p className="mt-3 max-w-2xl text-xs leading-6 text-[#687069]">
                {activeSection.description}
              </p>
            </div>

            <Link
              to="/quick-start"
              aria-label="开始创作"
              style={{ color: '#f3f6f2' }}
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-[#35583f] px-4 text-xs font-bold text-[#f3f6f2] transition hover:bg-[#456c51] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#35583f]"
            >
              开始创作
              <span aria-hidden="true" className="ml-3">
                →
              </span>
            </Link>
          </header>

          {activeSection.id === 'overview' ? (
            <WorkspaceOverview onSelect={setSection} />
          ) : activeSection.id === 'characters' ? (
            <CharacterAssetsSection state={state} />
          ) : (
            <AssetSectionEmptyState section={activeSection} />
          )}
        </div>
      </section>
    </div>
  )
}

function WorkspaceSidebar({
  activeSection,
  onSelect,
}: {
  activeSection: ProjectWorkspaceSection
  onSelect: (section: ProjectWorkspaceSection) => void
}) {
  return (
    <aside className="relative z-10 border-b border-[#bdc7bf] bg-[#dfe3df]/70 p-4 md:flex md:min-h-full md:flex-col md:border-r md:border-b-0">
      <div className="flex items-center justify-between px-2 py-2">
        <div>
          <p className="font-mono text-[8px] font-bold tracking-[0.17em] text-[#7c847d]">
            ASSET DESK
          </p>
          <h2 className="mt-1 text-sm font-semibold">项目资产</h2>
        </div>
        <span aria-label="项目服务状态：待连接" className="h-2 w-2 rounded-full bg-[#aab1aa]" />
      </div>

      <label className="mt-3 block">
        <span className="sr-only">搜索项目资产</span>
        <input
          type="search"
          disabled
          placeholder="搜索项目资产"
          className="min-h-9 w-full rounded-lg border border-[#bdc7bf] bg-[#f7f8f4]/80 px-3 text-xs placeholder:text-[#7a817b] disabled:cursor-not-allowed disabled:opacity-80"
        />
      </label>

      <nav
        aria-label="项目资产导航"
        className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-1"
      >
        {WORKSPACE_SECTIONS.map((workspaceSection, index) => {
          const active = workspaceSection.id === activeSection

          return (
            <button
              key={workspaceSection.id}
              type="button"
              onClick={() => onSelect(workspaceSection.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-10 items-center gap-3 rounded-lg px-3 text-left text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#35583f] ${
                active
                  ? 'bg-[#f7f8f4] text-[#35583f] shadow-[0_8px_24px_rgba(31,43,35,0.08)]'
                  : 'text-[#687069] hover:bg-[#e7ebe5] hover:text-[#26372c]'
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-[#35583f]' : 'bg-[#b2b9b2]'}`}
              />
              <span>{workspaceSection.label}</span>
              <small
                aria-hidden="true"
                className="ml-auto hidden font-mono text-[8px] text-[#9aa19a] sm:block"
              >
                {String(index + 1).padStart(2, '0')}
              </small>
            </button>
          )
        })}
      </nav>

      <div className="mt-5 border-t border-[#bdc7bf] pt-5 md:mt-8">
        <p className="px-2 font-mono text-[8px] font-bold tracking-[0.16em] text-[#7c847d]">
          CURRENT PROJECT
        </p>
        <div className="mt-3 rounded-xl border border-dashed border-[#bdc7bf] bg-[#f7f8f4]/55 p-3">
          <strong className="block text-xs">暂无项目</strong>
          <p className="mt-1 text-[10px] leading-5 text-[#747d76]">连接项目服务后显示真实列表。</p>
        </div>
      </div>

      <p className="mt-auto hidden px-2 pt-8 text-[9px] leading-5 text-[#858d86] md:block">
        当前页面不会用演示数据冒充后端项目。
      </p>
    </aside>
  )
}

function WorkspaceOverview({
  onSelect,
}: {
  onSelect: (section: ProjectWorkspaceSection) => void
}) {
  const perspectives = Object.values(CHARACTER_PERSPECTIVE).join(' / ')
  const directions = Object.values(DIRECTIONAL_MOVEMENT).join(' / ')
  const sizeRange = `${SPRITE_SIZES[0]}–${SPRITE_SIZES.at(-1)} px`

  return (
    <div className="p-6 sm:p-10">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="flex min-h-[34rem] flex-col rounded-[1.35rem] border border-[#bdc7bf] bg-[#f7f8f4] p-6 shadow-[0_22px_60px_rgba(31,43,35,0.08)] sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[9px] font-bold tracking-[0.16em] text-[#687069]">
                CURRENT PROJECT
              </p>
              <h2 className="mt-3 font-serif text-3xl">等待项目数据</h2>
            </div>
            <span className="rounded-full border border-[#c9d0ca] bg-[#e7ebe5] px-3 py-1.5 text-[9px] font-semibold text-[#515a53]">
              接口待连接
            </span>
          </header>

          <div className="grid flex-1 place-items-center py-14 text-center">
            <div className="max-w-sm">
              <span aria-hidden="true" className="mx-auto block h-2 w-2 rounded-full bg-[#35583f]" />
              <p className="mt-6 font-serif text-2xl">选择项目后进入完整工作区</p>
              <p className="mt-3 text-[11px] leading-6 text-[#687069]">
                项目会统一保存角色、造型和动作使用的生成约束，并显示真实资产进度。
              </p>
            </div>
          </div>

          <footer className="grid gap-3 border-t border-[#d3d9d3] pt-5 sm:grid-cols-3">
            <ProjectConstraint label="游戏视角" value={perspectives} />
            <ProjectConstraint label="移动方向" value={directions} />
            <ProjectConstraint label="精灵尺寸" value={sizeRange} />
          </footer>
        </section>

        <div className="grid content-start gap-10">
          <section aria-label="资产目录">
            <header className="border-t border-[#96a198] pt-4">
              <p className="font-mono text-[9px] font-bold tracking-[0.16em] text-[#687069]">
                ASSET DIRECTORY
              </p>
              <h2 className="mt-2 font-serif text-2xl">资产目录</h2>
            </header>
            <div className="mt-4 border-b border-[#bdc7bf]">
              {ASSET_DIRECTORY.map(([index, title, detail, target]) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => onSelect(target)}
                  className="group grid w-full grid-cols-[2rem_1fr_auto] items-center gap-3 border-t border-[#bdc7bf] py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#35583f]"
                >
                  <small className="font-mono text-[8px] text-[#8c948d]">{index}</small>
                  <span>
                    <strong className="block text-xs font-semibold">{title}</strong>
                    <small className="mt-1 block text-[9px] text-[#737b74]">{detail}</small>
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-sm text-[#69736b] transition group-hover:translate-x-1"
                  >
                    →
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section aria-label="制作链路">
            <header className="border-t border-[#96a198] pt-4">
              <p className="font-mono text-[9px] font-bold tracking-[0.16em] text-[#687069]">
                PRODUCTION FLOW
              </p>
              <h2 className="mt-2 font-serif text-xl">制作链路</h2>
            </header>
            <ol className="mt-4 space-y-3">
              {PRODUCTION_FLOW.map(([index, title, detail]) => (
                <li key={index} className="grid grid-cols-[2rem_1fr] gap-3">
                  <span className="font-mono text-[8px] text-[#8c948d]">{index}</span>
                  <span>
                    <strong className="block text-[11px] font-semibold">{title}</strong>
                    <small className="mt-1 block text-[9px] leading-4 text-[#737b74]">
                      {detail}
                    </small>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}

/** 角色资产分区：接入真实数据的角色选择器，卡片链接到 /playtest/:characterId/:outfitId。 */
function CharacterAssetsSection({ state }: { state: LoadState }) {
  return (
    <div className="p-6 sm:p-10">
      {state.status === 'loading' && <SelectorMessage>加载角色列表中…</SelectorMessage>}
      {state.status === 'error' && <SelectorMessage tone="error">{state.message}</SelectorMessage>}
      {state.status === 'ready' && state.cards.length === 0 && (
        <SelectorMessage>还没有可试玩的角色。先去「创作」生成一个角色吧。</SelectorMessage>
      )}
      {state.status === 'ready' && state.cards.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {state.cards.map((card) => (
            <li key={`${card.characterId}:${card.outfitId}`}>
              <CharacterSelectorCard card={card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CharacterSelectorCard({ card }: { card: CharacterCard }) {
  return (
    <Link
      to={`/playtest/${card.characterId}/${card.outfitId}`}
      aria-label={`进入试玩：${card.title}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-[1.35rem] border border-[#bdc7bf] bg-[#f7f8f4] text-left shadow-[0_22px_60px_rgba(31,43,35,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-[#8f958b] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#35583f] motion-reduce:transform-none"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#e7ebe5]">
        {card.thumbnailUrl ? (
          <img
            src={card.thumbnailUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none"
          />
        ) : (
          <span className="grid h-full w-full place-items-center font-mono text-[10px] tracking-[0.18em] text-[#a2a69f]">
            NO PREVIEW
          </span>
        )}
        <span className="absolute left-3 top-3 rounded-full border border-[#d7dbd3] bg-white/85 px-2.5 py-1 font-mono text-[8px] font-semibold tracking-[0.16em] text-[#5b655d] backdrop-blur-sm">
          {card.actionCount} 动作
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <span className="font-mono text-[9px] font-semibold tracking-[0.18em] text-[#687069]">
          {card.outfitName}
        </span>
        <strong className="mt-2 block font-serif text-xl font-medium leading-tight tracking-[-0.025em] text-[#171817]">
          {card.title}
        </strong>
        <span className="mt-2 block text-sm leading-6 text-[#687069] line-clamp-3">
          {card.description}
        </span>

        <span className="mt-5 flex items-center justify-between border-t border-[#d3d9d3] pt-4 text-xs font-semibold text-[#35583f]">
          进入试玩
          <span
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transform-none"
          >
            →
          </span>
        </span>
      </div>
    </Link>
  )
}

function SelectorMessage({
  children,
  tone = 'default',
}: {
  children: string
  tone?: 'default' | 'error'
}) {
  return (
    <div className="rounded-[1.35rem] border border-dashed border-[#aeb9b0] bg-[#f7f8f4] p-10 text-center shadow-[0_22px_60px_rgba(31,43,35,0.08)]">
      <p className={`text-sm ${tone === 'error' ? 'text-[#9a3b34]' : 'text-[#687069]'}`}>
        {children}
      </p>
    </div>
  )
}

function AssetSectionEmptyState({ section }: { section: WorkspaceSection }) {
  return (
    <div className="grid gap-8 p-6 sm:p-10 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <section className="grid min-h-[32rem] place-items-center rounded-[1.35rem] border border-dashed border-[#aeb9b0] bg-[#f7f8f4] px-6 py-12 text-center shadow-[0_22px_60px_rgba(31,43,35,0.08)]">
        <div className="max-w-sm">
          <span aria-hidden="true" className="mx-auto block h-2 w-2 rounded-full bg-[#35583f]" />
          <h2 className="mt-6 font-serif text-3xl">暂无{section.title}</h2>
          <p className="mt-4 text-[11px] leading-6 text-[#687069]">
            选择一个真实项目后，这里会按项目关系展示{section.title}，不会混入演示数据。
          </p>
          <Link
            to="/quick-start"
            style={{ color: '#f3f6f2' }}
            className="mt-7 inline-flex min-h-10 items-center rounded-lg bg-[#35583f] px-4 text-xs font-semibold text-[#f3f6f2] transition hover:bg-[#456c51]"
          >
            创建第一项资产
          </Link>
        </div>
      </section>

      <aside>
        <header className="border-t border-[#96a198] pt-4">
          <p className="font-mono text-[9px] font-bold tracking-[0.16em] text-[#687069]">
            DATA STRUCTURE
          </p>
          <h2 className="mt-2 font-serif text-2xl">信息结构</h2>
        </header>
        <ol className="mt-4 border-b border-[#bdc7bf]">
          {section.fields?.map((field, index) => (
            <li
              key={field}
              className="grid grid-cols-[2rem_1fr] items-center gap-3 border-t border-[#bdc7bf] py-5"
            >
              <span className="font-mono text-[8px] text-[#8c948d]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>
                <strong className="block text-xs font-semibold">{field}</strong>
                <small className="mt-1 block text-[9px] text-[#737b74]">等待真实数据</small>
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  )
}

function ProjectConstraint({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#e7ebe5] px-4 py-3">
      <small className="font-mono text-[8px] tracking-[0.12em] text-[#858c85]">{label}</small>
      <strong className="mt-2 block text-xs font-semibold text-[#48544b]">{value}</strong>
    </div>
  )
}
