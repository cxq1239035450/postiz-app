# QPublish 新版登录与第三方认证

新版地址：`/auth/login`（登录）、`/auth`（注册）。
旧版地址：`/auth/legacy/login`、`/auth/legacy`。
旧版 `components/auth/login.tsx` 和 `register.tsx` 保持原样，原布局保存在 `components/auth/legacy/layout.tsx`。找回密码、激活和历史第三方回调继续使用旧版布局。

## 模块边界

- UI：`apps/frontend/src/components/auth/modern/`。Google、微信各有独立按钮组件，通过通用 `ProviderButton` 发起跳转。
- 服务端：`apps/backend/src/services/auth/web-login/`。`GoogleLoginProvider` 与 `WechatLoginProvider` 实现同一个接口，`WebLoginService` 注册和选择模块。
- 入口与回调：`apps/backend/src/api/routes/web-login.controller.ts`。
- 共享服务端配置：`libraries/helpers/src/auth/web-login.config.ts`。页面仅接收可用状态，密钥不会序列化到浏览器。
- 新模块独立于旧版 `providers/google.provider.ts` 及 YouTube 发布授权，原有渠道授权无需改动。

## 启用 Google

在 Google Cloud 中为网站创建 OAuth 客户端，在服务器 `.env` 设置：

```dotenv
GOOGLE_LOGIN_ENABLED="true"
GOOGLE_LOGIN_CLIENT_ID="填写 OAuth 客户端 ID"
GOOGLE_LOGIN_CLIENT_SECRET="填写 OAuth 客户端密钥"
GOOGLE_LOGIN_REDIRECT_URI="https://你的后端公网地址/auth/social/google/callback"
```

回调地址必须与 Google 控制台完全一致。如果后端挂在 `/api` 下，地址应为 `https://你的站点/api/auth/social/google/callback`。
不填写 `REDIRECT_URI` 时，默认使用 `NEXT_PUBLIC_BACKEND_URL` 加对应回调路径。
不读取 `YOUTUBE_CLIENT_ID`，可明确控制系统登录与频道发布的凭据。
只请求 `openid email profile`，使用 PKCE、nonce 和服务端 ID Token 验签。
参考：[Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)。

## 启用微信

使用微信开放平台的**网站应用** AppID/AppSecret，并配置该应用的授权回调域名。此模块为网站扫码登录，不是公众号网页授权，也不表示支持微信内容发布。

```dotenv
WECHAT_LOGIN_ENABLED="true"
WECHAT_LOGIN_CLIENT_ID="填写网站应用 AppID"
WECHAT_LOGIN_CLIENT_SECRET="填写网站应用 AppSecret"
WECHAT_LOGIN_REDIRECT_URI="https://你的后端公网地址/auth/social/wechat/callback"
```

模块跳转到微信托管的二维码页，采用 `snsapi_login`，用户扫码同意后回调本系统。授权码、access_token 和用户信息均由服务器交换，不交给前端。
开发者后台应配置真实可访问域名；本地 localhost 预览不代表微信回调已配置成功。
官方配置入口：[微信开放平台](https://open.weixin.qq.com/)。

微信不返回邮箱。为兼容现有必填邮箱字段，系统用稳定的 `sha256(AppID:OpenID)@wechat.invalid` 内部标识，并关闭该账号默认邮件通知；邮件服务拒绝向 `.invalid` 发送邮件。该标识不是用户邮箱，不参与 Google 或邮箱账号的自动合并。身份固定使用 `AppID:OpenID`，不会因为以后出现 UnionID 而创建不同身份。

## 数据库与部署

1. 先对应用数据库执行 `deploy/sql/20261004-wechat-login.sql`，仅新增 `Provider.WECHAT` 枚举值，不删除或重置数据。
2. 运行 `pnpm exec prisma generate --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma`。
3. 填写实际凭据、启用相应模块，重新构建并重启前端与后端。也可将某个 `*_ENABLED` 设为 `false` 单独关闭。
4. `FRONTEND_URL`、后端公网入口及 Cookie 域应处于同一站点（推荐后端走 `/api` 反向代理），使用 HTTPS。
5. `QPUBLISH_WEBSITE_URL` 控制服务条款和隐私政策的官网地址，默认沿用现有官网域名。

未配置模块仍显示入口，点击后提示暂未开放并保留邮箱登录；后端也拒绝未启用模块的启动与回调。
新第三方用户遵守 `DISABLE_REGISTRATION`，已存在的第三方用户仍可登录。不会根据相同邮箱自动绑定其他身份。
授权事务有效期 10 分钟，使用随机 state、签名、指定 audience 和 HttpOnly/SameSite=Lax Cookie 绑定浏览器与平台。正式会话沿用现有 Cookie 域及有效期；只有原项目显式启用 `NOT_SECURED` 的开发模式会使用其既有可读 Cookie 机制。

## 验证与限制

运行 `node --test scripts/test-web-login.cjs`：覆盖模块启停、配置隔离、state 篡改/过期/错平台、Google nonce/邮箱验证、微信 OpenID 核对、取消授权、异常脱敏、会话 Cookie、邀请组织、旧账号复用和关闭注册。
这些测试使用模拟第三方响应及数据库服务，不替代生产授权验收。

本次已运行前端 TypeScript 检查、后端构建和浏览器交互验证。本机 Docker / PostgreSQL 服务未运行，因此新增枚举 SQL 未执行，真实账号写库及 Google/微信实际授权尚未验收。启用前请在真实凭据和已配置回调域名的环境完成一次登录闭环。
