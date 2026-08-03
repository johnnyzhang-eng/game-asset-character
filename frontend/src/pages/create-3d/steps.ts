/**
 * 「3D 角色生成」引导流程的步骤定义与时序。
 *
 * 时序集中在这里而不是散落在组件里，理由是演示可靠性：现场要临时把某一步调快调慢时，
 * 只改这一个表，不用翻组件。全部是 setTimeout 假进度，不含任何网络调用。
 */

/** 流程阶段。`input` 是初始态，`applying` 之后跳转到试玩页。 */
export type Create3dStage = 'input' | 'tpose' | 'generating' | 'review' | 'applying'

/** 各阶段的停留时长（毫秒）。`input` 与 `review` 等用户操作，没有超时。 */
export const STAGE_DURATION_MS = {
  tpose: 1500,
  generating: 2500,
  applying: 2500,
} as const satisfies Partial<Record<Create3dStage, number>>

/** 套用默认动作时逐个点亮的动作。数量与 applying 时长共同决定点亮节奏。 */
export const DEFAULT_ACTIONS = [
  { id: 'idle', label: '待机' },
  { id: 'walk', label: '行走' },
  { id: 'run', label: '跑步' },
  { id: 'jump', label: '跳跃' },
  { id: 'attack', label: '攻击' },
] as const

/** 顶部进度条上展示的四个阶段标题。`input` 不占位。 */
export const STAGE_STEPS = [
  { stage: 'tpose', index: '01', title: '提取 T-pose 参考' },
  { stage: 'generating', index: '02', title: '生成 3D 模型' },
  { stage: 'review', index: '03', title: '审核你的 3D 模型' },
  { stage: 'applying', index: '04', title: '套用默认动作' },
] as const satisfies readonly { stage: Create3dStage; index: string; title: string }[]

/**
 * 落点：已 seed 的可试玩角色。
 * characterId=2 / outfitId=xed-bare-2bce1546 对应后端真实数据，不是占位。
 */
export const PLAYTEST_PATH = '/playtest/2/xed-bare-2bce1546'

/**
 * 演示素材，全部在 public/ 下，无需后端。
 *
 * public/ 里还有一张 `/xed-walk-preview.gif`，**故意不用**：那张图里的角色是另一个
 * 细身小人，与 xed_all.glb 的重装机器人明显不是同一个，摆在「套用默认动作」一步里
 * 会被现场一眼看出前后不一致。第 ④ 步只用动作 chip 逐个点亮。
 */
export const ASSETS = {
  tposeImage: '/xed-tpose.png',
  model: '/xed_all.glb',
} as const
