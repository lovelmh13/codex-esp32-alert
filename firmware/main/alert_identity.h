// 职责：定义可持久保存的设备连接码与静态随机蓝牙身份。
#ifndef CODEX_ALERT_IDENTITY_H
#define CODEX_ALERT_IDENTITY_H
#include <stdbool.h>
#include <stdint.h>
/** 独立授权身份；连接码为0时兼容原始名称和地址。 */
struct alert_identity {
    /** NimBLE 使用的小端六字节随机地址。 */
    uint8_t address[6];
    /** 屏幕显示的六位连接码。 */
    uint32_t code;
};
/** 根据随机输入生成新身份，确保地址和连接码均与原身份不同。 */
void alert_identity_rotate(struct alert_identity *identity, const uint8_t random_address[6], uint32_t random_code);
/** 验证从NVS读回的身份，允许全零的首次兼容状态。 */
bool alert_identity_is_valid(const struct alert_identity *identity);
#endif
