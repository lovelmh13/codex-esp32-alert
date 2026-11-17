# 职责：记录公开源码包含的字体数据来源与第三方依赖许可边界。

## 屏幕字体

屏幕使用 Adobe Source Han Sans CN Normal 生成的固定界面字体子集：`firmware/main/alert_font.c` 提供 40 像素标题字体 `alert_font`；`firmware/main/alert_font_small.c` 提供 16 像素字体 `alert_font_small`，覆盖连接状态、连接码、提示和授权按钮的全部固定中文文案。小字号字体的其他字符回退到 LVGL 内置 `lv_font_source_han_sans_sc_16_cjk`；动态任务名中的中文字形范围由这两份小字号字库共同决定。

- 上游：[Adobe Source Han Sans](https://github.com/adobe-fonts/source-han-sans)。
- 源字体：官方 `release` 分支的 `SubsetOTF/CN/SourceHanSansCN-Normal.otf`。
- 许可：SIL Open Font License 1.1，完整版权与许可见 [字体许可](licenses/SourceHanSans-LICENSE.txt)。
- 转换工具：`lv_font_conv`，参数为 `--bpp 4 --size 40 --symbols 本轮结束等待任务查看蓝牙已连接未触摸屏幕确认全部提醒器 --format lvgl --no-compress`，使用上述源字体并输出到 `firmware/main/alert_font.c`。
- 小字号转换工具：`lv_font_conv@1.5.3`，参数为 `--bpp 4 --size 16 --symbols 蓝牙已连接未码首次可不填本轮结束等待任务后将在这里提示触摸屏幕确认全部醒请电脑端器长按重新授权 --format lvgl --no-compress --no-kerning --lv-fallback lv_font_source_han_sans_sc_16_cjk`，使用上述源字体并输出到 `firmware/main/alert_font_small.c`。

## 依赖

Electron、TypeScript、ESP-IDF、LVGL、NimBLE、微雪 BSP 及其他依赖由 npm 或 ESP-IDF 组件管理器下载，版本记录在依赖配置及锁文件中；其各自许可证随上游项目提供。分发自行构建的二进制时，应保留对应依赖的许可证和版权声明。

仓库公开不改变第三方组件的许可。本说明不授予超出各自许可证范围的第三方权利。
