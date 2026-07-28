"""视频抽帧 / 对齐 / 打包(后处理管线的帧级工具)。

承接视频路线(Issue #35):i2v 产出的短视频步态真实但为插画质感。本模块提供抽帧、
底线对齐(#21)、拼图集 / gif;像素化见 :mod:`.pixelate`、循环闭合见 :mod:`.loop`、
抠图见 framework 的 MatteProvider(#20)。抽帧后端(imageio/ffmpeg)函数内惰性,
模块导入零成本、CI 可收集。
"""

from __future__ import annotations

import os
import tempfile

from PIL import Image

__all__ = [
    "extract_frames_bytes",
    "extract_all_frames_bytes",
    "align_bottom_center",
    "sprite_sheet",
    "save_gif",
]


def extract_frames_bytes(video: bytes, n: int) -> list[Image.Image]:
    """从视频 bytes 均匀抽 ``n`` 帧(供后端 strategy 用,provider 返回的是 bytes)。"""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=True) as f:
        f.write(video)
        f.flush()
        return _extract_frames(f.name, n)


def extract_all_frames_bytes(video: bytes, cap: int = 150) -> list[Image.Image]:
    """抽视频全部帧(至多 ``cap``,均匀降采样),供周期检测用。"""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=True) as f:
        f.write(video)
        f.flush()
        return _extract_frames(f.name, cap)


def _extract_frames(video_path: str, n: int) -> list[Image.Image]:
    """从视频均匀抽 ``n`` 帧。优先 imageio,回退系统 ffmpeg。"""
    try:
        import imageio.v3 as iio

        all_frames = iio.imread(video_path, plugin="pyav")  # (T, H, W, C)
        total = len(all_frames)
        m = min(n, total)
        idx = [round(i * (total - 1) / max(1, m - 1)) for i in range(m)]
        return [Image.fromarray(all_frames[i]).convert("RGBA") for i in idx]
    except Exception:
        pass

    import glob
    import subprocess

    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["ffmpeg", "-y", "-i", video_path, "-vsync", "0",
             os.path.join(tmp, "f_%04d.png")],
            capture_output=True, check=True,
        )
        files = sorted(glob.glob(os.path.join(tmp, "f_*.png")))
        if not files:
            raise RuntimeError("抽帧失败:视频无可解码帧")
        m = min(n, len(files))
        idx = [round(i * (len(files) - 1) / max(1, m - 1)) for i in range(m)]
        return [Image.open(files[i]).convert("RGBA").copy() for i in idx]


def align_bottom_center(
    frames: list[Image.Image], cell: int = 256, foot_line: float = 0.92, fill_h: float = 0.80
) -> list[Image.Image]:
    """按脚线对齐到统一画布,消除逐帧画布漂移(Issue #21)。

    **整段共用一个缩放系数**(取全序列最高帧定标),不逐帧归一化 —— 逐帧各自缩放到等高
    会把走路自然的身高起伏(实测约 4%)反向变成"忽大忽小":蹲下的帧被放大、伸展的帧被
    缩小。统一缩放后帧间只剩真实姿态差,尺度稳定。

    水平方向按**主体水平中心**对齐(不含挥出的武器会更好,当前用整体包围盒中心兜底);
    垂直方向按**脚线**(包围盒底边)对齐到 ``foot_line``。
    """
    import numpy as np

    boxes: list[tuple[int, int, int, int] | None] = []
    for f in frames:
        ys, xs = np.where(np.asarray(f)[:, :, 3] > 128)
        boxes.append(
            (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
            if len(ys)
            else None
        )
    heights = [b[3] - b[1] for b in boxes if b]
    if not heights:
        return [Image.new("RGBA", (cell, cell), (0, 0, 0, 0)) for _ in frames]
    scale = (cell * fill_h) / max(heights)      # 全序列统一定标

    out = []
    for f, box in zip(frames, boxes):
        if box is None:
            out.append(Image.new("RGBA", (cell, cell), (0, 0, 0, 0)))
            continue
        x0, y0, x1, y1 = box
        crop = f.crop(box)
        w = max(1, round(crop.width * scale))
        h = max(1, round(crop.height * scale))
        crop = crop.resize((w, h), Image.NEAREST)
        canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
        canvas.alpha_composite(crop, (cell // 2 - w // 2, int(cell * foot_line) - h))
        out.append(canvas)
    return out


def sprite_sheet(frames: list[Image.Image], bg=(0, 0, 0, 0)) -> Image.Image:
    """横向拼接为 sprite sheet。"""
    if not frames:
        raise ValueError("frames 为空")
    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * len(frames), h), bg)
    for i, f in enumerate(frames):
        sheet.alpha_composite(f.convert("RGBA"), (i * w, 0))
    return sheet


def save_gif(frames: list[Image.Image], path: str, duration: int = 120) -> None:
    """导出循环 gif 供预览。"""
    if not frames:
        raise ValueError("frames 为空")
    rgba = [f.convert("RGBA") for f in frames]
    rgba[0].save(path, save_all=True, append_images=rgba[1:], duration=duration, loop=0, disposal=2)
