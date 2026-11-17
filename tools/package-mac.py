# 职责：在 Windows 上直接重组 macOS ZIP，保留符号链接及可执行权限，避免依赖 Windows 创建符号链接的权限。
import copy
import hashlib
import json
import plistlib
import stat
import struct
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

# 构建只使用 Python 标准库，无需安装第三方 Python 包。
ROOT = Path(__file__).resolve().parent.parent
RUNTIME_VERSION = "40.10.6"
EXPECTED_HASHES = {
    "arm64": "24e3b1a13ff7243f6b9036ebb743b6f62b19e4a925242d27eaa2be90de90a691",
}
# 当前应用启动和运行所需的编译文件，缺少任意文件时不能生成交付。
REQUIRED_APP_FILES = (
    "dist/main.js", "dist/preload.cjs", "dist/renderer.js", "dist/core.js",
    "dist/queue.js", "dist/watcher.js", "dist/api.js", "dist/connection.js",
    "dist/hook.js", "dist/authorization.js", "dist/authorization-store.js", "index.html",
)


def validate_app_files(app_directory: Path):
    """在打包前检查入口及其依赖，避免把不完整构建写入安装包。"""
    for relative_path in REQUIRED_APP_FILES:
        if not (app_directory / relative_path).is_file():
            raise FileNotFoundError(f"应用构建缺少必需文件：{relative_path}")


def write_file(archive: ZipFile, name: str, content: bytes, is_executable: bool = False):
    """写入普通文件，保留 Mac 解压后所需的 Unix 权限。"""
    info = ZipInfo(name)
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | (0o755 if is_executable else 0o644)) << 16
    info.compress_type = ZIP_DEFLATED
    archive.writestr(info, content)


