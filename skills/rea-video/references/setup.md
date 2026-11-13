<!-- SoloSquad vendored copy: edited, see ../UPSTREAM.md -->
# 安装与 VLM 配置

## 安装（一次性）

按 SoloSquad `SKILL.md`「설치」：从仓库内固定版本（`vendor/`）装进独立 venv。不要从网上安装最新版，也不用上游的安装脚本（SoloSquad 副本里没有）。

## 本地语音识别（可选）

没有烧录字幕、也没开能听声音的 VLM 时，台词从哪来？装上可选的语音识别：

```bash
<venv>/bin/pip install sherpa-onnx   # 可选：本地语音识别 + 分说话人（首次使用下载模型，需用户同意）
```

装了之后 `decompose` 会自动在分离出的人声干声上识别（SenseVoice，中 / 英 / 日 / 韩 / 粤；首次使用下载约 160 MB 模型到 `$REA_VIDEO_MODELS`，默认 `~/.cache/rea-video/models`），
一分钟的片子几秒钟。结果在 `breakdown.json` 的 `speech.lines`（每句有起止时间），报告「脚本」表和 `review_tasks.json` 每镜的 `said` 会用它。`--no-asr` 可跳过。
台词是孟加拉语时加 `--asr-lang bn`（或 `rea-video prefs asr_lang bn` 设成默认）：SenseVoice 不认孟加拉语，会把它听成英 / 日 / 韩文的乱码；
`bn` 换用孟加拉语的流式识别模型（另下约 90 MB），`speech.language` 是 `bn`，识别出的句子不带标点。
同一个可选包还会分出说话人（另下约 35 MB 模型）：多人对话时台词带上是谁说的，并给每人输出一条音轨，见 `audio.md`。

这是机器听写，会有同音错字、专有名词听错：画面上有字幕时以字幕为准，VLM 给了台词时报告用 VLM 的；引用台词给用户时注明"语音识别，未校对"。
长句里逐句的时间是按字数估的（`timing: estimated`），整段的起止是测出来的。没装时 `speech.reason` 是 `not_installed`，其余照常。

## VLM 配置（建议，不强制）

**VLM（建议配置，不强制）**：VLM 是能看图/看视频的多模态大模型（Gemini、GPT-4o、豆包、Qwen-VL 等）。不开 VLM，工具只靠像素统计、帧率、OCR、元数据判断，照样能跑完、出报告，但**实拍 / AI / 3D 的区分明显变弱**，音效清单也只有信号层的低置信候选。开了 VLM，工具会把每个镜头的短片段和关键帧发给它，再和确定性结果融合。

配置走 OpenAI 兼容接口，按以下顺序读取：

1. `REA_VLM_BASE_URL` / `REA_VLM_API_KEY` / `REA_VLM_MODEL`（`REA_VLM_MODEL` 可写多个模型、逗号分隔，前一个失败自动换下一个）
2. 如果没有，回落到 capsule-cinema 的 `VIDEO_ANALYSIS_*` 或 `GEMINI3_*`

用 `--env-file <某个 .env>` 读取配置。**不要把密钥写进对话、仓库或报告，也不要打开 .env 看内容。**

用户没配 VLM 时：照常不加 `--vlm` 跑，不要因此中止任务。

- **你自己能看图（多模态 agent）**：你就是这次的"VLM"，不需要建议用户另配。按 SKILL.md 第 1 节的「看图复核并入」做：`rea-video review` → 逐镜看图填答案 → `rea-video apply-review`，你的判断会并入工具结论和报告。结论里写"未开 VLM，由 agent 看图复核"。
- **你看不了图**：遵守 `review.md` 的「看不了图时的规则」，并在回复末尾用一句话建议配置 VLM（说明能提升实拍/AI/3D 的区分和音效识别）。
- 实测（仓库 eval/RESULTS.md）：agent 看图复核并入比单开 Gemini VLM 更准；Gemini 容易把卡通 3D 风格的 AI 视频判成 3D 渲染、把画进画面的游戏界面判成录屏。所以能看图时**一定要做看图复核**，开了 VLM 也要做，并且独立判断，不要照抄 VLM。
- 外部 VLM 仍有你替代不了的部分：它能直接看视频片段的运动、听音轨。你只能看静帧、听不了声音时，音效和人声来源照样标"待确认"。

**VLM 是否真的生效，以 `rea-video summary` 的 `VLM:` 一行为准**（也在 `breakdown.json` 的 `analysis.vlm.status`）：`ok` 已生效、`partial` 部分镜头有结果、`failed` 请求了但全部调用失败（例如服务端 503）、`not_configured` 请求了但没找到配置、`off` 没请求。`failed` / `not_configured` 等同没开 VLM，报告里要如实写，不能写"已开 VLM"。镜头很多时这一行会写"只送了 a/n 个镜头"：默认最多 60 次调用，没送的镜头只靠确定性取证，需要全看就加 `--max-vlm-shots N` 重跑，或对这些镜头做看图复核。
