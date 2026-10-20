花瓣原图下载器首次开源发布。

Windows 10/11 x64 用户请下载下方的 **HuabanOriginalDownloader-v1.1.0-windows-x64.zip**，完整解压后按安装教程操作。GitHub 自动生成的 Source code 是源码，不是可直接运行的下载包。

### 功能

- 整板分页读取、原图下载与标题命名。
- 暂停恢复、已有文件核验、损坏补下、检查新增采集。
- 过期链接刷新与限流退避。
- 尺寸、解码和 SHA-256 核验，CSV/JSON 清单与 ZIP/ZIP64 导出。
- 文件占用导致改名失败时保留原文件，提示重试。

### 使用

1. 解压到固定目录，双击“安装本地引擎.cmd”。
2. 在 Chrome 扩展管理页开启开发者模式，加载其中的 extension 文件夹。
3. 登录花瓣，打开画板，点击插件图标，再点击“读取并下载”。

[安装教程](https://github.com/klaushuanghy/huaban-original-downloader/blob/main/docs/INSTALL.md) · [常见问题](https://github.com/klaushuanghy/huaban-original-downloader/blob/main/docs/FAQ.md)

### 验证范围

Windows + Chrome 实测132条采集全部通过；标题命名后原图校验值保持一致，最终重复核验重新下载0张。12项自动测试通过。Edge提供兼容实现，尚未专项实测。

这是非官方工具，原图指花瓣“查看大图”实际提供的版本，不追溯来源网站；不会处理验证码或绕过访问限制。发行包未做代码签名。源码采用MIT许可，随附组件保留各自许可。

旁边的 .sha256 文件用于核对下载包完整性。
