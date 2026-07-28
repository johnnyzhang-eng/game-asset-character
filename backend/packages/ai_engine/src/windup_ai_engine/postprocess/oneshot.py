"""一次性动作(jump / attack / hit)的抽帧:裁动作起止 + 按状态切段。

与循环类(idle/walk/run)的根本差别:
- 循环类用 :mod:`.loop` 找步态周期抽单周期闭环;一次性动作**不能闭环** —— 首尾姿态不同,
  强行闭环会把落地帧接回蓄力帧,读起来是抽搐。
- i2v 出的 5s 视频里,真正的动作往往只占中间一段(前后是静止的起手/终态保持),直接均匀
  抽帧会浪费一半帧在不动的地方 → 需要先**裁到动作发生的区间**。
- jump 还要进一步**按状态切段**(蓄力/上升/顶点/下降/落地),因为引擎里悬空时长由物理
  决定、上升中可被打断,必须能分段播放。

纯 numpy / PIL,零 API。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

__all__ = [
    "find_motion_span",
    "first_action_end",
    "pick_oneshot",
    "split_jump_phases",
    "foot_line_series",
]


def _frame_energy(frames: list[Image.Image], size: int = 64) -> np.ndarray:
    """逐帧与前一帧的差异强度(灰度小图),长度 = len(frames)-1。"""
    gs = [np.asarray(f.convert("L").resize((size, size)), dtype=np.float32) for f in frames]
    return np.array([np.abs(gs[i + 1] - gs[i]).mean() for i in range(len(gs) - 1)])


def find_motion_span(frames: list[Image.Image], rel_thr: float = 0.25) -> tuple[int, int]:
    """定位"动作真正发生"的帧区间 ``[start, end]``(含端点)。

    以帧间差异强度超过峰值 ``rel_thr`` 倍的最早/最晚位置为界,并各留一帧余量。
    静止的起手与终态保持会被裁掉。
    """
    if len(frames) < 3:
        return 0, len(frames) - 1
    e = _frame_energy(frames)
    peak = float(e.max())
    if peak <= 1e-6:
        return 0, len(frames) - 1
    active = np.flatnonzero(e >= peak * rel_thr)
    if not len(active):
        return 0, len(frames) - 1
    start = max(0, int(active[0]) - 1)
    end = min(len(frames) - 1, int(active[-1]) + 2)
    return start, end


def first_action_end(
    frames: list[Image.Image], start: int, end: int, rise_factor: float = 1.25, min_gap: int = 2
) -> int:
    """在 ``[start, end]`` 内找**第一次**动作的结束帧。

    i2v 常在 5s 里把一次性动作**复读第二遍**(实测:提示词写了 "ONCE",兽人仍跳了两次),
    直接取整个区间会把两次动作压进一套序列帧。

    判据:以起始帧为参照算逐帧差异 ``dev``,取峰值后的**第一个谷底** —— 谷底=最接近
    起始姿态的时刻(落回地面 / 收回戒备),谷底之后 ``dev`` 重新上升即第二次动作起手。
    两个实测踩过的错解法:
      - 看"帧间安静":会在**顶点悬停**处误触发,把动作截在半空;
      - 看 dev 是否跌破峰值的固定比例:落地姿态与起始并不完全相同(实测谷底 10.4 vs
        峰值 24.9),阈值定高了切不动、定低了又会误切,不如直接找谷底。
    """
    if end - start < 3:
        return end
    ref = np.asarray(frames[start].convert("L").resize((64, 64)), dtype=np.float32)
    dev = np.array(
        [
            np.abs(np.asarray(f.convert("L").resize((64, 64)), dtype=np.float32) - ref).mean()
            for f in frames[start : end + 1]
        ]
    )
    peak_i = int(np.argmax(dev))
    valley_i, valley_v = peak_i, float(dev[peak_i])
    for i in range(peak_i + 1, len(dev)):
        if dev[i] < valley_v:
            valley_i, valley_v = i, float(dev[i])
        elif dev[i] > valley_v * rise_factor and i - valley_i >= min_gap:
            return min(end, start + valley_i)      # 谷底=第一次动作收势
    return end


def pick_oneshot(frames: list[Image.Image], n: int, first_only: bool = True) -> list[Image.Image]:
    """一次性动作抽 ``n`` 帧:裁到动作区间 → 只留第一次动作 → 区间内均匀取(不闭环)。

    ``first_only`` 默认开:防 i2v 在 5s 内复读第二遍动作被一起抽进来。
    """
    if len(frames) <= n:
        return frames
    start, end = find_motion_span(frames)
    if first_only:
        end = max(start + 1, first_action_end(frames, start, end))
    span = frames[start : end + 1]
    if len(span) <= n:
        return span
    idx = [round(i * (len(span) - 1) / (n - 1)) for i in range(n)]
    return [span[i] for i in idx]


def foot_line_series(frames: list[Image.Image], alpha_thr: int = 128) -> np.ndarray:
    """逐帧主体**底边** y 坐标(脚线)。跳跃时脚线先降(蹲)、再升(腾空)、再落回。"""
    out = []
    for f in frames:
        ys, _ = np.where(np.asarray(f.convert("RGBA"))[:, :, 3] > alpha_thr)
        out.append(float(ys.max()) if len(ys) else np.nan)
    arr = np.array(out, dtype=np.float32)
    if np.isnan(arr).any():                      # 空帧用邻近值补
        idx = np.arange(len(arr))
        good = ~np.isnan(arr)
        if good.any():
            arr = np.interp(idx, idx[good], arr[good])
        else:
            arr = np.zeros_like(arr)
    return arr


def split_jump_phases(frames: list[Image.Image]) -> dict[str, list[int]]:
    """按脚线轨迹把跳跃切成 crouch / rise / apex / fall / land 五段,返回每段的帧下标。

    判据:脚线 y 越小 = 人越高。最高点(y 最小)即 apex;起跳前脚线最低(蹲)处为 crouch
    结束;之后到 apex 为 rise,apex 之后到脚线回到地面高度为 fall,余下为 land。
    只依赖几何,不依赖模型。
    """
    n = len(frames)
    if n < 5:
        return {"rise": list(range(n))}
    y = foot_line_series(frames)
    apex = int(np.argmin(y))                     # 最高点
    ground = float(np.median([y[0], y[-1]]))     # 地面脚线
    # 起跳点:apex 之前脚线最低(数值最大 = 蹲得最深)的位置
    takeoff = int(np.argmax(y[: max(1, apex)])) if apex > 0 else 0
    # 落地点:apex 之后脚线首次回到地面附近
    after = y[apex:]
    back = np.flatnonzero(after >= ground - 2)
    landing = apex + int(back[0]) if len(back) else n - 1

    apex_lo = max(takeoff + 1, apex - 1)
    apex_hi = min(landing - 1, apex + 1)
    phases = {
        "crouch": list(range(0, takeoff + 1)),
        "rise": list(range(takeoff + 1, apex_lo)),
        "apex": list(range(apex_lo, apex_hi + 1)),
        "fall": list(range(apex_hi + 1, landing)),
        "land": list(range(landing, n)),
    }
    return {k: v for k, v in phases.items() if v}
