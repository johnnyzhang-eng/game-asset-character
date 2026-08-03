import '@google/model-viewer'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import {
  ASSETS,
  DEFAULT_ACTIONS,
  PLAYTEST_PATH,
  STAGE_DURATION_MS,
  STAGE_STEPS,
  type Create3dStage,
} from './steps'

/**
 * 「3D 角色生成」引导流程页（演示用，全程 mock）。
 *
 * 五步：输入 → 提取 T-pose → 生成 3D → 审核（真 3D，可拖动旋转）→ 套用动作 → 跳试玩页。
 *
 * 三条为「演示不能翻车」做的设计，改动前请先读：
 *
 * 1. **不发任何网络请求**。时序全是 setTimeout（时长见 steps.ts），prompt 只是装饰，
 *    内容被忽略，永远产出 xed。落点 /playtest/2/xed-bare-2bce1546 是已 seed 的真实角色。
 *
 * 2. **model-viewer 从第 ② 步就挂载，只是看不见**（off-screen + opacity-0 + loading="eager"）。
 *    3.4MB 的 GLB 在假进度那 2.5 秒里就下载完，进第 ③ 步时是同一个 DOM 节点显形，
 *    不重新挂载、不重新下载 —— 现场不会出现「点了确认，模型转圈半天」。
 *    这也是为什么「重新生成」不卸载它：卸载再挂会重新拉一次模型。
 *
 * 3. **所有定时器集中登记、切步与卸载时统一清理**。演示时会有人反复点「重新生成」，
 *    残留定时器会让流程自己往前跳 —— 这是最容易在台上出丑的一类 bug。
 *
 * 4. **按钮文字样式挂在内层 span,不挂 button 本身**。
 *    workflow-shell.css:45 有一条没放进 @layer 的全局 `button, a { color: inherit; font: inherit }`,
 *    无层级样式在级联里压过 Tailwind 的 @layer utilities，于是 button 上的
 *    text-* 颜色 / font-bold / 连 text-sm 字号全部失效（全站现象，不止本页；
 *    quick-start 的绿色按钮同样是深色字）。那个文件不属于本次改动范围，
 *    所以这里用「文字包一层 span」绕开 —— 无层级规则只命中 button/a，不管 span。
 */
