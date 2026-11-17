// 职责：提供 Windows/macOS 共用的 BLE 消息写入和回执通知服务。
#include <assert.h>
#include <string.h>
#include <stdio.h>
#include <stdatomic.h>
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "esp_log.h"
#include "alert_app.h"
/** 服务 9c3b0001-5b6e-4f64-9d8a-1a24e5b6c701；写入和状态特征为 0002/0003。 */
static const ble_uuid128_t service_uuid = BLE_UUID128_INIT(0x01,0xc7,0xb6,0xe5,0x24,0x1a,0x8a,0x9d,0x64,0x4f,0x6e,0x5b,0x01,0x00,0x3b,0x9c);
static const ble_uuid128_t command_uuid = BLE_UUID128_INIT(0x01,0xc7,0xb6,0xe5,0x24,0x1a,0x8a,0x9d,0x64,0x4f,0x6e,0x5b,0x02,0x00,0x3b,0x9c);
static const ble_uuid128_t status_uuid = BLE_UUID128_INIT(0x01,0xc7,0xb6,0xe5,0x24,0x1a,0x8a,0x9d,0x64,0x4f,0x6e,0x5b,0x03,0x00,0x3b,0x9c);
/** 通知句柄与广播地址类型。 */
static uint16_t status_handle;
static uint8_t address_type;
/** 仅由蓝牙任务应用的新身份和切换定时器。 */
static struct alert_identity pending_identity;
static uint16_t active_connection = BLE_HS_CONN_HANDLE_NONE;
static atomic_bool is_switching = false;
static struct ble_npl_callout switch_callout;
static void advertise(void);
static void apply_identity(void);

