# GitHub 自动部署（现有 QPublish 服务器）

代码 push 到指定分支 → GitHub Actions 上传该次提交的源码 → 服务器构建镜像 → 备份 PostgreSQL → 替换应用容器 → 健康检查。

这套文件已经准备好，但**尚未配置 SSH 凭证、提交或推送，也未启用线上自动部署**。本地未提交的修改不会进入部署包。首次启用前应把部署文件和要上线的业务代码一起提交。

## 一次性配置

在 GitHub 仓库 Settings → Secrets and variables → Actions 中设置：

| 类型 | 名称 | 当前项目值 |
| --- | --- | --- |
| Variable | `DEPLOY_ENABLED` | 配置完成后设为 `true`；其他值不部署 |
| Variable | `DEPLOY_BRANCH` | `main`，或明确填写 `feat/unified-ai` |
| Variable | `DEPLOY_ROOT` | `/opt/postiz-app` |
| Variable | `DEPLOY_PUBLIC_URL` | `https://qpublush.io` |
| Variable | `DEPLOY_PORT` | `22`（SSH 端口，不是宝塔的 21640） |
| Secret | `DEPLOY_HOST` | `179.236.227.173` |
| Secret | `DEPLOY_USER` | 有该目录和 Docker 操作权限的服务器用户 |
| Secret | `DEPLOY_SSH_KEY` | 专用于发布的 SSH 私钥完整内容 |
| Secret | `DEPLOY_KNOWN_HOSTS` | 已核对的服务器 SSH 主机公钥记录 |

`DEPLOY_ENABLED` 和 `DEPLOY_BRANCH` 必须放在**仓库级 Variables**，因为作业启动前就会判断它们。工作流使用 `production` Environment；可在 Settings → Environments 中限制允许部署的分支或设置审批人。需要完全自动更新时，不设置人工审批。

生成一对专用 SSH 密钥，把公钥追加到部署用户的 `~/.ssh/authorized_keys`；私钥只保存到 GitHub Secret，不要提交进仓库。部署用户必须能够无交互运行 Docker 和读写部署目录。Docker 权限接近服务器管理员权限，应限制哪些人可以修改部署分支及工作流。

从已登录的服务器终端读取公钥（不是私钥），例如：

```sh
cat /etc/ssh/ssh_host_ed25519_key.pub
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

将公钥整理成 known_hosts 格式：`179.236.227.173 ssh-ed25519 AAAA...`；非 22 端口用 `[179.236.227.173]:端口 ssh-ed25519 AAAA...`。不要关闭主机密钥验证。

服务器需已有本项目运行中的 Compose 服务、Docker Compose v2+、Python3、curl、flock。当前服务器已满足基础环境。脚本复用 `deploy/production/compose.yaml`、`.env`、`config/.env` 和现有数据卷，不初始化新数据库。

## 日常使用

TikTok、Facebook、Instagram 和 YouTube 的生产密钥配置见 [社交平台密钥配置](SOCIAL-KEYS.md)。

```sh
git add <要发布的文件>
git commit -m "描述本次修改"
git push origin main
```

仅 push 到 `DEPLOY_BRANCH` 指定的分支才部署。也可以在 Actions → Deploy production → Run workflow 手动触发同一分支。首次手动触发要求工作流已经存在于默认分支。

本地 Linux / Git Bash 设置相同环境变量后，也可执行：

```sh
bash deploy/automation/publish.sh
```

它只打包 `HEAD`，不会上传未提交内容；必须先提交本套脚本。GitHub 托管 runner 需要能通过 SSH 访问服务器。

## 更新行为与边界

- 构建阶段旧服务继续运行；切换容器会有短暂中断，不是零停机部署。
- 只替换 app，数据库、Redis、Temporal 和宝塔反代配置保持原样。Compose 基础设施变更需单独审核并部署，不会跟随 push 自动应用。
- 新版本使用自己的启动脚本挂载；服务器已有的配置和 AI 设置仍持久保存在 `deploy/production/config/.env`。
- 发布前用 `pg_dump -Fc` 备份应用数据库到 `backups/`。备份含业务数据，仅保存在服务器，需自行安排异机备份和保留周期。
- 构建失败不切换；应用启动或健康检查失败尝试恢复旧镜像。迁移仍采用现有 `prisma db push`，不加 `--accept-data-loss`。
- **数据库 schema 不会自动还原。** 不兼容 schema 变更可能导致旧镜像也无法运行，届时需要人工处理备份，不能把镜像回退理解为数据库回退。
- 不自动清理镜像、release 或备份，防止误删恢复材料；需定期检查磁盘。
- 不在 PR、fork PR 或任意分支上执行生产部署。工作流只部署已指定的分支；请保护该分支。
- GitHub Secret 只用于 SSH；AI/社交平台密钥继续在服务器配置，不放进 Actions 或源码。

## 服务器常用命令

自动部署成功后，操作 app 必须携带 active override，否则基础 Compose 中的旧镜像会覆盖新版本：

```sh
cd /opt/postiz-app/deploy/production
docker compose -f compose.yaml -f /opt/postiz-app/.deploy-state/active.json ps
docker compose -f compose.yaml -f /opt/postiz-app/.deploy-state/active.json logs --tail=100 app
docker compose -f compose.yaml -f /opt/postiz-app/.deploy-state/active.json restart app
cat /opt/postiz-app/.deploy-state/current-release
```

发布日志：`.deploy-state/<release>.log`。首次自动部署前尚无 `active.json`，使用原来的 `docker compose` 命令。

手动回退某次发布前的镜像（先确认数据库兼容；不要执行 `down -v`）：

```sh
cd /opt/postiz-app/deploy/production
# 将 RELEASE 替换为要撤销的发布编号
cp /opt/postiz-app/.deploy-state/RELEASE-previous.json /opt/postiz-app/.deploy-state/active.json
docker compose -f compose.yaml -f /opt/postiz-app/.deploy-state/active.json up -d --no-build --no-deps app
docker compose -f compose.yaml -f /opt/postiz-app/.deploy-state/active.json ps
```

其他项目复制 [通用模板](../automation/README.md)，只需替换 `project.sh` 项目适配配置和工作流中的服务器默认地址；核心 `publish.sh` 和 `deploy.sh` 不包含 Postiz 服务约定。

GitHub 官方说明：[工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)、[Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。
