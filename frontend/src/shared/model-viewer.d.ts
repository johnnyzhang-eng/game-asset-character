import type { HTMLAttributes, Ref } from 'react'

/**
 * `<model-viewer>` 自定义元素的 JSX 类型声明。
 *
 * React 19 起 JSX 命名空间挂在 `react` 模块内（@types/react 19 的 index.d.ts 里
 * `namespace JSX { interface IntrinsicElements }`），不再是全局 `JSX`，
 * 所以这里必须用模块增强而不是 `declare global`。
 * 本文件顶部的 import 让它成为模块 —— 否则 `declare module 'react'` 会被当成
 * 模块「声明」把真实的 react 类型整个覆盖掉。
 *
 * 属性只声明本项目实际用到的那些。model-viewer 的属性名是连字符式的自定义属性，
 * 布尔类开关在 DOM 上按「是否存在」判定，所以类型放开到 `boolean | string`，
 * 调用处统一传空字符串（`camera-controls=""`），语义最无歧义。
 */
interface ModelViewerAttributes extends HTMLAttributes<HTMLElement> {
  /**
   * `HTMLAttributes` 不含 ref（React 把它放在 ClassAttributes 里），自定义元素要自己补。
   * 需要 ref 是因为 `load` 事件不冒泡、React 也不为自定义元素代理 onLoad，
   * 只能拿到真实节点后 addEventListener。
   */
  ref?: Ref<HTMLElement>
  src?: string
  alt?: string
  poster?: string
  /** eager 时立刻下载，不等进入视口 —— 演示里靠它提前预热模型 */
  loading?: 'auto' | 'lazy' | 'eager'
  reveal?: 'auto' | 'manual' | 'interaction'
  'camera-controls'?: boolean | string
  'auto-rotate'?: boolean | string
  /** 默认 3000ms —— 不显式设 0 的话模型前 3 秒纹丝不动，演示上会被当成坏了 */
  'auto-rotate-delay'?: string
  'rotation-per-second'?: string
  'shadow-intensity'?: string
  exposure?: string
  'camera-orbit'?: string
  'field-of-view'?: string
  'interaction-prompt'?: 'auto' | 'none'
  'touch-action'?: string
  'disable-zoom'?: boolean | string
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': ModelViewerAttributes
    }
  }
}
