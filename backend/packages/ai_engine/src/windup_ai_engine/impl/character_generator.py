"""CharacterGenerator —— 装配 strategy + 最后一公里,串起整条生产线(架构串联点)。

这是 CharacterGeneratorPort 的实现;server 经 port 调它、不碰这里。
串联:选路线(ROUTE_MATRIX)→ strategy.derive 出帧 → 最后一公里(脚线对齐)→ GeneratedAction。

MVP 边界(与作者对齐):**只出帧 bytes + 逐帧时长**,不打包 sprite sheet、不落存储——
上传对象存储、写 character_data、拼图集/多格式导出由 server / export 侧做(#22)。
"""
from __future__ import annotations

import io

from PIL import Image

from windup_common.models import ActionSpec, CharacterCard, GenRoute

from windup_ai_engine.ports import (
    CharacterGeneratorPort,
    GeneratedAction,
    ProgressPort,
)
from windup_ai_engine.postprocess import align_bottom_center, frame_durations
from windup_ai_engine.strategy.base import ROUTE_MATRIX, DerivationStrategy


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, "PNG")
    return buf.getvalue()


def _img(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("RGBA")


class CharacterGenerator(CharacterGeneratorPort):
    """由 bootstrap 注入 {GenRoute: DerivationStrategy} 装配表。"""

    def __init__(
        self,
        strategies: dict[GenRoute, DerivationStrategy],
        *,
        align_cell: int = 256,
        ref_height: float | None = None,
    ) -> None:
        """``align_cell``:对齐画布边长——插画风想要高清演示可传 512(角色不再被压到
        ~159px);游戏原生 256 精灵用默认。``ref_height``:跨动作**统一定标高**(站立姿态
        像素高)——多动作共用一张母版时传同一值,攻击举剑/跳跃蹲姿就不会各自缩放到不同大小。
        """
        self._by_route = strategies
        self._align_cell = align_cell
        self._ref_height = ref_height

    def generate(
        self,
        card: CharacterCard,
        action: ActionSpec,
        master: bytes,
        progress: ProgressPort,
    ) -> GeneratedAction:
        # ① 选路线(架构决策矩阵)
        route = ROUTE_MATRIX[action.action]
        progress.step("route", 0, 3, f"{action.action} → {route.value}")
        strategy = self._by_route[route]

        # ② 生成帧(交给 strategy —— 串联)
        frames = strategy.derive(card, action, master, progress)

        # ③ 最后一公里:脚线对齐成原地序列帧
        frames = self._lastmile(frames, progress, stylize=action.stylize)

        # ④ 出参:帧 + 逐帧时长(上传 / 落库在 server 侧)
        progress.step("package", 2, 3, f"{len(frames)} 帧 + 逐帧时长")
        return GeneratedAction(
            frames=frames,
            durations=frame_durations(action.action.value, len(frames)),
            fps=action.fps,
        )

    def _lastmile(
        self, frames: list[bytes], progress: ProgressPort, stylize: str = "none"
    ) -> list[bytes]:
        """脚线对齐:把各帧对齐成原地序列帧(消除逐帧画布漂移,Issue #21)。

        位移轨道(root_motion)MVP 先不做(见 #63 / character_data.frames 暂无该字段):
        序列帧保持原地即可,位移留给后续 export / playtest 阶段再算。
        """
        progress.step("lastmile", 1, 3, "脚线对齐(原地)")
        if not frames or not all(frames):   # 含空桩帧(未开发路线)→ 跳过
            return frames
        imgs = [_img(f) for f in frames]
        # 定标高:优先用注入的**统一 ref_height**(跨动作同尺寸);否则回退各帧包围盒高的
        # 中位数(比"最高帧"稳,不被举过头顶的武器带偏)。
        import numpy as _np
        ref = self._ref_height
        if ref is None:
            _hs = []
            for _im in imgs:
                _ys, _ = _np.where(_np.asarray(_im)[:, :, 3] > 128)
                if len(_ys):
                    _hs.append(float(_ys.max() - _ys.min()))
            ref = float(_np.median(_hs)) if _hs else None
        # 插画风 LANCZOS 保清晰;像素画 NEAREST 保像素边(pixelate 已吸附网格)。
        from PIL import Image as _Image
        resample = _Image.NEAREST if stylize == "pixel" else _Image.LANCZOS
        aligned = align_bottom_center(
            imgs, cell=self._align_cell, ref_height=ref, resample=resample
        )
        # TODO(dev, #21): tail_match 循环闭合(净位移动作先锚点再匹配帧)
        return [_png(im) for im in aligned]
