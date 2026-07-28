"""CharacterGenerator —— 装配 strategy + 最后一公里,串起整条生产线(架构串联点)。

这是 CharacterGeneratorPort 的实现;server 经 port 调它、不碰这里。
串联:选路线(ROUTE_MATRIX)→ strategy.derive 出帧 → 最后一公里(脚线对齐)→
打包(sprite sheet)+ 存储 → 资产包。
对齐 / 打包已迁自 windup-pipeline 的 postprocess(脚线锚点对齐 + 拼图集);循环闭合
(tail_match)与多格式导出(#21 / #22)后续叠加。
"""
from __future__ import annotations

import io

from PIL import Image

from windup_common.models import (
    ActionSpec,
    ActionType,
    AssetPackageRef,
    CharacterCard,
    GenRoute,
)

from windup_ai_engine.ports import Callbacks, CharacterGeneratorPort
from windup_ai_engine.postprocess import (
    align_bottom_center,
    extract_root_motion,
    frame_durations,
    sprite_sheet,
)
from windup_ai_engine.strategy.base import ROUTE_MATRIX, DerivationStrategy


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, "PNG")
    return buf.getvalue()


def _img(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("RGBA")


class CharacterGenerator(CharacterGeneratorPort):
    """由 bootstrap 注入 {GenRoute: DerivationStrategy} 装配表。"""

    def __init__(self, strategies: dict[GenRoute, DerivationStrategy]) -> None:
        self._by_route = strategies

    def generate(
        self, card: CharacterCard, action: ActionSpec, cb: Callbacks
    ) -> AssetPackageRef:
        # ① 选路线(架构决策矩阵)
        route = ROUTE_MATRIX[action.action]
        cb.progress.step("route", 0, 3, f"{action.action} → {route.value}")
        strategy = self._by_route[route]

        # ② 生成帧(交给 strategy —— 串联)
        frames = strategy.derive(card, action, cb)

        # ③ 最后一公里 + 打包(护城河,串联)
        frames, motion = self._lastmile(frames, action, cb)
        return self._package(card, action, frames, cb, motion)

    def _lastmile(
        self, frames: list[bytes], action: ActionSpec, cb: Callbacks
    ) -> tuple[list[bytes], list[tuple[int, int]]]:
        """脚线对齐 + 抽出 root motion。返回(原地序列帧, 逐帧位移)。

        业界惯例:位移**不烘进像素**,序列帧保持原地、位移交引擎驱动(玩家要即时操控;
        平台游戏跳跃=姿势定格 + 引擎物理)。故先从对齐前的帧量出位移轨道,再把帧对齐成原地。
        """
        cb.progress.step("lastmile", 1, 3, "抽 root motion + 脚线对齐(原地)")
        if not frames or not all(frames):   # 含空桩帧(未开发路线)→ 跳过
            return frames, []
        imgs = [_img(f) for f in frames]
        motion = extract_root_motion(imgs)          # 位移轨道交引擎
        # 参考姿态高 = 各帧包围盒高的中位数:比"最高帧"稳(不被举过头顶的武器带偏),
        # 各动作都以自身中位姿态定标,本体尺寸跨动作一致。
        import numpy as _np
        _hs = []
        for _im in imgs:
            _ys, _ = _np.where(_np.asarray(_im)[:, :, 3] > 128)
            if len(_ys):
                _hs.append(float(_ys.max() - _ys.min()))
        aligned = align_bottom_center(imgs, ref_height=(float(_np.median(_hs)) if _hs else None))
        # TODO(dev, #21): tail_match 循环闭合(净位移动作先锚点再匹配帧)
        return [_png(im) for im in aligned], motion

    def _package(
        self,
        card: CharacterCard,
        action: ActionSpec,
        frames: list[bytes],
        cb: Callbacks,
        motion: list[tuple[int, int]] | None = None,
    ) -> AssetPackageRef:
        cb.progress.step("package", 2, 3, "sprite sheet + 存储")
        sheet_ref = ""
        valid = [f for f in frames if f]
        if valid:
            sheet_png = _png(sprite_sheet([_img(f) for f in valid]))
            sheet_ref = cb.store.put("sheet", sheet_png, {"action": action.action.value})
        # TODO(dev, #22): 写 Cocos plist(SpriteFrames)→ plist_ref
        # 关键帧定格:attack 取位移/形变最大处(触点),jump 取最高点(顶点)
        key = None
        if motion:
            if action.action is ActionType.ATTACK:
                key = max(range(len(motion)), key=lambda i: abs(motion[i][0]))
            elif action.action is ActionType.JUMP:
                key = max(range(len(motion)), key=lambda i: motion[i][1])
        return AssetPackageRef(
            character=card.name,
            action=action.action,
            fps=action.fps,
            sheet_ref=sheet_ref,
            frame_refs=[cb.store.put("frame", f, {"i": i}) for i, f in enumerate(frames)],
            root_motion=motion or [],
            durations=frame_durations(action.action.value, len(frames), key_frame=key),
        )
