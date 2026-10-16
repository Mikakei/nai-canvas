# NovelAI 生图工具：功能清单与技术参考

调研日期：2026-10-14

资料来源：

- 官方文档 https://docs.novelai.net/en/image/ （图像部分 26 个页面）
- 图像 API 规范 https://image.novelai.net/docs/index.html （Swagger 原文：`/docs/doc.json`）
- 官网生图页 https://novelai.net/image 当前前端代码（用来核对文档没写的细节：默认参数、计费公式、预设字符串等）

标 ⚠ 的条目只出现在前端代码里、文档没写，或者文档和代码说法不一致。实现时以 API 实际返回为准。

本工具的界面是无限画布加功能节点，不照搬官网的面板布局。下面的功能会按 [PLAN.md](PLAN.md) 第二节拆分到各个节点和侧栏里。

---

## 一、功能清单

### 1. 账户与额度

- [ ] 用 Persistent API Token（`pst-…`）登录并保存在本地
- [ ] （可选）邮箱加密码登录：用 Argon2 算出 access key，调 `/user/login` 换 JWT。官方不建议明文保存账号密码，优先用 Token
- [ ] 显示订阅等级、Anlas 余额（`fixedTrainingStepsLeft + purchasedTrainingSteps`）、试用剩余张数
- [ ] Opus 用户的 V5 免费额度条（`subscription.usage`）：剩余百分比、额外购买的百分比、恢复倒计时、用完提示，并提供"始终显示额度条"开关
- [ ] 生成按钮实时显示本次消耗（Anlas 或"Opus 免费"）。单张超过 140 Anlas 时提示设置过大（附录 H）
- [ ] 错误处理：401、402（Anlas 不足）、429、500（附带 correlation id）

### 2. 模型与模式

- [ ] 模型下拉框共 8 个：V5 Full、V5 Curated、V4.5 Full、V4.5 Curated、V4 Full、V4 Curated、Anime V3、Furry V3。每个附说明文字，旧模型标"不再推荐"
- [ ] 按能力矩阵显示界面，当前模型不支持的功能隐藏或禁用（附录 B）
- [ ] V5 Full 的 Effort 开关，可选 High 或 Medium。Medium 对应 `nai-diffusion-5-full-medium`：
  - 固定 14 步、采样器固定 Euler Ancestral
  - UC 预设固定为 Heavy，不能写自定义 UC
  - 不能调 Guidance Rescale
  - 默认设置下比 High 少花约 42%
- [ ] Anime / Furry 模式切换（V4 及以上）：提示词开头加 `fur dataset`，标签补全改用 Furry 数据集
- [ ] 切换模型时：
  - 改用新模型的默认参数（附录 C）
  - UC 预设按类别映射到新模型的同类预设
  - 提示"提示词在不同版本之间不一定通用"
- [ ] 在 V5 上添加 Vibe Transfer 或 Precise Reference 时，自动切换到对应的 V4.5 模型（Full 切到 V4.5 Full，Curated 切到 V4.5 Curated）
- [ ] 局部重绘时自动换成对应的 inpainting 模型（附录 B）

### 3. 提示词编辑器

- [ ] 提示词和负面提示词（Undesired Content，下称 UC）做成同一个输入框的两个标签页。UC 可以"分离"出来，变成上下两个框
- [ ] Token 计数和上限进度条：
  - V5 Full 上限 1471，V5 Curated 上限 703，用 Qwen 分词
  - V4 和 V4.5 上限 512，用 T5 分词，主提示词和所有角色提示词共用这个额度
  - V3 及更早上限 225，用 CLIP 分词
- [ ] 标签自动补全（`suggest-tags`，支持 en 和 jp）：用圆点透明度表示模型对该标签的熟悉度（confidence），同时显示帖子数。可以关闭
- [ ] 强调语法高亮：
  - `{}` 每层乘以 1.05，`[]` 每层除以 1.05
  - `1.5::tag::` 数值权重（V4 及以上）
  - 负权重 `-1::hat::`（V4.5 及以上）
  - 高亮颜色可以自定义
- [ ] 强调语法错误提示，共 3 种：数字和 `::` 之间有空格；数字写在 `::` 后面；权重数值异常大
- [ ] 用 Shift+Enter 换行
- [ ] 文字渲染：把 `Text:` 写在主提示词末尾
  - V4 和 V4.5 只支持英文，最多 118 字符
  - V5 Curated 最多 374 字符，V5 Full 最多 750 字符，支持中文、日文、英文
