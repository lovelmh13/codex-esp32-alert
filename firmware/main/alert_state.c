// 职责：实现提醒数量和去重规则，保持可独立于 ESP32 测试。
#include "alert_state.h"
#include <string.h>

/** 接收一条提醒。 */
bool alert_state_add(struct alert_state *state, const char *id, const char *title)
{
    if (state == NULL || id == NULL || title == NULL || id[0] == '\0' ||
        strlen(id) > 120 || strlen(title) > 240) {
        return false;
    }
    /** 重复发送仍更新回执标识，防止电脑因丢失上次回执无限重发。 */
    for (unsigned int index = 0; index < 64; index++) {
        if (strcmp(state->recent[index], id) == 0) {
            memcpy(state->last_id, id, strlen(id) + 1);
            return false;
        }
    }
    memcpy(state->recent[state->next % 64], id, strlen(id) + 1);
    state->next = (state->next + 1) % 64;
    memcpy(state->last_id, id, strlen(id) + 1);
    memcpy(state->title, title, strlen(title) + 1);
    if (state->count < 9999) {
        state->count++;
    }
    return true;
}

/** 清除等待确认数量。 */
void alert_state_clear(struct alert_state *state)
{
    if (state != NULL) {
        state->count = 0;
    }
}
