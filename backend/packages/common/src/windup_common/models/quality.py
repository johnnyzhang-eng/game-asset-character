"""判官读数的数据契约。

放在 common 而不是 ai_engine.ports,是因为构造它的是 framework 层的 provider,而分层门禁
禁止 framework 依赖 ai_engine。调用方仍从 ``windup_ai_engine.ports`` 取(那里再导出一次),
不必知道它物理上落在哪层。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class JudgeVerdict:
    """一帧交付物的四个**可数、可复核**读数 —— 不含任何"好不好看"的判断。

    刻意**没有** score 字段:同模型同输入的主观评分噪声大到能盖过真实差异,而一旦出参里
    有个分数,迟早有人拿它卡阈值 —— 那时卡掉的是噪声,每一次误杀都是用户已付费、不可退的
    产物。四个字段各自有唯一答案,复核时人眼看一遍就能确认对错。

    "好看"由输入端(母版规格 + 提示词骨架)保证,不由本读数保证。
    """

    subject_count: int
    """画面里出现了几个角色主体。期望 1;≥2 通常是 i2v 把角色分裂成了两个。"""

    foreign_objects: tuple[str, ...]
    """母版里没有、生成帧里却出现的物体名。空元组 = 没有多出来的东西。"""

    action_matches: bool
    """这一帧的姿态是否属于所要求的动作类别 —— 判类别,不判动作做得好不好。"""

    clipped: bool
    """角色是否被画面边缘裁到。"""

    raw: str
    """模型原话。留着是为了让人能复核判读本身对不对 —— 四个读数都是模型给的,
    判官自己出错时,没有原话就无从分辨"产物真有问题"和"判官读错了"。"""