- [ ] ⚠ V5 自动文字：提示词里用引号（`""` `“”` `「」` `''`）括起来的内容，会自动追加成 `Text:`。多角色时按角色位置排序，CJK 文字按从右到左的顺序
- [ ] 质量标签开关：V5 可选 Standard、Light 或关闭，其他模型只有开和关。追加的内容不显示在输入框里，但计入 token
- [ ] UC 预设：每个模型不同，有 Heavy、Light、Human Focus、Furry Focus、None 等。可以和自定义 UC 叠加使用（附录 G）
- [ ] Transparent BG 开关（V5）：在提示词里加 `transparent background`，并发送 `tag_hint_transparent_background`
- [ ] 随机提示词（骰子按钮）：
  - 可以直接生成、删除（恢复原来的提示词）或重抽
  - 离开页面后再回来仍可恢复原提示词
  - 官方用的是前端内置的标签库，我们需要自建一份
- [ ] 提示词随机器语法 `1girl, ||red hair|blue hair||`：每张图各自随机，实际用到的提示词写进元数据
- [ ] 提示词混合 `a|b :0.3`：只有 V3 及更早的模型支持，最多 6 段
- [ ] Prompt Guidance 过高或过低时显示警告
- [ ] 一键重置全部设置

### 4. Prompt Chunks（提示词片段）

- [ ] 新建、编辑、删除片段，每个片段有名称、颜色和内容。内容里可以包含随机器语法
- [ ] 分类文件夹；拖拽排序、拖进分类；一键删除全部
- [ ] 插入片段的三种方式：
  - 拖进提示词框
  - 在提示词框输入 `@` 弹出列表，继续输入可筛选
  - 点击片段，插入到当前有焦点的输入框
- [ ] 单击片段查看内容，双击把它展开成普通文本
- [ ] 嵌套写法 `!macro:片段名!`，片段名区分大小写
- [ ] 云端同步（`/user/objects/promptmacros`），多设备共用
- [ ] ⚠ 官方提供的 Official 片段分组
- [ ] 导入图片时，如果提示词里某段文字和某个已保存片段的内容完全相同，就自动换回该片段

### 5. 多角色提示词（V4 及以上）

- [ ] 一个主提示词，外加多张角色卡片。每张卡片：
  - 新建时可选女、男或其他
  - 有独立的提示词和 UC
  - 可以启用或禁用、上下移动、删除
- [ ] 角色数量上限：V4 和 V4.5 为 6 个；V5 官方宣传 22 个（⚠ 前端代码里的上限是 32）
- [ ] 角色位置：
  - 可选 AI's Choice 或自定义
  - V4 和 V4.5 只能放在 5×5 网格上，V5 可以自由摆放
  - 位置编辑画布带参考线：无、三分线、黄金比例、自定义行列
  - 角色重叠时显示警告
- [ ] 也可以在主提示词里用 `|` 分隔各角色。只要存在角色卡片，这种写法就失效
- [ ] 动作标签前缀 `source#`、`target#`、`mutual#`
- [ ] 随机角色（Random Character），以及"清除随机角色"
- [ ] V4 专用的 Legacy Prompt Conditioning Mode（LPC，对应 `legacy_uc`）
- [ ] 从图片导入时可以导入或追加角色；超过上限时截断并提示

### 6. 生成参数

- [ ] 分辨率：
  - 预设分 Normal、Large、Wallpaper、Small 四档，每档有竖图、横图、方图（附录 D）
  - 可自定义宽高（64 的倍数），一键交换宽高
  - 总像素上限 3,145,728
- [ ] 每次张数按尺寸限制：
  - 不超过约 1MP 时最多 4 张
  - 不超过 409,600 像素时 6 张
  - 不超过 360,448 像素时 8 张
- [ ] Steps（1–50）、Prompt Guidance、Guidance Rescale
- [ ] Seed：可随机或固定；点击图片上的 seed 即可复制过来
- [ ] 采样器：按模型分"推荐"和"其他"两组（附录 E）
- [ ] 噪声计划：按采样器和模型过滤可选项。V5 没有这一项
- [ ] V3 专属设置：
  - SMEA、SMEA DYN、Auto SMEA
  - Decrisper
  - Undesired Content Strength（不等于 100% 时会加价）
- [ ] Variety+（`skip_cfg_above_sigma`）：V3、V4、V4.5 有，V5 没有
- [ ] AI 设置面板可以折叠。折叠后仍能修改 Steps 和 Guidance
- [ ] 锁定设置（Locked Settings）：约 25 项可勾选。勾选的项在点击历史图或导入图片时不会被覆盖

