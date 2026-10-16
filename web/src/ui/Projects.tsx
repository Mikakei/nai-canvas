import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.ts';
import { createProject, deleteProject, duplicateProject, exportProject, importProject, refreshProjects, renameProject, switchProject } from '../projects.ts';
import { pickFiles } from '../images.ts';

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
};

/** 顶栏左侧的画布名：点开切换画布，双击直接改名 */
export function ProjectSwitcher() {
  const project = useStore(s => s.project), projects = useStore(s => s.projects);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    refreshProjects();
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key); };
  }, [open]);

  // 回车、Esc 之后输入框消失时还可能再触发一次失焦，只认第一次
  const ended = useRef(false);
  const startRename = () => { setOpen(false); setName(project?.name ?? ''); ended.current = false; setEditing(true); };
  const finish = (save: boolean) => { if (ended.current) return; ended.current = true; if (save) renameProject(name); setEditing(false); };

  return (
    <div className="proj-wrap" ref={box}>
      {editing ? (
        <input className="proj-input" autoFocus value={name} aria-label="画布名称" maxLength={40}
          onChange={e => setName(e.target.value)} onBlur={() => finish(true)}
          onKeyDown={e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); }} />
      ) : (
        <button type="button" className="proj" aria-haspopup="menu" aria-expanded={open} title="切换画布（双击改名）"
          onClick={() => setOpen(o => !o)} onDoubleClick={startRename}>
          {project?.name ?? '…'}<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      )}
      {open && (
        <div className="menu proj-menu" role="menu" style={{ ['--ox' as string]: '20px', ['--oy' as string]: '0px' }}>
          <div className="menu-head">全部画布</div>
          <div className="proj-list">
            {projects.map((p, i) => (
              <div key={p.id} role="menuitem" className={`menu-item ${p.id === project?.id ? 'is-act' : ''}`} style={{ animationDelay: `${i * 15}ms` }}
                onClick={() => { setOpen(false); switchProject(p.id); }}>
                <span className="t">{p.name}</span>
                <span className="e">{p.id === project?.id ? '当前' : ''}</span>
                <span className="d">{p.nodes} 个节点 · {ago(p.updatedAt)}</span>
              </div>
            ))}
          </div>
          <div className="menu-sep" />
          <div role="menuitem" className="menu-item" onClick={() => { setOpen(false); createProject(); }}><span className="t">新建画布</span></div>
          <div role="menuitem" className="menu-item" onClick={startRename}><span className="t">重命名当前画布</span><kbd>双击名称</kbd></div>
          <div role="menuitem" className="menu-item" onClick={() => { setOpen(false); duplicateProject(); }}><span className="t">复制当前画布</span></div>
          <div className="menu-sep" />
          <div role="menuitem" className="menu-item" onClick={() => { setOpen(false); exportProject(); }}><span className="t">导出备份</span><span className="d">画布和用到的图片打包成一个 zip</span></div>
          <div role="menuitem" className="menu-item" onClick={async () => { setOpen(false); const f = await pickFiles('.zip,application/zip'); if (f[0]) importProject(f[0]); }}><span className="t">导入备份…</span></div>
          <div role="menuitem" className="menu-item is-danger" onClick={() => { setOpen(false); if (project) deleteProject(project.id); }}><span className="t">删除当前画布</span></div>
        </div>
      )}
    </div>
  );
}
