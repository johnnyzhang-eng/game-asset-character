"""Render3DPort 的实现 —— 把三渲二那三段拼成"母版 → 这个动作的帧"。

放在 app 层而不是 framework:``Render3DPort`` 是 ai_engine 的 port,而依赖方向是
**ai_engine → framework**(``strategy.concrete`` import ``windup_framework.providers``)。
在 framework 里实现 ai_engine 的 port 会成环。app 能同时看到两边,和 ProgressPort
一样由 app 实现并注入。

━━ 为什么要有 CharacterAssetStore ━━

三段的成本结构完全不同:
  ① 图生 3D    按积分   **每角色一次性**
  ② 自动绑骨    10 积分  **每角色一次性**
  ③ 渲帧       零 API   每动作、每朝向都免费

没有角色级落点,①② 就得**每个动作重跑一次**:一个角色做 10 个动作,成本从"一次性 ¥3.6"
变成"¥3.6 × 10",差一个数量级(实测,见 1024XEngineer/Windup#121)。所以这个 store
不是"存得整齐一点",它是这条路线成本优势能否成立的开关。

━━ 落点选型(这是本文件唯一需要评审拍板的决定)━━

按 #122 的 D3 默认「provider 自持存储」实现:落点由本层自己管,**ai_engine 继续只认
bytes、不碰存储**,``CharacterCard`` 也**不新增 3D 资产字段**。

键取 ``(master_ref, version)`` 而不是 ``name``:
  - ``name`` 不唯一(落库时甚至可以为 null,#123 记过),拿它当键会让两个同名角色互相
    复用彼此的模型 —— 那是"看起来省钱、实际出错角色"的静默错误;
  - port docstring 早写明渲染出帧路线该靠 ``master_ref`` / ``version`` 定位 3D 资产;
  - ``master_ref`` 为空时**不缓存也不假装缓存**:此时 :meth:`has_character_assets`
    返回 False,而 ``derive_frames`` 直接抛 —— 否则每个动作都重付 ①②,而调用方
    看到的只是"有点慢",不会发现自己在按动作付角色级的钱。
"""
from __future__ import annotations

import hashlib
import logging
import pathlib
from typing import Protocol, runtime_checkable

from windup_ai_engine.ports import ProgressPort, RenderedFrames
from windup_common.models import ActionSpec, CharacterCard, Facing
from windup_framework.providers.render3d import (
    RENDER_SIZE,
    AutoRigProvider,
    Model3DProvider,
    RiggedModel,
    SpriteRenderProvider,
    SpriteSheet,
)

logger = logging.getLogger(__name__)

# Facing → 出帧台的朝向名。出帧台里 0° = 角色朝屏幕右(对齐 faces="right"),
# 逆时针每 45° 一个,故 e=朝右、s=朝观者。键名与前端导出模型的
# ExportAction.sequences[].direction 同域,不需要转换层。
_FACING_TO_DIRECTION: dict[Facing, str] = {
    Facing.SIDE: "e",     # 横版侧视,角色朝画面右
    Facing.FRONT: "s",    # 身体正对观者
}


@runtime_checkable
class CharacterAssetStore(Protocol):
    """角色级派生资产(绑好骨的 3D 模型)的落点。

    只有两个动作,且**必须是跨进程持久的** —— 进程内缓存等于每次重启都重付一遍
    ①②,而那正是本文件开头那笔一个数量级的差价。
    """

    def get(self, key: str) -> bytes | None: ...

    def put(self, key: str, data: bytes) -> None: ...


class LocalDirAssetStore(CharacterAssetStore):
    """落在本地目录的实现。

    **部署注意:这个目录必须挂持久卷。** 落在容器可写层里的话,每次重建镜像/重启都会
    清空,于是角色级资产退化成"每次部署后第一个动作重付 ①②"。要在多副本后端上用,
    应换成对象存储实现(同一个 Protocol,换注入即可)—— 那一步等 #121 拍板后做。
    """

    def __init__(self, root: pathlib.Path) -> None:
        self._root = root
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> pathlib.Path:
        # key 里可能有 URL / 路径分隔符,哈希成扁平文件名;保留前缀便于人肉排查。
        digest = hashlib.sha256(key.encode()).hexdigest()[:32]
        return self._root / f"rigged_{digest}.bin"

    def get(self, key: str) -> bytes | None:
        p = self._path(key)
        return p.read_bytes() if p.is_file() else None

    def put(self, key: str, data: bytes) -> None:
        # 先写临时文件再 rename:半截文件被当成"资产已就绪"会让下一次渲染拿到坏模型,
        # 而那时钱已经花完、错误却显形在出帧台("Bad glTF"),排查方向完全跑偏
        # (2026-08-05 就被这个坑过一次,当时差点判成"出帧管线坏了")。
        p = self._path(key)
        tmp = p.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(p)


