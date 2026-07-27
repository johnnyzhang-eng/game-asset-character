"""走路 i2v 编排(视频路线)。

视频 API 是异步任务:``providers.create_video_client`` 只给官方 SDK 的请求能力,
任务的提交 / 轮询 / 下载由本模块按供应商协议编排(见 ``providers.video`` 注释)。

协议已在 windup-pipeline 端到端实测到 completed(Issue #35):
  POST /videos {model, prompt, size, seconds, mode, input_reference} → {id, status}
  轮询 GET /videos/{id} → status==completed → task_result.videos[0].url → 下载 mp4
本模块用后端 provider 按同协议复刻;下游像素化后处理见 :mod:`..postprocess`。
i2v 段需联网验证,像素化 / 对齐段有单测覆盖。
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import urllib.request

import httpx
from PIL import Image

from windup_framework.providers import create_video_client

from ..postprocess import save_gif, sprite_sheet, video_to_pixel_frames
from ..prompt import build_walk_prompt

__all__ = ["generate_walk_video", "derive_walk_frames"]

# 只有 o1 走 image_list;其余(v2-5-turbo/v2-1/sora)走 input_reference(实测坑,勿混)。
_IMAGE_LIST_MODELS = ("kling-video-o1",)


def _first_frame_b64(base_image: str, size: str) -> str:
    """本地首帧 → 等比缩放 + 补边到目标尺寸 → JPG(RGB,q90) base64。

    不强拉到目标尺寸(母版多为横幅,强压成方会把角色压成瘦长鬼影);等比缩进 +
    背景色补边保比例。必须 JPG:PNG base64 会 VENDOR_FAILED(实测)。
    """
    w, h = (int(x) for x in size.split("x"))
    im = Image.open(base_image).convert("RGB")
    pad = im.getpixel((0, 0))
    fitted = im.copy()
    fitted.thumbnail((w, h), Image.LANCZOS)
    canvas = Image.new("RGB", (w, h), pad)
    canvas.paste(fitted, ((w - fitted.width) // 2, (h - fitted.height) // 2))
    buf = io.BytesIO()
    canvas.save(buf, "JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


async def generate_walk_video(
    base_image: str,
    out_dir: str,
    *,
    model: str = "kling-v2-5-turbo",
    garment: str = "the cape and tabard",
    feet: str = "boot",
    size: str = "1280x720",
    seconds: str = "5",
    mode: str = "std",
    poll_interval: float = 60.0,
    max_min: int = 30,
) -> str:
    """严格侧面母版 → 走路 i2v 短视频 mp4,返回路径。

    ``base_image`` 必须是严格侧面母版:正面母版会让 i2v 边走边转身(Issue #35)。
    """
    os.makedirs(out_dir, exist_ok=True)
    prompt = build_walk_prompt(garment=garment, feet=feet)
    ref = "data:image/jpeg;base64," + _first_frame_b64(base_image, size)

    body: dict = {"model": model, "prompt": prompt, "size": size,
                  "seconds": seconds, "mode": mode}
    if model in _IMAGE_LIST_MODELS:
        body["image_list"] = [{"image": _first_frame_b64(base_image, size)}]
    else:
        body["input_reference"] = ref

    client = create_video_client()
    async with client:
        job = (await client.post("/videos", body=body, cast_to=httpx.Response)).json()
        jid = job.get("id")
        url = None
        for _ in range(max(1, max_min * 60 // int(poll_interval))):
            await asyncio.sleep(poll_interval)
            st = (await client.get(f"/videos/{jid}", cast_to=httpx.Response)).json()
            status = st.get("status")
            if status == "completed":
                vids = (st.get("task_result") or {}).get("videos") or []
                url = vids[0].get("url") if vids else None
                break
            if status in ("failed", "cancelled"):
                raise RuntimeError(f"i2v 失败: {status}")
    if not url:
        raise RuntimeError("i2v 未取得视频 URL(超时或失败)")

    mp4 = os.path.join(out_dir, f"walk_{model.replace('/', '_')}.mp4")
    urllib.request.urlretrieve(url, mp4)
    return mp4


async def derive_walk_frames(
    base_image: str,
    out_dir: str,
    *,
    n_frames: int = 8,
    target_h: int = 100,
    palette_size: int = 32,
    **video_kwargs,
) -> dict:
    """端到端:严格侧面母版 → i2v 走路视频 → 像素序列帧 + sheet + gif。

    返回各产物路径。视频段联网,后处理段纯 CV。
    """
    os.makedirs(out_dir, exist_ok=True)
    mp4 = await generate_walk_video(base_image, out_dir, **video_kwargs)
    frames = video_to_pixel_frames(mp4, n_frames=n_frames, target_h=target_h, palette_size=palette_size)

    sheet_path = os.path.join(out_dir, "walk_sheet.png")
    gif_path = os.path.join(out_dir, "walk.gif")
    sprite_sheet(frames).save(sheet_path)
    save_gif(frames, gif_path)
    return {"video": mp4, "sheet": sheet_path, "gif": gif_path, "n_frames": len(frames)}
