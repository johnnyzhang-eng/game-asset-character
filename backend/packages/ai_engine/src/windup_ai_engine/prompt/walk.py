"""走路 i2v 提示词(视频路线)。

实测要点(Issue #35):
- 只写正向词、逐条写腿部可见动作(抬 / 摆 / 蹬 / 承重),锁死手持武器不乱动。
- 显式 "STRICT SIDE VIEW facing right":正面母版会让 i2v 边走边转身,严格侧面母版
  才能规规矩矩侧走。这条是本管线唯一的硬前提。
- 换角色只替换装备子句(如 骷髅:boot→骨足、cape→围巾),机制词保持不变。
"""

from __future__ import annotations

# 基础走路机制正文(默认佩剑 / 铁靴 / 披风角色,如暗黑骑士)。
WALK_BODY = (
    "The character walks steadily to the right through the open space, the whole body "
    "advancing with every stride: the front boot lifts, swings forward and plants heel "
    "first, the rear boot pushes off the ground, the hips and torso carry the weight "
    "forward over the planted foot, {garment} swing with the steps, the sword stays held "
    "low and steady at the side in a fixed grip, the upper body stays calm and upright, "
    "STRICT SIDE VIEW facing right the whole time, the legs clearly visible."
)

# 每个角色只替换 legs / garment 两处装备子句,机制词不动。
DEFAULT_GARMENT = "the cape and tabard"


def build_walk_prompt(garment: str = DEFAULT_GARMENT, feet: str = "boot") -> str:
    """按角色装备生成走路正文。

    Args:
        garment: 随步伐摆动的衣饰(如 "the cape and tabard" / "the red scarf and tabard")。
        feet: 落脚部件用词(如 "boot" / "bare bony foot"),替换机制句里的 boot。
    """
    body = WALK_BODY.format(garment=garment)
    if feet != "boot":
        body = body.replace("boot", feet)
    return body