### 7. 图生图、变体与增强

- [ ] 底图来源：上传、拖拽、粘贴、在历史里选"Use as Base Image"，或新建空白画布（Paint New Image）
- [ ] Strength 和 Noise 参数
- [ ] 调整底图尺寸：Resize、裁到最近的合法尺寸、Shift Edges
- [ ] Variations：对选中的图生成变体
- [ ] Enhance：
  - Magnitude 1–5，每档对应一组 Strength 和 Noise（附录 C）；也可以展开分别调整
  - Upscale Amount 可选 1× 或 1.5×，V5 额外有 Max
  - 会使用当前的提示词
- [ ] 结果和原图对比（Compare with Original）

### 8. 局部重绘（Inpaint）

- [ ] 遮罩的画笔和橡皮、笔刷大小、清空、编辑或移除遮罩
- [ ] 遮罩显示设置：
  - 颜色、不透明度、边框
  - 图案：实心、线条、圆点、交叉线、网格、棋盘、爱心
- [ ] Overlay Original Image 开关：开启时遮罩外不会变化，但可能出现接缝；关闭时没有接缝，但遮罩外可能有轻微变化
- [ ] Inpaint Strength（V4 及以上）
- [ ] Focused Inpainting：
  - 框选一块区域，放大到约 1MP 后再重绘
  - Minimum Context Area 滑块
  - Opus 用户对大图使用也免费
- [ ] 扩图：画布扩边后，新增的区域自动加入遮罩
- [ ] 可与 Precise Reference 配合使用（V4.5）。Vibe Transfer 不支持局部重绘

### 9. 画布编辑器（Canvas）

- [ ] 绘图工具：
  - 画笔（圆头、柔边圆头、方头，支持压感）、橡皮
  - 填充（可调容差）
  - 矩形选区、套索（选区可移动、缩放、旋转）
  - 取色器、调色板
  - 模糊（可调大小和强度）
  - 仿制图章（Alt+点击设置取样点）
  - HSV 调整
- [ ] 图层：新建、上下移动
- [ ] 3D 模型图层：
  - 导入 .glb、.gltf、.pmd、.pmx、.vrm；带外部贴图的模型打包成 .zip 导入
  - 整体变换、骨骼姿势、表情（morph targets）
  - 渲染设置：透视或正交、FOV、环境光和直射光、光照方向、阴影、渲染质量、显示骨骼、物理
- [ ] 画布尺寸：直接填宽高、Shift Edges、拖动边缘、裁到合法尺寸
- [ ] 撤销和重做；滚轮缩放；中键拖动平移
- [ ] 快捷键：
  - 工具：b 画笔、e 橡皮、g 填充、s 选区、l 套索、c 取色、r 模糊、j 仿制
  - 笔刷：`[` 和 `]` 调大小；Ctrl+左键快速取色
  - 缩放选区：按住 Shift 等比缩放，按住 Alt 从中心缩放
  - 3D：t 变换、p 姿势，WASDQE 移动相机
- [ ] 下载画布文件；Save & Close；Cancel

### 10. Vibe Transfer（V3、V4、V4.5 支持；V5 不支持）

- [ ] 最多 16 张参考图。每张都有 Reference Strength、Information Extracted 两个参数和启用开关
- [ ] Normalize Reference Strength Values 开关（V4 及以上）
- [ ] V4 及以上的模型要先编码（`/ai/encode-vibe`），每次编码 2 Anlas：
  - 编码结果按"图片 × 模型 × Information Extracted 取值"缓存在本地（IndexedDB）
  - 生成前提示"本次将额外花费 X"
- [ ] 启用超过 4 张时，第 5 张起每张加 2 Anlas
- [ ] 导出：
  - `.naiv4vibe` 文件，包含原图、缩略图和所有编码过的 Information Extracted 取值
  - 打包导出成 `.naiv4vibebundle`
  - "只导出编码"选项
  - 嵌入到一张图片里
- [ ] 导入：
  - 可拖入 vibe 文件、bundle 文件或带 vibe 的 PNG
  - 选择替换或追加
  - 重复的参考图会被检测出来
  - 模型不匹配时提示
- [ ] 下载 PNG 时把 vibe 编码写进元数据

### 11. Precise Reference（仅 V4.5）

