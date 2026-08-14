"""变异测试跑手 —— 证明新加的用例真的按住了判据,而不是陪跑。

用脚本而不是手改:手改会忘了还原,而**还原绝不能用 ``git checkout --``**(会连未提交的
改动一起丢)。这里的做法是内存里存原文、``try/finally`` 写回、结束核对 sha256。

    uv run python tests/_mutation_check.py
"""
from __future__ import annotations

import hashlib
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

# (说明, 文件, 原片段, 变异片段, 必须因此变红的用例)
MUTANTS = [
    (
        "连通段计数恒返回 2(双足人形的正常值)",
        "packages/ai_engine/src/windup_ai_engine/master_check.py",
        """    x0, y0, x1, y1 = box
    span = y1 - y0 - 1
    return tuple(
        len(_runs(mask[min(y1 - 1, y0 + int(round(frac * span))), x0:x1], MIN_LIMB_RUN_PX))
        for frac in LIMB_BANDS
    )""",
        "    return (2,) * len(LIMB_BANDS)",
        [
            "tests/test_master_check_shape_warnings.py::test_fused_legs_drop_to_one_segment_and_warn",
            "tests/test_master_check_shape_warnings.py::test_a_detached_prop_cannot_silence_the_fused_legs_warning",
            "tests/test_master_check_shape_warnings.py::test_antialiasing_speckles_do_not_inflate_the_segment_count",
        ],
    ),
    (
        "毛刺不再被滤掉(每段最少 1px)",
        "packages/ai_engine/src/windup_ai_engine/master_check.py",
        "MIN_LIMB_RUN_PX = 3",
        "MIN_LIMB_RUN_PX = 1",
        [
            "tests/test_master_check_shape_warnings.py::test_antialiasing_speckles_do_not_inflate_the_segment_count",
        ],
    ),
    (
        "数腿时不剔除画面里别的东西",
        "packages/ai_engine/src/windup_ai_engine/master_check.py",
        "    body = main_component(mask)",
        "    body = mask",
        [
            "tests/test_master_check_shape_warnings.py::test_a_detached_prop_cannot_silence_the_fused_legs_warning",
        ],
    ),
    (
        "独立色块一律并成一块(等于不报)",
        "packages/ai_engine/src/windup_ai_engine/master_check.py",
        "    return tuple(sorted(_label(mask)[1].values(), reverse=True))",
        "    return (int(mask.sum()),)",
        [
            "tests/test_master_check_shape_warnings.py::test_detached_prop_is_reported_as_an_extra_component",
            "tests/test_master_check_shape_warnings.py::test_component_sizes_are_ordered_largest_first",
        ],
    ),
    (
        "人工确认闸自动放行",
        "packages/app/src/windup_app/server/orchestrator/render3d_assets.py",
        '        return self._stem(key).with_suffix(".approved").is_file()',
        "        return True",
        [
            "tests/test_render3d_asset_endpoints.py::test_build_stops_at_the_review_gate_without_rigging",
            "tests/test_render3d_asset_endpoints.py::test_waiting_at_the_gate_forever_never_auto_approves",
        ],
    ),
    (
        "否掉待审模型时不删批准标记",
        "packages/app/src/windup_app/server/orchestrator/render3d_assets.py",
        """        stem = self._stem(key)
        for path in self._root.glob(f"{stem.name}.*"):
            path.unlink(missing_ok=True)""",
        '        self._stem(key).with_suffix(".glb").unlink(missing_ok=True)',
        [
            "tests/test_render3d_asset_endpoints.py::test_discard_after_a_failed_rig_clears_the_approval_marker",
        ],
    ),
    (
        "成本按前端方便抄的数字写死",
        "packages/app/src/windup_app/server/orchestrator/render3d_assets.py",
        'MODEL3D_CREDITS = CREDITS["Normal"]',
        "MODEL3D_CREDITS = 15",
        [
            "tests/test_render3d_asset_endpoints.py::test_cost_numbers_come_from_the_billing_implementation",
            "tests/test_render3d_asset_endpoints.py::test_status_always_carries_the_cost_even_before_anything_is_built",
        ],
    ),
    (
        "待审模型不上传(人无从查看)",
        "packages/app/src/windup_app/server/orchestrator/render3d_service.py",
        "            self._publish_for_review(outfit_key)",
        "            pass",
        [
            "tests/test_render3d_asset_endpoints.py::test_awaiting_review_hands_out_a_link_to_the_model",
        ],
    ),
]


def _run(node_ids: list[str]) -> tuple[bool, str]:
    """(全过?, 输出)。"""
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "--no-cov", *node_ids],
        cwd=ROOT, capture_output=True, text=True,
    )
    return done.returncode == 0, done.stdout + done.stderr


def _verify_harness(all_ids: list[str]) -> list[str]:
    """先验仪器:不加任何变异,这些 node id 必须**全部存在且全绿**。

    这一步不能省,因为读错的方向正好相反:node id 打错时 pytest 报 "no tests ran" 并
    **非零退出**,而跑手把非零一律读成"变异被杀死" —— 于是一个根本没跑过的用例会被
    当成守住了判据。(前端那个跑手栽的是同一件事的另一面:``-t`` 匹配不上时 vitest
    退出 0,七个变异体全部假"存活"。)
    """
    green, out = _run(all_ids)
    if not green:
        return [f"[跑手坏了] 未变异时基线就不绿:\n{out[-2000:]}"]
    if f"{len(all_ids)} passed" not in out:
        return [f"[跑手坏了] 期望跑 {len(all_ids)} 条,实际:\n{out[-2000:]}"]
    return []


def main() -> int:
    all_ids = sorted({node_id for m in MUTANTS for node_id in m[4]})
    broken = _verify_harness(all_ids)
    if broken:
        for line in broken:
            print(line)
        return 1

    files = sorted({m[1] for m in MUTANTS})
    originals = {f: (ROOT / f).read_text(encoding="utf-8") for f in files}
    digests = {f: hashlib.sha256(t.encode()).hexdigest() for f, t in originals.items()}
    failures: list[str] = []

    try:
        for label, path, before, after, node_ids in MUTANTS:
            target = ROOT / path
            source = originals[path]
            if source.count(before) != 1:
                failures.append(f"[锚点失效] {label}:片段在 {path} 里出现 {source.count(before)} 次")
                continue
            target.write_text(source.replace(before, after), encoding="utf-8")
            try:
                if _run(node_ids)[0]:
                    failures.append(f"[存活] {label}:变异后用例仍全绿 → 这些用例没按住它")
                else:
                    print(f"[杀死] {label}")
            finally:
                target.write_text(source, encoding="utf-8")
    finally:
        for f, text in originals.items():
            (ROOT / f).write_text(text, encoding="utf-8")
        for f, want in digests.items():
            got = hashlib.sha256((ROOT / f).read_text(encoding="utf-8").encode()).hexdigest()
            if got != want:
                failures.append(f"[还原失败] {f} sha256 {got} != {want}")

    for line in failures:
        print(line)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
