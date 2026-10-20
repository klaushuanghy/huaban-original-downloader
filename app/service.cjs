'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const C = require('./common.cjs');
function getStatus(boardId) {
  const dir = C.jobDir(boardId), manifest = C.read(path.join(dir, 'manifest.json'));
  if (!manifest) return { boardId: C.id(boardId), status: 'empty', total: 0, completed: 0, failed: 0 };
  const state = C.read(path.join(dir, 'status.json'), {});
  if (['running', 'cooldown', 'verifying', 'packaging'].includes(state.status) && !C.alive(state.pid)) { state.status = 'interrupted'; state.message = '任务已中断，点击继续即可恢复下载；原图文件会保留'; }
  return { boardId: manifest.boardId, title: manifest.title, total: manifest.pins.length, outputDir: manifest.outputDir, ...state };
}
function listJobs() {
  const p = C.mkdir(path.join(C.STATE, 'jobs'));
  return fs.readdirSync(p).filter(x => /^[1-9]\d*$/.test(x)).map(x => getStatus(x)).filter(x => x.status !== 'empty').sort((a,b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}
function startWorker(boardId) {
  const dir = C.jobDir(boardId), state = getStatus(boardId);
  const lock=C.read(path.join(dir,'worker.lock'));
  if(lock && C.alive(lock.pid)) return {...state,message:'任务正在运行或结束，请稍候刷新状态'};
  if (['running', 'cooldown', 'verifying', 'packaging'].includes(state.status) && C.alive(state.pid)) return state;
  if (!C.read(path.join(dir, 'manifest.json'))) throw Error('请先读取画板清单');
  C.atomic(path.join(dir, 'control.json'), { paused: false });
  const log = fs.openSync(path.join(dir, 'worker.log'), 'a');
  const cp = spawn(process.execPath, [path.join(__dirname, 'worker.cjs'), C.id(boardId)], { detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  fs.closeSync(log); cp.unref();
  C.atomic(path.join(dir, 'status.json'), { ...state, status: 'running', pid: cp.pid, message: '正在核对已有文件', updatedAt: new Date().toISOString() });
  return getStatus(boardId);
}
async function dispatch(m) {
  if (!m || typeof m !== 'object' || typeof m.action !== 'string') throw Error('请求格式无效');
  switch (m.action) {
    case 'hello': return { version: C.config().version, platform: process.platform, downloadRoot: C.settings().downloadRoot, jobs: listJobs() };
    case 'list': return listJobs();
    case 'status': return getStatus(m.boardId);
    case 'chooseFolder': {
      const exe = path.join(C.ROOT, 'HuabanDownloader.exe');
      const chosen = await new Promise((resolve, reject) => execFile(exe, ['--pick-folder'], { windowsHide: true }, (e, stdout) => e ? reject(e) : resolve(stdout.trim())));
      if (!chosen) return { canceled: true, downloadRoot: C.settings().downloadRoot };
      if (!path.isAbsolute(chosen)) throw Error('请选择有效的本地文件夹');
      C.mkdir(chosen); C.atomic(path.join(C.STATE, 'settings.json'), { downloadRoot: path.resolve(chosen) });
      return C.settings();
    }
    case 'begin': {
      const boardId = C.id(m.boardId), current = getStatus(boardId);
      if (C.id(m.board?.board_id) !== boardId) throw Error('画板信息与链接编号不一致');
      if (['running','cooldown','verifying','packaging'].includes(current.status) && C.alive(current.pid)) throw Error('请先暂停当前下载，或等待打包完成，再更新清单');
      const total = Number(m.board?.pin_count);
      if (!Number.isSafeInteger(total) || total < 0 || total > 1000000) throw Error('画板数量无效');
      const title = String(m.board?.title || '画板').slice(0, 200);
      const old = C.read(path.join(C.jobDir(boardId), 'manifest.json'));
      const outputDir = old?.outputDir || path.join(path.resolve(C.settings().downloadRoot), boardId + '_' + C.cleanName(title));
      const staged = { boardId, title, expected: total, pins: [], outputDir, updatedAt: new Date().toISOString(), userAgent: String(m.userAgent || C.config().defaultUserAgent).replace(/[\r\n]/g, '').slice(0, 600) };
      C.atomic(path.join(C.jobDir(boardId), 'staging.json'), staged);
      return { boardId, expected: total, received: 0 };
    }
    case 'append': {
      const dir = C.jobDir(m.boardId), staged = C.read(path.join(dir, 'staging.json'));
      if (!staged || !Array.isArray(m.pins) || m.pins.length > 100) throw Error('清单批次无效');
      const seen = new Set(staged.pins.map(x => x.pin_id));
      for (const p of m.pins) { const pin = C.normalizePin(p, m.boardId); if (seen.has(pin.pin_id)) throw Error('分页返回了重复采集，请重新读取画板'); seen.add(pin.pin_id); staged.pins.push(pin); }
      if (staged.pins.length > staged.expected) throw Error('画板数量发生变化，请重新读取');
      C.atomic(path.join(dir, 'staging.json'), staged);
      return { received: staged.pins.length, expected: staged.expected };
    }
    case 'commit': {
      const dir = C.jobDir(m.boardId), staged = C.read(path.join(dir, 'staging.json'));
      const current=getStatus(m.boardId);
      if(['running','cooldown','verifying','packaging'].includes(current.status)&&C.alive(current.pid))throw Error('任务仍在运行，请先暂停后重试');
      if (!staged || !m.exhausted || staged.pins.length !== staged.expected || Number(m.finalTotal) !== staged.expected) throw Error('清单数量与画板不一致，请重新读取');
      C.mkdir(path.join(staged.outputDir, '原图'));
      C.atomic(path.join(dir, 'manifest.json'), { ...staged, collectedAt: new Date().toISOString(), pagination: { expected: staged.expected, actual: staged.pins.length, exhausted: true } });
      C.atomic(path.join(dir, 'status.json'), { status: 'ready', completed: 0, failed: 0, total: staged.pins.length, message: '清单已就绪', updatedAt: new Date().toISOString() });
      return m.start === false ? getStatus(m.boardId) : startWorker(m.boardId);
    }
    case 'resume': return startWorker(m.boardId);
    case 'package': {
      const dir=C.jobDir(m.boardId),state=getStatus(m.boardId);
      if(state.status!=='complete')throw Error('请在所有原图核验完成后再生成压缩包');
      const log=fs.openSync(path.join(dir,'worker.log'),'a');
      const cp=spawn(process.execPath,[path.join(__dirname,'package.cjs'),C.id(m.boardId)],{detached:true,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);cp.unref();
      C.atomic(path.join(dir,'status.json'),{...state,status:'packaging',pid:cp.pid,message:'正在生成并校验压缩包',updatedAt:new Date().toISOString()});return getStatus(m.boardId);
    }
    case 'pause': { const d = C.jobDir(m.boardId); C.atomic(path.join(d, 'control.json'), { paused: true }); return { ...getStatus(m.boardId), message: '正在暂停；当前传输完成后停止' }; }
    case 'openFolder': {
      const state = getStatus(m.boardId);
      if (!state.outputDir || !fs.existsSync(state.outputDir)) throw Error('保存文件夹尚未创建');
      spawn('explorer.exe', [state.outputDir], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
      return { opened: true };
    }
    default: throw Error('不支持的操作');
  }
}
module.exports = { dispatch, getStatus, startWorker };
