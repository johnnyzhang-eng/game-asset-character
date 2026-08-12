"""三渲二接进编排:路线选择 + Render3DAdapter 的成本性质。

这一片锁的核心不是"能跑通",而是**两类静默错误**:
  ① 显式点了三渲二、资产没就绪 → 悄悄回退到 i2v,用户拿到一段画风/成本/多朝向能力
     完全不同的产物,而帧数时长成色全正常、没有任何一道会红;
  ② 角色级资产没被复用 → 图生 3D + 绑骨按动作重付,一个角色 10 个动作贵 10 倍。
     这条只会表现为"有点慢 + 账单变多",不会有任何报错(Refs #121)。
"""
from __future__ import annotations

import io
import pathlib

import pytest
from PIL import Image

from windup_ai_engine.impl import CharacterGenerator
from windup_ai_engine.ports import RenderedFrames, RouteUnavailable
from windup_ai_engine.strategy.concrete import RenderFrameStrategy, VideoFrameStrategy
from windup_app.server.orchestrator.render3d_adapter import (
    LocalDirAssetStore,
    LocalDirModelReview,
    ModelAwaitingReview,
    Render3DAdapter,
)
from windup_common.models import (
    ActionSpec,
    ActionType,
    CharacterCard,
    Facing,
    GenRoute,
    Stylize,
)
from windup_framework.providers.render3d import (
    PresetMotion,
    RiggedModel,
    RigInfo,
    SpriteSequence,
    SpriteSheet,
)



def _png(w: int = 64, h: int = 96) -> bytes:
    """一张带主体的真 RGBA PNG —— 假帧必须能被 _lastmile 真的解码/对齐,
    否则测的是"我的假数据长得像帧"而不是管线。"""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y in range(20, 80):
        for x in range(24, 40):
            im.putpixel((x, y), (200, 60, 60, 255))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


class _NullProgress:
    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        pass


class _SpyProgress:
    def __init__(self) -> None:
        self.notes: list[str] = []

    def step(self, stage: str, i: int, total: int, note: str = "") -> None:
        self.notes.append(note)


# ── 假三段(记调用次数,用来证明"每角色一次性")──────────────────────────────


class _FakeModel3D:
    def __init__(self) -> None:
        self.calls = 0

    def image_to_3d(self, master, *, want="GLB", extra_views=None) -> bytes:
        self.calls += 1
        return b"GLB-model-bytes"


class _FakeAutoRig:
    def __init__(self) -> None:
        self.calls = 0

    @property
    def preset_motions(self):
        return {"walk": PresetMotion(name="walk", motion_type=1)}

    def rig(self, model, *, want="GLB", motion=None) -> RiggedModel:
        self.calls += 1
        return RiggedModel(data=b"RIGGED-bytes", fmt="GLB")


def _sheet(directions: tuple[str, ...], n_frames: int) -> SpriteSheet:
    return SpriteSheet(
        clip="walk",
        duration_s=1.0,
        sample_times=[i / n_frames for i in range(n_frames)],
        sequences=[
            SpriteSequence(direction=d, camera_yaw=0.0, frames=[_png()] * n_frames)
            for d in directions
        ],
        rig=RigInfo(bones=28, skinned_meshes=1, vertices=100, root_bone="Hips", loader="glb"),
        available_clips={"walk": 1.0},
    )


class _FakeRenderer:
    def __init__(self, directions=("e", "n", "w", "s")) -> None:
        self.calls = 0
        self._directions = directions
        self.last_size: tuple[int, int] | None = None

    def render(self, rigged_model, *, clip=None, directions=4, frames=12,
               size=(1536, 2560), material="cel") -> SpriteSheet:
        self.calls += 1
        self.last_size = size
        return _sheet(self._directions, frames)


class _AutoApproveReview:
    """测试替身:直接放行。**只用于不测这道闸的用例** —— 闸本身另有专门用例。"""

    def __init__(self) -> None:
        self.submitted: list[str] = []

    def submit(self, key: str, model: bytes, fmt: str) -> str:
        self.submitted.append(key)
        return f"<fake>/{key}.{fmt.lower()}"

    def is_approved(self, key: str) -> bool:
        return True


def _adapter(tmp_path: pathlib.Path, renderer=None, may_build=True, review=None):
    """``may_build`` 缺省 True:多数用例要验建资产那一支的行为,而这里的三段都是假的、
    不花真钱。**默认档(False)的行为另有专门用例**,见"花钱要有人点头"那一节。

    ``review`` 缺省自动放行,同理 —— 人工确认停点的行为另有专门用例。"""
    m, r = _FakeModel3D(), _FakeAutoRig()
    rend = renderer or _FakeRenderer()
    return Render3DAdapter(
        model3d=m, autorig=r, renderer=rend, store=LocalDirAssetStore(tmp_path),
        review=review or _AutoApproveReview(),
        may_build_assets=may_build,
    ), m, r, rend


