# 花瓣原图下载器

[![Windows build](https://github.com/klaushuanghy/huaban-original-downloader/actions/workflows/build.yml/badge.svg)](https://github.com/klaushuanghy/huaban-original-downloader/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

输入一个花瓣画板链接，把整个画板的原图保存到本地。文件名对应花瓣标题，支持暂停继续、已有文件核验和压缩包导出。

**Windows 10/11 x64 · Chrome 已实测 · Edge 提供兼容实现，暂未专项实测。**

[下载安装包](https://github.com/klaushuanghy/huaban-original-downloader/releases/latest) · [安装教程](docs/INSTALL.md) · [常见问题](docs/FAQ.md) · [开发说明](docs/DEVELOPMENT.md)

## 能做什么

- 分页读取整个画板，核对采集总数，避免只下载当前屏幕中的图片。
- 保存花瓣“查看大图”实际提供的原文件，拒绝缩略图地址，不放大、不重新压缩。
- 按 **`花瓣标题_采集ID.实际格式`** 命名。同名采集通过 ID 区分；完整标题保存在 CSV。
- 下载后逐张核对尺寸、解码和 SHA-256；重复执行会检查已有文件，补齐缺失或损坏项。
- 暂停、继续、刷新过期链接、检查新增采集。下载工作进程独立运行，可关闭任务页。
- 输出 CSV 清单、逐张校验值、JSON 结果和通过完整性检查的 ZIP/ZIP64 压缩包。

这是一款非官方个人工具。原图范围以花瓣实际保存并在大图中提供的版本为准；原始来源网站可能还有其他版本，工具不保证能取得来源站的最高分辨率。

## 三步开始

1. 在 [Releases](https://github.com/klaushuanghy/huaban-original-downloader/releases/latest) 下载 `HuabanOriginalDownloader-v1.1.0-windows-x64.zip`，完整解压到固定文件夹。GitHub 的 **Source code** 是开发用源码，不是可直接运行的下载包。
2. 双击 `安装本地引擎.cmd`。在 Chrome 的 `chrome://extensions` 打开开发者模式，加载解压目录里的 `extension` 文件夹。
3. 登录花瓣，打开画板，点击插件图标，选择保存位置，再点击“读取并下载”。

不需要额外安装 Node.js 或 Python，不需要管理员权限。分步操作、更新和卸载见[安装教程](docs/INSTALL.md)。

## 保存的文件

```text
画板ID_画板名称/
├─ 原图/
│  ├─ 示例标题_1234567890.jpg
│  └─ 未命名采集_1234567891.webp
├─ 采集清单.csv
├─ 校验清单.sha256
├─ 采集元数据.json
├─ 下载核验结果.json
├─ 阅读说明.txt
└─ 画板ID_原图.zip          # 完成后点击“生成压缩包”
```

标题最多保留 60 个 UTF-16 字符（部分 emoji 占两个字符）。Windows 不允许的字符替换为下划线，无标题时使用“未命名采集”。重新核验会把旧版的 ID 文件名更新成标题文件名，保持图片内容。文件被其他程序占用时保留原文件，提示稍后重试。

## 使用中的状态

| 状态 | 怎么处理 |
|---|---|
| 已完成 | 当前清单中的图片全部通过核验，可生成压缩包 |
| 等待恢复 / 访问受限 | 等待限流解除；持续受限时稍后继续 |
| 需要更新链接 | 确认花瓣正常登录，点击“更新清单并继续” |
| 有失败项 / 改名未完成 | 关闭占用文件的程序，重试或重新核验 |

“检查新增采集”会重新读取清单，已有合格文件跳过。画板移除的采集对应的本地文件会保留，不会跟随删除。

## 隐私和权限

插件只申请花瓣网站访问、当前标签操作、本地存储和本地引擎通信权限。登录状态用于在花瓣页面内读取清单；不读取或导出账户 Cookie，不索取密码，不把图片和任务上传到第三方服务。

本地引擎通过 Native Messaging 通信，不开放本地 HTTP 服务。安装仅写入当前用户的 Chrome/Edge 本地连接项，限定扩展 ID `loeddnbbnjnakckbcajdegbdohenaplg`。`app/identity.json` 是固定扩展 ID 所用的**公钥**，不是登录凭据或签名私钥。

本地元数据包含图片签名地址和保存路径，分享时请自行检查；仓库和发行包不包含真实任务、下载图片或登录数据。权限和数据流说明见 [SECURITY.md](SECURITY.md)。

## 验证情况

2026-10-20 在 Windows + Chrome 上完成一次 132 条采集画板实测：完整读取 132 条，下载及核验 132 张，失败 0 张；最后重复核验跳过 132 张、重新下载 0 张。标题命名后，每张图片 SHA-256 与改名前一致。浏览器“查看大图”抽样文件与保存文件的尺寸、SHA-256 一致。

包含 12 项自动测试，覆盖分页清单校验、暂停恢复、损坏文件、过期链接、限流、尺寸不符、ZIP 完整性、标题改名及文件占用、本地连接持续打开时的消息收发。测试边界见 [docs/VALIDATION.md](docs/VALIDATION.md)。

## 从源码构建

需要 Windows x64、Node.js **24.19.0**、pnpm **11.25.0**，以及 Windows 自带的 .NET Framework C# 编译器。

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:public
pnpm build
pnpm test
pnpm package
```

便携目录生成在 `.build/HuabanOriginalDownloader`，发布 ZIP 和 SHA-256 在 `dist/`。GitHub Actions 使用相同流程。构建不会注册本地连接，也不会自动访问花瓣。完整目录和维护步骤见[开发说明](docs/DEVELOPMENT.md)。

## 贡献和许可

欢迎提交复现步骤、修复和兼容性反馈。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，不要在 Issue 中粘贴 Cookie、签名原图地址、个人路径或完整任务文件。

本项目源码采用 [MIT](LICENSE) 许可。Node.js、sharp、libvips 等随发行包分发的组件保留各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。图片版权归原权利人所有；软件许可不授予图片内容的使用权。请只下载你有权访问、保存的内容，并遵守网站规则；工具不处理验证码、不绕过登录或访问限制。