- [ ] 参考类型：Character、Style、Character & Style。⚠ 界面里还有 Costume、Delta 两种类型和一个 Style Aware 开关，文档没写
- [ ] Strength 和 Fidelity 两个滑块；点数字可以输入负数
- [ ] 参考图自动缩放并补黑边，统一成 1024×1536、1536×1024 或 1472×1472
- [ ] 每个参考在每张图上加 5 Anlas；最多 16 个；不能和 Vibe Transfer 同时使用
- [ ] 把全部参考图打包下载成 ZIP

### 12. Director Tools（`/ai/augment-image`）

- [ ] Remove BG：结果可在 Masked、Generated、Blend 三种之间切换
- [ ] Declutter，以及保留文字气泡的版本
- [ ] Line Art、Sketch
- [ ] Colorize：可选填提示词，并调 Defry（0–5）
- [ ] Emotion：24 种表情、6 档强度（Normal 到 Weakest），可选填提示词，只适用于动漫风
- [ ] Upscale
- [ ] ⚠ Pixel Snap，在本地处理，不调用 API：
  - 减色：关闭、自动或自定义色数
  - Avoid Over-Refining
  - 处理后放大回原尺寸
- [ ] 输入图最大 1536×2048，超出会自动缩放
- [ ] 显示本次消耗；结果可以送到其他工具继续处理，也可以送回生图页
- [ ] 独立的 Director Tools 页面

### 13. 放大（Upscale）

- [ ] 调用 `/ai/upscale`，按像素数收 1–4 Anlas
- [ ] ⚠ 文档写的是放大 4 倍，但当前前端常量是 2 倍、模型为 V5 Curated

### 14. 流式生成

- [ ] 调用 `/ai/generate-image-stream`（SSE 或 msgpack），显示中间步骤的预览
- [ ] 设置项：
  - 流式生成开关
  - "显示未处理的中间图"（默认会隐藏前几步，并对中间图做模糊）
- [ ] 连续失败 3 次后自动改回普通请求

### 15. 结果查看与历史

- [ ] 结果视图：
  - 可缩放、平移，按批次展示
  - 设置项：简洁视图、减少动画、锁定视角
- [ ] 单张图的操作：下载、复制到剪贴板、复制 seed、设为底图、变体、增强、放大、局部重绘、编辑、送到 Director Tools、钉住、删除
- [ ] 历史栏缩略图上的角标：批次张数、是否图生图或重绘、是否放大或增强过
- [ ] 历史图的点击操作：
  - 单击：查看
  - Ctrl+单击：复制设置（不含底图）
  - Shift+单击：复制 seed
  - Ctrl+Shift+单击：设置和 seed 一起复制
- [ ] 多选后删除所选，或把所选下载成 ZIP
- [ ] 清空历史；全部下载成 ZIP（图多时分成多个包）；滚动锁定；回到顶部
- [ ] 历史持久化：
  - 打开页面时询问"是否加载上次会话"（数据存在浏览器里）
  - 有未下载的图时，离开页面前提醒
- [ ] Pin 图板：
  - 可建多块图板，支持便签、箭头连线、调整大小；图板满了会提示
  - 钉住的图可以快速对比，也能直接复制 seed
- [ ] 自动下载
- [ ] 文件名模板（附录 J）
- [ ] 输出格式：
  - PNG 或无损 WebP
  - 透明图的 Alpha 模式：Straight 或 Premultiplied
  - 透明背景的预览底色：跟随主题的棋盘格、亮色棋盘格、暗色棋盘格、黑、白、灰、红、绿、蓝、自定义

### 16. 元数据与导入

- [ ] 读取 NovelAI 元数据，来源有三处：
  - PNG 文本块：Title、Description、Software、Source、Generation time、Comment
  - Alpha 通道里的隐写元数据
  - WebP 的 EXIF
- [ ] 下载时保留或写入元数据，包括 vibe 编码和随机器实际选中的提示词
- [ ] 导入对话框：可以把图片用作图生图底图、Vibe Transfer 参考、Precise Reference 参考，或者导入它的元数据
- [ ] 元数据可分项导入：
  - 提示词、UC、设置、Seed
  - 角色（可追加）、Vibe（可追加）
  - Actual Prompt（随机器实际选中的提示词）
  - Clean Imports（去掉 `{}` `[]`，逗号后补空格）
- [ ] 一次导入多张图
- [ ] 以下情况提示"无法从元数据复现"：
  - 用了图生图或局部重绘
  - 用了 Vibe Transfer，但元数据里没有编码
  - 用了 Precise Reference
