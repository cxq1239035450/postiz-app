# 独立站数据观测配置

本模块只读取 Google 搜索表现，独立于 Google 登录和社交发布。网站不占发布频道额度。组织成员可以查看及管理本组织的网站连接。

## Google 配置

1. 在 Google Cloud 选择项目并启用 **Google Search Console API**。
2. 配置 OAuth 同意屏幕，申请 `https://www.googleapis.com/auth/webmasters.readonly`。测试阶段将实际使用者添加为测试用户；正式向其他用户开放前，按 Google 控制台要求完成应用发布/验证。
3. 创建 Web application 类型 OAuth 客户端，添加精确回调：
   - 线上：`https://qpublush.io/website-analytics/connect`
   - 本地：`http://localhost:4200/website-analytics/connect`
4. 客户端可以独立创建；不要覆盖现有 Google 登录的配置。回调由 `FRONTEND_URL` 自动生成，需与控制台一致。
5. 登录 Search Console 添加并验证网站，或者让所有者授予当前 Google 账号访问权限。系统支持域名资源（`sc-domain:example.com`）及 URL 前缀资源。

## 服务端配置与迁移

将以下变量填入服务端运行配置 `/opt/postiz-app/deploy/production/config/.env`，本地开发填项目 `.env`，不要提交真实值：

```dotenv
SEARCH_CONSOLE_CLIENT_ID=你的客户端ID
SEARCH_CONSOLE_CLIENT_SECRET=你的客户端密钥
SEARCH_CONSOLE_ENCRYPTION_KEY=64位十六进制随机字符串
```

可以用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 在受控终端生成加密密钥。密钥应安全备份并跨发布保持不变；直接更换会导致已有连接无法解密，需要恢复旧密钥或解除绑定后重连。密钥及令牌不能发送到聊天、日志或前端。

现有生产镜像在启动时运行不带 `--accept-data-loss` 的 Prisma db push，会创建新增表。也可在新后端启动前，通过数据库管理员连接执行 `deploy/sql/20261005-website-analytics.sql` 做显式迁移；该脚本只新增两张表和索引，可重复执行。构建时执行 Prisma generate。应用已有运行镜像部署流程无需把仓库留在服务器中，可通过 stdin 将迁移 SQL 传给 PostgreSQL 客户端。

生产环境需要原有 PostgreSQL、Redis，以及访问 Google OAuth 和 Search Console API 的网络连接。重启应用后在「数据分析 → 独立站」检查配置状态。

## 使用与验收

- 「添加频道 → 独立站 / Search Console」→ Google 授权 → 勾选一个或多个网站 → 绑定。
- 「数据分析 → 独立站」切换网站，查看四项指标、每日趋势、关键词/页面/国家/设备热门明细。
- 默认近 28 天，支持 7/90 天和自定义日期（最多 487 天）；日期使用 Google 的太平洋时间，搜索类型固定为网页，数据状态为 final。
- 最近日期的数据可能尚未完成处理；Google 隐私过滤及 API 限制可能使明细与总览不一致。总览独立查询，不能通过明细相加核验。此模块不展示全站访客和订单。
- 查询结果缓存 1 小时，页面显示缓存更新时间，刷新页面不会强制突破缓存。无 Redis 的开发回退亦通过时间戳限制缓存有效期。
- 重新授权必须仍有原网站访问权限。解除绑定只删除本组织连接，不删除 Google 网站，也不全局撤销同账号其他网站的授权。
- 对照 Search Console 的相同资源、日期、网页搜索类型核对核心指标。验证无数据、拒绝授权、令牌失效、无网站权限及多个网站场景。
- OAuth 状态绑定组织与用户，15 分钟有效且单次使用；网站选择票据同样受保护。令牌以 AES-256-GCM 加密保存。过期票据在下次发起授权时清理。
- 回滚代码无需删除新表；先禁用入口/回退镜像，保留数据与加密密钥。

## 接口

所有接口均需现有用户登录和组织上下文，后端校验资源归属，不接受客户端指定组织：

| 方法与路径 | 用途 |
| --- | --- |
| GET `/website-analytics` | 配置状态和本组织网站列表（无令牌） |
| POST `/website-analytics/authorize` | 创建授权地址，可传 reconnectId |
| POST `/website-analytics/callback` | 消费 state/code，返回一次性选站票据及资源列表 |
| POST `/website-analytics/connections` | 提交 ticket 和 siteUrls 绑定网站 |
| DELETE `/website-analytics/connections/:id` | 解除绑定 |
| GET `/website-analytics/connections/:id/report` | startDate、endDate、dimension、page（从 0 起，每页 50） |

验证脚本：`node --test scripts/test-website-analytics.cjs`。

参考：[Google Search Analytics](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)、[网站列表](https://developers.google.com/webmaster-tools/v1/sites/list)。
