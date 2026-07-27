"""像素化后处理:把生成帧(插画/渲染风)转成脆边限色的像素精灵。

视频路线实测(Issue #35)结论:i2v 能解决步态(腿真交替、不转身),但会把角色
重绘成插画质感;本模块负责把每帧压回像素风——网格降采样(NEAREST)保硬边 + 色板
量化限色。纯 Pillow / numpy,零 API、秒级,符合"本机只做轻量 CV"的算力约束。

输入约定:传入 RGBA 图(alpha 为主体掩码,抠图见 ``postprocess.matting`` / Issue #20)。
无 alpha 时按整幅处理。
"""

from __future__ import annotations

import numpy as np
from PIL import Image

__all__ = ["to_pixel_art", "pixelate_frames"]


def _content_bbox(rgba: Image.Image, alpha_thr: int = 128) -> tuple[int, int, int, int]:
    """按 alpha 求主体包围盒;无有效 alpha 时回退整幅。"""
    arr = np.asarray(rgba)
    if arr.shape[-1] == 4:
        ys, xs = np.where(arr[:, :, 3] > alpha_thr)
        if len(ys):
            return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
    return 0, 0, rgba.width, rgba.height


def to_pixel_art(
    rgba: Image.Image,
    target_h: int = 100,
    palette_size: int = 32,
    alpha_thr: int = 128,
) -> Image.Image:
    """单帧转像素风,返回小尺寸 RGBA(``target_h`` 高,等比宽)。

    步骤:裁到主体包围盒 → 等比缩到 ``target_h``(NEAREST 网格降采样)→ RGB 色板
    量化到 ``palette_size`` 色(保留 alpha)。放大展示交给调用方(用 NEAREST 保脆)。

    Args:
        rgba: 输入帧,建议已抠图的 RGBA。
        target_h: 目标像素高(角色约占这么多像素行),主流 sprite 常用 64–128。
        palette_size: 色板颜色数,越小越"复古"。
        alpha_thr: 主体 alpha 阈值。
    """
    if target_h < 1:
        raise ValueError("target_h 必须 >= 1")
    rgba = rgba.convert("RGBA")
    x0, y0, x1, y1 = _content_bbox(rgba, alpha_thr)
    crop = rgba.crop((x0, y0, x1, y1))
    w, h = crop.size
    target_w = max(1, round(w * target_h / h))
    small = crop.resize((target_w, target_h), Image.NEAREST)

    # RGB 色板量化,alpha 单独保留(量化不吃 alpha 通道)
    quantized = (
        small.convert("RGB")
        .quantize(colors=max(2, palette_size), method=Image.FASTOCTREE)
        .convert("RGB")
    )
    alpha = np.asarray(small)[:, :, 3]
    out = np.dstack([np.asarray(quantized), alpha]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def pixelate_frames(
    frames: list[Image.Image],
    target_h: int = 100,
    palette_size: int = 32,
) -> list[Image.Image]:
    """批量像素化一组帧,像素高与色板对齐,便于打包为 sprite sheet。"""
    return [to_pixel_art(f, target_h, palette_size) for f in frames]
