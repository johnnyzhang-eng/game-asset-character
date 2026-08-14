"""三渲二三段能力的 provider 接口契约。

    Model3DProvider      母版图 bytes  → 3D 模型 bytes        (云,按次计费)
    AutoRigProvider      3D 模型 bytes → 绑骨模型 bytes + 动作 (云,按次计费)
    SpriteRenderProvider 绑骨模型 bytes → 各朝向序列帧 bytes   (本地,零成本)

入参出参恒为 bytes,不是 URL / 路径:让每个调用点自己弄一个公网 URL 或落盘目录,会把对象
存储与路径约定扩散到整条管线。绑骨接口只吃公网 URL,那是 :class:`AutoRigProvider` 实现接
一个 :class:`ModelUploader` 自行解决的适配问题。本文件不 import 管线仓任何模块。
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

__all__ = [
    "Model3DProvider", "AutoRigProvider", "SpriteRenderProvider", "ModelUploader",
    "PresetMotion", "RiggedModel", "SpriteSequence", "SpriteSheet", "RigInfo",
    "ModelRejectCode", "ModelRejected", "ArtifactFormatError", "ModelNotPublicError",
    "JobFailedError", "JobTimeoutError", "InsufficientCreditsError", "RenderStageError",
    "MODEL_FORMATS",
]

# 接口两端只认这两种容器格式(``File3D.Type`` 的取值域)。
MODEL_FORMATS = ("GLB", "FBX")

# 竖屏画布:角色竖长,横画布(旧默认 1107×924)下主体只占 193×668,宽度浪费 82%。
# 只改画布不改别的,主体像素涨 2.65 倍而单帧耗时(~2.5s)几乎不变 —— "糊"的根因是画布,
# 不是渲染质量。
RENDER_SIZE = (1536, 2560)


# ── 出错形态 ────────────────────────────────────────────────────────────────
# 分四类而不是一个 RuntimeError:积分不够(充值)、姿势不对(换母版)、产物格式不符
# (改取件)、任务超时(可能已计费)看起来一样,修法完全不同。


class ModelRejectCode:
    """入口预检的拒绝原因。取值是稳定字符串,可进日志 / 进 API 响应。"""

    UNREADABLE = "unreadable"          # 解不开的 bytes / 不是 GLB 也不是 FBX
    TOO_LARGE = "too_large"            # 超过接口 60MB 上限
    NOT_A_POSE = "not_a_pose"          # 几何上明显不是 A/T-Pose(单侧判据,见 checks)
    HAS_ACCESSORY = "has_accessory"    # 检出人体以外的独立网格(弱信号,见 checks)


class ModelRejected(Exception):
    """送检模型不满足绑骨的三条硬约束(≤60MB / A-T-Pose / 无武器配件),在提交(花钱)
    之前抛 —— 违反这三条接口不报错,只会默默产出错结果并照常扣积分。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message


class ArtifactFormatError(RuntimeError):
    """产物格式与请求的不符 —— 拒绝当成功。请求 GLB 拿到 FBX 是会发生的,而 bytes 进
    bytes 出没有文件名可改,只能按 Type 挑 + magic bytes 复核:Type 是自述,magic 是事实。"""


class ModelNotPublicError(RuntimeError):
    """uploader 没给出 http(s) 公网 URL,绑骨服务器取不到这个模型。本地路径 / dataURI
    提交上去注定失败但照样占配额,宁可在提交前炸。"""


class JobFailedError(RuntimeError):
    """云端任务返回失败终态,或返回了认不出的状态。认不出的一律当失败、不 continue ——
    继续轮询会转到超时,把"协议变了"伪装成"生成太慢"。"""


class JobTimeoutError(RuntimeError):
    """轮询预算耗尽仍未出结果(任务可能还在跑,**积分可能已经扣了**)。"""


class InsufficientCreditsError(RuntimeError):
    """账户积分不足(``ResourceInsufficient``)。单拎一类是因为它极易被误判成"接口坏了",
    而修法是充值,不是改代码。"""


class RenderStageError(RuntimeError):
    """本地出帧台失败(node / 浏览器 / 页面脚本)。零成本段,失败可以随便重试。"""


# ── 值对象 ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PresetMotion:
    """绑骨接口自带的预设动作。``has_root_motion`` 恒为 ``False``:48 个预设全部是纯旋转的
    原地动画,跑步、向前大跳的根位移实测都是 0,这条来源上没有位移源数据。"""

    name: str
    motion_type: int
    has_root_motion: bool = False


