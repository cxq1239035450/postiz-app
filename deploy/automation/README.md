# 镜像自动部署

GitHub Actions 从已提交的 HEAD 构建 Docker 镜像，通过 SSH 上传压缩镜像和必要运行配置。服务器校验文件、执行 docker load、切换容器并检查健康状态，不接收仓库源码、不执行构建。镜像压缩包加载后删除，发布失败也尝试清理；断电或强制终止可能遗留临时包。

复用现有 Compose 安装。配置 DEPLOY_HOST、DEPLOY_USER、DEPLOY_SSH_KEY、DEPLOY_KNOWN_HOSTS 四个 Secrets，设置仓库变量 DEPLOY_ENABLED=true。项目服务、构建参数、备份及健康检查由 project.sh 定义。GitHub runner 必须有 Docker、足够构建内存和磁盘，并可通过 SSH 访问服务器。

服务器保留 Compose、私密环境文件、数据卷、备份、运行镜像及 .deploy-state 发布状态。Postiz 启动脚本复制到 .deploy-state，运行不再依赖 releases 源码目录。镜像仍包含运行必需的编译后 JavaScript、依赖和 Prisma schema；这不是代码加密方案。

加载或备份失败不切换服务；健康检查失败尝试恢复旧镜像。数据库 schema 不自动回退。历史镜像、数据库备份需自行制定保留周期。不要执行 docker compose down -v。

在 Linux 执行 python3 deploy/automation/test-deploy.py -v，覆盖成功、启动脚本挂载、校验/加载/备份失败及健康检查失败回退。
