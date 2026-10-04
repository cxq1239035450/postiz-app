# 统一 AI 配置与模型调用

配置文件是项目根目录 `.env`。修改后重启 backend 以及执行生成任务的 worker；Mastra 会缓存 Agent，配置不支持运行时热切换。

## 后台可视化配置

进入 **设置 → AI 模型**。系统超级管理员（用户的 `isSuperAdmin` 标识）可以查看、保存配置和测试连接；工作区管理员不具备修改整个实例模型的权限。普通用户可以看到页签及权限说明。

页面读取项目根目录 `.env` 并只保存 AI 字段，不改其他环境变量。已有密钥不返回浏览器，留空保留原值，填写新值会替换；修改供应商或接口地址必须重新填写对应密钥。保存后重启后端及任务进程生效，不会只热更新一个进程。配置被其他页面或编辑器修改时，会提示重新加载，防止覆盖。

“测试文字模型”使用当前表单发起一次简短请求，不保存配置，可能产生少量费用；“测试图片服务连接”仅检查模型列表接口，不生成图片，不保证图片生成能力。不要把 `/chat/completions` 附加到 Base URL 后面。

此页面适用于运行目录位于 Postiz 源码工作区、且根目录 `.env` 可读写的部署。使用容器环境变量或只读部署时，应通过部署配置管理密钥；页面会明确提示无法读写配置。操作系统注入的同名变量可能优先于 dotenv 配置，应避免混用。

验证命令：`node --test scripts/test-ai-settings.cjs scripts/test-ai-settings-ui.cjs`。前者验证保存及权限，后者使用模拟 API 进行浏览器交互测试，不修改真实配置。

## 保留原有 OpenAI 配置

只设置 `OPENAI_API_KEY` 仍然可用。文字、普通聊天默认 `gpt-4.1`，对话 Agent 默认 `gpt-5.2`，分类默认 `gpt-4o-2024-08-06`，图片默认 `chatgpt-image-latest`。

设置 `AI_TEXT_MODEL` 可以统一所有文字模型；`AI_CHAT_MODEL`、`AI_AGENT_MODEL`、`AI_CLASSIFICATION_MODEL` 可分别覆盖。默认模型沿用仓库原值，不保证供应商始终提供这些模型。

## DeepSeek 文字 + 独立图片服务

```dotenv
AI_TEXT_PROVIDER=deepseek
AI_TEXT_BASE_URL=https://api.deepseek.com
AI_TEXT_API_KEY=替换为DeepSeek密钥
AI_TEXT_MODEL=替换为当前可用模型ID

AI_IMAGE_PROVIDER=openai
AI_IMAGE_API_KEY=替换为图片服务密钥
AI_IMAGE_MODEL=chatgpt-image-latest
```

模型 ID 请从供应商控制台确认，不要原样复制占位符。文字供应商切换不会改变图片供应商；不配置图片服务时仍可使用文字功能，但请求图片生成会明确失败。

其他兼容 Chat Completions 协议的服务使用 `AI_TEXT_PROVIDER=openai-compatible`，同时指定 `AI_TEXT_BASE_URL`、`AI_TEXT_API_KEY`、`AI_TEXT_MODEL`。这是兼容协议接入，不是所有厂商功能自动兼容。

## 配置与调用行为

| 配置 | 说明 |
|---|---|
| `AI_TEXT_PROVIDER` / `AI_IMAGE_PROVIDER` | `openai`、`deepseek`、`openai-compatible`；图片不接受 `deepseek` |
| `AI_TEXT_BASE_URL` / `AI_IMAGE_BASE_URL` | 各自 API 地址；兼容供应商必须显式指定 |
| `AI_TEXT_API_KEY` / `AI_IMAGE_API_KEY` | 各自凭证；只有 OpenAI 配置可回退到旧 `OPENAI_API_KEY` |
| `AI_TEXT_MODEL` / `AI_IMAGE_MODEL` | 文字默认模型、图片模型 |
| `AI_TIMEOUT_MS` | 请求超时，默认 120000 毫秒；不是整个 Agent 工作流的总时限 |
| `AI_MAX_RETRIES` | SDK 模型请求重试次数，默认 0；不会自动重试发布工具或整个业务流程 |

剪辑选段任务继续使用已有的 8 分钟请求超时和零重试。现有业务层生成修复循环、Temporal 任务重试仍独立存在。

文字生成在 OpenAI 使用 JSON Schema；兼容接口使用 JSON Object + 本地结构校验。LangGraph 工作流在兼容接口上通过工具调用获取结构化结果，因此模型必须支持工具调用。多候选生成会拆成多次请求，保持候选数量，但耗时和调用次数会增加。

图片服务使用 Images API。后台直接生成图片的功能要求响应包含 `b64_json`，支持尺寸 `1024x1024`、`1024x1536`；工作流也接受图片 URL。仅修改模型名不能适配尺寸、参数和返回格式不同的任意图片服务。

没有配置模型时不会在模块导入阶段创建客户端，也不会发送占位 Key；聊天入口返回 HTTP 503。社交平台 OAuth Token、登录、手动发布不依赖 AI Key。

## 代码入口

- `libraries/nestjs-libraries/src/ai/ai.config.ts`：配置优先级、默认值和配置校验。
- `libraries/nestjs-libraries/src/ai/ai.models.ts`：统一创建 SDK 客户端，提供 `complete`、`parse`、`structured`、`image` 及框架适配器。
- 现有 `OpenaiService` 保留业务方法和提示词，内部改用统一调用服务。
- CopilotKit、Mastra、LangGraph 保持现有流式协议、记忆、工具和业务流程；本次没有合并 Agent 核心或替换框架。

## 验证与边界

运行 `node --test scripts/test-ai.cjs` 执行本地模拟接口测试，无需密钥，不会调用真实服务。

接入真实供应商后仍需验证普通聊天、工具调用、结构化生成、流式响应、图片生成及草稿任务。模拟接口测试不代表供应商端到端认证；测试时不要直接向真实社交账号发布。