def package(architecture: str):
    """验证官方运行时，添加编译后的应用及首次启动入口。"""
    validate_app_files(ROOT / "desktop")
    runtime = ROOT / "local" / "work" / "electron-archives" / f"electron-v{RUNTIME_VERSION}-darwin-{architecture}.zip"
    if hashlib.sha256(runtime.read_bytes()).hexdigest() != EXPECTED_HASHES[architecture]:
        raise ValueError("官方 Electron 运行时校验失败")
    output = ROOT / "local" / "releases" / f"Codex提醒器-macOS-{architecture}.zip"
    if output.exists():
        raise FileExistsError(f"为避免覆盖已有交付，停止生成：{output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    bundle = "Codex提醒器.app/"
    app_root = bundle + "Contents/Resources/app/"
    with ZipFile(runtime) as source, ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=6) as target:
        for item in source.infolist():
            if not item.filename.startswith("Electron.app/"):
                continue
            if item.filename == "Electron.app/Contents/Resources/default_app.asar":
                continue
            content = source.read(item.filename)
            info = copy.copy(item)
            info.filename = bundle + item.filename[len("Electron.app/"):]
            if item.filename == "Electron.app/Contents/Info.plist":
                settings = plistlib.loads(content)
                settings.update({
                    "CFBundleName": "Codex提醒器",
                    "CFBundleDisplayName": "Codex提醒器",
                    "CFBundleIdentifier": "local.codex.esp32.alert",
                    "CFBundleShortVersionString": "1.0.0",
                    "CFBundleVersion": "1.0.0",
                    "NSBluetoothAlwaysUsageDescription": "连接你的 ESP32 屏幕，在 Codex 本轮结束时显示无声提醒。",
                    "NSBluetoothPeripheralUsageDescription": "通过低功耗蓝牙连接 Codex 提醒器。",
                })
                settings.pop("ElectronAsarIntegrity", None)
                content = plistlib.dumps(settings)
            target.writestr(info, content)
        for path in (ROOT / "desktop" / "dist").glob("*"):
            if path.is_file():
                write_file(target, app_root + "dist/" + path.name, path.read_bytes())
        write_file(target, app_root + "index.html", (ROOT / "desktop" / "index.html").read_bytes())
        write_file(target, app_root + "package.json", json.dumps({"name": "codex-esp32-alert", "version": "1.0.0", "type": "module", "main": "dist/main.js", "description": "Codex 蓝牙屏幕提醒器"}, ensure_ascii=False).encode("utf-8"))
        # 官方运行时经过修改后，需要在目标 Mac 上重新做本地临时签名，无需开发者账号。
        entitlements = plistlib.dumps({
            "com.apple.security.cs.allow-jit": True,
            "com.apple.security.device.bluetooth": True,
        })
        write_file(target, "提醒器权限.plist", entitlements)
        launcher = '''#!/bin/bash
# 职责：首次在本机给提醒器签名并启动，不修改系统安全设置。
set -euo pipefail
cd "$(dirname "$0")"
echo "正在为这份本机应用生成临时签名，无需开发者账号。"
/usr/bin/codesign --force --deep --sign - --entitlements "提醒器权限.plist" "Codex提醒器.app"
echo "正在检查应用及内部组件的签名。"
/usr/bin/codesign --verify --deep --strict --verbose=2 "Codex提醒器.app"
/usr/bin/open "Codex提醒器.app"
'''
        write_file(target, "首次启动.command", launcher.encode("utf-8"), True)
        notes = """职责：说明 macOS 提醒器的首次启动步骤与验证范围。

1. 完整解压本 ZIP，保留 Codex提醒器.app、提醒器权限.plist 和 首次启动.command 在同一目录。
2. 首次运行 首次启动.command，为本机应用做临时签名并打开。
3. 若 macOS 提示来源未知，按系统提示在“隐私与安全性”中允许这份你自行构建的应用；不要关闭系统安全保护。
4. 首次蓝牙权限提示选择允许，确保 ESP32 已通电；设备显示连接码时，输入该码并点击“重新授权设备”，首次无连接码可点击“连接提醒器”。
5. 后续直接打开 Codex提醒器.app。最小化后继续监听，关闭窗口则退出。
6. 本包包含全部运行时，不要求 Mac 安装 Node.js 或 Python。
7. 换电脑前点击“切换到其他电脑”；无法操作旧电脑时，在设备上长按“重新授权”1.2 秒。新电脑输入屏幕上的新连接码并点击“重新授权设备”。提醒及旧电脑未投递队列保留。
8. 连接码用于选择设备，不是加密密码；系统蓝牙权限被禁用时，需在系统设置中允许。

仅支持 Apple 芯片 Mac（arm64），最低 macOS 12.0，不需要 Rosetta。本包不支持 Intel Mac。
此包在 Windows 上生成并检查归档、权限和应用配置；首次启动脚本会在 Mac 本机检查签名，尚未宣称完成 Mac 实机验证。
"""
        write_file(target, "使用说明.txt", notes.encode("utf-8"))
    # 验证应用内容、符号链接和首次启动权限没有在跨平台打包中丢失。
    with ZipFile(runtime) as source, ZipFile(output) as archive:
        original_links = [item for item in source.infolist() if item.filename.startswith("Electron.app/") and stat.S_ISLNK(item.external_attr >> 16)]
        result_links = [item for item in archive.infolist() if stat.S_ISLNK(item.external_attr >> 16)]
        if len(original_links) != len(result_links):
            raise ValueError("符号链接数量不一致")
        for item in original_links:
            renamed = bundle + item.filename[len("Electron.app/"):]
            if archive.read(renamed) != source.read(item.filename):
                raise ValueError("符号链接目标不一致")
        if not archive.getinfo("首次启动.command").external_attr >> 16 & stat.S_IXUSR:
            raise ValueError("首次启动脚本缺少执行权限")
        # 检查实际启动二进制的 CPU 类型，而不是只相信文件名中的 arm64。
        binary = archive.read(bundle + "Contents/MacOS/Electron")
        if struct.unpack_from("<II", binary) != (0xFEEDFACF, 0x0100000C):
            raise ValueError("运行时不是 Apple 芯片原生 arm64 架构")
        for path in (ROOT / "desktop" / "dist").glob("*"):
            if path.is_file() and archive.read(app_root + "dist/" + path.name) != path.read_bytes():
                raise ValueError(f"应用源码归档不一致：{path.name}")
        if archive.read(app_root + "index.html") != (ROOT / "desktop" / "index.html").read_bytes():
            raise ValueError("应用界面归档不一致")
        settings = plistlib.loads(archive.read(bundle + "Contents/Info.plist"))
        if not settings.get("NSBluetoothAlwaysUsageDescription") or not settings.get("NSBluetoothPeripheralUsageDescription"):
            raise ValueError("应用缺少 macOS 蓝牙权限用途声明")
        if archive.testzip() is not None:
            raise ValueError("归档 CRC 校验失败")
    print(f"macOS {architecture} 归档验证通过：{output}")


if __name__ == "__main__":
    for architecture in EXPECTED_HASHES:
        package(architecture)
