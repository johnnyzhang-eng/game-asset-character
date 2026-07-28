"""母版预处理:按动作给母版留出运动方向的空间。

实测教训:母版里角色居中、占 ~70% 画面高时,i2v 跳跃会让角色**头顶顶出视频画面上沿**
被裁掉(生成本身没错,是构图没留够空间)。规则同 MasterSpec 的"运动方向多留白":
  - jump:向上运动 → 顶部补空间,角色坐低
  - dash / walk / run:向右位移 → 前进方向多留白(由母版生成时构图保证,此处不改)

纯 PIL,零 API。背景色取母版四角中位色,补出来的边与母版底色一致。
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

__all__ = ["add_headroom", "prepare_master"]


def _bg_color(img: Image.Image) -> tuple[int, int, int]:
    """取四角中位色当背景色(母版通常是纯色底)。"""
    rgb = np.asarray(img.convert("RGB"))
    corners = np.stack([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]])
    return tuple(int(v) for v in np.median(corners, axis=0))


def add_headroom(master: bytes, ratio: float = 0.6) -> bytes:
    """在母版上方补空间,让角色坐到画面下部,给腾空留出余量。

    Args:
        master: 母版图 bytes。
        ratio: 处理后角色所占的画面高度比例(越小头顶空间越多)。0.6 表示角色高度
            约占新画面的 60%,上方留约 40%。
    """
    if not 0.1 < ratio < 1.0:
        raise ValueError("ratio 需在 (0.1, 1.0) 之间")
    img = Image.open(io.BytesIO(master)).convert("RGB")
    new_h = max(img.height + 1, int(round(img.height / ratio)))
    canvas = Image.new("RGB", (img.width, new_h), _bg_color(img))
    canvas.paste(img, (0, new_h - img.height))       # 原图贴底,空间加在顶部
    buf = io.BytesIO()
    canvas.save(buf, "PNG")
    return buf.getvalue()


def prepare_master(master: bytes, action: str) -> bytes:
    """按动作类型预处理母版;不需要处理的动作原样返回。"""
    if action == "jump":
        return add_headroom(master)
    return master
