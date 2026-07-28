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
    """按主体包围盒底边中心对齐到统一画布,消除逐帧画布漂移(Issue #21)。"""
    import numpy as np

    out = []
    for f in frames:
        arr = np.asarray(f)
        ys, xs = np.where(arr[:, :, 3] > 128)
        if not len(ys):
            out.append(Image.new("RGBA", (cell, cell), (0, 0, 0, 0)))
            continue
        crop = f.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
        scale = (cell * fill_h) / crop.height
        crop = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.NEAREST)
        canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
        canvas.alpha_composite(crop, (cell // 2 - crop.width // 2, int(cell * foot_line) - crop.height))
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