export function Create3dPage() {
  const navigate = useNavigate()
  const [stage, setStage] = useState<Create3dStage>('input')
  const [prompt, setPrompt] = useState('')
  const [litActions, setLitActions] = useState(0)
  const [modelReady, setModelReady] = useState(false)
  const [progressFilled, setProgressFilled] = useState(false)
  const viewerRef = useRef<HTMLElement | null>(null)

  /** 已登记的定时器。切步或卸载时一次清空，避免上一段时序继续推进。 */
  const timers = useRef<number[]>([])
  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
  }, [])
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  /**
   * 进度条：进入 generating 时先归零，下一帧再置满，让 transition 有起点可动。
   * 同帧内从 0 直接改 100 浏览器会合并成一次布局，看不到动画。
   */
  useEffect(() => {
    if (stage !== 'generating') {
      setProgressFilled(false)
      return
    }
    const raf = requestAnimationFrame(() => setProgressFilled(true))
    return () => cancelAnimationFrame(raf)
  }, [stage])

  /**
   * 模型就绪：用 ref + addEventListener 监听，而不是 JSX 上的 onLoad。
   * React 的合成事件不为自定义元素代理 load（load 也不冒泡），
   * 写 onLoad 会静默不触发 —— 那样界面会一直停在「模型载入中…」，演示上很难看。
   */
  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const onLoad = () => setModelReady(true)
    el.addEventListener('load', onLoad)
    return () => el.removeEventListener('load', onLoad)
  }, [stage])

  /** 从输入态起跑：提取 T-pose → 生成 3D → 停在审核态等用户操作。 */
  const start = useCallback(() => {
    clearTimers()
    setLitActions(0)
    setStage('tpose')
    later(() => {
      setStage('generating')
      later(() => setStage('review'), STAGE_DURATION_MS.generating)
    }, STAGE_DURATION_MS.tpose)
  }, [clearTimers, later])

  /** 重新生成：只重播第 ② 步，不回到输入态，也不卸载 model-viewer。 */
  const regenerate = useCallback(() => {
    clearTimers()
    setStage('generating')
    later(() => setStage('review'), STAGE_DURATION_MS.generating)
  }, [clearTimers, later])

  /** 确认模型 → 逐个点亮动作 → 跳试玩页。 */
  const confirmModel = useCallback(() => {
    clearTimers()
    setLitActions(0)
    setStage('applying')

    const step = STAGE_DURATION_MS.applying / (DEFAULT_ACTIONS.length + 1)
    DEFAULT_ACTIONS.forEach((_, index) => {
      later(() => setLitActions(index + 1), step * (index + 1))
    })
    later(() => navigate(PLAYTEST_PATH), STAGE_DURATION_MS.applying)
  }, [clearTimers, later, navigate])

  const activeIndex = STAGE_STEPS.findIndex((item) => item.stage === stage)
  /** 第 ② 步起就挂 model-viewer（隐藏预热），第 ③ 步显形。 */
  const viewerMounted = stage === 'generating' || stage === 'review' || stage === 'applying'
  const viewerVisible = stage === 'review'

  return (
    <section className="relative min-h-[640px] overflow-hidden rounded-[2rem] border border-[#c9d0ca] bg-[#dfe3df] text-[#191b18] shadow-[0_26px_80px_rgba(31,43,35,0.10)]">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"
      />

      <div className="relative mx-auto grid max-w-4xl gap-7 px-6 py-9 sm:px-9">
        <header>
          <p className="font-mono text-[9px] font-semibold tracking-[0.18em] text-[#8b9089]">
            3D CHARACTER · MOCK PREVIEW
          </p>
          <h1 className="mt-3 font-serif text-[clamp(1.9rem,4vw,2.7rem)] font-medium leading-[1.06] tracking-[-0.03em]">
            生成你的 3D 角色
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-7 text-[#666b64]">
            描述一个角色，得到可旋转审核的 3D 模型与一套默认动作，直接进入试玩。
          </p>
        </header>

        {/* 阶段指示条：输入态不显示，避免首屏被流程条占掉注意力 */}
        {stage !== 'input' && (
          <ol
            aria-label="生成进度"
            className="grid grid-cols-2 gap-2 border-y border-[#c9d0ca] py-3 sm:grid-cols-4"
          >
            {STAGE_STEPS.map((item, index) => {
              const done = index < activeIndex
              const current = index === activeIndex
              return (
                <li key={item.stage} className="flex items-baseline gap-2">
                  <span
                    className={`font-serif text-xs tabular-nums ${
                      current ? 'text-[#35583f]' : done ? 'text-[#8fa092]' : 'text-[#a2a69f]'
                    }`}
                  >
                    {item.index}
                  </span>
                  <strong
                    className={`text-xs font-semibold ${
                      current ? 'text-[#191b18]' : done ? 'text-[#687069]' : 'text-[#a2a69f]'
                    }`}
                  >
                    {item.title}
                  </strong>
                  {done && (
                    <span aria-hidden="true" className="text-[10px] text-[#8fa092]">
                      ✓
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        )}

        {/* 无障碍播报：视觉上的阶段变化对读屏用户也要可感知 */}
        <p aria-live="polite" className="sr-only">
          {stage === 'input' ? '等待输入角色描述' : (STAGE_STEPS[activeIndex]?.title ?? '')}
        </p>

        {stage === 'input' && (
          <div className="grid gap-3 rounded-[1.4rem] border border-[#bdc7bf] bg-[#f7f8f4] p-4 shadow-[0_22px_60px_rgba(31,43,35,0.12)] sm:grid-cols-[1fr_auto]">
            <label className="grid gap-2">
              <span className="font-mono text-[9px] font-semibold tracking-[0.18em] text-[#8b9089]">
                DESCRIBE YOUR CHARACTER
              </span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                placeholder="描述你的 3D 角色，例如：一台被判废又重启的重装机器人，胸口有发光的核心。"
                className="w-full resize-none rounded-xl border border-[#c9d0ca] bg-white/70 px-4 py-3 text-sm leading-7 text-[#191b18] placeholder:text-[#a2a69f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#35583f]"
              />
            </label>
            <button
              type="button"
              onClick={start}
              className="min-h-20 min-w-36 self-end rounded-[1rem] bg-[#35583f] px-5 transition hover:bg-[#456c51] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#35583f]"
            >
              {/* 文字样式挂在 span 上,原因见文件顶部注释第 4 条 */}
              <span className="text-sm font-bold text-[#f3f6f2]">生成 3D 模型</span>
            </button>
          </div>
        )}

        {stage === 'tpose' && (
          <figure className="grid gap-3 rounded-[1.4rem] border border-[#c4cbc5] bg-[#eef1ed]/90 p-5">
            <figcaption className="flex items-center gap-2 text-xs font-semibold text-[#35583f]">
              <i
                aria-hidden="true"
                className="h-2 w-2 animate-pulse rounded-full bg-[#35583f] motion-reduce:animate-none"
              />
              正在提取 T-pose 参考…
            </figcaption>
            <img
              src={ASSETS.tposeImage}
              alt="角色 T-pose 参考图"
              className="mx-auto h-[380px] w-auto rounded-xl border border-[#c7cec8] bg-[#e7ebe6] object-contain p-2"
            />
          </figure>
        )}

        {stage === 'generating' && (
          <div className="grid min-h-[380px] place-items-center gap-5 rounded-[1.4rem] border border-[#c4cbc5] bg-[#eef1ed]/90 p-5">
            <div className="grid justify-items-center gap-4">
              <i
                aria-hidden="true"
                className="h-14 w-14 animate-spin rounded-full border-2 border-[#c7cec8] border-t-[#35583f] motion-reduce:animate-none"
              />
              <strong className="text-sm font-semibold text-[#191b18]">生成 3D 模型…</strong>
              <p className="max-w-sm text-center text-xs leading-6 text-[#747973]">
                正在把 T-pose 参考重建为带骨骼的 3D 模型。
              </p>
              {/*
                假进度条。刻意用「state + transition」而不是 CSS keyframes：
                keyframes 要在全局 css 里额外定义，漏了就变成一根静止的条，
                而这里不该为了一根进度条去改共享样式文件。
              */}
              <span className="block h-1.5 w-64 overflow-hidden rounded-full bg-[#d9ded8]">
                <i
                  aria-hidden="true"
                  style={{ width: progressFilled ? '100%' : '4%' }}
                  className="block h-full rounded-full bg-[#35583f] transition-[width] duration-[2400ms] ease-out"
                />
              </span>
            </div>
          </div>
        )}

        {stage === 'applying' && (
          <div className="grid min-h-[380px] content-center gap-6 rounded-[1.4rem] border border-[#c4cbc5] bg-[#eef1ed]/90 p-6">
            <div className="grid justify-items-center gap-2">
              <strong className="text-sm font-semibold text-[#191b18]">套用默认动作…</strong>
              <p className="text-xs text-[#747973]">共 {DEFAULT_ACTIONS.length} 个动作</p>
            </div>
            <ul className="flex flex-wrap justify-center gap-2.5">
              {DEFAULT_ACTIONS.map((action, index) => {
                const lit = index < litActions
                return (
                  <li
                    key={action.id}
                    className={`flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition duration-300 ${
                      lit
                        ? 'border-[#8fa092] bg-[#e4ebe2] text-[#35583f]'
                        : 'border-[#d0d6cf] bg-[#e9ece7] text-[#a2a69f]'
                    }`}
                  >
                    <i
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${lit ? 'bg-[#35583f]' : 'bg-[#c6ccc4]'}`}
                    />
                    {action.label}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/*
          model-viewer 容器。
          必须给明确宽高，否则自定义元素高度为 0、什么都不显示。
          第 ② 步起就挂载并 loading="eager" 预热；未到审核态时移出视口而不是 display:none
          —— 隐藏元素会让浏览器/元素自身跳过加载，预热就白做了。
        */}
        {viewerMounted && (
          <div
            className={
              viewerVisible
                ? 'grid gap-4 rounded-[1.4rem] border border-[#c4cbc5] bg-[#eef1ed]/90 p-5'
                : 'pointer-events-none absolute -left-[9999px] top-0 h-[380px] w-[640px] opacity-0'
            }
            aria-hidden={viewerVisible ? undefined : true}
          >
            {viewerVisible && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <strong className="text-sm font-semibold text-[#191b18]">审核你的 3D 模型</strong>
                <span className="rounded-full border border-[#bcc6be] bg-[#f3f5f1]/80 px-3 py-1.5 text-[11px] font-medium text-[#35583f]">
                  拖动旋转查看
                </span>
              </div>
            )}

            <model-viewer
              src={ASSETS.model}
              alt="生成的 3D 角色模型，可拖动旋转查看"
              camera-controls=""
              auto-rotate=""
              auto-rotate-delay="0"
              rotation-per-second="30deg"
              shadow-intensity="1"
              exposure="1"
              loading="eager"
              interaction-prompt="none"
              ref={viewerRef}
              className="h-[380px] w-full rounded-xl border border-[#c7cec8] bg-[#e7ebe6]"
            />

            {viewerVisible && (
              <>
                <p className="text-xs text-[#747973]">
                  {modelReady
                    ? '模型已就绪。左键拖动旋转，滚轮缩放。'
                    : '模型载入中…'}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={regenerate}
                    className="min-h-12 rounded-[1rem] border border-[#c4cbc5] bg-[#f7f8f4] px-5 transition hover:border-[#8fa092] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#35583f]"
                  >
                    <span className="text-sm font-semibold text-[#35583f]">重新生成</span>
                  </button>
                  <button
                    type="button"
                    onClick={confirmModel}
                    className="min-h-12 rounded-[1rem] bg-[#35583f] px-6 transition hover:bg-[#456c51] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#35583f]"
                  >
                    <span className="text-sm font-bold text-[#f3f6f2]">确认模型</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
