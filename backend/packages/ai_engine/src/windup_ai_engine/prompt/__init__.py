"""prompt:各动作的生成提示词与装配。"""

from .walk import WALK_BODY, build_walk_prompt

__all__ = ["WALK_BODY", "build_walk_prompt"]
