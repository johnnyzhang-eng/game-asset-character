/**
 * 变异测试跑手 —— 证明母版确认闸与建 3D 资产入口的用例真的按住了行为。
 *
 * 用脚本而不是手改：手改会忘了还原，而**还原绝不能用 `git checkout --`**（会连未提交的
 * 改动一起丢）。这里在内存里存原文、`try/finally` 写回、结束核对 sha256。
 *
 *     node scripts/mutation-check.mjs
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PAGE = 'src/pages/workflow-editor/index.tsx'

const MUTANTS = [
  {
    label: '母版还没确认就把建 3D 资产入口摆出来',
    file: PAGE,
    before: '        {input.character && outfit ? (',
    after: '        {input.character && outfit && false ? (',
    tests: ['触发按次计费之前把积分和金额摆在按钮上'],
  },
  {
    label: '成本从按钮上拿掉',
    file: PAGE,
    before: '            建 3D 资产（{cost.totalCredits} 积分 · 约 ¥{cost.totalCny}）',
    after: '            建 3D 资产',
    tests: ['触发按次计费之前把积分和金额摆在按钮上'],
  },
  {
    label: '成本改成前端写死的常量',
    file: PAGE,
    before: '  const cost = asset.cost',
    after:
      '  const cost = { ...asset.cost, model3dCredits: 20, autorigCredits: 10, ' +
      'totalCredits: 30, totalCny: 3.6 }',
    tests: ['成本数字来自后端返回，不是前端写死的常量'],
  },
  {
    label: '待审状态直接放行去绑骨（闸自动点头）',
    file: PAGE,
    before: "      {asset.state === 'awaiting_review' ? (",
    after:
      "      {asset.state === 'awaiting_review' && " +
      'Boolean(act(() => render3d.approveOutfitAsset(characterId, outfitId)) ?? true) ? (',
    tests: ['模型出来后停在确认闸上，没人点头就绝不绑骨'],
  },
  {
    label: '预检拒绝也允许确认母版',
    file: PAGE,
    before: "  const rejected = precheck.status === 'done' && !precheck.report.accepted",
    after: '  const rejected = false',
    tests: ['预检拒绝时不许确认，并说清为什么'],
  },
  {
    label: '预检警告不显示',
    file: PAGE,
    before: '      {report.warnings.map((warning) => (',
    after: '      {[].map((warning) => (',
    tests: ['警告只提示不挡路——侧视角色两腿重叠时这条判据必然误报'],
  },
  {
    label: '预检自身失败时连带把确认按钮禁掉',
    file: PAGE,
    before: '        disabled={branchBusy || rejected}',
    after: "        disabled={branchBusy || rejected || precheck.status !== 'done'}",
    tests: ['预检本身跑不通不连带把人挡在外面——它是旁证，不是准入条件'],
  },
]

function runTest(name) {
  const done = spawnSync(
    'npx',
    ['vitest', 'run', 'src/pages/workflow-editor/index.test.tsx', '-t', name],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const summary = `${done.stdout ?? ''}${done.stderr ?? ''}`
  const counts = [...summary.matchAll(/Tests\s+(.+)/g)].at(-1)?.[1] ?? ''
  return {
    green: done.status === 0,
    passed: Number(/(\d+) passed/.exec(counts)?.[1] ?? 0),
  }
}

/**
 * 先验仪器：不加任何变异，逐条跑本次要用到的用例名，要求**真的跑到了一条且是绿的**。
 *
 * 这一步不能省。`-t` 匹配不上任何用例时 vitest 会把全部用例 skip 掉并**退出 0** ——
 * 于是每个变异体都被报成"存活",而真相是一条用例都没跑。实测踩过:`-t` 里写了
 * `describe > it` 的层级串,那不是 vitest 的匹配格式,七个变异体全部假"存活"。
 */
function verifyHarness(names) {
  const broken = []
  for (const name of names) {
    const { green, passed } = runTest(name)
    if (!green || passed !== 1) {
      broken.push(`${name}（绿=${green}，跑到 ${passed} 条）`)
    }
  }
  return broken
}

const files = [...new Set(MUTANTS.map((m) => m.file))]
const originals = new Map(files.map((f) => [f, readFileSync(resolve(ROOT, f), 'utf8')]))
const digests = new Map(
  [...originals].map(([f, text]) => [f, createHash('sha256').update(text).digest('hex')]),
)
const failures = []

const brokenNames = verifyHarness([...new Set(MUTANTS.flatMap((m) => m.tests))])
if (brokenNames.length) {
  console.log('[跑手坏了] 未变异时这些用例名就没能各自跑到一条绿的：')
  for (const line of brokenNames) console.log(`  ${line}`)
  process.exit(1)
}

try {
  for (const mutant of MUTANTS) {
    const path = resolve(ROOT, mutant.file)
    const source = originals.get(mutant.file)
    const hits = source.split(mutant.before).length - 1
    if (hits !== 1) {
      failures.push(`[锚点失效] ${mutant.label}：片段出现 ${hits} 次`)
      continue
    }
    writeFileSync(path, source.replace(mutant.before, mutant.after))
    try {
      // 变异之后只看退出码：用例失败时 testing-library 会把整棵 DOM 打出来，
      // 末尾那行汇总常常被冲掉，parse 不到不等于没跑。仪器已在上面单独验过。
      if (mutant.tests.every((name) => runTest(name).green)) {
        failures.push(`[存活] ${mutant.label}：变异后用例仍全绿 → 这些用例没按住它`)
      } else {
        console.log(`[杀死] ${mutant.label}`)
      }
    } finally {
      writeFileSync(path, source)
    }
  }
} finally {
  for (const [file, text] of originals) writeFileSync(resolve(ROOT, file), text)
  for (const [file, want] of digests) {
    const got = createHash('sha256').update(readFileSync(resolve(ROOT, file), 'utf8')).digest('hex')
    if (got !== want) failures.push(`[还原失败] ${file} sha256 ${got} != ${want}`)
  }
}

for (const line of failures) console.log(line)
process.exit(failures.length ? 1 : 0)