def _card(master_ref: str = "kodo://masters/abc.png") -> CharacterCard:
    return CharacterCard(name="仙月", desc="美少女", master_ref=master_ref, version="v1")


def _spec(**kw) -> ActionSpec:
    kw.setdefault("action", ActionType.WALK)
    kw.setdefault("n_frames", 4)
    kw.setdefault("stylize", Stylize.NONE)
    return ActionSpec(**kw)


# ── ① 成本性质:角色级资产每角色一次性 ────────────────────────────────────


def test_second_action_reuses_character_assets_and_pays_nothing_extra(tmp_path):
    """同一角色的第二个动作**不得**再跑图生 3D / 绑骨。

    这是 #121 的整个论点:有落点时一个角色做 N 个动作的云成本与做 1 个几乎一样;
    没落点则线性翻 N 倍。而重付这件事**不会报错**,只表现为账单变多 —— 所以必须有
    一条断言盯着调用次数,不能靠"跑通了"证明。
    """
    ad, m3d, rig, rend = _adapter(tmp_path)
    card = _card()

    ad.derive_frames(card, _spec(action=ActionType.WALK), b"master", _NullProgress())
    assert (m3d.calls, rig.calls) == (1, 1)

    ad.derive_frames(card, _spec(action=ActionType.RUN), b"master", _NullProgress())
    ad.derive_frames(card, _spec(action=ActionType.IDLE), b"master", _NullProgress())

    assert (m3d.calls, rig.calls) == (1, 1), "角色级资产被重复生成 = 按动作重复计费"
    assert rend.calls == 3, "渲帧是零成本的那段,每个动作都该真渲"


def test_assets_survive_a_new_adapter_instance(tmp_path):
    """换一个 adapter 实例(≈进程重启)仍要复用 —— 进程内缓存不算落点。"""
    ad1, m1, r1, _ = _adapter(tmp_path)
    ad1.derive_frames(_card(), _spec(), b"master", _NullProgress())
    assert (m1.calls, r1.calls) == (1, 1)

    ad2, m2, r2, _ = _adapter(tmp_path)          # 同一个目录
    assert ad2.can_serve(_card()) is True
    ad2.derive_frames(_card(), _spec(), b"master", _NullProgress())
    assert (m2.calls, r2.calls) == (0, 0), "重启后又付了一遍角色级的钱"


def test_different_version_does_not_reuse(tmp_path):
    """键含 version:换版本是另一份资产,不能复用旧模型。"""
    ad, m3d, rig, _ = _adapter(tmp_path)
    ad.derive_frames(_card(), _spec(), b"master", _NullProgress())
    v2 = CharacterCard(name="仙月", desc="美少女", master_ref="kodo://masters/abc.png",
                       version="v2")
    ad.derive_frames(v2, _spec(), b"master", _NullProgress())
    assert (m3d.calls, rig.calls) == (2, 2)


def test_no_master_ref_raises_before_spending(tmp_path):
    """没有 master_ref 就没法安全缓存 —— 在花钱之前停,而不是每个动作重付。"""
    ad, m3d, rig, _ = _adapter(tmp_path)
    with pytest.raises(ValueError, match="master_ref"):
        ad.derive_frames(_card(master_ref=""), _spec(), b"master", _NullProgress())
    assert (m3d.calls, rig.calls) == (0, 0), "报错前不该已经花过钱"


def test_can_serve_costs_nothing(tmp_path):
    """can_serve 在选路线时调用,即在花钱之前,必须无副作用。"""
    ad, m3d, rig, rend = _adapter(tmp_path, may_build=False)
    assert ad.can_serve(_card()) is False
    assert (m3d.calls, rig.calls, rend.calls) == (0, 0, 0)


# ── 花钱要有人点头(默认档 may_build_assets=False)────────────────────────────


def test_default_posture_refuses_to_build_assets(tmp_path):
    """默认不授权花钱:新角色**不会**被一个请求顺手扣掉 ¥3.60。"""
    ad, m3d, rig, _ = _adapter(tmp_path, may_build=False)
    with pytest.raises(ValueError, match="未获准建"):
        ad.derive_frames(_card(), _spec(), b"master", _NullProgress())
    assert (m3d.calls, rig.calls) == (0, 0), "默认档下不该花掉任何一笔"


