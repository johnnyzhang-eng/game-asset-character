"""像素化后处理测试(纯 CV,无需联网 / API)。"""

import numpy as np
from PIL import Image

from windup_ai_engine.postprocess import (
    pixelate_frames,
    sprite_sheet,
    to_pixel_art,
)


def _synthetic_char(size=256, box=(80, 40, 176, 220)) -> Image.Image:
    """透明底上画一个不透明矩形"角色",四周留透明边。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    arr = np.asarray(img).copy()
    x0, y0, x1, y1 = box
    arr[y0:y1, x0:x1] = (200, 60, 60, 255)
    # 加一点颜色变化,让色板量化有意义
    arr[y0:y1, x0 : (x0 + x1) // 2] = (60, 120, 200, 255)
    return Image.fromarray(arr, "RGBA")


def test_to_pixel_art_targets_height_and_keeps_ratio():
    src = _synthetic_char()  # 主体 96x180
    out = to_pixel_art(src, target_h=60, palette_size=16)
    assert out.height == 60
    # 主体宽高比 96/180 → 目标宽 ≈ 60*96/180 = 32
    assert abs(out.width - 32) <= 1
    assert out.mode == "RGBA"


def test_to_pixel_art_crops_to_alpha_bbox():
    """输出应裁到主体包围盒:透明边被切掉,首列即主体。"""
    out = to_pixel_art(_synthetic_char(), target_h=90, palette_size=16)
    alpha = np.asarray(out)[:, :, 3]
    assert alpha.max() == 255  # 有实心主体
    # 顶行与左列应落在主体上(已裁边),而非全透明
    assert alpha[0, :].max() > 0
    assert alpha[:, 0].max() > 0


def test_to_pixel_art_reduces_palette():
    out = to_pixel_art(_synthetic_char(), target_h=80, palette_size=8)
    rgb = np.asarray(out.convert("RGB")).reshape(-1, 3)
    colors = np.unique(rgb, axis=0)
    assert len(colors) <= 8


def test_pixelate_frames_uniform_height_packs_to_sheet():
    frames = pixelate_frames([_synthetic_char() for _ in range(4)], target_h=48, palette_size=16)
    assert all(f.height == 48 for f in frames)
    sheet = sprite_sheet(frames)
    assert sheet.height == 48
    assert sheet.width == sum(f.width for f in frames)


def test_to_pixel_art_rejects_bad_height():
    import pytest

    with pytest.raises(ValueError):
        to_pixel_art(_synthetic_char(), target_h=0)