@dataclass(frozen=True)
class RiggedModel:
    """绑骨产物。``fmt`` 是 magic bytes 验过的真实格式,不是接口自述的 ``Type``。"""

    data: bytes
    fmt: str
    motion: PresetMotion | None = None

    def __post_init__(self) -> None:
        if self.fmt not in MODEL_FORMATS:
            raise ArtifactFormatError(f"fmt 只能是 {MODEL_FORMATS},收到 {self.fmt!r}")


@dataclass(frozen=True)
class RigInfo:
    """出帧台读到的骨架事实,用于交付前核对,不参与渲染。自动绑骨产出恒为 **28 骨** ·
    humanoid 命名 · **无 ``mixamorig:`` 前缀**;对不上说明拿到的不是本链路的产物。"""

    bones: int
    skinned_meshes: int
    vertices: int
    root_bone: str | None
    loader: str


@dataclass(frozen=True)
class SpriteSequence:
    """一个朝向的一条序列帧。``direction`` 取值域与前端
    ``ExportAction.sequences[].direction`` 一致,不需要转换层。"""

    direction: str
    camera_yaw: float
    frames: Sequence[bytes] = field(repr=False)

    def __len__(self) -> int:
        return len(self.frames)


@dataclass(frozen=True)
class SpriteSheet:
    """一次出帧的全部产物。``root_motion`` 的单位是归一化的(1.0 = 角色总高),走绑骨预设
    动作时恒为 0(见 :class:`PresetMotion`);留着它是因为同一个出帧台也吃外部动画。"""

    clip: str
    duration_s: float
    sample_times: Sequence[float]
    sequences: Sequence[SpriteSequence]
    rig: RigInfo
    available_clips: Mapping[str, float]
    root_motion: Mapping[str, object] | None = None

    @property
    def frame_count(self) -> int:
        return sum(len(s) for s in self.sequences)


# ── port ────────────────────────────────────────────────────────────────────


@runtime_checkable
class ModelUploader(Protocol):
    """3D 模型 bytes → **公网可取的 URL**(给只吃 URL 的绑骨接口用)。

    与 :class:`FirstFrameUploader` 形状相同、契约不同:URL 必须在整个绑骨任务周期
    (排队 + 绑骨)内可取,不是发出去就完事;预签名 URL 含 SecretId 与 signature,
    **调用方不得把它写进日志 / 错误文本**。
    """

    def upload(self, model: bytes, content_type: str) -> str: ...


# ── 三个 Protocol ───────────────────────────────────────────────────────────


@runtime_checkable
class Model3DProvider(Protocol):
    """母版图 bytes → 3D 模型 bytes。**按次计费**,不要在循环里跑。``want`` 是保证不是偏好:
    拿不到该格式就抛,绝不返回另一种格式的 bytes —— bytes 没有后缀可以说谎。"""

    def image_to_3d(
        self,
        master: bytes,
        *,
        want: str = "GLB",
        extra_views: Mapping[str, bytes] | None = None,
    ) -> bytes: ...


@runtime_checkable
class AutoRigProvider(Protocol):
    """3D 模型 bytes → 绑好骨的模型 bytes。**按次计费**(10 积分/次,每角色一次性)。

    格式由 magic bytes 嗅,不由调用方声明:``fmt=`` 参数可以填错,而填错的后果是提交一个
    注定产出错结果的付费任务。
    """

    @property
    def preset_motions(self) -> Mapping[str, PresetMotion]: ...

    def rig(
        self,
        model: bytes,
        *,
        want: str = "GLB",
        motion: str | int | None = None,
    ) -> RiggedModel: ...


@runtime_checkable
class SpriteRenderProvider(Protocol):
    """绑骨模型 bytes + 动作 + 朝向 → 各朝向序列帧 bytes。

    **本地跑,零 API 成本**,且只换相机方位角重渲、各朝向天生一致 —— 这是三渲二相对
    逐帧 / 视频路线的主要杠杆,那两条做同样的事是 N 倍费用且没有一致性保证。
    """

    def render(
        self,
        rigged_model: bytes,
        *,
        clip: str | None = None,
        directions: int = 4,
        frames: int = 12,
        size: tuple[int, int] = RENDER_SIZE,
        material: str = "cel",
    ) -> SpriteSheet: ...
