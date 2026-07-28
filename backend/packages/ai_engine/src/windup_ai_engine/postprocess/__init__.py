"""后处理:把生成帧落地成交付级像素序列帧(抽帧 / 像素化 / 循环闭合 / 对齐 / 打包)。"""

from .loop import find_period, pick_cycle
from .oneshot import (
    find_motion_span,
    first_action_end,
    foot_line_series,
    pick_oneshot,
    split_jump_phases,
)
from .rootmotion import DEFAULT_FPS_MS, extract_root_motion, frame_durations
from .pixelate import (
    detect_pixel_size,
    extract_palette,
    master_pixel_spec,
    pixelate_frames,
    to_pixel_art,
)
from .video_frames import (
    align_bottom_center,
    extract_all_frames_bytes,
    extract_frames_bytes,
    save_gif,
    sprite_sheet,
)

__all__ = [
    "to_pixel_art",
    "pixelate_frames",
    "detect_pixel_size",
    "extract_palette",
    "master_pixel_spec",
    "find_period",
    "pick_cycle",
    "find_motion_span",
    "first_action_end",
    "pick_oneshot",
    "split_jump_phases",
    "foot_line_series",
    "extract_root_motion",
    "frame_durations",
    "DEFAULT_FPS_MS",
    "extract_frames_bytes",
    "extract_all_frames_bytes",
    "align_bottom_center",
    "sprite_sheet",
    "save_gif",
]
