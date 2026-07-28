"""视频 → 像素走路序列帧(后处理管线)。

承接视频路线(Issue #35):i2v 产出的短视频步态真实但为插画质感,本管线把它
落地成交付级像素序列帧——均匀抽帧 → 抠图(matting, Issue #20)→ 像素化
(:mod:`.pixelate`)→ 底线对齐(Issue #21)→ 打包 sheet / gif。

重量级依赖(rembg 抠图、抽帧后端)全部在函数内惰性导入,保证模块导入零成本、
CI 可收集;真正运行时才需要 ``rembg`` 与 ffmpeg。
"""

from __future__ import annotations

import os
import tempfile

from PIL import Image

from .pixelate import pixelate_frames

__all__ = [
    "video_to_pixel_frames",
    "extract_frames_bytes",
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


def _extract_frames(video_path: str, n: int) -> list[Image.Image]:
    """从视频均匀抽 ``n`` 帧。优先 imageio,回退系统 ffmpeg。"""
    try:
        import imageio.v3 as iio

        all_frames = iio.imread(video_path, plugin="pyav")  # (T, H, W, C)
        total = len(all_frames)
        idx = [round(i * (total - 1) / max(1, n - 1)) for i in range(n)]
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
        idx = [round(i * (len(files) - 1) / max(1, n - 1)) for i in range(n)]
        return [Image.open(files[i]).convert("RGBA").copy() for i in idx]


def _matte(frame: Image.Image) -> Image.Image:
    """AI 主体抠图(rembg/u2net)。骨白等浅色角色禁用按颜色抠(Issue #20)。"""
    from rembg import remove

    return remove(frame).convert("RGBA")


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


def video_to_pixel_frames(
    video_path: str,
    n_frames: int = 8,
    target_h: int = 100,
    palette_size: int = 32,
    cell: int = 256,
) -> list[Image.Image]:
    """视频 → 对齐好的像素走路帧(RGBA,统一 ``cell`` 画布)。

    已在骷髅剑士严格侧面母版上端到端验证(Issue #35):8/12 帧、腿清晰交替、
    不转身、像素风。任意**严格侧面母版**的 i2v 视频都可复用本管线。
    """
    raw = _extract_frames(video_path, n_frames)
    cut = [_matte(f) for f in raw]
    pix = pixelate_frames(cut, target_h=target_h, palette_size=palette_size)
    return align_bottom_center(pix, cell=cell)


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
