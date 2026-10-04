# 通用 GitHub → 服务器自动部署模板

适用：已经 Docker 化、由 Docker Compose 管理的单台 Linux 服务器应用。支持 Next.js、Vue/Vite、Node、Python、Java 等技术栈；语言差异交给项目自己的 Dockerfile。不是任意源码直接上传就能运行，也不是 Kubernetes 或多台服务器的发布系统。

## 每个新项目只需替换配置

复制以下文件到新仓库，目录结构保持一致：

```text
.github/workflows/deploy-production.yml
deploy/automation/publish.sh      # 通用：打包提交、SSH 验证、上传
deploy/automation/deploy.sh       # 通用：构建、切换、检查、失败回退
deploy/automation/project.sh     # 项目适配：每个项目修改这个文件
```

使用 `examples/project.sh` 替换 `project.sh`，再填自己的服务名、Compose 路径、Dockerfile、镜像名和健康检查 URL。本仓库的 `project.sh` 是 Postiz 示例，包含 PostgreSQL 备份和额外接口检查。

工作流中 `DEPLOY_ROOT`、`DEPLOY_PUBLIC_URL` 的默认值是本项目地址，**复制到其他项目时必须改掉或设置对应仓库变量**。建议新项目删除这两个默认值，要求显式配置。并发组已经按 GitHub 仓库隔离；服务器端另有目录锁，防止同时部署。

每个项目使用不同的服务器根目录、Compose `name`、镜像名和本机端口，防止操作到另一个项目。

## 首次部署前提

1. 项目提供可构建的 Dockerfile、生产 Compose 文件，app 服务包含真正检查服务可用性的 `healthcheck`。
2. 在服务器上初始化一次服务和环境变量，验证 `docker compose up -d` 可用。模板负责后续更新，不创建域名、SSL、数据库账号或初始管理员。
3. 配置下表中的 GitHub Actions Secrets 与 Variables。端口和服务器路径每个项目独立配置。
4. 保护部署分支，设置 `DEPLOY_ENABLED=true`，推送后在 Actions 查看执行日志。

在仓库 Settings → Secrets and variables → Actions 中填写：

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| Variable | `DEPLOY_ENABLED` | 配置就绪后填 `true` |
| Variable | `DEPLOY_BRANCH` | 生产分支，例如 `main` |
| Variable | `DEPLOY_ROOT` | 已初始化的服务器目录，例如 `/opt/myapp` |
| Variable | `DEPLOY_PUBLIC_URL` | 公网地址，例如 `https://app.example.com` |
| Variable | `DEPLOY_PORT` | SSH 端口，默认 `22` |
| Secret | `DEPLOY_HOST` | 服务器 IP 或 SSH 主机名 |
| Secret | `DEPLOY_USER` | 有目录读写和 Docker 操作权限的部署用户 |
| Secret | `DEPLOY_SSH_KEY` | 专用部署 SSH 私钥 |
| Secret | `DEPLOY_KNOWN_HOSTS` | 核实过的 SSH 主机公钥记录 |

前两个变量必须放在仓库级，不能只放在 Environment 中。工作流使用 `production` Environment，可按需设置分支限制和人工审批。

SSH 密钥需一次性配置：公钥放到服务器部署用户的 `~/.ssh/authorized_keys`，私钥放 GitHub Secret。服务器 Docker 权限接近管理员权限，只给可信部署分支使用。`DEPLOY_KNOWN_HOSTS` 应从已验证的服务器终端读取 `/etc/ssh/ssh_host_ed25519_key.pub` 并核对指纹，格式为 `主机名 ssh-ed25519 AAAA...`，非默认端口用 `[主机名]:端口`，不能关闭主机验证。

服务器需要 Docker Compose v2+、Python3、curl、flock 和 Bash。生产根目录已有 `project.sh` 指定的 Compose 文件、环境文件及运行中的目标容器。每次构建的 Dockerfile 和项目适配配置来自提交；服务器的基础 Compose 不会被自动覆盖。

示例 Node 服务的 Compose 约定（生产镜像应提供 `/health` 接口）：

```yaml
name: myapp
services:
  web:
    image: myapp-initial:latest
    restart: unless-stopped
    ports:
      - '127.0.0.1:4100:3000'
    env_file: .env
    healthcheck:
      test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 30s
```

Vue 静态站通常用 Nginx 镜像及 wget 检查首页；Python、Java 使用各自运行时或镜像内已有工具检查 `/health`。不要把开发环境源码目录挂载到容器中覆盖镜像代码，否则替换镜像不会更新运行的代码。

## 两个可选项目扩展点

- `before_switch()`：新镜像构建完成、替换旧容器前运行。适合数据库备份和发布前检查；命令失败会停止发布。数据库迁移应采用项目自己的兼容迁移方案。
- `verify_app override文件`：容器自身 healthcheck 已健康后额外检查。可通过 `"${base[@]}" -f "$1" exec -T "$APP_SERVICE" ...` 调用容器内检测。

脚本为扩展点提供 `root`、`source_dir`、`prod`、`release`、`current`（当前 Compose 命令数组）、`base`（基础 Compose 命令数组）。不要在钩子中输出环境变量密钥。

默认只更新一个服务。前后端分成多个镜像、有复杂迁移顺序或滚动更新需求时，需要扩展发布模型，不能简单循环该脚本并假设具有事务性。

## 固定规则

只发布已提交的 HEAD；服务器保留环境文件和数据卷；构建失败不影响旧实例；切换失败尝试恢复旧镜像；数据库不自动还原。单容器切换有短暂中断。SSH 连接中断或进程被强制终止时仍需检查日志与容器实际状态，不能保证所有故障都能自动恢复。

后续人工操作 Compose 时必须携带 `.deploy-state/active.json`，以免重新使用基础文件的旧镜像。日志、备份、历史镜像与 release 保留在服务器，需自行制定清理和异机备份策略。

将 `/incoming/`、`/releases/`、`/backups/`、`/.deploy-state/` 加入项目 `.gitignore` 和 `.dockerignore`，不要提交环境文件、SSH 私钥或数据库备份。Windows 开发环境为 `.sh` 设置 Git 属性 `text eol=lf`。

本地模拟测试：`python3 deploy/automation/test-deploy.py -v`；仅用替身命令测试流程决策，不连接生产服务器。Windows 上可用 `TEST_BASH` 指定 Git Bash 路径。上线前仍需实际检查 Docker 构建、SSH 和项目健康检查。

官方参考：[GitHub 工作流语法](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)、[Secrets 配置](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)。
