import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import type { Character, CharacterApis, ProjectApis } from '@/entities'

/**
 * 角色选择器 / 导入预览台。
 *
 * 后端列举角色需要 project_id（GET /characters?project_id=…），没有「列出全部角色」的端点，
 * 因此这里先取项目（ProjectApis.list），再按项目取角色（CharacterApis.listByProject），
 * 汇聚成一张可点击进入试玩的角色卡片网格。
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

export function ProjectsPage({ apis }: ProjectsPageProps) {
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

  return (
    <div className="relative left-1/2 -mb-8 -mt-24 w-screen -translate-x-1/2 overflow-hidden bg-[#e5e8e3] text-[#191b18]">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"
      />

      <section className="mx-auto min-h-screen max-w-5xl px-6 py-10 lg:py-14">
        <header className="mt-14 max-w-2xl">
          <p className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[#747973]">
            CHARACTER LIBRARY
          </p>
          <h1 className="mt-4 font-serif text-[clamp(2.4rem,5vw,3.6rem)] font-medium leading-[1.02] tracking-[-0.04em]">
            选择一个角色，进入试玩
          </h1>
          <p className="mt-5 text-base leading-8 text-[#666b64]">
            这里汇总了所有项目下的角色资产。点选任意角色即可载入试玩预览台，查看动作播放与逐帧核验。
          </p>
        </header>

        <div className="mt-10">
          {state.status === 'loading' && <SelectorMessage>加载角色列表中…</SelectorMessage>}
          {state.status === 'error' && <SelectorMessage tone="error">{state.message}</SelectorMessage>}
          {state.status === 'ready' && state.cards.length === 0 && (
            <SelectorMessage>还没有可试玩的角色。先去「创作」生成一个角色吧。</SelectorMessage>
          )}
          {state.status === 'ready' && state.cards.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.cards.map((card) => (
                <li key={`${card.characterId}:${card.outfitId}`}>
                  <CharacterSelectorCard card={card} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

function CharacterSelectorCard({ card }: { card: CharacterCard }) {
  return (
    <Link
      to={`/playtest/${card.characterId}/${card.outfitId}`}
      aria-label={`进入试玩：${card.title}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-[1.35rem] border border-[#cfd1ca] bg-[#f4f3ed] text-left transition duration-200 hover:-translate-y-0.5 hover:border-[#8f958b] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#263f2d] motion-reduce:transform-none"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#e8e9e2]">
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
        <span className="font-mono text-[9px] font-semibold tracking-[0.18em] text-[#747973]">
          {card.outfitName}
        </span>
        <strong className="mt-2 block font-serif text-xl font-medium leading-tight tracking-[-0.025em] text-[#191b18]">
          {card.title}
        </strong>
        <span className="mt-2 block text-sm leading-6 text-[#666b64] line-clamp-3">
          {card.description}
        </span>

        <span className="mt-5 flex items-center justify-between border-t border-[#dfe1da] pt-4 text-xs font-semibold text-[#263f2d]">
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
    <div className="rounded-[1.35rem] border border-dashed border-[#cfd1ca] bg-[#f4f3ed] p-10 text-center">
      <p className={`text-sm ${tone === 'error' ? 'text-[#9a3b34]' : 'text-[#666b64]'}`}>
        {children}
      </p>
    </div>
  )
}
