/**
 * 17×17 画布点阵：同心延迟脉冲 + 光标移动 / 描边动画，纯装饰、不承载业务状态。
 * 视觉与动画由 quick-start.css 的 .quick-start-pixel-field 系列类驱动。
 */
export function DynamicPixelField() {
  return (
    <div className="quick-start-pixel-field mx-auto" aria-hidden="true">
      {Array.from({ length: 289 }, (_, index) => {
        const x = index % 17
        const y = Math.floor(index / 17)
        const frame =
          ((y === 3 || y === 13) && x >= 3 && x <= 13) ||
          ((x === 3 || x === 13) && y >= 3 && y <= 13)
        const handle = (x === 2 || x === 14) && (y === 2 || y === 14)
        const cursor = [
          [8, 7],
          [8, 8],
          [8, 9],
          [8, 10],
          [8, 11],
          [9, 8],
          [9, 9],
          [9, 10],
          [10, 9],
          [10, 10],
          [11, 10],
          [10, 11],
          [11, 12],
        ].some(([pixelX, pixelY]) => pixelX === x && pixelY === y)
        const guide = (y === 6 && x >= 5 && x <= 7) || (x === 6 && y >= 5 && y <= 7)
        const ring = Math.min(8, Math.floor(Math.hypot(x - 8, y - 8)))
        const phase = (x + y) % 4
        const role = handle
          ? 'is-active is-handle'
          : cursor
            ? 'is-active is-cursor'
            : frame || guide
              ? 'is-active'
              : ''

        return (
          <i
            key={index}
            className={`quick-start-pixel-ring-${ring} quick-start-pixel-phase-${phase} ${role}`}
          />
        )
      })}
    </div>
  )
}
