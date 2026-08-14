"""动作预设:措辞门禁 + 只读接口。

门禁那两条用例是本组的重点:预设描述直通两条付费生成通路,写错了只能靠人看图发现,
而这里能让它在 CI 当场变红(Refs 1024XEngineer/Windup#309)。
"""

import pytest

from windup_ai_engine.prompt import ACTION_PRESETS
from windup_ai_engine.prompt.lint import lint


@pytest.mark.parametrize("preset", ACTION_PRESETS, ids=lambda p: p.type.value)
def test_preset_description_passes_the_wording_gate(preset):
    """按 i2v 查,不按 still 查。

    预设描述同时进两条通路(动作母版静态图 + i2v),而 2a / 2b 只在 i2v 报 error:
    按 still 查会把"轻微"降级成 warn、把持物锚定整条跳过,于是只在视频里翻车的措辞
    照样绿着上线 —— 那正是这条用例要拦的那类错。i2v 的 error 集是两者的超集。
    """
    errors = [issue for issue in lint(preset.description, kind="i2v") if issue.level == "error"]
    assert not errors, "预设 {} 的描述过不了措辞门禁:{}".format(
        preset.type.value,
        " / ".join(f"[{issue.category}] {issue.message}" for issue in errors),
    )


@pytest.mark.parametrize("preset", ACTION_PRESETS, ids=lambda p: p.type.value)
def test_preset_description_is_one_instant_not_a_sequence(preset):
    """多阶段描述是 #309 的直接成因,而它逐词都不违规 —— lint 的规则里没有一条管得着。

    静态模型收到"先 A 后 B"只能把两个阶段并排画成分解姿势图,于是一张母版上有多个
    人物;帧数、时长、成色全部正常,只有看图才看得出来。
    """
    for staging in ("然后", "接着", "再", "之后", "回到", "先"):
        assert staging not in preset.description, (
            f"预设 {preset.type.value} 的描述里出现了阶段连接词「{staging}」,"
            "它描述的是一段过程而不是一个瞬间"
        )


def test_list_action_presets_returns_every_preset(auth_client):
    response = auth_client.get("/action-presets")

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert [item["type"] for item in body["data"]] == [p.type.value for p in ACTION_PRESETS]
    assert [item["description"] for item in body["data"]] == [
        p.description for p in ACTION_PRESETS
    ]
    assert [item["label"] for item in body["data"]] == [p.label for p in ACTION_PRESETS]
    assert [item["name"] for item in body["data"]] == [p.name for p in ACTION_PRESETS]


def test_list_action_presets_requires_login(client):
    """预设是产品文案,但接口不进白名单:未登录拿不到,与其余业务接口同一道门。"""
    body = client.get("/action-presets").json()

    assert body["code"] == 401
