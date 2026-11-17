# 职责：记录公开源码包含的字体数据来源与第三方依赖许可边界。

## 屏幕字体

`firmware/main/alert_font.c` 是使用 Adobe Source Han Sans CN Normal 生成的 40 像素字体子集，字体对象命名为 `alert_font`，用于固定界面文字。

- 上游：[Adobe Source Han Sans](https://github.com/adobe-fonts/source-han-sans)。
- 源字体：官方 `release` 分支的 `SubsetOTF/CN/SourceHanSansCN-Normal.otf`。
- 许可：SIL Open Font License 1.1，完整版权与许可见 [字体许可](licenses/SourceHanSans-LICENSE.txt)。
- 转换工具：`lv_font_conv`，参数为 `--bpp 4 --size 40 --symbols 本轮结束等待任务查看蓝牙已连接未触摸屏幕确认全部提醒器 --format lvgl --no-compress`，使用上述源字体并输出到 `firmware/main/alert_font.c`。

## 依赖

Electron、TypeScript、ESP-IDF、LVGL、NimBLE、微雪 BSP 及其他依赖由 npm 或 ESP-IDF 组件管理器下载，版本记录在依赖配置及锁文件中；其各自许可证随上游项目提供。分发自行构建的二进制时，应保留对应依赖的许可证和版权声明。

仓库公开不改变第三方组件的许可。本说明不授予超出各自许可证范围的第三方权利。
