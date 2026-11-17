# 职责：说明 Codex 蓝牙屏幕提醒器的使用、构建、数据范围和验证边界。

# Codex ESP32 屏幕提醒器

用于微雪 **ESP32-S3-Touch-AMOLED-1.75C** 的无声 Codex 提醒器。Codex 本轮结束后，设备显示中文任务标题和待确认数量，背景缓慢变色；触摸屏幕可确认全部提醒。

电脑端支持 Windows x64 和 Apple 芯片 Mac（arm64、macOS 12+）。ESP32 使用同一份固件，通过低功耗蓝牙连接电脑，同一时刻连接一台电脑。

## 功能

- 监听本机 Codex 主聊天的本轮结束事件，不回放启动前历史、不提醒子代理。
- 电脑断线时保存待投递队列，设备明确回执后才出队。
- 设备独立保存未确认提醒，断电重启后保留。
- 电脑界面提供连接、测试提醒、确认提醒、Hook 配置和重新授权操作。
- 重新授权更换设备连接码与蓝牙地址，旧电脑暂停自动连接，方便切换电脑。

“本轮结束”表示可以查看回答，不表示需求完成或测试通过。

## 连接与换电脑

1. 给 ESP32 供电，开启电脑蓝牙，运行电脑端提醒器。
2. 设备首次未显示连接码时，可直接点击“连接提醒器”。已有六位连接码时，输入屏幕上的码并点击“重新授权设备”。
3. 点击“发送测试提醒”验证；触摸屏幕或点击电脑端确认按钮清除提醒。
4. 换电脑前，在旧电脑点击“切换到其他电脑”；到新电脑输入设备屏幕上的新连接码，再点击“重新授权设备”。
5. 无法操作旧电脑时，在设备上长按“重新授权”1.2 秒，再到新电脑输入新码。

切换保留设备提醒和旧电脑未投递队列，队列仍在原电脑。连接码及蓝牙地址在断电后保留。连接码用于选择设备，不是加密密码；系统禁用蓝牙权限时，仍需在系统设置中允许。无需先在系统蓝牙设置中手动配对。

最小化窗口后继续监听，关闭窗口会退出；项目没有自动配置登录启动。

## 电脑端开发与打包

需要 Node.js 24 及 npm。普通用户运行打包成品时不需要安装 Node.js、Python 或 ESP-IDF。本仓库仅保存源码，不包含本机安装包。

```sh
cd desktop
npm ci
npm test
npm start
```

`npm test` 先编译 TypeScript 再执行测试。只编译可运行 `npm run build`。安装时若跳过了 Electron 安装脚本，可执行 `node node_modules/electron/install.js` 下载运行时。

Windows 打包：`npm run package:win`，输出到 `local/releases/Codex提醒器-win32-x64`。运行时须保留整个目录，不能只复制 EXE。

在 Apple 芯片 Mac 上打包：`npm run package:mac`，输出到 `local/releases`。首次蓝牙权限提示选择允许；如被拒绝，在 macOS 系统设置中恢复权限。此构建命令不包含开发者签名或 Apple 公证。

`tools/package-mac.py` 提供 Windows 上生成 arm64 Mac ZIP 的另一条路径：先构建电脑端，并将该脚本指定版本的官方 Electron Darwin arm64 ZIP 放入 `local/work/electron-archives`。脚本校验运行时哈希，输出到 `local/releases`，保留符号链接和可执行权限，并生成本机临时签名入口 `首次启动.command`。Mac 上完整解压后首次运行该入口，保留同目录的权限文件；后续直接打开应用。来源提示按 macOS“隐私与安全性”指引处理。此方式不需要开发者账号，也不关闭系统安全保护。

## 固件构建

设备配置为 466×466 屏幕、32 MiB Flash、8 MiB PSRAM，使用 ESP-IDF 6.1、微雪 BSP、LVGL 和 NimBLE。固件使用 C，电脑端使用 TypeScript/Electron。

**烧录专用固件会替换设备原应用。请先自行备份整片 Flash，并验证备份完整性。仓库不提供任何设备的原系统备份或出厂配置。**

在已激活 ESP-IDF 的终端中：

```sh
idf.py -C firmware set-target esp32s3
idf.py -C firmware build
idf.py -C firmware -p 实际串口 flash
```

Windows 编译器可能无法正确处理中文或带空格的源码路径。可使用 `tools/build-firmware.ps1` 同步到独立英文目录构建；参数 `ActivationScript` 指向本机 ESP-IDF 激活脚本，`BuildDirectory` 指向独立英文目录。该脚本只复制，不删除其他文件。

烧录地址以构建目录 `flash_args` 为准。提醒状态及设备身份保存在独立 `alertnvs` 分区；项目不修改 eFuse。恢复原系统需使用自己设备的备份，通过 esptool 完整回写并执行 `verify-flash`。备份只能恢复 Flash 内容，不能修复硬件或还原云端状态。

## 数据与隐私

默认监听当前用户 `~/.codex/sessions`，支持通过 `CODEX_HOME` 指定其他目录。提醒只携带事件标识、时间和标题，不发送回答正文，不上传数据。日志格式属于 Codex 内部实现，升级后可能需要适配。

界面“生成 Hook 配置”可生成正式 `Stop` Hook 配置。自行合并到本机 `~/.codex/hooks.json` 并在 Codex 的 Hooks 设置中审阅、信任；程序不会覆盖原配置或修改信任数据库。Windows 和 Mac 应各自在本机生成配置，提醒器仍需运行。

本仓库按文件白名单管理，并显式忽略 `local/`，不包含 Flash 备份、运行日志、聊天记录、设备连接码、本机授权配置、交接记录、安装包或签名私钥。应用状态和待投递队列保存在各电脑的本机应用数据目录。

## 项目目录

公开部分包含 `desktop/src`、`desktop/tests`、`firmware/main`、`firmware/tests`、构建配置、`tools`、README 和第三方许可。

本机资料统一放在 `local/`，不提交 Git：

- `local/backups`：原系统整片备份。
- `local/releases`：Windows、Mac 安装包和固件二进制。
- `local/records`：交接记录、验证报告及内部设计资料。
- `local/config`：归档的本机构建配置。
- `local/work`：工具下载、运行状态、测试记录和临时文件。
- `local/build`：归档的固件构建产物。

本机已有的启动和恢复入口位于 `local/启动提醒器.cmd`、`local/恢复原系统.cmd`，与安装包、备份保持相对路径。恢复脚本仅供对应设备使用，不随公开仓库分发。

`desktop/node_modules`、`desktop/dist` 和 `firmware/managed_components` 是开发工具生成的依赖源码或编译代码，保留在各自工具要求的位置，同样不提交 Git。

## 验证范围

Windows 已验证实际 BLE 投递、离线队列、换码释放、重启保留和成品连接。电脑端 14 项测试、固件状态与身份宿主测试通过。换电脑场景使用同一台 Windows 的隔离授权目录验证，未视作两台实体电脑验收。

Apple 芯片 Mac 包已检查 arm64 架构、应用内容、权限声明、符号链接和归档完整性；真实 Mac 的签名执行、系统蓝牙权限及 Codex 通知链路尚未实测。设备实体触摸确认和长按重新授权也仍需人工验收。

字体与第三方依赖说明见 [第三方说明](THIRD_PARTY_NOTICES.md)。
