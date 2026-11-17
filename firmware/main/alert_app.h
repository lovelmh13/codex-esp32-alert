// 职责：声明蓝牙、USB 和界面共用的应用入口。
#ifndef CODEX_ALERT_APP_H
#define CODEX_ALERT_APP_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "alert_identity.h"
/** 将一条完整 JSON 放入串行队列，队满返回 false。 */
bool alert_submit_json(const char *message, size_t length);
/** 读取线程安全的 JSON 状态。 */
void alert_get_status(char *buffer, size_t capacity);
/** 更新蓝牙连接状态。 */
void alert_set_connected(bool is_connected);
/** 初始化 GATT 服务。 */
void alert_ble_start(const struct alert_identity *identity);
/** 当前是否正在等待旧连接断开并更换身份。 */
bool alert_ble_is_switching(void);
/** 在通知旧客户端后，异步更换广播身份。 */
void alert_ble_reauthorize(const struct alert_identity *identity);
/** 通知订阅者读取最新状态。 */
void alert_ble_notify(void);
/** 初始化屏幕和触摸。 */
void alert_ui_start(void);
/** 刷新界面，内部处理 LVGL 锁。 */
void alert_ui_render(uint32_t count, const char *title, bool is_connected, uint32_t connection_code);
#endif
