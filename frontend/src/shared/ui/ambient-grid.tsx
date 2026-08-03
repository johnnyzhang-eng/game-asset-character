/** 页面级灰绿网格背景，不承载任何 Windup 业务状态。 */
export function AmbientGrid() {
  return (
    <div
      data-ambient-grid
      className="pointer-events-none absolute inset-0 opacity-50"
      aria-hidden="true"
      style={{
        backgroundImage:
          'linear-gradient(rgba(53, 88, 63, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(53, 88, 63, 0.045) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
        maskImage: 'linear-gradient(to bottom, black, transparent 84%)',
      }}
    />
  )
}
