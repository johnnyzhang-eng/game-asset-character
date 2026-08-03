import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PlaytestAction } from '../model'
import {
  advanceRuntime,
  createRuntime,
  selectRuntimeAction,
  setDirectionInput,
  type Direction,
  type StageBounds,
} from './runtime'

const MOVEMENT_SPEED = 150
const MAX_FRAME_DELTA_MS = 50
const INITIAL_BOUNDS: StageBounds = { minX: 0, maxX: 0 }

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

function keyDirection(key: string): Direction | null {
  const normalized = key.toLowerCase()
  if (normalized === 'a' || normalized === 'arrowleft') return 'left'
  if (normalized === 'd' || normalized === 'arrowright') return 'right'
  return null
}

export function preloadActionFrames(
  actions: readonly PlaytestAction[],
  createImage?: () => HTMLImageElement,
): readonly HTMLImageElement[] {
  const imageFactory = createImage ?? (typeof Image === 'undefined' ? null : () => new Image())
  if (imageFactory === null) return []

  return [
    ...new Set(actions.flatMap((action) => action.frames.map((frame) => frame.imageUrl))),
  ].map((imageUrl) => {
    const image = imageFactory()
    image.src = imageUrl
    if (typeof image.decode === 'function') void image.decode().catch(() => undefined)
    return image
  })
}

export function usePlaytestRuntime(
  actions: readonly PlaytestAction[],
  initialActionId: string | null,
) {
  const [runtime, setRuntime] = useState(() => createRuntime(actions, initialActionId))
  const actionsRef = useRef(actions)
  const boundsRef = useRef<StageBounds>(INITIAL_BOUNDS)
  const activeInputsRef = useRef(new Map<string, Direction>())
  const preloadedImagesRef = useRef<readonly HTMLImageElement[]>([])

  useEffect(() => {
    actionsRef.current = actions
    activeInputsRef.current.clear()
    setRuntime(createRuntime(actions, initialActionId))
  }, [actions, initialActionId])

  useEffect(() => {
    preloadedImagesRef.current = preloadActionFrames(actions)
    return () => {
      preloadedImagesRef.current = []
    }
  }, [actions])

  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return

    let animationFrame = 0
    let previousTime: number | null = null
    const tick = (time: number) => {
      if (previousTime !== null) {
        const deltaMs = Math.min(time - previousTime, MAX_FRAME_DELTA_MS)
        setRuntime((current) =>
          advanceRuntime(current, actionsRef.current, deltaMs, boundsRef.current, MOVEMENT_SPEED),
        )
      }
      previousTime = time
      animationFrame = requestAnimationFrame(tick)
    }

    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [])

  const setDirection = useCallback(
    (direction: Direction, pressed: boolean, source: string = direction) => {
      if (pressed) activeInputsRef.current.set(source, direction)
      else activeInputsRef.current.delete(source)

      const stillHeld = [...activeInputsRef.current.values()].includes(direction)
      setRuntime((current) => setDirectionInput(current, actionsRef.current, direction, stillHeld))
    },
    [],
  )

  const clearDirections = useCallback(() => {
    activeInputsRef.current.clear()
    setRuntime((current) => {
      const withoutLeft = setDirectionInput(current, actionsRef.current, 'left', false)
      return setDirectionInput(withoutLeft, actionsRef.current, 'right', false)
    })
  }, [])

  /** Shift 是否按住(奔跑修饰键)。 */
  const runHeldRef = useRef(false)

  /**
   * 按 type 优先、name 兜底解析动作 id。
   * 有的角色"奔跑"后端 type 是 custom、名字才是「奔跑」(如 xed),故两条都留。
   */
  const actionIdFor = useCallback((type: string | null, names: readonly string[]): string | null => {
    const list = actionsRef.current
    if (type !== null) {
      const byType = list.find((a) => a.type === type && a.frames.length > 0)
      if (byType) return byType.id
    }
    const byName = list.find((a) => a.frames.length > 0 && names.some((n) => a.name.includes(n)))
    return byName?.id ?? null
  }, [])

  const selectById = useCallback((actionId: string | null) => {
    if (actionId === null) return
    setRuntime((current) => selectRuntimeAction(current, actionsRef.current, actionId))
  }, [])

  /** 移动中按是否按住 Shift 在 奔跑/行走 间切;非移动态不干预(仍由方向逻辑管 idle)。 */
  const applyRunStyle = useCallback(() => {
    if (activeInputsRef.current.size === 0) return
    selectById(
      runHeldRef.current ? actionIdFor('run', ['奔跑', '跑']) : actionIdFor('walk', ['行走', '走']),
    )
  }, [actionIdFor, selectById])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()

      // J = 攻击(单次触发;移动中也可打,松开方向键后回到移动态)
      if (key === 'j') {
        event.preventDefault()
        if (!event.repeat) selectById(actionIdFor('attack', ['攻击']))
        return
      }
      // Shift = 奔跑修饰键:移动中切到奔跑
      if (key === 'shift') {
        if (!event.repeat && !runHeldRef.current) {
          runHeldRef.current = true
          applyRunStyle()
        }
        return
      }

      const direction = keyDirection(event.key)
      if (direction === null) return
      event.preventDefault()
      if (event.repeat) return
      setDirection(direction, true, `keyboard:${event.code || event.key}`)
      if (runHeldRef.current) applyRunStyle()
    }

    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      const key = event.key.toLowerCase()
      // 松开 Shift:仍在移动则切回行走
      if (key === 'shift') {
        runHeldRef.current = false
        applyRunStyle()
        return
      }
      const direction = keyDirection(event.key)
      if (direction === null) return
      event.preventDefault()
      setDirection(direction, false, `keyboard:${event.code || event.key}`)
      if (runHeldRef.current) applyRunStyle()
    }

    const handleBlur = () => {
      runHeldRef.current = false
      clearDirections()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [applyRunStyle, actionIdFor, selectById, clearDirections, setDirection])

  const selectAction = useCallback((actionId: string) => {
    setRuntime((current) => selectRuntimeAction(current, actionsRef.current, actionId))
  }, [])

  const setBounds = useCallback((bounds: StageBounds) => {
    boundsRef.current = bounds
    setRuntime((current) => ({
      ...current,
      x: Math.min(bounds.maxX, Math.max(bounds.minX, current.x)),
    }))
  }, [])

  const action = useMemo(
    () => actions.find((candidate) => candidate.id === runtime.actionId) ?? null,
    [actions, runtime.actionId],
  )
  const frame = action?.frames[runtime.frameIndex] ?? action?.frames[0] ?? null

  return {
    runtime,
    action,
    frame,
    selectAction,
    setDirection,
    setBounds,
  }
}