- [ ] 已废弃模型的图不能导入设置
- [ ] 旧版提示词兼容标记（`legacy_v3_extend`）

### 17. 网格生成（X/Y 参数对比）

- [ ] X 轴和 Y 轴各自选择要变化的参数，可选：steps、scale、cfg_rescale、uncond_scale、seed、width、height、sampler、noise_schedule、model、prompt、uc、sm、sm_dyn
- [ ] 取值写法：
  - 数字：`1,2,5-9` 或 `0.5-2:0.25`
  - seed：`123,456`，或 `r3`（每次生成 3 个新的随机 seed）
  - 文本：每行一个
- [ ] 显示总张数和上限；可以在生成中途停止

### 18. 设置与其他

- [ ] 生图设置：
  - 流式生成、显示未处理的中间图、自动下载
  - 文件名模板、输出格式、Alpha 模式
  - 隐藏快速入门画廊、页面布局、简洁视图、减少动画、锁定视角、彩纸动画
  - 强调高亮及颜色、关闭标签补全、始终显示额度条
- [ ] 快速入门画廊（点击图片即复制提示词和设置）。可以改成我们自己的预设库
- [ ] 移动端布局：底部抽屉，分 Prompt、Reference Images、Chunks 三个标签
- [ ] 中文界面

### 建议不做或暂缓

- Explore 社区画廊（浏览 New/Hot/Top、上传作品）：它走的是 explore.novelai.net 的接口，公开 API 文档里没有
- 自定义模型 URL、Passthrough Testing：都是内部调试功能
- 已下架的模型（Anime V1/V2、Furry Beta），以及只在这些模型上能用的 ControlNet 工具（Palette Swap、Form Lock、Scribbler、Building Control、Landscaper）
- 新手教程、活动和竞赛、订阅和付款管理

---

## 二、技术参考（附录）

### A. API

