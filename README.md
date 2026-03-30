# Coder 简体中文语言包

这是一个面向 Coder 的简体中文语言包。它通过“外部运行时脚本 + locale 覆盖层”的方式工作，因此不会改动上游 Coder 镜像，也不会破坏原有文件结构。

## 支持版本

- 支持的 Coder 版本：`2.31.6`
- 支持的完整构建版本：`v2.31.6+f765029`
- 支持的上游提交：`f7650296ceb9b020c79cd525ac7bd3c7f252ae1d`

本项目刻意采用严格的版本锁定策略。低于或高于该版本的 Coder 都不在支持范围内；如果安装脚本检测到的版本不是精确的 `2.31.6`，会在做出任何修改前直接停止。若能读取到上游构建元信息和提交哈希，安装器也会一并校验是否与上述受支持版本完全一致。

## 这个包会做什么

- 将翻译资源安装到独立目录，而不是直接修改 Coder 容器或二进制文件。
- 通过 nginx 的 `sub_filter` 钩子注入运行时脚本。
- 通过单独的静态资源路由提供 locale JSON 和运行时 JavaScript。
- 在修改目标 nginx 配置前自动写入备份。
- 只有在配置补丁成功后才重新加载 nginx。

## 安装

推荐方式是直接克隆项目仓库，然后在仓库目录里执行安装器：

```bash
git clone https://github.com/AIALRA-0/Coder-Simplified-Chinese.git
cd Coder-Simplified-Chinese
sudo ./install.sh
```

如果 nginx 自动检测出了多个候选配置文件，或者你希望显式指定部署参数，请直接在部署命令里传入：

```bash
git clone https://github.com/AIALRA-0/Coder-Simplified-Chinese.git
cd Coder-Simplified-Chinese
sudo ./install.sh --nginx-conf /etc/nginx/conf.d/coder.conf
```

## 安装前提

- 一个放在 nginx 反向代理后的 Coder 部署
- `python3`
- 引导安装脚本需要的 `curl` 和 `tar`
- 执行最终安装步骤所需的 root 权限
- 一个已经安装完成、并且版本号为 `2.31.6` 的 Coder 实例

## 部署脚本的行为

安装器会按如下顺序执行：

1. 优先从正在运行的 `coder/coder` 容器检测 Coder 版本；如果没找到容器，则尝试从本机 `coder` 二进制读取版本。
2. 若检测到的版本不是精确的 `2.31.6`，立即终止。
3. 若未传入 `--nginx-conf`，则自动寻找为 Coder 提供反向代理的 nginx 配置文件。
4. 默认将资源安装到 `/opt/coder-simplified-chinese/i18n`。
5. 向 nginx 配置中插入两段受管理的配置块：
   一段是 server 级别的资源路由暴露配置，另一段是 `location /` 内的运行时注入配置。
6. 在补丁 nginx 配置前写入带时间戳的备份文件。
7. 执行 nginx 配置校验并重新加载 nginx。

## 默认路径

- 资源安装根目录：`/opt/coder-simplified-chinese`
- 注入资源访问路径：`/__coder-sc/`

## 常用参数

```bash
sudo ./scripts/deploy.sh --nginx-conf /etc/nginx/conf.d/coder.conf
sudo ./scripts/deploy.sh --install-root /srv/coder-simplified-chinese
sudo ./scripts/deploy.sh --coder-container coder
sudo ./scripts/deploy.sh --skip-reload
./scripts/deploy.sh --dry-run --nginx-conf /etc/nginx/conf.d/coder.conf
```

## 仓库结构

```text
assets/i18n/
  coder-i18n-runtime.js
  coder-locales/
    en-US.json
    zh-CN.json
install.sh
manifest.env
scripts/
  deploy.sh
  patch_nginx_conf.py
  sync-from-source.sh
  validate.sh
```

## 校验

执行：

```bash
./scripts/validate.sh
```

该脚本默认会检查 JSON 语法、JavaScript 语法、Shell 语法和 Python 语法。

如果你还想顺带验证部署补丁流程，可以显式传入一个 nginx 配置路径：

```bash
VALIDATE_NGINX_CONF=/etc/nginx/conf.d/coder.conf ./scripts/validate.sh
```

## 同步最新资源

如果你在源环境里更新了翻译内容，可以用下面的命令重新同步仓库内资源：

```bash
./scripts/sync-from-source.sh /path/to/source/i18n
```

同步后请再次执行：

```bash
./scripts/validate.sh
```

## 回滚

- 恢复 `deploy.sh` 自动生成的 nginx 备份文件。
- 删除安装后的资源目录，通常是 `/opt/coder-simplified-chinese`。
- 再次重新加载 nginx。

由于这个包只注入外部静态资源和受 nginx 管理的配置块，因此它不会修改上游 Coder 镜像，也不会直接改写 Coder 应用文件。
