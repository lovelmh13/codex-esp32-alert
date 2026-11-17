// 职责：在电脑上验证固件状态转换、重复过滤和输入长度限制。
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "alert_state.h"

/** 检查提醒累加、确认后重复发送和边界数据。 */
int main(void)
{
    /** 初始状态和用于越界验证的事件标识。 */
    struct alert_state state = {0};
    char oversized_id[122];
    assert(alert_state_add(&state, "event-1", "项目一"));
    assert(state.count == 1);
    assert(!alert_state_add(&state, "event-1", "项目一"));
    assert(alert_state_add(&state, "event-2", "项目二"));
    assert(state.count == 2);
    alert_state_clear(&state);
    assert(state.count == 0);
    assert(!alert_state_add(&state, "event-1", "项目一"));
    assert(strcmp(state.last_id, "event-1") == 0);
    memset(oversized_id, 'a', sizeof(oversized_id) - 1);
    oversized_id[sizeof(oversized_id) - 1] = '\0';
    assert(!alert_state_add(&state, oversized_id, "超长"));
    assert(!alert_state_add(&state, "", "空标识"));
    assert(state.count == 0);
    state.count = 9999;
    assert(alert_state_add(&state, "event-3", "数量上限"));
    assert(state.count == 9999);
    puts("固件状态测试通过");
    return 0;
}
