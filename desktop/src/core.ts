// 职责：定义跨平台事件与设备协议，供监听器和蓝牙投递复用。
/** 已筛选的主聊天完成事件。 */
export interface Completion {
  /** 由聊天与回合标识组成的唯一 ID。 */
  id: string;
  /** 屏幕展示的任务名称。 */
  title: string;
  /** 完成时间。 */
  completedAt: string;
}
/** 设备返回的投递状态。 */
export interface Receipt {
  /** 最后成功接收的事件 ID。 */
  lastId: string;
  /** 尚未确认的提醒数量。 */
  count: number;
  /** 设备当前界面状态。 */
  state: string;
  /** 新固件提供的连接码；旧固件可以没有该字段。 */
  connectionCode?: string;
}
/** 从会话记录筛选主聊天完成事件。 */
export const createCompletion = (entry: unknown, meta: unknown, startedAt: number): Completion | undefined => {
  if (!entry || typeof entry !== 'object' || !meta || typeof meta !== 'object') { return undefined; }
  /** 日志仅提取事件类型、时间和标识，不使用回答正文。 */
  const record = entry as Record<string, unknown>;
  const session = meta as Record<string, unknown>;
  const payload = record.payload as Record<string, unknown> | undefined;
  if (record.type !== 'event_msg' || payload?.type !== 'task_complete') { return undefined; }
  if (typeof session.id !== 'string' || session.parent_thread_id || (session.source !== null && typeof session.source === 'object')) { return undefined; }
  if (typeof payload.turn_id !== 'string' || !payload.turn_id || typeof record.timestamp !== 'string') { return undefined; }
  /** 完成时间用于排除启动前历史；项目名只保留目录末段。 */
  const time = Date.parse(record.timestamp);
  const project = typeof session.cwd === 'string' ? session.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '';
  if (!Number.isFinite(time) || time < startedAt) { return undefined; }
  return { id: `${session.id}:${payload.turn_id}`, title: project || 'Codex 聊天', completedAt: new Date(time).toISOString() };
};
/** 编码可通过单次 GATT 写入的消息。 */
export const encodeNotice = (event: Completion): Uint8Array => {
  if (!event.id || new TextEncoder().encode(event.id).byteLength > 120) { throw new Error('事件标识长度不合法'); }
  /** 按完整 Unicode 字符截断，避免切断中文或表情。 */
  const characters = Array.from(event.title.replace(/[\u0000-\u001f]/g, ' ').trim() || 'Codex 聊天');
  const encoder = new TextEncoder();
  let bytes = encoder.encode(JSON.stringify({ v: 1, type: 'done', id: event.id, title: characters.join('') }));
  while ((bytes.byteLength > 384 || encoder.encode(characters.join('')).byteLength > 240) && characters.length > 0) {
    characters.pop();
    bytes = encoder.encode(JSON.stringify({ v: 1, type: 'done', id: event.id, title: characters.join('') }));
  }
  return bytes;
};
/** 根据设备回执移除已投递的那一条事件。 */
export const applyReceipt = (queue: Completion[], receipt: Receipt): Completion[] => {
  return queue.filter((event) => event.id !== receipt.lastId);
};
