# 生产环境社交平台密钥

应用从服务器 `/opt/postiz-app/deploy/production/config/.env` 读取配置，容器内路径为 `/config/.env`。不要填到同目录用于数据库密码的 `deploy/production/.env`。

首次初始化执行 `initialize.py` 时会自动附加 [social.env.example](social.env.example) 中的空配置项。已有服务器不要重新初始化；编辑现有 `config/.env`，补充缺少的配置项，已有项目直接修改，避免重复定义。模板中的空值需要替换为真实凭证，不能直接覆盖已有配置文件。

| 平台 | 配置项 | 用途 |
| --- | --- | --- |
| TikTok | `TIKTOK_CLIENT_ID` / `TIKTOK_CLIENT_SECRET` | 当前 TikTok provider 的 Client key 和 Client secret |
| Facebook | `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Meta 主应用凭证 |
| Instagram（Facebook Business） | 共用 `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | 项目现有 Instagram 接入方式 |
| YouTube | `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | Google OAuth 客户端凭证 |
| Instagram（Standalone，可选） | `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | 独立 Instagram 应用凭证，使用时取消模板注释 |

按照当前 provider 代码和生产 `FRONTEND_URL=https://qpublush.io`，对应回调地址如下。将使用的平台回调填入对应开发者后台；如果更换域名，需与 `FRONTEND_URL` 一起调整。

```text
https://qpublush.io/integrations/social/tiktok
https://qpublush.io/integrations/social/facebook
https://qpublush.io/integrations/social/instagram
https://qpublush.io/integrations/social/youtube
```

独立 Instagram 的可选回调为 `https://qpublush.io/integrations/social/instagram-standalone`。

保存真实凭证后，在服务器重启应用加载配置。已启用自动部署时保留 active override：

```sh
cd /opt/postiz-app/deploy/production
docker compose -f compose.yaml -f /opt/postiz-app/.deploy-state/active.json restart app
docker compose -f compose.yaml -f /opt/postiz-app/.deploy-state/active.json ps
```

首次自动部署前没有 `active.json` 时，使用 `docker compose -f compose.yaml restart app` 和 `docker compose -f compose.yaml ps`。无需重新构建镜像。

重启后分别从“添加频道”发起授权并确认频道保存成功。填写凭证不代表已完成平台审核或授权验证。密钥只保存在服务器配置文件中，不提交到 Git，也不输出到部署日志。
