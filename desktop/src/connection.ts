// 职责：确保 GATT 初始化中途失败时释放连接，使下一次重连可以重试。
/** 初始化需要的最小 GATT 连接接口。 */
export interface RecoverableGatt {
  /** 当前底层连接状态。 */
  connected: boolean;
  /** 断开失败或不完整的连接。 */
  disconnect: () => void;
}
/** 初始化外设；初始化失败必须释放已经建立的底层连接。 */
export const initializeConnection = async (gatt: RecoverableGatt, initialize: () => Promise<void>): Promise<void> => {
  try { await initialize(); }
  catch (error) {
    if (gatt.connected) { gatt.disconnect(); }
    throw error;
  }
};
