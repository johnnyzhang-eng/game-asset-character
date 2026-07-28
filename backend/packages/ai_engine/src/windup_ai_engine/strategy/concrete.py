"""三条 DerivationStrategy。

- VideoFrameStrategy：**已迁入 windup-pipeline 实测通路**（walk 主链，2026-07-27 验证）。
- PerFrameStrategy / ProcIdleStrategy：桩，待开发（见 #53，per-frame / idle 非首个竖线）。

VideoFrameStrategy 实测通路：严格侧面母版 → kling i2v(v2-5-turbo) → 抽单循环 N 帧 →
matte 抠图 → 像素化。返回对齐前的 RGBA PNG 帧（对齐 / 打包在 CharacterGenerator 最后一公里）。
"""
from __future__ import annotations

import io

from PIL import Image

from windup_common.models import ActionSpec, CharacterCard, GenRoute
from windup_framework.providers import ImageProvider, MatteProvider, VideoProvider

from windup_ai_engine.ports import Callbacks
from windup_ai_engine.postprocess import extract_frames_bytes, pixelate_frames
from windup_ai_engine.prompt import build_walk_prompt
from windup_ai_engine.strategy.base import DerivationStrategy

# 像素化默认参数（角色约占这么多像素行 + 色板色数）。
_PIX_H = 100
_PALETTE = 32


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, "PNG")
    return buf.getvalue()


def _img(png: bytes) -> Image.Image:
    return Image.open(io.BytesIO(png)).convert("RGBA")


class VideoFrameStrategy(DerivationStrategy):
    """步态 / 爆发动作（walk / run / attack）：严格侧面母版 → i2v 视频 → 抽帧 → 抠图 → 像素化。

    唯一硬前提=严格侧面母版（正面母版会让 i2v 边走边转身，实测 #35）。
    """

    route = GenRoute.VIDEO_I2V

    def __init__(self, video: VideoProvider, matte: MatteProvider) -> None:
        self._video = video
        self._matte = matte

    def derive(
        self, card: CharacterCard, action: ActionSpec, cb: Callbacks
    ) -> list[bytes]:
        n = action.n_frames or 8
        cb.progress.step("derive", 0, 3, f"{action.action}: i2v 生成视频")
        master = cb.store.get(card.master_ref)              # 严格侧面母版 bytes
        prompt = build_walk_prompt()                        # 只写正向腿部机制 + STRICT SIDE
        video = self._video.i2v(master, prompt, seconds=5)  # → mp4 bytes

        cb.progress.step("derive", 1, 3, f"抽 {n} 帧 + 抠图")
        raw = extract_frames_bytes(video, n)
        cut = [_img(self._matte.cutout(_png(im))) for im in raw]

        cb.progress.step("derive", 2, 3, "像素化")
        pix = pixelate_frames(cut, target_h=_PIX_H, palette_size=_PALETTE)
        return [_png(p) for p in pix]


class PerFrameStrategy(DerivationStrategy):
    """离散姿势（hit 等，需单帧可编辑）：逐帧图生图 → 抠图。桩，待开发（#53）。"""

    route = GenRoute.PER_FRAME

    def __init__(self, image: ImageProvider, matte: MatteProvider) -> None:
        self._image = image
        self._matte = matte

    def derive(
        self, card: CharacterCard, action: ActionSpec, cb: Callbacks
    ) -> list[bytes]:
        cb.progress.step("derive", 0, 1, f"{action.action}: 逐帧图生图")
        # TODO(dev, #53): 逐 pose image.gen_image(母版, pose) → matte.cutout（不加骨架）
        return [b"" for _ in range(action.n_frames)]  # 桩


class ProcIdleStrategy(DerivationStrategy):
    """待机（idle）：母版抠图 → 程序化局部躯干呼吸（Idle-B，零 API）。桩，待开发（#53）。"""

    route = GenRoute.PROC_IDLE

    def __init__(self, image: ImageProvider, matte: MatteProvider) -> None:
        self._image = image
        self._matte = matte

    def derive(
        self, card: CharacterCard, action: ActionSpec, cb: Callbacks
    ) -> list[bytes]:
        cb.progress.step("derive", 0, 1, f"{action.action}: Idle-B 程序化呼吸")
        # TODO(dev, #53): 母版抠图 → 躯干带保体积缩放，腿冻结
        return [b"" for _ in range(action.n_frames)]  # 桩
