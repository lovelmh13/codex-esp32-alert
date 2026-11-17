// 职责：定义与硬件无关的提醒状态及重复事件处理接口。
#ifndef CODEX_ALERT_STATE_H
#define CODEX_ALERT_STATE_H
#include <stdbool.h>
#include <stdint.h>

/** 提醒状态：最近 64 个事件用于重连和重复发送去重。 */
struct alert_state {
    /** 尚未触摸确认的提醒数量。 */
    uint32_t count;
    /** 下一条去重记录的位置。 */
    uint32_t next;
    /** 已接收的事件标识。 */
    char recent[64][121];
    /** 最后成功接收的标识，提供给电脑确认投递。 */
    char last_id[121];
    /** 最后一个任务的中文标题，最多 240 个 UTF-8 字节。 */
    char title[241];
};

/** 接收合法的新事件；重复或超限事件返回 false，不累加数量。 */
bool alert_state_add(struct alert_state *state, const char *id, const char *title);
/** 确认全部提醒，保留去重记录。 */
void alert_state_clear(struct alert_state *state);
#endif
