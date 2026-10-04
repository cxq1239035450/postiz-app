# QPublish Meta 开发测试配置

核对日期：2026-09-29。主应用：`2018547362136332`（QPublish）。

本次选择 **Instagram（Facebook Business）**，与 Facebook Page 共用
`FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`。Instagram 专业账户需绑定 Facebook 公共主页。
Meta 中已有“管理公共主页”和“管理 Instagram 上的消息和内容”两个用例，以及企业版 Facebook 登录。

独立 Instagram 应用 `916441231306473`（QPublish-IG）属于 **Standalone**，
其凭证只适用于 `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`，不能填入 Facebook 配置。
本次不启用 Standalone。

本地 `.env` 已设置主应用编号和从 Meta 基本设置页读取的主应用密钥；
Standalone 的两项环境变量保持未设置。应用身份页确认当前账号“陈小强”为管理员。

## 按项目代码核对的 scopes

来源：`libraries/nestjs-libraries/src/integrations/social/` 下三个 provider 的 `scopes`。

| Provider | scopes |
| --- | --- |
| `facebook.provider.ts` | `pages_show_list`, `business_management`, `pages_manage_posts`, `pages_manage_engagement`, `pages_read_engagement`, `read_insights` |
| `instagram.provider.ts` | `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `business_management`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights` |
| `instagram.standalone.provider.ts`（本次不用） | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_insights` |

前两行合并后的 10 项权限均已在 Meta 控制台核对为“准备测试”。
原先已有 `business_management`、`pages_show_list` 和默认 `public_profile`；
本次补齐另 8 项。未添加消息、广告、Webhook 等代码未请求的权限。
“加入应用审核”按钮在此界面用于添加权限；本次未提交应用审核，也未发布应用。

实际 OAuth 测试还返回了 `Invalid Scopes: pages_read_user_content`。
将此项作为授权流程要求的额外权限添加后，错误消失，成功进入 Facebook 账号和公共主页选择步骤。
因此 Meta 最终配置为代码直接请求的 10 项，加上 `pages_read_user_content`（共 11 项，不含默认 `public_profile`）。
三个 provider 的 scopes 保持原样；Standalone 权限未启用。

## 本地 OAuth

当前 `FRONTEND_URL=http://localhost:4200`，代码生成的回调为：

- Facebook Page：`http://localhost:4200/integrations/social/facebook`
- Instagram（Facebook Business）：`http://localhost:4200/integrations/social/instagram`

Meta 企业版 Facebook 登录设置已开启 OAuth 客户端授权登录、OAuth 网页授权登录、
强制 HTTPS 和严格 URI 匹配。控制台对本地地址明确提示：
“http://localhost 只可在开发模式下自动跳转，无需在这里添加。”
因此不要把本地 HTTP 地址强行加入有效 OAuth 跳转 URI 列表。
未来使用 HTTPS 域名时，需同时更新 `FRONTEND_URL` 和 Meta 中对应的两个精确回调。

## 开发测试前提

- 主应用密钥应保存在 Git 忽略的本地 `.env` 中，不能写入文档或提交版本库。
- 更新 `.env` 后需要让后端重新加载环境变量。
- 授权账号需要具备应用管理员、开发者或测试人员身份，并有目标公共主页的相应管理权限。
- Instagram 专业账户需要与目标公共主页绑定。
- 在 QPublish 分别选择 Facebook Page 和 Instagram（Facebook Business）进行授权。
- “准备测试”仅表示权限已配置，不代表已完成 OAuth、账号绑定或发布测试。
- 发布媒体需要 Meta 能访问媒体 URL；本地 `localhost` 媒体地址不能供 Meta 服务器抓取。

## 本次验证结果

- `.env` 的主应用 ID 与 Meta 一致，密钥已设置，Standalone 凭证未设置。
- 后端编译通过（0 errors），运行时配置检查通过；开发服务已恢复就绪。
- 从 QPublish 的“添加频道 → Facebook Page”发起真实 OAuth，成功到达公共主页选择页。
- 初次授权时账号没有公共主页；经用户明确授权，已创建软件类别测试主页 [QPublish Test](https://www.facebook.com/profile.php?id=61594615573690)，主页 ID 为 `61594615573690`。
- 经用户明确授权，已创建 `QPublish Test` 业务资产组合（`1973197443820026`）并将测试主页加入其中。
- Facebook OAuth 已选择仅授权这一个现有主页和这一个现有业务账户，Meta 显示“陈小强已绑定 QPublish”。
- 用户明确同意将 Instagram 测试账号 `xiao_yu99999` 转为商企专业账号并绑定；Meta Business Suite 已确认该账号与测试主页关联成功，且加入专用业务资产组合。
- 已关闭绑定流程中的可选 Instagram 消息收件箱共享。
- 两个真实 OAuth 流程均已完成回调、账号读取和频道保存，QPublish 显示 `Channel Added`。
- 已连接 Facebook Page：`QPublish Test`。
- 已连接 Instagram（Facebook Business）：`xiao_yu99999`，界面显示名为 `chen xiao qiang`。
- Instagram 授权也仅选择这一个现有账号、测试主页和测试业务账户。
- 未做发帖/评论测试，未发布 Meta 应用，未提交上线或应用审核。

## 本地运行说明

首次回调遇到后端监视器反复重启，导致浏览器请求失败。将本次运行日志移入
`node_modules/.cache/qpublish-meta/` 后重新启动开发服务，后端保持同一进程并完成了两个频道连接。
日志目录在 Git 忽略范围内；日志可能包含 OAuth 回调参数，不应提交或共享。
本次没有修改 provider 实现或 scopes。

参考：[Meta 的 Instagram API with Facebook Login 文档](https://www.postman.com/meta/instagram/folder/u4g5a2a/instagram-api-with-facebook-login)。
