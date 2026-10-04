# GitHub 自动部署（现有 QPublish 服务器）

代码 push 到指定分支 → GitHub Actions 构建该次提交的运行镜像 → 上传并加载镜像 → 备份 PostgreSQL → 替换应用容器 → 健康检查。

截至 2026-10-04，旧版源码部署流程已完成首次手动发布验证。本文工作流现已改为 GitHub 构建镜像，以下首次验证记录属于迁移前的历史记录。工作流和部署脚本已推送到 `main`（提交 `f678104f`）；4 个部署 Secrets 已保存，仓库变量 `DEPLOY_BRANCH=main`、`DEPLOY_ENABLED=true` 已启用。SSH 端口、部署目录和网站地址使用工作流默认值。以后 push 到 `main` 会自动触发发布，本地未提交的修改不会进入部署包。

首次验证：[Deploy production #2](https://github.com/cxq1239035450/postiz-app/actions/runs/37188890447)，结果 Success，部署作业耗时约 10 分钟。服务器版本为 `f678104fba03-37188890447-1`，新应用容器健康，公网 `/auth/login` 返回 HTTP 200，数据库备份已生成。此验证不代表 Google / 微信登录与所有业务功能已验收；启用后的下一次 push 触发尚未另行测试。

维护记录：专用私钥仅保存在本机 `C:/Users/admin/.ssh/qpublish_actions_20261004` 和 GitHub 的 `DEPLOY_SSH_KEY` Secret，未纳入仓库。服务器公钥授权带 `restrict`，禁止该密钥的端口转发、代理转发和交互 PTY；发布仍使用 root 运行远程命令，具有管理员权限。停止自动发布可将 `DEPLOY_ENABLED` 设为 `false`；需要撤销服务器访问时，仅移除 `authorized_keys` 中注释为 `qpublish-github-actions` 的对应公钥，并移除仓库部署 Secret，不要删除其他登录密钥。

## 按顺序操作：首次启用手册

本手册用于更新已经运行的 QPublish Linux / Docker Compose 实例，不用于空白服务器首次安装。无需 Jenkins，也无需在服务器安装 GitHub Runner。GitHub 托管执行机完成编译，只上传镜像和必要运行配置。服务器无需源码和构建工具。

准备好两个窗口：Windows 本机终端、已登录服务器的 SSH / 宝塔终端。以下每段命令均标明执行位置。不要把密码或私钥发到聊天、截图或提交到 Git。

### 第 1 步：确认服务器实际参数

当前项目约定如下，若服务器实际配置不同，请填写实际值，不要直接修改现有线上目录：

- 仓库：`cxq1239035450/postiz-app`，部署分支 `main`。
- 网站：`https://qpublush.io`。
- 部署根目录：`/opt/postiz-app`。
- SSH 地址：下方配置表中的 IP 仅为已有记录，先确认它仍是你的服务器。
- SSH 端口：默认 `22`，宝塔面板端口不是 SSH 端口。

在**服务器终端**执行：

```bash
whoami
docker --version
docker compose version
command -v bash python3 curl flock sha256sum tar
df -h /opt/postiz-app
free -h
cd /opt/postiz-app/deploy/production
test -s .env && echo 'Compose 环境文件存在'
test -s config/.env && echo '应用环境文件存在'
docker compose -f compose.yaml ps
```

应能看到正在运行的 `app`、`postgres` 等服务。缺少目录、配置或运行中的 app 时，先修复现有安装，不要靠开启 Actions 初始化它。Dockerfile 设置 Node 构建堆上限为 6144 MB；这不是总内存需求，构建执行机需有足够内存和磁盘。服务器仅加载镜像并运行服务。

如果以前已经自动发布过，查看状态时使用本手册后面的 `active.json` 命令。

### 第 2 步：在本机生成一对专用部署密钥

在 **Windows PowerShell** 执行：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -C "qpublish-github-actions" -f "$env:USERPROFILE\.ssh\qpublish_actions"
```

如果提示该文件已存在，不要覆盖，改用另一个文件名。自动部署脚本不支持交互输入密钥口令，生成时在两次 passphrase 提示处直接按 Enter，使用仅供本项目发布的专用密钥。

生成两个文件：

| 文件 | 用途 |
| --- | --- |
| `qpublish_actions.pub` | 公钥，放到服务器 |
| `qpublish_actions` | 私钥，放到 GitHub Secret |

查看公钥：

```powershell
Get-Content "$env:USERPROFILE\.ssh\qpublish_actions.pub"
```

### 第 3 步：让服务器允许部署密钥登录

先确定部署用户。最简单的做法是使用已经能管理当前 Docker Compose 项目的账号。若新建专用账号，管理员需单独授予该项目目录读写权限和 Docker 权限；不要递归改动数据库目录权限。当前脚本不会替你运行 sudo 或输入密码。

在**服务器上以部署用户身份**执行：

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
cat >> ~/.ssh/authorized_keys
```

粘贴刚才 `.pub` 文件的完整一行，然后按 Enter，再按 Ctrl+D 结束。这里只追加公钥，不覆盖已有密钥。随后确认该用户运行 `docker ps` 不需要密码，并有 `/opt/postiz-app` 的读写权限。Docker 管理权限接近管理员权限，只授予可信部署账号。

### 第 4 步：核对服务器身份并测试 SSH

在**已验证身份的服务器终端**执行：

```bash
cat /etc/ssh/ssh_host_ed25519_key.pub
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

保存显示的主机公钥和指纹。主机公钥与第 2 步的部署公钥是两种不同的密钥，不能混用。

在 **Windows PowerShell** 中将以下三项替换为实际值后执行：

```powershell
$deployHost = '你的服务器IP'
$deployUser = '部署用户名'
$deployPort = 22
ssh -i "$env:USERPROFILE\.ssh\qpublish_actions" -p $deployPort "$deployUser@$deployHost" "whoami; docker ps --format '{{.Names}}'"
```

第一次连接会提示服务器指纹，必须与上面服务器输出一致再接受。应能登录并列出容器。如果仍要求账号密码，先检查公钥是否加到了正确用户以及 `.ssh` 权限。

将服务器公钥整理成 `DEPLOY_KNOWN_HOSTS` 的值，去掉原行末尾的用户注释也可以：

```text
# SSH 使用 22 端口：
你的服务器IP ssh-ed25519 服务器主机公钥的AAAA部分

# SSH 使用其他端口，例如 2222：
[你的服务器IP]:2222 ssh-ed25519 服务器主机公钥的AAAA部分
```

只复制与你实际端口相符的一行，不含上面的注释。主机名必须与 `DEPLOY_HOST` 一致。

### 第 5 步：填写 GitHub Secrets 和 Variables

打开 [仓库 Actions 配置](https://github.com/cxq1239035450/postiz-app/settings/secrets/actions)。进入 **Settings → Secrets and variables → Actions**。

1. 在 **Secrets** 标签点击 **New repository secret**，逐个添加下方表格的 4 个 Secret。
2. `DEPLOY_SSH_KEY` 填写本机 `qpublish_actions` 文件完整内容，包括开头和结尾的私钥标记。可以用本机编辑器打开复制，切勿填成 `.pub` 公钥。
3. 在 **Variables** 标签点击 **New repository variable**，添加下方表格的变量。此时先设置 `DEPLOY_ENABLED=false`。
4. 打开 **Settings → Environments**，创建或检查名为 `production` 的环境；若使用部署分支限制，允许 `main`。希望全自动时，不设置必需审批人。环境功能以你的 GitHub 方案和仓库界面可用项为准。
5. 若仓库禁用了 Actions，在 **Settings → Actions → General** 中启用，并确保策略允许工作流使用 `actions/checkout`。

全部值填好后，将仓库级变量 `DEPLOY_ENABLED` 改成小写 `true`。`DEPLOY_BRANCH` 填 `main`。变量值不要加引号。

### 第 6 步：第一次手动发布并验证

打开 [Actions 页面](https://github.com/cxq1239035450/postiz-app/actions)，选择 **Deploy production → Run workflow → Branch: main → Run workflow**。这一步会实际更新线上应用。

打开本次执行记录，观察 `Build image on GitHub and deploy` 步骤。依次应看到 GitHub 构建、镜像上传、`Loading prebuilt`、数据库备份和 `Deployed`。首次构建需要下载依赖，耗时取决于执行机性能和网络；当前作业超时为 60 分钟。

在**服务器终端**验证：

```bash
cat /opt/postiz-app/.deploy-state/current-release
cd /opt/postiz-app/deploy/production
docker compose -f compose.yaml -f /opt/postiz-app/.deploy-state/active.json ps
curl -I https://qpublush.io/auth/login
```

最后在浏览器打开网站，检查登录页、已有账号登录及一项核心业务功能。健康检查只验证服务可用，不代表 Google / 微信授权或所有发布平台已验收。若日志出现公网检查警告，即使作业绿色，也应检查域名、HTTPS 和反向代理。

### 第 7 步：以后正常提交即可更新

在**本机项目目录**执行：

```powershell
git add <本次修改的文件>
git commit -m "描述本次修改"
git push origin main
```

仅本地 commit 不触发；push 到 `main` 才触发当前部署配置。其他分支不会更新生产。想临时停止自动发布，将仓库变量 `DEPLOY_ENABLED` 改回 `false`；它不会停止已经运行的发布作业。

### 常见问题速查

| 现象 | 检查方法 |
| --- | --- |
| 作业显示 Skipped | 确认仓库级 `DEPLOY_ENABLED=true`，且分支与 `DEPLOY_BRANCH` 一致 |
| 看不到 Run workflow | 确认默认分支已有工作流、Actions 已启用且你有相应权限 |
| 一直等待审批 | 检查 `production` 环境的审批规则 |
| `Missing DEPLOY_...` | Secret / Variable 名称或所属位置错误，检查是否漏填 |
| SSH 超时或拒绝连接 | 核对 SSH 端口、防火墙和公网可达性；不是宝塔面板端口 |
| `Permission denied (publickey)` | 用户名错误、公钥未安装、私钥不匹配或带口令 |
| `Host key verification failed` | 核实服务器主机指纹，修正 `DEPLOY_KNOWN_HOSTS`；不要关闭验证 |
| Docker permission denied | 部署账号没有非交互 Docker 权限，交由服务器管理员处理 |
| `Expected startup bind mount missing` | 现有 app 没按本项目 Compose 挂载 start.sh，先核对原部署布局 |
| 构建被 Killed / 退出 137 | 检查内存不足、OOM 记录；不要在旧服务仍占资源时盲目重试 |
| 数据库迁移失败 | 查看 app 日志和 schema 兼容性，不要加 `--accept-data-loss` 强行上线 |
| 健康检查失败 | 查看本次日志和容器日志，确认是否已恢复旧镜像 |
| SSH 中断或作业被取消 | 手动核对服务器容器和日志，不能假定已完成回退 |

完成标准：首次手动发布成功、线上功能检查通过，下一次真实代码 push 能自动发布；三个条件全部满足后，才算配置完成。

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

服务器需已有本项目运行中的 Compose 服务、Docker Compose v2+、Python3、curl、flock。请按第 1 步核实当前环境。脚本复用 `deploy/production/compose.yaml`、`.env`、`config/.env` 和现有数据卷，不初始化新数据库。

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

它只构建 `HEAD`，不会上传源码或未提交内容；必须先提交本套脚本。GitHub 托管 runner 需要能通过 SSH 访问服务器。

## 更新行为与边界

- 构建阶段旧服务继续运行；切换容器会有短暂中断，不是零停机部署。
- 只替换 app，数据库、Redis、Temporal 和宝塔反代配置保持原样。Compose 基础设施变更需单独审核并部署，不会跟随 push 自动应用。
- 新版本使用自己的启动脚本挂载；服务器已有的配置和 AI 设置仍持久保存在 `deploy/production/config/.env`。
- 发布前用 `pg_dump -Fc` 备份应用数据库到 `backups/`。备份含业务数据，仅保存在服务器，需自行安排异机备份和保留周期。
- 构建失败不切换；应用启动或健康检查失败尝试恢复旧镜像。迁移仍采用现有 `prisma db push`，不加 `--accept-data-loss`。
- **数据库 schema 不会自动还原。** 不兼容 schema 变更可能导致旧镜像也无法运行，届时需要人工处理备份，不能把镜像回退理解为数据库回退。
- 镜像上传包加载后删除；新发布不生成源码 release。运行镜像、数据库备份及发布状态保留，需定期检查磁盘。
- Postiz 使用多阶段构建，运行镜像只复制编译产物、依赖、静态资源和必要配置；仍包含运行所需 JavaScript 和 Prisma schema。
- 启动脚本位于 `.deploy-state/`，删除旧源码前必须确认容器没有指向旧源码的挂载。
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