class Render3DAdapter:
    """组合三段 + 角色级资产复用,实现 ai_engine 的 ``Render3DPort``。"""

    def __init__(
        self,
        model3d: Model3DProvider,
        autorig: AutoRigProvider,
        renderer: SpriteRenderProvider,
        store: CharacterAssetStore,
        *,
        directions: int = 4,
        material: str = "cel",
        size: tuple[int, int] = RENDER_SIZE,
    ) -> None:
        self._model3d = model3d
        self._autorig = autorig
        self._renderer = renderer
        self._store = store
        self._directions = directions
        self._material = material
        self._size = size

    # ── 键 ────────────────────────────────────────────────────────────────
    @staticmethod
    def _key(card: CharacterCard) -> str | None:
        """``None`` = 这个角色没法安全缓存(见模块 docstring 里为什么不退化成用 name)。"""
        ref = (card.master_ref or "").strip()
        return f"{ref}@{card.version}" if ref else None

    # ── Render3DPort ─────────────────────────────────────────────────────
    def has_character_assets(self, card: CharacterCard) -> bool:
        """不花钱、无副作用:只查落点里有没有这个角色的绑骨产物。"""
        key = self._key(card)
        return bool(key) and self._store.get(key) is not None

    def derive_frames(
        self,
        card: CharacterCard,
        action: ActionSpec,
        master: bytes,
        progress: ProgressPort,
    ) -> RenderedFrames:
        key = self._key(card)
        if not key:
            raise ValueError(
                f"角色 {card.name!r} 没有 master_ref,无法定位/复用角色级 3D 资产。"
                "继续跑会让图生 3D + 绑骨按动作重复计费(每角色一次性 → 每动作一次),"
                "故在花钱之前停下。请先让 server 把母版落存储并回填 master_ref。"
            )

        rigged_bytes = self._store.get(key)
        if rigged_bytes is None:
            # 只有这一支会花钱,且**每角色只会走一次**。
            rigged_bytes = self._build_character_assets(card, master, key, progress)

        # ③ 渲帧:纯本地,零 API 成本。多朝向在这里一次性拿到。
        want = _FACING_TO_DIRECTION.get(action.facing, "e")
        progress.step(
            "derive", 1, 3,
            f"渲 {self._directions} 朝向 × {action.n_frames} 帧"
            f"({self._size[0]}×{self._size[1]},材质 {self._material})",
        )
        sheet: SpriteSheet = self._renderer.render(
            rigged_bytes,
            clip=action.action.value,
            directions=self._directions,
            frames=action.n_frames,
            size=self._size,
            material=self._material,
        )
        return self._pick(sheet, want, action)

    # ── 内部 ─────────────────────────────────────────────────────────────
    def _build_character_assets(
        self, card: CharacterCard, master: bytes, key: str, progress: ProgressPort
    ) -> bytes:
        """① 图生 3D + ② 绑骨。**按次计费,每角色一次性。**"""
        progress.step("derive", 0, 3, "角色级资产未就绪:图生 3D(按次计费)")
        model = self._model3d.image_to_3d(master, want="GLB")

        progress.step("derive", 0, 3, "自动绑骨(按次计费,10 积分)")
        rigged: RiggedModel = self._autorig.rig(model, want="GLB")

        # 存的是**绑骨后**的产物:它是渲帧真正要的那个,存中间的 model 等于下次还得再绑一次。
        self._store.put(key, rigged.data)
        logger.info("角色级 3D 资产已落点 key=%s fmt=%s", key, rigged.fmt)
        return rigged.data

    @staticmethod
    def _pick(sheet: SpriteSheet, want: str, action: ActionSpec) -> RenderedFrames:
        """取请求朝向那一条;把"其实渲了几个朝向"如实带出去。"""
        available = tuple(s.direction for s in sheet.sequences)
        chosen = next((s for s in sheet.sequences if s.direction == want), None)
        if chosen is None:
            # 不静默换一个朝向交出去:朝向错了的序列帧在引擎里就是角色朝反方向走,
            # 而帧数、时长、成色全都正常,没有任何一道会红。
            raise ValueError(
                f"出帧台没有产出朝向 {want}(动作 {action.action.value}、facing "
                f"{action.facing.value});实际产出 {available}。"
            )
        return RenderedFrames(
            frames=list(chosen.frames),
            direction=chosen.direction,
            available_directions=available,
        )
