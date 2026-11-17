// 职责：串行处理 USB/BLE 消息，在独立分区保存待确认提醒。
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdatomic.h>
#include <assert.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "cJSON.h"
#include "esp_log.h"
#include "esp_random.h"
#include "alert_state.h"
#include "alert_app.h"

/** 队列帧上限与电脑单次 GATT 写入一致。 */
struct alert_frame { char json[385]; };
/** 状态、队列、互斥锁、独立存储和连接标志。 */
static struct alert_state state;
/** 与提醒内容分开持久保存的蓝牙授权身份。 */
static struct alert_identity identity;
static QueueHandle_t messages;
static SemaphoreHandle_t state_mutex;
static nvs_handle_t storage;
static atomic_bool is_connected = false;

/** 拒绝嵌入空字节、超长输入和无法入队的消息。 */
bool alert_submit_json(const char *message, size_t length)
{
    if (length == 0 || length > 384 || memchr(message, '\0', length) != NULL) { return false; }
    struct alert_frame frame = {0};
    memcpy(frame.json, message, length);
    return xQueueSend(messages, &frame, 0) == pdTRUE;
}

/** 返回纯状态快照，不暴露原系统配置。 */
void alert_get_status(char *buffer, size_t capacity)
{
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    char code[7] = "";
    if (identity.code != 0) { snprintf(code, sizeof(code), "%06lu", (unsigned long)(identity.code % 1000000)); }
    snprintf(buffer, capacity, "{\"v\":1,\"count\":%lu,\"lastId\":\"%s\",\"state\":\"%s\",\"connected\":%s,\"connectionCode\":\"%s\"}",
             (unsigned long)state.count, state.last_id, state.count > 0 ? "alert" : "idle",
             atomic_load(&is_connected) ? "true" : "false", code);
    xSemaphoreGive(state_mutex);
}

/** 蓝牙任务只更新标志，屏幕刷新仍交由应用队列。 */
void alert_set_connected(bool connected)
{
    atomic_store(&is_connected, connected);
    const char *message = "{\"v\":1,\"type\":\"status\"}";
    alert_submit_json(message, strlen(message));
}

