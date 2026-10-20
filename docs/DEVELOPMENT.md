# 开发与发布

## 环境

Windows x64，Node.js 24.19.0，pnpm 11.25.0。Node 的版本由 `.node-version` 固定；依赖由 `pnpm-lock.yaml` 固定。构建使用 Windows .NET Framework 4.x 的 `csc.exe`，不依赖 Visual Studio 或另装 Python。

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:public
pnpm build
pnpm test
pnpm package
```

依赖安装不执行包的安装脚本，sharp 使用 Windows 预编译组件。构建会检查 sharp 能否实际处理图片。

## 代码目录

| 目录 | 作用 |
|---|---|
| `extension/` | Manifest V3 插件、分页清单读取、中文任务页 |
| `app/common.cjs` | 输入校验、原图地址与文件名规则 |
| `app/service.cjs` | 清单提交、任务和本地操作 |
| `app/worker.cjs` | 下载、恢复、尺寸/解码/校验值检查、标题改名 |
| `app/package.cjs` | 原图 ZIP 流式生成与 CRC 检查 |
| `app/native-host.cjs` | Native Messaging 消息处理 |
| `app/Launcher.cs` | Windows 安装注册、目录选择、二进制消息转发 |
| `tests/` | 无真实网络请求的核心行为和启动器测试 |
| `scripts/` | 构建、测试、分发打包与公开文件检查 |

## 数据流

```text
已登录的花瓣标签页 → 插件读取分页清单 → Native Messaging
→ 本地清单校验 → 独立下载进程 → 原图文件、CSV、SHA-256、JSON、ZIP
```

浏览器内的同源请求使用现有登录状态；不把 Cookie 发给本地引擎。图片原图地址临时签名会到期，刷新必须经过正常登录的花瓣页面。

## 本地调试

`pnpm build` 生成 `.build/HuabanOriginalDownloader`。在这个目录运行安装脚本，并加载它的 `extension`；无需改变真实浏览器配置文件或导出 Cookie。构建本身不安装注册项。

测试使用独立的临时任务目录、微型图片和模拟传输；不需要真实花瓣账号，不上传或下载用户图片。测试包含实际编译的启动器与 Node 子进程，验证输入保持打开时连续请求也能返回。

修改后重新构建，再重新注册新的输出路径、重载插件。重新构建会替换本项目固定的 `.build/HuabanOriginalDownloader` 目录，开发期间先暂停任务并备份测试数据。用户应从 `dist` 发布包安装到固定目录。

## 扩展 ID 与本地连接

`app/identity.json` 和 `extension/manifest.json` 的公钥应保持一致。它们固定扩展 ID，方便 Chrome/Edge 的 Native Messaging 白名单匹配。公钥用于固定开发者模式扩展 ID，不是私钥，不提供官方商店签名。

若维护独立分支并更改公钥，应同时更新扩展 ID 和安装生成的 `allowed_origins`；不要放宽成任意扩展。原图允许域名、间隔和重试规则位于 `app/config.json`。

## 发布

1. 同步修改 `package.json`、`app/config.json`、`extension/manifest.json`、帮助页版本和 `CHANGELOG.md`。
2. 从干净源码执行完整构建、12项测试和 `check:public`。
3. 执行 `pnpm package`，得到 ZIP 和 SHA-256；打包会排除 `state`、`Downloads` 及机器专属本地连接文件。
4. 在 GitHub 创建版本标签和 Release，上传 `dist` 中的 ZIP 和 `.sha256`，写明验证范围。

CI 在 main 提交、Pull Request 和手动触发时执行相同的构建、测试、打包，上传构建产物。初次真实画板验收不能替代以后的接口兼容测试。Windows 发行包未做代码签名，也未提交浏览器扩展商店。
