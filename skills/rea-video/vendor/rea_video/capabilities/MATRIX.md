# 能力矩阵（自动生成，请勿手改）

由 `python3 scripts/validate_capabilities.py --matrix` 根据 `rea_video/capabilities/` 生成。
置信度：● high ◐ medium ○ low。已关停的模型不列出。

| 原语 | 名称 | 可用模型 |
|---|---|---|
| `analyze.video_understanding` | 视频语义理解 | ◐ `doubao-seed-2.0-pro`、◐ `gemini-3.1-pro`、◐ `gemini-3.5-flash`、◐ `pegasus-1.5`、◐ `qwen3.5-397b-a17b` |
| `analyze.shot_boundary` | 切镜检测 | ● `pyscenedetect`、● `transnetv2` |
| `analyze.asr_word_align` | 语音识别 + 字级对齐 | ◐ `funasr-sensevoice`、● `whisperx` |
| `analyze.ocr_text_track` | 画面文字识别与轨迹 | ● `paddleocr` |
| `analyze.segmentation` | 分割与跟踪 | ◐ `sam-video` |
| `analyze.matting` | 视频抠像（alpha） | ◐ `matanyone-2`、◐ `robust-video-matting`、◐ `volcengine-matting` |
| `analyze.camera_motion` | 相机运动反解 | ◐ `megasam` |
| `analyze.audio_separation` | 音频分轨 | ● `demucs` |
| `analyze.beat_tempo` | 节拍与段落分析 | ◐ `librosa-madmom` |
| `analyze.image_layer_decompose` | 单帧图层分解 | ◐ `seedream-5.0`、◐ `seedream-5.5` |
| `image.t2i` | 文生图 | ◐ `flux-3`、◐ `flux-3-klein`、● `gpt-image-2.5`、◐ `gpt-image-2.6`、◐ `grok-imagine-image-2.0`、○ `ideogram-4.5`、◐ `kling-o3-image`、◐ `mai-image-2.6`、○ `midjourney-v8.2`、◐ `minimax-h3-image`、◐ `nano-banana-2-lite`、◐ `nano-banana-2.1`、◐ `qwen-image-2.1`、◐ `qwen-image-3.0`、◐ `qwen-image-3.0-pro`、◐ `seedream-5.0`、◐ `seedream-5.5` |
| `image.edit_multi_ref` | 多参考图像编辑/合成 | ◐ `flux-3`、◐ `flux-3-klein`、● `gpt-image-2.5`、◐ `gpt-image-2.6`、◐ `grok-imagine-image-2.0`、○ `ideogram-4.5`、◐ `kling-o3-image`、◐ `mai-image-2.6`、○ `midjourney-v8.2`、◐ `minimax-h3-image`、◐ `nano-banana-2.1`、◐ `qwen-image-2.1`、◐ `qwen-image-3.0`、◐ `qwen-image-3.0-pro`、◐ `seedream-5.0`、◐ `seedream-5.5` |
| `image.text_render` | 画内文字渲染 | ◐ `flux-3`、● `gpt-image-2.5`、◐ `gpt-image-2.6`、○ `ideogram-4.5`、◐ `mai-image-2.6`、◐ `minimax-h3-image`、◐ `nano-banana-2.1`、◐ `qwen-image-2.1`、◐ `qwen-image-3.0`、◐ `qwen-image-3.0-pro`、◐ `seedream-5.0`、◐ `seedream-5.5` |
| `image.storyboard_series` | 分镜组图 | ◐ `kling-o3-image`、◐ `seedream-5.0` |
| `image.tryon` | 虚拟试穿 | ◐ `fashn-tryon-max`、◐ `fashn-v1.6`、◐ `kling-kolors-tryon`、◐ `kling-virtual-tryon-3`、◐ `qwen-image-2.1` |
| `video.t2v` | 文生视频 | ◐ `flux-3-video`、○ `flux-3-video-max`、◐ `gemini-omni-flash`、◐ `grok-imagine-video-1.5`、○ `grok-imagine-video-1.5-lite`、◐ `hailuo-2.3`、○ `happyhorse-1.0`、◐ `heygen-video-1`、◐ `hunyuanvideo-1.5`、◐ `kling-3.0`、◐ `kling-4.0`、◐ `kling-4.0-flash`、◐ `kling-o3`、◐ `ltx-2.5`、○ `luma-ray3.2`、◐ `minimax-h3`、◐ `minimax-h3-max`、○ `p-video-2-pro`、◐ `pika-h3-flex`、◐ `pixverse-v6`、◐ `runway-gen-4.5`、◐ `seedance-2.0`、● `seedance-2.5`、○ `seedance-2.5-flash`、○ `skyreels-v4`、○ `utopai-x`、◐ `veo-3.1`、◐ `vidu-q3`、● `wan-2.2`、◐ `wan-3.0` |
| `video.i2v_first_frame` | 图生视频（首帧） | ◐ `flux-3-video`、○ `flux-3-video-max`、◐ `gemini-omni-flash`、◐ `grok-imagine-video-1.5`、○ `grok-imagine-video-1.5-lite`、◐ `hailuo-2.3`、○ `happyhorse-1.0`、◐ `heygen-video-1`、◐ `hunyuanvideo-1.5`、◐ `kling-3.0`、◐ `kling-4.0`、◐ `kling-4.0-flash`、◐ `kling-o3`、◐ `ltx-2.5`、○ `luma-ray3.2`、◐ `minimax-h3`、◐ `minimax-h3-max`、○ `p-video-2-pro`、◐ `pika-h3-flex`、◐ `pixverse-v6`、◐ `runway-gen-4.5`、◐ `seedance-2.0`、● `seedance-2.5`、○ `seedance-2.5-flash`、○ `skyreels-v4`、◐ `veo-3.1`、◐ `vidu-q3`、◐ `vidu-q4-preview`、● `wan-2.2`、◐ `wan-3.0` |
| `video.i2v_first_last` | 首尾帧生成 | ◐ `flux-3-video`、○ `flux-3-video-max`、◐ `gemini-omni-flash`、◐ `grok-imagine-video-1.5`、◐ `heygen-video-1`、◐ `kling-3.0`、◐ `kling-4.0`、◐ `kling-o3`、◐ `minimax-h3`、◐ `minimax-h3-max`、○ `p-video-2-pro`、◐ `pika-h3-flex`、◐ `pixverse-v6`、◐ `seedance-2.0`、● `seedance-2.5`、○ `seedance-2.5-flash`、◐ `veo-3.1`、◐ `wan-3.0` |
| `video.keyframes` | 多关键帧控制 | ◐ `flux-3-video`、○ `flux-3-video-max`、◐ `grok-imagine-video-1.5`、◐ `kling-4.0`、◐ `runway-gen-4.5` |
| `video.multi_reference` | 多参考生视频（主体一致） | ◐ `gemini-omni-flash`、◐ `grok-imagine-video-1.5`、○ `happyhorse-1.0`、◐ `heygen-video-1`、◐ `kling-3.0`、◐ `kling-4.0`、◐ `kling-4.0-flash`、◐ `kling-o3`、◐ `minimax-h3`、◐ `minimax-h3-max`、◐ `pika-h3-flex`、◐ `pixverse-v6`、◐ `seedance-2.0`、● `seedance-2.5`、○ `seedance-2.5-flash`、◐ `veo-3.1`、◐ `vidu-q3`、◐ `vidu-q4-preview`、◐ `wan-3.0` |
| `video.reference_video` | 参考视频生成（动作/运镜/特效迁移） | ◐ `gemini-omni-flash`、◐ `heygen-video-1`、◐ `kling-4.0`、◐ `kling-4.0-flash`、◐ `kling-o3`、◐ `minimax-h3-max`、◐ `pika-h3-flex`、◐ `pixverse-v6`、◐ `seedance-2.0`、● `seedance-2.5`、○ `seedance-2.5-flash`、○ `skyreels-v4`、◐ `wan-3.0` |
| `video.reference_audio` | 参考音频生成 | ◐ `grok-imagine-video-1.5`、◐ `heygen-video-1`、◐ `kling-4.0-flash`、◐ `ltx-2.5`、◐ `minimax-h3-max`、◐ `pika-h3-flex`、◐ `seedance-2.0`、● `seedance-2.5`、○ `seedance-2.5-flash`、◐ `vidu-q4-preview`、◐ `wan-3.0` |
| `video.multi_shot` | 单次多镜头 | ◐ `flux-3-video`、◐ `gemini-omni-flash`、◐ `kling-3.0`、◐ `kling-4.0`、◐ `kling-4.0-flash`、◐ `kling-o3`、◐ `ltx-2.5`、◐ `minimax-h3`、◐ `pika-h3-flex`、◐ `pixverse-v6`、◐ `seedance-2.0`、● `seedance-2.5`、◐ `veo-3.1`、◐ `vidu-q4-preview`、◐ `wan-3.0` |
| `video.extend` | 续写延长 | ◐ `flux-3-video`、◐ `gemini-omni-flash`、● `seedance-2.5`、◐ `veo-3.1` |
| `video.edit_v2v` | 视频编辑（保留运动） | ◐ `flux-3-video`、◐ `gemini-omni-flash`、○ `happyhorse-1.0`、○ `higgsfield-genjutsu`、◐ `kling-4.0`、◐ `kling-o3`、◐ `ltx-2.5`、○ `luma-ray3.2`、◐ `pika-h3-flex`、○ `runway-aleph-2`、◐ `runway-gen-4.5`、◐ `seedance-2.0`、● `seedance-2.5`、○ `skyreels-v4`、◐ `viggle-animate`、◐ `wan-2.2-animate`、○ `wan-2.7-edit` |
| `video.camera_control` | 运镜与镜头参数控制 | ◐ `gemini-omni-flash`、◐ `kling-3.0`、◐ `kling-4.0`、◐ `pixverse-v6`、○ `runway-aleph-2`、◐ `runway-gen-4.5`、● `seedance-2.5` |
| `video.native_audio` | 音画同出 | ◐ `flux-3-video`、○ `flux-3-video-max`、◐ `gemini-omni-flash`、◐ `grok-imagine-video-1.5`、○ `grok-imagine-video-1.5-lite`、◐ `heygen-video-1`、◐ `kling-3.0`、◐ `kling-4.0`、◐ `kling-4.0-flash`、◐ `ltx-2.5`、○ `luma-ray3.2`、◐ `minimax-h3`、◐ `minimax-h3-max`、○ `p-video-2-pro`、◐ `pika-h3-flex`、◐ `pixverse-v6`、◐ `runway-gen-4.5`、◐ `seedance-2.0`、● `seedance-2.5`、○ `seedance-2.5-flash`、○ `skyreels-v4`、○ `utopai-x`、◐ `veo-3.1`、◐ `vidu-q3`、◐ `vidu-q4-preview`、◐ `wan-3.0` |
| `motion.transfer` | 动作迁移 | ○ `dreamactor-m2.0`、○ `higgsfield-genjutsu`、◐ `kling-motion-control`、◐ `runway-gen-4.5`、◐ `viggle-animate`、◐ `viggle-v4`、◐ `wan-2.2-animate`、◐ `wan-animate-2` |
| `avatar.audio_driven` | 音频驱动数字人 | ○ `creatify-aurora`、○ `hedra-omnia`、◐ `heygen-avatar-v`、◐ `kling-avatar-v2`、◐ `longcat-video-avatar-1.5`、◐ `ltx-2.3-lipsync`、◐ `ltx-2.5`、◐ `mirage-avatar-x`、◐ `omnihuman-2.0`、◐ `sync-3`、◐ `synthesia-express-3`、○ `veed-fabric-1.0` |
| `lipsync.redub` | 口型重配 | ◐ `heygen-avatar-v`、◐ `sync-3`、◐ `sync-react-1` |
| `threed.image_to_3d` | 图生 3D | ◐ `hunyuan-3d`、◐ `rodin-gen-2.5`、◐ `tripo-p1` |
| `audio.tts` | 语音合成 | ◐ `cosyvoice-3`、○ `doubao-tts`、● `elevenlabs-v3`、◐ `heygen-avatar-v`、● `indextts-2`、● `minimax-speech-2.8`、◐ `mirage-avatar-x`、◐ `qwen3-tts`、◐ `sync-3`、◐ `synthesia-express-3` |
| `audio.voice_clone` | 音色克隆 | ◐ `cosyvoice-3`、○ `doubao-tts`、● `elevenlabs-v3`、◐ `heygen-avatar-v`、● `indextts-2`、● `minimax-speech-2.8`、◐ `mirage-avatar-x`、◐ `qwen3-tts` |
| `audio.tts_duration_control` | 时长可控配音 | ● `indextts-2` |
| `audio.music_gen` | 音乐生成 | ◐ `lyria-3-pro`、◐ `minimax-music-2.5`、◐ `suno-v5.5` |
| `audio.sfx_gen` | 文生音效 | ◐ `elevenlabs-sfx` |
| `audio.v2a_foley` | 视频生音效（Foley） | ● `hunyuanvideo-foley`、● `mmaudio` |
| `render.code_graphics` | 代码渲染动效 | ◐ `html-gsap-playwright`、● `motion-canvas`、● `remotion` |
| `render.web_capture` | 网页/界面录制 | ◐ `html-gsap-playwright` |
| `render.3d_scene` | 3D 场景渲染 | ● `blender` |
| `render.compose` | 合成与编码 | ● `ffmpeg`、● `remotion` |
| `post.upscale` | 视频超分 | ◐ `flashvsr`、◐ `real-esrgan`、◐ `seedvr2`、◐ `topaz-video` |
| `post.frame_interp` | 补帧 | ● `rife`、◐ `topaz-video` |