/** GATT 回调只读快照或将消息入队。 */
static int access_characteristic(uint16_t connection, uint16_t attribute, struct ble_gatt_access_ctxt *context, void *argument)
{
    (void)connection; (void)attribute; (void)argument;
    if (context->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        char status[256];
        alert_get_status(status, sizeof(status));
        return os_mbuf_append(context->om, status, strlen(status)) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (context->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        char message[385];
        uint16_t length = 0;
        if (OS_MBUF_PKTLEN(context->om) > 384 || ble_hs_mbuf_to_flat(context->om, message, 384, &length) != 0) { return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN; }
        return alert_submit_json(message, length) ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    return BLE_ATT_ERR_UNLIKELY;
}
/** 只开放消息写入和状态读取/订阅。 */
static const struct ble_gatt_svc_def services[] = {
    { .type = BLE_GATT_SVC_TYPE_PRIMARY, .uuid = &service_uuid.u,
      .characteristics = (struct ble_gatt_chr_def[]) {
        { .uuid = &command_uuid.u, .access_cb = access_characteristic, .flags = BLE_GATT_CHR_F_WRITE },
        { .uuid = &status_uuid.u, .access_cb = access_characteristic, .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY, .val_handle = &status_handle }, {0} } }, {0}
};
/** 连接失败或断开时恢复广播。 */
static int gap_event(struct ble_gap_event *event, void *argument)
{
    (void)argument;
    switch (event->type) {
        case BLE_GAP_EVENT_CONNECT:
            active_connection = event->connect.status == 0 ? event->connect.conn_handle : BLE_HS_CONN_HANDLE_NONE;
            alert_set_connected(event->connect.status == 0);
            if (event->connect.status != 0 && !atomic_load(&is_switching)) { advertise(); }
            break;
        case BLE_GAP_EVENT_DISCONNECT:
            active_connection = BLE_HS_CONN_HANDLE_NONE;
            alert_set_connected(false);
            if (atomic_load(&is_switching)) { apply_identity(); }
            else { advertise(); }
            break;
        case BLE_GAP_EVENT_ADV_COMPLETE:
            if (!atomic_load(&is_switching)) { advertise(); }
            break;
        default: break;
    }
    return 0;
}
/** UUID 广播包和名称扫描响应分开，避免超过 31 字节。 */
static void advertise(void)
{
    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.uuids128 = (ble_uuid128_t *)&service_uuid;
    fields.num_uuids128 = 1;
    fields.uuids128_is_complete = 1;
    assert(ble_gap_adv_set_fields(&fields) == 0);
    struct ble_hs_adv_fields response = {0};
    const char *name = ble_svc_gap_device_name();
    response.name = (const uint8_t *)name;
    response.name_len = strlen(name);
    response.name_is_complete = 1;
    assert(ble_gap_adv_rsp_set_fields(&response) == 0);
    struct ble_gap_adv_params parameters = {0};
    parameters.conn_mode = BLE_GAP_CONN_MODE_UND;
    parameters.disc_mode = BLE_GAP_DISC_MODE_GEN;
    int result = ble_gap_adv_start(address_type, NULL, BLE_HS_FOREVER, &parameters, gap_event, NULL);
    if (result != 0) { ESP_LOGE("codex_alert", "蓝牙广播失败：%d", result); }
}
/** 控制器同步后生成本机地址并开始广播。 */
static void on_sync(void)
{
    assert(ble_hs_util_ensure_addr(0) == 0);
    assert(ble_hs_id_infer_auto(0, &address_type) == 0);
    apply_identity();
}
/** 旧连接结束后再修改静态地址和名称，避免控制器忙时设置失败。 */
static void apply_identity(void)
{
    // 旧电脑可能在300ms到期前主动断开，提前切换后不再执行旧定时器。
    ble_npl_callout_stop(&switch_callout);
    char name[32] = "Codex-ESP32";
    if (pending_identity.code != 0) {
        assert(ble_hs_id_set_rnd(pending_identity.address) == 0);
        address_type = BLE_OWN_ADDR_RANDOM;
        snprintf(name, sizeof(name), "Codex-ESP32-%06lu", (unsigned long)pending_identity.code);
    }
    assert(ble_svc_gap_device_name_set(name) == 0);
    atomic_store(&is_switching, false);
    advertise();
}
/** 留出状态通知时间后释放旧连接，停止旧广播并应用新身份。 */
static void begin_switch(struct ble_npl_event *event)
{
    (void)event;
    if (!atomic_load(&is_switching)) { return; }
    if (ble_gap_adv_active()) { ble_gap_adv_stop(); }
    if (active_connection != BLE_HS_CONN_HANDLE_NONE) {
        if (ble_gap_terminate(active_connection, BLE_ERR_REM_USER_CONN_TERM) == 0) { return; }
        active_connection = BLE_HS_CONN_HANDLE_NONE;
    }
    apply_identity();
}
/** 应用任务查询切换状态，不重复覆盖尚未应用的身份。 */
bool alert_ble_is_switching(void)
{
    return atomic_load(&is_switching);
}
/** 仅在单独处理任务调用，将控制器操作安排到NimBLE事件队列。 */
void alert_ble_reauthorize(const struct alert_identity *identity)
{
    pending_identity = *identity;
    atomic_store(&is_switching, true);
    ble_npl_callout_reset(&switch_callout, ble_npl_time_ms_to_ticks32(300));
}
/** NimBLE 独立任务。 */
static void host_task(void *argument)
{
    (void)argument;
    nimble_port_run();
    nimble_port_freertos_deinit();
}
/** 应用保存完成后才触发状态通知。 */
void alert_ble_notify(void)
{
    if (status_handle != 0) { ble_gatts_chr_updated(status_handle); }
}
/** 初始化蓝牙和固定 UUID 的 GATT 服务。 */
void alert_ble_start(const struct alert_identity *identity)
{
    // 常规 GATT 通知不逐条输出调试日志，保留警告和错误。
    esp_log_level_set("NimBLE", ESP_LOG_WARN);
    ESP_ERROR_CHECK(nimble_port_init());
    pending_identity = *identity;
    ble_npl_callout_init(&switch_callout, nimble_port_get_dflt_eventq(), begin_switch, NULL);
    ble_svc_gap_init();
    ble_svc_gatt_init();
    assert(ble_gatts_count_cfg(services) == 0);
    assert(ble_gatts_add_svcs(services) == 0);
    assert(ble_svc_gap_device_name_set("Codex-ESP32") == 0);
    ble_hs_cfg.sync_cb = on_sync;
    nimble_port_freertos_init(host_task);
}
