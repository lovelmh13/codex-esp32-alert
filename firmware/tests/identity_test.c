// 职责：验证重新授权确实改变身份，且生成有效的BLE地址和连接码。
#include <assert.h>
#include <string.h>
#include <stdio.h>
#include "alert_identity.h"
/** 检查首次状态、重复随机输入以及损坏身份。 */
int main(void)
{
    /** 默认兼容状态与模拟随机输入。 */
    struct alert_identity identity = {0};
    const uint8_t random_address[6] = {1,2,3,4,5,6};
    assert(alert_identity_is_valid(&identity));
    alert_identity_rotate(&identity, random_address, 12345);
    assert(identity.code >= 100000 && identity.code <= 999999);
    assert((identity.address[5] & 0xc0) == 0xc0);
    assert(alert_identity_is_valid(&identity));
    struct alert_identity previous = identity;
    alert_identity_rotate(&identity, random_address, 12345);
    assert(identity.code != previous.code);
    assert(memcmp(identity.address, previous.address, 6) != 0);
    identity.code = 12;
    assert(!alert_identity_is_valid(&identity));
    // 非法随机部分修正后仍必须与旧地址不同。
    const uint8_t empty_address[6] = {0};
    struct alert_identity boundary = {{2,0,0,0,0,0xc0},123456};
    previous = boundary;
    alert_identity_rotate(&boundary, empty_address, 12345);
    assert(alert_identity_is_valid(&boundary));
    assert(memcmp(boundary.address, previous.address, 6) != 0);
    puts("蓝牙身份测试通过");
    return 0;
}
