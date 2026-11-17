// 职责：生成符合BLE静态随机地址规则的设备身份和六位连接码。
#include "alert_identity.h"
#include <string.h>
/** 排除BLE规范禁止的全零或全一随机部分。 */
static bool is_valid_address(const uint8_t address[6])
{
    bool is_zero = (address[5] & 0x3f) == 0;
    bool is_ones = (address[5] & 0x3f) == 0x3f;
    for (unsigned int index = 0; index < 5; index++) {
        is_zero = is_zero && address[index] == 0;
        is_ones = is_ones && address[index] == 0xff;
    }
    return (address[5] & 0xc0) == 0xc0 && !is_zero && !is_ones;
}
/** 身份生成入口。 */
void alert_identity_rotate(struct alert_identity *identity, const uint8_t random_address[6], uint32_t random_code)
{
    uint8_t previous_address[6];
    memcpy(previous_address, identity->address, 6);
    uint32_t code = 100000 + random_code % 900000;
    if (code == identity->code) { code = 100000 + (code - 100000 + 1) % 900000; }
    memmove(identity->address, random_address, 6);
    identity->address[5] |= 0xc0;
    if (!is_valid_address(identity->address)) { identity->address[0] ^= 2; }
    if (memcmp(identity->address, previous_address, 6) == 0) { identity->address[0] ^= 1; }
    if (!is_valid_address(identity->address)) { identity->address[0] ^= 2; }
    identity->code = code;
}
/** 身份校验入口。 */
bool alert_identity_is_valid(const struct alert_identity *identity)
{
    if (identity->code == 0) {
        const uint8_t empty[6] = {0};
        return memcmp(identity->address, empty, 6) == 0;
    }
    return identity->code >= 100000 && identity->code <= 999999 && is_valid_address(identity->address);
}