def test_default_posture_still_serves_characters_that_already_have_assets(tmp_path):
    """默认档不是"整条路线关掉":已有资产的角色照常出帧(渲帧本就零成本)。"""
    ready, *_ = _adapter(tmp_path, may_build=True)
    ready.derive_frames(_card(), _spec(), b"master", _NullProgress())   # 先备好

    ad, m3d, rig, rend = _adapter(tmp_path, may_build=False)
    assert ad.can_serve(_card()) is True
    ad.derive_frames(_card(), _spec(), b"master", _NullProgress())
    assert (m3d.calls, rig.calls) == (0, 0)
    assert rend.calls == 1


def test_authorized_posture_reports_route_available_before_assets_exist(tmp_path):
    """获准花钱时,资产还没建也该判"这条路线能用" —— 否则明明能跑却被拒。"""
    ad, *_ = _adapter(tmp_path, may_build=True)
    assert ad.can_serve(_card()) is True


# ── ② 路线选择:不静默回退 ────────────────────────────────────────────────


def test_explicit_render3d_without_assets_raises_not_falls_back(tmp_path):
    """点了三渲二但这条路线对该角色不可用 → 报错,**不能**悄悄给一段 i2v。

    用默认档(未授权花钱)+ 无资产来构造"真的不可用";授权档下没资产是可以现建的,
    那种情形不该被拒(另有用例)。
    """
    ad, *_ = _adapter(tmp_path, may_build=False)
    gen = CharacterGenerator({
        GenRoute.RENDER_3D: RenderFrameStrategy(ad),
        GenRoute.VIDEO_I2V: VideoFrameStrategy(None, None),
    })
    with pytest.raises(RouteUnavailable) as e:
        gen.generate(_card(), _spec(route=GenRoute.RENDER_3D), _png(256, 256), _NullProgress())
    assert e.value.route == "render_3d"
    assert "3D" in e.value.detail


def test_route_defaults_to_matrix_when_not_specified():
    """不传 route 时行为与从前一致(走 ROUTE_MATRIX),这次改动不该动默认路线。"""
    from windup_ai_engine.strategy.base import ROUTE_MATRIX

    assert _spec(action=ActionType.WALK).route is None
    assert ROUTE_MATRIX[ActionType.WALK] is GenRoute.VIDEO_I2V


def test_explicit_route_is_honoured_over_matrix(tmp_path):
    """显式 route 要压过矩阵 —— 否则这个字段是摆设。"""
    ad, m3d, rig, rend = _adapter(tmp_path)
    ad.derive_frames(_card(), _spec(), b"master", _NullProgress())      # 先备好资产
    gen = CharacterGenerator({GenRoute.RENDER_3D: RenderFrameStrategy(ad)})
    prog = _SpyProgress()
    # walk 的矩阵默认是 video_i2v,而装配表里只有 render_3d;显式指定后必须能跑通。
    gen.generate(_card(), _spec(route=GenRoute.RENDER_3D), _png(256, 256), prog)
    assert any("render_3d" in n and "调用方指定" in n for n in prog.notes), prog.notes


# ── ③ 多朝向:如实上报,不闷掉 ─────────────────────────────────────────────


def test_requested_facing_picks_the_matching_direction(tmp_path):
    ad, *_ = _adapter(tmp_path)
    out = ad.derive_frames(_card(), _spec(facing=Facing.FRONT), b"master", _NullProgress())
    assert out.direction == "n", "FRONT 应取朝观者那一条(实测 n 是正面,不是 s)"
    out = ad.derive_frames(_card(), _spec(facing=Facing.SIDE), b"master", _NullProgress())
    assert out.direction == "e", "SIDE 应取朝画面右那一条"


def test_missing_direction_raises_instead_of_handing_back_another(tmp_path):
    """朝向缺失时不能随便给一条:角色朝反方向走,而帧数/时长/成色全正常。"""
    ad, *_ = _adapter(tmp_path, renderer=_FakeRenderer(directions=("n", "w")))
    with pytest.raises(ValueError, match="朝向"):
        ad.derive_frames(_card(), _spec(facing=Facing.SIDE), b"master", _NullProgress())


def test_extra_directions_are_reported_not_silently_dropped(tmp_path):
    """一次渲染已经算出的其余朝向是零成本资产,出参装不下也要说出来(#122 D15)。"""
    ad, *_ = _adapter(tmp_path)
    prog = _SpyProgress()
    strat = RenderFrameStrategy(ad)
    strat.derive(_card(), _spec(facing=Facing.SIDE), b"master", prog)
    assert any("#122" in n and "零成本" in n for n in prog.notes), prog.notes