/** 限制标识字符，确保回执 JSON 不会被引号或控制字符破坏。 */
static bool is_valid_id(const char *id)
{
    if (id == NULL || id[0] == '\0' || strlen(id) > 120) { return false; }
    for (size_t index = 0; id[index] != '\0'; index++) {
        char character = id[index];
        if (!((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
              (character >= '0' && character <= '9') || character == ':' || character == '-' || character == '_')) { return false; }
    }
    return true;
}

/** 保存失败则回滚内存，避免确认尚未持久写入的通知。 */
static void process_message(const char *message)
{
    cJSON *document = cJSON_ParseWithOpts(message, NULL, true);
    if (document == NULL) { return; }
    const cJSON *version = cJSON_GetObjectItemCaseSensitive(document, "v");
    const cJSON *type = cJSON_GetObjectItemCaseSensitive(document, "type");
    if (!cJSON_IsNumber(version) || version->valuedouble != 1 || !cJSON_IsString(type)) { cJSON_Delete(document); return; }
    bool has_change = false;
    bool has_new_identity = false;
    struct alert_state *previous = malloc(sizeof(state));
    if (previous == NULL) { cJSON_Delete(document); return; }
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    memcpy(previous, &state, sizeof(state));
    if (strcmp(type->valuestring, "done") == 0) {
        const cJSON *id = cJSON_GetObjectItemCaseSensitive(document, "id");
        const cJSON *title = cJSON_GetObjectItemCaseSensitive(document, "title");
        if (cJSON_IsString(id) && cJSON_IsString(title) && is_valid_id(id->valuestring)) {
            has_change = alert_state_add(&state, id->valuestring, title->valuestring);
            has_change = has_change || strcmp(previous->last_id, state.last_id) != 0;
        }
    } else if (strcmp(type->valuestring, "clear") == 0) {
        has_change = state.count != 0;
        alert_state_clear(&state);
    } else if (strcmp(type->valuestring, "reauthorize") == 0 && !alert_ble_is_switching()) {
        // 先保存新身份，再切换广播；不清除待确认提醒或原系统数据。
        struct alert_identity next_identity = identity;
        uint8_t random_address[6];
        esp_fill_random(random_address, sizeof(random_address));
        alert_identity_rotate(&next_identity, random_address, esp_random());
        if (nvs_set_blob(storage, "identityv1", &next_identity, sizeof(next_identity)) == ESP_OK && nvs_commit(storage) == ESP_OK) {
            identity = next_identity;
            has_new_identity = true;
        } else { ESP_LOGE("codex_alert", "保存蓝牙身份失败，保留原连接"); }
    }
    if (has_change && (nvs_set_blob(storage, "statev1", &state, sizeof(state)) != ESP_OK || nvs_commit(storage) != ESP_OK)) {
        memcpy(&state, previous, sizeof(state));
        ESP_LOGE("codex_alert", "保存提醒失败，未确认本次投递");
    }
    uint32_t count = state.count;
    uint32_t connection_code = identity.code;
    struct alert_identity next_identity = identity;
    char title[241];
    memcpy(title, state.title, sizeof(title));
    xSemaphoreGive(state_mutex);
    free(previous);
    cJSON_Delete(document);
    alert_ui_render(count, title, atomic_load(&is_connected), connection_code);
    char status[256];
    alert_get_status(status, sizeof(status));
    printf("CODEX_STATUS %s\n", status);
    fflush(stdout);
    alert_ble_notify();
    if (has_new_identity) { alert_ble_reauthorize(&next_identity); }
}

/** 顺序执行全部状态修改。 */
static void message_task(void *argument)
{
    (void)argument;
    struct alert_frame frame;
    while (true) {
        if (xQueueReceive(messages, &frame, portMAX_DELAY) == pdTRUE) { process_message(frame.json); }
    }
}

/** USB 换行分帧，整条丢弃超长输入。 */
static void usb_task(void *argument)
{
    (void)argument;
    char message[385];
    size_t length = 0;
    bool is_overflow = false;
    while (true) {
        char character;
        if (usb_serial_jtag_read_bytes(&character, 1, pdMS_TO_TICKS(100)) <= 0) { continue; }
        if (character == '\n') {
            if (!is_overflow && length > 0) { alert_submit_json(message, length); }
            length = 0;
            is_overflow = false;
        } else if (!is_overflow) {
            if (length < 384) { message[length++] = character; } else { is_overflow = true; }
        }
    }
}

/** 只初始化新分区，保留原系统 NVS 数据。 */
void app_main(void)
{
    ESP_ERROR_CHECK(nvs_flash_init_partition("alertnvs"));
    ESP_ERROR_CHECK(nvs_open_from_partition("alertnvs", "codex", NVS_READWRITE, &storage));
    size_t size = sizeof(state);
    esp_err_t read_result = nvs_get_blob(storage, "statev1", &state, &size);
    if (read_result != ESP_OK || size != sizeof(state) || state.count > 9999 || state.next >= 64) { memset(&state, 0, sizeof(state)); }
    state.last_id[120] = '\0';
    state.title[240] = '\0';
    for (unsigned int index = 0; index < 64; index++) { state.recent[index][120] = '\0'; }
    size = sizeof(identity);
    if (nvs_get_blob(storage, "identityv1", &identity, &size) != ESP_OK || size != sizeof(identity) || !alert_identity_is_valid(&identity)) { memset(&identity, 0, sizeof(identity)); }
    state_mutex = xSemaphoreCreateMutex();
    messages = xQueueCreate(16, sizeof(struct alert_frame));
    assert(state_mutex != NULL && messages != NULL);
    alert_ui_start();
    alert_ui_render(state.count, state.title, false, identity.code);
    usb_serial_jtag_driver_config_t usb_config = { .tx_buffer_size = 2048, .rx_buffer_size = 2048 };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb_config));
    // 标准输出也使用同一中断驱动，避免与 USB 收发队列直接争用硬件 FIFO。
    usb_serial_jtag_vfs_use_driver();
    alert_ble_start(&identity);
    xTaskCreate(message_task, "alert_messages", 8192, NULL, 5, NULL);
    xTaskCreate(usb_task, "alert_usb", 4096, NULL, 4, NULL);
    ESP_LOGI("codex_alert", "Codex 提醒器已启动，屏幕触摸与蓝牙服务已初始化");
}
