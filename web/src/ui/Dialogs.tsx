import { useState } from 'react';
import { useStore } from '../store.ts';
import { Settings } from './Settings.tsx';

export function Toast() {
  const t = useStore(s => s.toast);
  const [last, setLast] = useState(t);
  if (t && t !== last) setLast(t);
  const shown = t ?? last;
  return (
    <div className={`toast ${t ? 'is-show' : ''} ${shown?.err ? 'is-err' : ''}`} role="status" aria-live="polite">
      <span>{shown?.text}</span>
      {shown?.action && <button type="button" onClick={() => { useStore.setState({ toast: null }); shown.action!.fn(); }}>{shown.action.label}</button>}
    </div>
  );
}

export function Dialogs() {
  const dialog = useStore(s => s.dialog);
  if (!dialog) return null;
  const close = () => useStore.setState({ dialog: null });
  return (
    <div className="overlay" onPointerDown={e => { if (e.target === e.currentTarget) close(); }} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
      {dialog === 'settings' ? <Settings close={close} /> : <Keys close={close} />}
    </div>
  );
}

const KEYS: [string, [string, string][]][] = [
  ['鼠标与触控板', [['拖动节点', '左键拖'], ['框选', '左键拖空白'], ['拉出连线', '拖 + 手柄'], ['平移画布', '右键 / 中键 / 空格拖'], ['平移画布', '滚轮'], ['缩放', 'Ctrl + 滚轮'], ['添加节点', '双击空白'], ['菜单', '右键单击'], ['加选 / 减选', 'Shift + 单击'], ['复制一份（拖出副本）', 'Alt + 拖动'], ['断开连线', '鼠标移到线上点 ×'], ['拖动时不吸附', '按住 Ctrl'], ['调整大小', '拖右下角弧线'], ['移动整个分区', '拖分区的标题栏'], ['放入图片', '把图片拖进画布'], ['导入风格参考', '拖入 .naiv4vibe 文件']]],
  ['键盘', [['运行选中的节点', 'Enter'], ['工具节点的提示词里换行', 'Shift + Enter'], ['删除', 'Delete'], ['撤销 / 重做', 'Ctrl+Z / Ctrl+Shift+Z'], ['原地复制一份', 'Ctrl+D'], ['复制到别的画布', '右键节点 → 复制到别的画布，再到空白处右键粘贴'], ['粘贴图片（选中图片节点时替换）', 'Ctrl+V'], ['全选', 'Ctrl+A'], ['把选中的节点框成分区', 'Ctrl+G'], ['切换历史图', '← / →'], ['隐藏生图节点的底栏', 'H'], ['展开 / 收起参数', 'P'], ['适配全部节点', 'Shift+1'], ['搜索节点', 'Ctrl+F'], ['本说明', '?'], ['关闭菜单 / 取消选择', 'Esc']]],
];
function Keys({ close }: { close: () => void }) {
  return (
    <div className="dialog" role="dialog" aria-label="快捷键">
      <h2>操作方式<button type="button" className="x-btn" aria-label="关闭" onClick={close}>×</button></h2>
      <div className="kgrid">
        {KEYS.map(([h, rows]) => [<h3 key={h}>{h}</h3>, ...rows.map(([a, b]) => <div key={h + a + b} className="kr"><span>{a}</span><b>{b}</b></div>)])}
      </div>
    </div>
  );
}
