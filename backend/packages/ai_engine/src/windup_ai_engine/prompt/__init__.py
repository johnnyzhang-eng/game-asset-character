"""prompt:各动作的生成提示词与装配。"""

from .walk import WALK_BODY_FRONT, WALK_BODY_SIDE, build_walk_prompt

__all__ = ["WALK_BODY_SIDE", "WALK_BODY_FRONT", "build_walk_prompt"]
