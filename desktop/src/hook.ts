// 职责：接收 Codex 正式 Stop Hook，将最小事件原子写入本机收件箱。
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

/** Hook 只读取标准输入，不执行任务内容或修改聊天状态。 */
const main = async (): Promise<void> => {
  const index = process.argv.indexOf('--inbox');
  if (index < 0 || !process.argv[index + 1]) { throw new Error('缺少提醒器收件箱路径'); }
  const inbox = resolve(process.argv[index + 1]);
  /** Stop 包含回答正文，允许长输入；按 UTF-8 解码，避免分块切断中文。 */
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) { input += String(chunk); if (input.length > 16 * 1024 * 1024) { throw new Error('Hook 输入超过 16Mi 字符限制'); } }
  const value = JSON.parse(input);
  if (value.hook_event_name !== 'Stop' || typeof value.session_id !== 'string' || typeof value.turn_id !== 'string') { return; }
  const id = `${value.session_id}:${value.turn_id}`;
  if (id.length > 120 || !/^[A-Za-z0-9:_-]+$/.test(id)) { throw new Error('Hook 事件标识无效'); }
  const title = typeof value.cwd === 'string' ? basename(value.cwd.replace(/\\/g, '/')) : 'Codex 聊天';
  const path = join(inbox, `${createHash('sha256').update(id).digest('hex')}.json`);
  await mkdir(inbox, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ id, title: title || 'Codex 聊天', completedAt: new Date().toISOString() }));
  await rename(temporary, path);
};
void main().catch((error) => { console.error(`提醒投递失败：${String(error)}`); }).finally(() => { process.stdout.write('{}\n'); });
