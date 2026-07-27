"""strategy:各动作的派生编排(视频路线 / 逐帧路线分流)。"""

from .walk_video import derive_walk_frames, generate_walk_video

__all__ = ["generate_walk_video", "derive_walk_frames"]