def test_rendered_frames_carries_available_directions(tmp_path):
    ad, *_ = _adapter(tmp_path)
    out: RenderedFrames = ad.derive_frames(_card(), _spec(), b"master", _NullProgress())
    assert set(out.available_directions) == {"e", "n", "w", "s"}


# ── ④ 出帧画布:用挣来的那个口径 ──────────────────────────────────────────


def test_render_uses_the_measured_portrait_canvas(tmp_path):
    """1536×2560 是 2026-08-11 实测挣来的(主体 2.65 倍、耗时不变),别退回横图。"""
    ad, _, _, rend = _adapter(tmp_path)
    ad.derive_frames(_card(), _spec(), b"master", _NullProgress())
    assert rend.last_size == (1536, 2560)


# ── ⑤ 空产出必须炸 ───────────────────────────────────────────────────────


def test_empty_render_output_raises(tmp_path):
    """钱已经花了,但空帧不放行(与 PerFrameStrategy 那条同一条理由)。"""

    class _EmptyRenderer(_FakeRenderer):
        def render(self, rigged_model, **kw):
            self.calls += 1
            return _sheet(("e",), 0)

    ad, *_ = _adapter(tmp_path, renderer=_EmptyRenderer())
    with pytest.raises(ValueError, match="未产出任何帧"):
        RenderFrameStrategy(ad).derive(_card(), _spec(), b"master", _NullProgress())


# ── ⑥ 生成的 3D 模型必须先给人看过才往下走 ─────────────────────────────────


def test_model_awaits_review_before_paying_for_rigging(tmp_path):
    """图生 3D 之后停住,**绑骨那 10 积分一分没花**。

    混元的模型改不动(生成即最终),坏模型只能重生成。一口气冲到绑骨+出帧的话,一个坏
    模型会连带浪费绑骨的钱和后面所有出帧,而人要看完一整套序列帧才发现锅在最上游。
    """
    review = LocalDirModelReview(tmp_path / "review")
    ad, m3d, rig, rend = _adapter(tmp_path, review=review)

    with pytest.raises(ModelAwaitingReview) as e:
        ad.derive_frames(_card(), _spec(), b"master", _NullProgress())

    assert m3d.calls == 1, "图生 3D 该已经跑了(模型要拿出来给人看)"
    assert rig.calls == 0, "绑骨的钱不该在人点头之前花掉"
    assert rend.calls == 0
    assert pathlib.Path(e.value.where).is_file(), "待审模型要真的落盘,人才看得到"


def test_waiting_for_review_does_not_repay_image_to_3d(tmp_path):
    """待审期间被反复调用,**不能每次都重付图生 3D**。

    停点的本意是省钱;若每次轮询都重生成一次模型,这道闸就变成了花钱机器。
    """
    review = LocalDirModelReview(tmp_path / "review")
    ad, m3d, rig, _ = _adapter(tmp_path, review=review)
    for _ in range(3):
        with pytest.raises(ModelAwaitingReview):
            ad.derive_frames(_card(), _spec(), b"master", _NullProgress())
    assert m3d.calls == 1, f"图生 3D 被重付了 {m3d.calls} 次"
    assert rig.calls == 0


def test_after_approval_it_proceeds_and_reuses_the_stored_model(tmp_path):
    """人点头后继续绑骨,且复用已存的模型(不重新生成)。"""
    review = LocalDirModelReview(tmp_path / "review")
    ad, m3d, rig, rend = _adapter(tmp_path, review=review)
    with pytest.raises(ModelAwaitingReview):
        ad.derive_frames(_card(), _spec(), b"master", _NullProgress())

    review.approve(Render3DAdapter._key(_card()))          # 人看过、放行

    out = ad.derive_frames(_card(), _spec(), b"master", _NullProgress())
    assert out.frames
    assert m3d.calls == 1, "放行后不该再重付一次图生 3D"
    assert rig.calls == 1
    assert rend.calls == 1


def test_review_never_self_approves(tmp_path):
    """这道闸不得自动放行 —— 自动放行的闸等于没有闸。"""
    review = LocalDirModelReview(tmp_path / "review")
    key = "kodo://x@v1"
    assert review.is_approved(key) is False
    review.submit(key, b"model-bytes", "GLB")
    assert review.is_approved(key) is False, "只是交上去待审,不该就算通过"
    review.approve(key)
    assert review.is_approved(key) is True