## 模型一览

| 模型 | 厂商 | 类别 | 状态 | 时长上限(s) | 原生音频 | 商用 | 验证依据 |
|---|---|---|---|---|---|---|---|
| Demucs（htdemucs） | Meta（开源） | analysis | ga |  |  | 是 | knowledge 2026-10-29 |
| Doubao Seed 2.0 Pro（豆包） | ByteDance | analysis | ga |  |  | 是 | third-party 2026-10-29 |
| FunASR / SenseVoice | Alibaba（开源） | analysis | ga |  |  | 有条件 | knowledge 2026-10-29 |
| Gemini 3.1 Pro | Google | analysis | ga | 10800 |  | 是 | third-party 2026-10-29 |
| Gemini 3.5 Flash | Google | analysis | ga | 10800 |  | 是 | third-party 2026-10-29 |
| librosa / madmom | 开源 | analysis | ga |  |  | 是 | knowledge 2026-10-29 |
| MatAnyone 2 | 学术开源 | analysis | ga |  |  | 有条件 | third-party 2026-10-29 |
| MegaSaM | 学术开源（CVPR 2025） | analysis | ga |  |  | 有条件 | vendor 2026-10-29 |
| PaddleOCR | Baidu（开源） | analysis | ga |  |  | 是 | knowledge 2026-10-29 |
| Twelve Labs Pegasus 1.5 | Twelve Labs | analysis | ga | 7200 |  | 是 | third-party 2026-10-29 |
| PySceneDetect | 开源 | analysis | ga |  |  | 是 | knowledge 2026-10-29 |
| Qwen3.5 397B-A17B（开源） | Alibaba | analysis | ga |  |  | 有条件 | third-party 2026-10-29 |
| RobustVideoMatting（RVM） | 开源 | analysis | ga |  |  | 有条件 | knowledge 2026-10-29 |
| SAM 系列（SAM 2 / SAM 3） | Meta（开源） | analysis | ga |  |  | 有条件 | knowledge 2026-10-29 |
| TransNetV2 | 开源 | analysis | ga |  |  | 是 | knowledge 2026-10-29 |
| 火山引擎人像视频抠像 | ByteDance | analysis | ga |  |  | 是 | third-party 2026-10-29 |
| WhisperX | 开源 | analysis | ga |  |  | 是 | knowledge 2026-10-29 |
| CosyVoice 3（开源）/ 百炼 CosyVoice v3.5 | Alibaba | audio | ga |  |  | 有条件 | third-party 2026-10-29 |
| 豆包语音合成 / 声音复刻（火山引擎） | ByteDance | audio | ga |  |  | 是 | third-party 2026-10-29 |
| ElevenLabs Sound Effects | ElevenLabs | audio | ga | 30 |  | 是 | third-party 2026-10-29 |
| ElevenLabs Eleven v3 | ElevenLabs | audio | ga |  |  | 是 | third-party 2026-10-29 |
| HunyuanVideo-Foley | Tencent | audio | ga |  |  | 有条件 | third-party 2026-10-29 |
| IndexTTS2 / IndexTTS 2.5（开源，B 站） | Bilibili | audio | ga |  |  | 有条件 | vendor 2026-10-29 |
| Lyria 3 Pro | Google | audio | ga | 180 |  | 是 | third-party 2026-10-29 |
| MiniMax Music 2.5 | MiniMax | audio | ga | 240 |  | 是 | third-party 2026-10-29 |
| MiniMax Speech 2.8（Turbo / HD） | MiniMax | audio | ga |  |  | 是 | user 2026-10-29 |
| MMAudio | 学术开源 | audio | ga | 8 |  | 否 | third-party 2026-10-29 |
| Qwen3-TTS（开源 1.7B / 0.6B） | Alibaba | audio | ga |  |  | 是 | third-party 2026-10-29 |
| Suno v5.5 | Suno | audio | ga |  |  | 有条件 | third-party 2026-10-29 |
| Creatify Aurora | Creatify | character | ga |  |  | 有条件 | third-party 2026-11-12 |
| DreamActor M2.0 | ByteDance | character | ga |  |  | 是 | vendor 2026-11-12 |
| FASHN Try-On Max | FASHN | character | ga |  |  | 是 | vendor 2026-11-12 |
| FASHN Virtual Try-On v1.6 | FASHN | character | ga |  |  | 是 | third-party 2026-10-29 |
| Hedra Omnia（Alpha） | Hedra | character | preview | 8 |  | 有条件 | vendor 2026-11-12 |
| HeyGen Avatar V | HeyGen | character | ga |  |  | 是 | vendor 2026-11-12 |
| Kling Avatar v2 | Kuaishou | character | ga |  |  | 是 | third-party 2026-10-29 |
| Kling Kolors Virtual Try-On v1.5 | Kuaishou | character | ga |  |  | 是 | third-party 2026-10-29 |
| Kling Motion Control（2.6 / 3.0） | Kuaishou | character | ga |  |  | 是 | third-party 2026-10-29 |
| Kling Virtual Try-On 3.0 | Kuaishou | character | ga |  |  | 是 | vendor 2026-11-12 |
| LongCat-Video-Avatar-1.5 | Meituan LongCat（美团） | character | ga |  |  | 是 | vendor 2026-11-12 |
| LTX 2.3 Lipsync | Lightricks | character | ga |  |  | 有条件 | third-party 2026-10-29 |
| Mirage Avatar X（原 Captions） | Mirage | character | ga |  |  | 有条件 | vendor 2026-11-12 |
| OmniHuman 2.0 | ByteDance | character | ga |  |  | 是 | vendor 2026-11-12 |
| Sync 3（Sync Labs） | Sync Labs | character | ga |  |  | 是 | vendor 2026-11-12 |
| sync react-1 | Sync Labs | character | ga |  |  | 是 | vendor 2026-11-12 |
| Synthesia Express-3 | Synthesia | character | ga |  |  | 是 | vendor 2026-11-12 |
| VEED Fabric 1.0（含 Fast） | VEED | character | ga |  |  | 有条件 | third-party 2026-11-12 |
| Viggle-Animate | Viggle | character | ga |  |  | 有条件 | vendor 2026-11-12 |
| Viggle V4 | Viggle | character | ga |  |  | 有条件 | vendor 2026-11-12 |
| Wan 2.2 Animate（含 animate-mix 换人） | Alibaba | character | ga |  |  | 是 | third-party 2026-10-29 |
| Wan-Animate-2 | Alibaba | character | ga |  |  | 是 | vendor 2026-11-12 |
| FLUX 3 Image | Black Forest Labs | image | ga |  |  | 是 | vendor 2026-11-12 |
| FLUX 3 Image Klein | Black Forest Labs | image | ga |  |  | 有条件 | vendor 2026-11-12 |
| GPT Image 2.5 | OpenAI | image | ga |  |  | 是 | user 2026-10-29 |
| GPT Image 2.6（Sunburst / Flare） | OpenAI | image | ga |  |  | 是 | vendor 2026-11-12 |
| Grok Imagine Image 2.0 | xAI | image | ga |  |  | 是 | vendor 2026-11-12 |
| Ideogram 4.5 | Ideogram | image | ga |  |  | 有条件 | third-party 2026-11-12 |
| Kling Image 3.0 / 3.0 Omni（O3 Image） | Kuaishou | image | ga |  |  | 是 | vendor 2026-11-12 |
| MAI-Image-2.6（含 Flash） | Microsoft AI | image | ga |  |  | 是 | vendor 2026-11-12 |
| Midjourney V8.2 | Midjourney | image | ga |  |  | 有条件 | third-party 2026-11-12 |
| MiniMax H3 Image（含 Highspeed） | MiniMax | image | ga |  |  | 有条件 | vendor 2026-11-12 |
| Nano Banana 2 Lite（Gemini 3.1 Flash Lite Image） | Google | image | ga |  |  | 是 | vendor 2026-11-12 |
| Nano Banana 2.1 | Google | image | ga |  |  | 是 | vendor 2026-11-12 |
| Qwen Image 2.1（开源 7B，含 Pro / Turbo API） | Alibaba | image | ga |  |  | 有条件 | vendor 2026-11-12 |
| Qwen Image 3.0 | Alibaba | image | ga |  |  | 是 | vendor 2026-11-12 |
| Qwen Image 3.0 Pro | Alibaba | image | ga |  |  | 是 | third-party 2026-10-29 |
| Seedream 5.0（Lite / Pro / Flash） | ByteDance Seed | image | ga |  |  | 是 | vendor 2026-11-12 |
| Seedream 5.5 | ByteDance Seed | image | ga |  |  | 是 | vendor 2026-11-12 |
| FlashVSR | 学术开源 | post | ga |  |  | 有条件 | third-party 2026-10-29 |
| Real-ESRGAN | 开源 | post | ga |  |  | 是 | third-party 2026-10-29 |
| RIFE | 开源 | post | ga |  |  | 是 | knowledge 2026-10-29 |
| SeedVR2 | ByteDance Seed（开源） | post | ga |  |  | 有条件 | third-party 2026-10-29 |
| Topaz Video（含 Starlight 系列） | Topaz Labs | post | ga |  |  | 是 | third-party 2026-10-29 |
| Blender | 开源 | render | ga |  |  | 是 | knowledge 2026-10-29 |
| FFmpeg | 开源 | render | ga |  |  | 是 | knowledge 2026-10-29 |
| HTML + GSAP + Playwright 录制 | 开源组合 | render | ga |  |  | 是 | knowledge 2026-10-29 |
| Motion Canvas | 开源 | render | ga |  |  | 是 | knowledge 2026-10-29 |
| Remotion | Remotion（开源，商用需许可） | render | ga |  |  | 有条件 | knowledge 2026-10-29 |
| Hunyuan 3D（3.x） | Tencent | threed | ga |  |  | 是 | third-party 2026-10-29 |
| Rodin Gen-2.5 | Hyper3D / Deemos | threed | ga |  |  | 是 | third-party 2026-10-29 |
| Tripo P1 | Tripo | threed | ga |  |  | 是 | third-party 2026-10-29 |
| FLUX 3 Video | Black Forest Labs | video | ga | 20 | 是 | 有条件 | vendor 2026-11-12 |
| FLUX 3 Max（视频） | Black Forest Labs | video | ga | 20 | 是 | 有条件 | vendor 2026-11-12 |
| Gemini Omni Flash | Google | video | ga | 15 | 是 | 是 | vendor 2026-11-12 |
| Grok Imagine Video 1.5 | xAI | video | ga | 15 | 是 | 有条件 | vendor 2026-11-12 |
| Grok Imagine Video 1.5 Lite | xAI | video | ga | 15 | 是 | 有条件 | vendor 2026-11-12 |
| Hailuo 2.3 / 2.3 Fast（海螺） | MiniMax | video | ga | 10 | 是 | 是 | third-party 2026-10-29 |
| HappyHorse 1.0 | Alibaba | video | ga |  |  | 有条件 | third-party 2026-11-12 |
| HeyGen Video 1 | HeyGen | video | ga | 30 | 是 | 有条件 | vendor 2026-11-12 |
| Higgsfield Genjutsu（含 Lite） | Higgsfield | video | ga |  |  | 有条件 | vendor 2026-11-12 |
| HunyuanVideo 1.5（开源） | Tencent | video | ga |  |  | 有条件 | third-party 2026-10-29 |
| Kling 3.0（含 Turbo） | Kuaishou | video | ga | 15 | 是 | 是 | third-party 2026-10-29 |
| Kling 4.0（可灵 4.0） | Kuaishou | video | ga | 30 | 是 | 是 | vendor 2026-11-12 |
| Kling 4.0 Flash（可灵 4.0 Flash） | Kuaishou | video | ga | 20 | 是 | 是 | vendor 2026-11-12 |
| Kling O3（Omni） | Kuaishou | video | ga | 15 | 否 | 是 | third-party 2026-10-29 |
| LTX-2.5（开源） | Lightricks | video | ga |  | 是 | 有条件 | third-party 2026-11-12 |
| Luma Ray3.2 / Modify | Luma AI | video | ga | 10 | 是 | 是 | vendor 2026-11-12 |
| MiniMax H3 / H3 Max | MiniMax | video | ga | 15 | 是 | 有条件 | third-party 2026-10-29 |
| MiniMax H3 Max | MiniMax | video | ga | 15 | 是 | 有条件 | vendor 2026-11-12 |
| P-Video-2-Pro | Pruna AI | video | ga | 15 | 是 | 有条件 | third-party 2026-11-12 |
| Pika H3 Flex | Pika | video | ga | 15 | 是 | 有条件 | vendor 2026-11-12 |
| PixVerse V6 | PixVerse（爱诗科技） | video | ga | 15 | 是 | 是 | third-party 2026-10-29 |
| Runway Aleph 2 | Runway | video | ga |  |  | 是 | vendor 2026-11-12 |
| Runway Gen-4.5（含 Act-Two） | Runway | video | ga | 10 | 是 | 是 | third-party 2026-10-29 |
| Seedance 2.0（含 Mini / Fast） | ByteDance Seed | video | ga | 15 | 是 | 是 | third-party 2026-11-11 |
| Seedance 2.5 | ByteDance Seed | video | ga | 30 | 是 | 是 | vendor 2026-11-11 |
| Seedance 2.5 Flash | ByteDance Seed | video | preview |  | 是 | 有条件 | third-party 2026-11-12 |
| SkyReels V4 | Kunlun Skywork（昆仑万维） | video | ga |  |  | 有条件 | third-party 2026-11-12 |
| Sora 2 / Sora 2 Pro | OpenAI | video | shutdown | 20 |  | 否 | third-party 2026-10-29 |
| Utopai X | Utopai Studios | video | ga |  |  | 有条件 | vendor 2026-11-12 |
| Veo 3.1（含 Lite） | Google | video | ga | 8 | 是 | 是 | third-party 2026-10-29 |
| Vidu Q3 | Shengshu（生数科技） | video | ga | 16 | 是 | 是 | vendor 2026-10-29 |
| Vidu Q4 Preview | Shengshu（生数科技） | video | preview | 16 | 是 | 有条件 | vendor 2026-11-12 |
| Wan 2.2（开源，含 TI2V-5B） | Alibaba | video | ga |  | 否 | 是 | third-party 2026-10-29 |
| Wan 2.7 视频编辑 | Alibaba | video | ga |  |  | 是 | third-party 2026-10-29 |
| Wan 3.0（万相） | Alibaba | video | ga | 30 | 是 | 是 | vendor 2026-11-12 |