- 基础地址：`https://image.novelai.net`
- 已验证 CORS 返回 `Access-Control-Allow-Origin: *`，允许 `Authorization` 和 `Content-Type` 请求头，所以浏览器可以直接调用
- 认证方式：`Authorization: Bearer pst-xxxx`

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/ai/generate-image` | 生成图片。`action` 取 `generate`、`img2img` 或 `infill`。默认返回 zip；请求头带 `Accept: application/json` 时返回 base64 数组 |
| POST | `/ai/generate-image-stream` | 流式生成。`parameters.stream` 取 `"sse"` 或 `"msgpack"`，事件有 intermediate、final、error 三种 |
| POST | `/ai/encode-vibe` | vibe 编码。参数：`image`、`model`、`information_extracted`、`mask`、`crop_to_mask` |
| POST | `/ai/augment-image` | Director Tools。参数：`req_type`、`image`、`width`、`height`、`prompt`、`defry`；返回 zip |
| POST | `/ai/upscale` | 放大。参数：`image`、`model`、`declared_blur_sigma` |
| GET | `/ai/generate-image/suggest-tags?model=&prompt=&lang=en\|jp` | 标签补全，返回 `{tags:[{tag,count,confidence}]}` |
| GET | `/user/subscription` | 订阅等级、Anlas 余额、usage（Opus 额度） |
| GET | `/user/data` | 用户信息汇总 |
| GET / PUT / PATCH / DELETE | `/user/objects/promptmacros[/{id}]` | Prompt Chunks 的云端存储 |
| GET / PUT | `/user/clientsettings` | 客户端设置 |

`parameters` 的主要字段：

`width` `height` `scale` `sampler` `steps` `seed` `n_samples` `params_version`(4) `qualityToggle` `ucPreset` `negative_prompt` `cfg_rescale` `noise_schedule` `skip_cfg_above_sigma` `dynamic_thresholding` `sm` `sm_dyn` `uncond_scale` `legacy` `legacy_v3_extend` `legacy_uc` `prefer_brownian` `deliberate_euler_ancestral_bug` `image` `strength` `noise` `extra_noise_seed` `mask` `add_original_image` `inpaintImg2ImgStrength` `color_correct` `reference_image_multiple` `reference_information_extracted_multiple` `reference_strength_multiple` `normalize_reference_strength_multiple` `director_reference_images` `director_reference_descriptions` `director_reference_strength_values` `director_reference_secondary_strength_values`(Fidelity) `director_reference_information_extracted` `v4_prompt` `v4_negative_prompt` `use_coords` `characterPrompts` `image_format`(png/webp) `straight_alpha` `tag_hint_qt` `tag_hint_uc_preset` `tag_hint_transparent_background` `stream` `upscale` `upscaled_enhance`

`v4_prompt` 的结构：

```json
{
  "caption": {
    "base_caption": "...",
    "char_captions": [
      { "char_caption": "...", "centers": [{ "x": 0.5, "y": 0.5 }] }
    ]
  },
  "use_coords": false,
  "use_order": true
}
```

5×5 网格的坐标取值是 0.1、0.3、0.5、0.7、0.9。

`tag_hint_*` 字段用数字表示预设：none=0、standard=1、heavy=2、light=3、humanFocus=4、furryFocus=5、lowQualityPlusBadAnatomy=6、lowQuality=7、badAnatomy=8。

### B. 模型 ID 与能力矩阵

| 显示名 | 生成用模型 | 局部重绘用模型 |
|---|---|---|
| V5 Full（High） | `nai-diffusion-5-full` | `nai-diffusion-5-full-inpainting` |
| V5 Full（Medium） | `nai-diffusion-5-full-medium` | `nai-diffusion-5-full-medium-inpainting` |
| V5 Curated | `nai-diffusion-5-curated` | ⚠ 前端目前用 `nai-diffusion-4-5-curated-inpainting`（另有 `nai-diffusion-5-curated-inpainting`） |
| V4.5 Full | `nai-diffusion-4-5-full` | `nai-diffusion-4-5-full-inpainting` |
| V4.5 Curated | `nai-diffusion-4-5-curated` | `nai-diffusion-4-5-curated-inpainting` |
| V4 Full | `nai-diffusion-4-full` | `nai-diffusion-4-full-inpainting` |
| V4 Curated | `nai-diffusion-4-curated-preview` | `nai-diffusion-4-curated-inpainting` |
| Anime V3 | `nai-diffusion-3` | `nai-diffusion-3-inpainting` |
| Furry V3 | `nai-diffusion-furry-3` | `nai-diffusion-furry-3-inpainting` |

| 能力 | V5 | V4.5 | V4 | V3 |
|---|---|---|---|---|
| Vibe Transfer | ✗（自动切到 V4.5） | ✓（需编码） | ✓（需编码） | ✓（不需编码） |
| Precise Reference | ✗（自动切到 V4.5） | ✓（可配合重绘） | ✗ | ✗ |
| 多角色 | ✓ 最多 32，可自由定位 | ✓ 最多 6，5×5 网格 | ✓ 最多 6，5×5 网格 | ✗ |
| 数值权重 / 负权重 | ✓ / ✓ | ✓ / ✓ | ✓ / ✗ | ✗ |
| 文字渲染 / 自动文字 | ✓ / ✓ | ✓ / ✗ | ✓ / ✗ | ✗ |
| 透明背景 | ✓ | ✗ | ✗ | ✗ |
| 噪声计划 | ✗ | ✓（不含 native） | ✓（不含 native） | ✓ |
| Variety+ 的 sigma 值 | ✗ | 58 | 19 | 19 |
| Guidance Rescale | ✓（Medium 不可调） | ✓ | ✓ | ✓ |
| SMEA / DYN / Decrisper / UC Strength | ✗ | ✗ | ✗ | ✓ |
| Furry 模式 | ✓ | ✓ | ✓ | 独立的 Furry V3 模型 |
| 流式生成 | ✓ | ✓ | ✓ | ✗ |
| Enhance 的 Max 倍率 | ✓ | ✗ | ✗ | ✗ |
| Opus 额度限制 | ✓（usage 百分比） | 常规免费规则 | 常规免费规则 | 常规免费规则 |
| Token 上限 / 分词器 | Full 1471、Curated 703 / Qwen | 512 / T5 | 512 / T5 | 225 / CLIP |
| 推荐 Guidance | 不限 | 不限 | 2–6 | 2–8 |

### C. 默认参数

| 模型 | scale | steps | sampler | noise_schedule |
|---|---|---|---|---|
| V5 | 7 | 23（Medium 为 14） | k_euler_ancestral | karras |
| V4.5 | 5 | 23 | k_euler_ancestral | karras |
| V4 | 5.5 | 23 | k_euler_ancestral | karras |
| Anime V3 / Furry V3 | 5 / 6.2 | 23 | k_euler_ancestral | karras（V3 默认开启 Auto SMEA） |

所有模型共用的默认值：

- 尺寸 832×1216，n_samples 1，cfg_rescale 0
- strength 0.7，noise 0，inpaintImg2ImgStrength 1
- add_original_image true，normalize_reference_strength_multiple true，params_version 4

Vibe 默认值：strength 0.6，information_extracted 1（V4.5 Full 为 0.7）。

Precise Reference 默认值：类型 `character&style`，strength 1，fidelity 1，information_extracted 1。

Enhance 的 Magnitude 对应关系：

| Magnitude | Strength | Noise |
|---|---|---|
| 1 | 0.2 | 0 |
| 2 | 0.4 | 0 |
| 3 | 0.5 | 0 |
| 4 | 0.6 | 0 |
| 5 | 0.7 | 0.1 |

Enhance 的可选倍率：832×1216 的图只能选 1.5× 或 1×，其他尺寸可选 2×、1.5×、1×（不能超过 3,145,728 像素）。

### D. 分辨率预设（V3 / V4 / V4.5 / V5）

| 档位 | 竖图 | 横图 | 方图 |
|---|---|---|---|
| Normal | 832×1216 | 1216×832 | 1024×1024 |
| Large | 1024×1536 | 1536×1024 | 1472×1472 |
| Wallpaper | 1088×1920 | 1920×1088 | — |
| Small | 512×768 | 768×512 | 640×640 |

另有 Custom，可自定义宽高。

### E. 采样器与噪声计划

采样器的 API 值：`k_euler_ancestral` `k_euler` `k_dpmpp_2m` `k_dpmpp_2s_ancestral` `k_dpmpp_2m_sde` `k_dpmpp_sde` `k_dpm_2` `k_dpm_fast` `ddim_v3`（V3 用）等。

各采样器可用的噪声计划：

| 采样器 | 可选的噪声计划 |
|---|---|
| euler、euler_ancestral、dpmpp_2s_ancestral、dpmpp_2m、dpmpp_2m_sde、dpmpp_sde | native、karras、exponential、polyexponential |
| dpm_2 | exponential、polyexponential |

默认噪声计划：

- karras：euler、euler_ancestral、dpmpp_sde、dpmpp_2s_ancestral、dpmpp_2m_sde
- exponential：dpm_2、dpmpp_2m

### F. 质量标签（追加到主提示词末尾）

下表是前端代码里的当前值。V4.5 和 V4 Curated 这几行与文档写法不同，实现时以代码为准。

| 模型 | 追加内容 |
|---|---|
| V5 Standard | `, very aesthetic, masterpiece, no text` |
| V5 Light | `, very aesthetic, amazing quality, no text` |
| V4.5 Full | `, very aesthetic, masterpiece, no text`（⚠ 文档写的是 `location, very aesthetic, masterpiece, no text`） |
| V4.5 Curated | `, very aesthetic, masterpiece, no text, -0.8::feet::, rating:general`（⚠ 文档开头是 `location`，没有 `very aesthetic`） |
| V4 Full | `, no text, best quality, very aesthetic, absurdres` |
| V4 Curated | `, rating:general, best quality, very aesthetic, absurdres`（⚠ 文档写的是 `amazing quality`） |
| Anime V3 | `, best quality, amazing quality, very aesthetic, absurdres` |
| Furry V3 | `, {best quality}, {amazing quality}` |

开启透明背景时，`transparent background` 会加在质量标签前面。有文字渲染时，质量标签插在 `Text:` 之前。

### G. UC 预设（加在 UC 开头）

V5（Full、Curated、Medium 通用）：

- Heavy：`lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page`
- Light：`lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::`
- Furry Focus：`{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic`
- Human Focus：Heavy 的全部内容，再加 `@_@, mismatched pupils, glowing eyes, bad anatomy`

V4.5 Curated：

- Heavy：`blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page`
- Light：`blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page`
- Human Focus：在 Heavy 的基础上加 `bad anatomy, bad hands`、`@_@, mismatched pupils, glowing eyes`

V4.5 Full：

- Heavy：与 V5 Heavy 相同
- 另有 Light、Furry Focus、Human Focus

V4 Full：

- Heavy：`blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page`
- Light：`blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page`

V4 Curated：

- Heavy：`blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page`
- Light：`blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page`

Anime V3：

- Heavy：`lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]`
- Light：`lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing`
- Human Focus：Heavy 的全部内容，再加 `bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes`

Furry V3：

- Heavy：一长串带 `{}` 强调的标签，原文可在前端代码里取到
- Light：`{worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text`

nsfw 自动处理：在非 Curated 模型上，如果提示词里没有 `nsfw`，并且选了 None 以外的 UC 预设，UC 开头会自动加上 `nsfw, `。

### H. Anlas 计费（官方前端公式）

```text
strengthFactor = 有遮罩 ? inpaintImg2ImgStrength : 有底图 ? strength : 1
# V3 / V4 / V4.5 / V5：
base = ceil(2.951823174884865e-6 * w*h + 5.753298233447344e-7 * w*h * steps * k) * (sm_dyn ? 1.4 : sm ? 1.2 : 1)
       # 一般模型 k = 1；V5 Medium 的 k = 1/1.06521739
if V5: base *= 1.5
perImage = max(ceil(base * strengthFactor), 2)      # 单张超过 140 视为无效
total = perImage * (n_samples - (Opus 免费 ? 1 : 0))
```

各项含义：

- **Opus 免费**：同时满足 tier ≥ 3、订阅有效、w×h ≤ 1,048,576、steps ≤ 28、没有使用 Precise Reference。在 V5 上还要求 usage 没有用完（`usage.isNegative` 为 false）
- **Vibe 额外费用**：每次编码 2 Anlas；启用超过 4 张时，加 `2 × (张数 − 4)`
- **Precise Reference**：每个参考在每张图上加 5 Anlas
- **放大**：按像素数分档。≤1,048,576 收 1；≤1,747,627 收 2；≤2,446,678 收 3；≤3,145,728 收 4
- **Director Tools**：按 V3 的公式，用缩放后的尺寸计算。Opus 用户 1MP 以内免费，Remove BG 除外

### I. Director Tools 请求

请求体：

```json
{
  "req_type": "bg-removal | declutter | declutter-keep-bubbles | lineart | sketch | colorize | emotion",
  "image": "<base64>",
  "width": 1024,
  "height": 1024,
  "prompt": "...",
  "defry": 0
}
```

- Emotion 的 `prompt` 写成 `"{emotion};;{额外提示词}"`，`defry` 取 0–5，对应 6 档强度
- 可选的表情：neutral、happy、sad、angry、scared、surprised、tired、excited、nervous、thinking、confused、shy、disgusted、smug、bored、laughing、irritated、aroused、embarrassed、worried、love、determined、hurt、playful
- 返回 zip，里面是 `image*.png`。Remove BG 会返回多张图（Masked、Generated、Blend）

### J. 文件名模板

占位符：

| 占位符 | 含义 |
|---|---|
| `{prompt}` | 提示词，默认截取 80 字符 |
| `{seed}` | seed |
| `{date}` | 生成日期 |
| `{time}` | 生成时间 |
| `{model}` | 模型 ID |
| `{modelname}` | 模型简称 |
| `{resolution}` | 分辨率 |
| `{width}` `{height}` | 宽、高 |
| `{index}` | 批次内序号 |
| `{id}` | 图片 ID |
| `{type}` | 生成类型 |
| `{characters}` | 角色名 |

过滤器：

| 过滤器 | 作用 |
|---|---|
| `first:N`、`last:N` | 保留前或后 N 个字符 |
| `words:N` | 保留 N 个词 |
| `tags:N` | 保留 N 个标签，负数表示从末尾取 |
| `pre:X`、`suf:X` | 加前缀或后缀（值为空时跳过） |
| `pad:N` | 数字补零到 N 位 |
| `lower`、`upper` | 转小写或大写 |

角色列表专用过滤器：`max:N`、`at:N`、`each:N`、`join:X`、`full`。

示例：`{prompt|first:40|pre:-}`。

### K. 元数据

- PNG tEXt 块：`Title`、`Description`（提示词）、`Software`（NovelAI）、`Source`（模型名）、`Generation time`、`Comment`（参数 JSON）
- `Comment` 里的特征字段：
  - `request_type` 为 `Img2ImgRequest` 或 `NativeInfillingRequest`
  - `actual_prompts`
  - `reference_image_multiple`（vibe 编码）
  - `director_reference_strengths`
  - `req_type`（Director Tools 生成的图）
- 同一份元数据也会以隐写方式写进 Alpha 通道，WebP 格式还会写进 EXIF UserComment
- 导入设置时只接受白名单里的字段：scale、seed、steps、strength、noise、sampler、sm、sm_dyn、uc、dynamic_thresholding、cfg_rescale、noise_schedule、legacy_v3_extend、width、height、skip_cfg_above_sigma、v4_prompt、v4_negative_prompt
