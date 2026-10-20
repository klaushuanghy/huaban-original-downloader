'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const STATE = process.env.HUABAN_DOWNLOADER_STATE ? path.resolve(process.env.HUABAN_DOWNLOADER_STATE) : path.join(ROOT, 'state');
const config = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); return p; }
function read(p, fallback = null) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
function atomic(p, value) { mkdir(path.dirname(p)); const t = p + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(value, null, 2)); fs.renameSync(t, p); }
function id(v) { const s = String(v ?? ''); if (!/^[1-9]\d{0,19}$/.test(s)) throw Error('画板或采集编号无效'); return s; }
function jobDir(v) { return path.join(STATE, 'jobs', id(v)); }
function cleanName(s) { return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 70) || '画板'; }
function imageFilename(pin,ext) {
  const pinId=id(pin.pin_id);if(!/^[a-z0-9]{1,8}$/.test(ext))throw Error('图片扩展名无效');
  const title=String(pin.title||'').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/\s+/g,' ').trim();
  let short='';for(const char of title){if(short.length+char.length>60)break;short+=char;}
  short=short.replace(/[. ]+$/g,'')||'未命名采集';
  return short+'_'+pinId+'.'+ext;
}
function imageUrl(raw) {
  const u = new URL(raw);
  const conf = config();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw Error('图片地址必须为花瓣 HTTPS 地址');
  if (!conf.imageHostSuffixes.some(s => u.hostname === s || u.hostname.endsWith('.' + s))) throw Error('拒绝下载花瓣图床以外的地址');
  if (/(?:_fw\d|_sq\d|image\/resize|x-oss-process)/i.test(u.pathname + u.search)) throw Error('该地址为缩略图，不能作为原图下载');
  if (!/^\/[A-Za-z0-9_-]+$/.test(u.pathname)) throw Error('图片文件键无效');
  if (conf.hostRewrites[u.hostname]) u.hostname = conf.hostRewrites[u.hostname];
  return u.href;
}
function normalizePin(p, boardId) {
  const pinId = id(p.pin_id);
  if (p.board_id != null && id(p.board_id) !== id(boardId)) throw Error('采集不属于这个画板');
  const f = p.file;
  if (!f || !Number.isInteger(f.width) || !Number.isInteger(f.height) || f.width < 1 || f.height < 1 || f.width * f.height > 500000000) throw Error('原图尺寸无效');
  const url = imageUrl(f.url);
  const key = new URL(url).pathname.slice(1);
  if (f.key !== key) throw Error('原图地址与文件键不一致');
  return { pin_id: pinId, board_id: id(boardId), title: String(p.raw_text ?? p.title ?? '').slice(0, 20000), source: String(p.source ?? '').slice(0, 1000), file: { key, url, width: f.width, height: f.height, type: String(f.type || ''), frames: Number(f.frames) || 1 } };
}
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function alive(pid) { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
function settings() { return read(path.join(STATE, 'settings.json'), { downloadRoot: path.join(ROOT, 'Downloads') }); }
function fileFor(dir, r) {
  if (!r?.filename || r.filename.length>100 || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(r.filename) || !/^(?:.+_)?[1-9]\d{0,19}\.[a-z0-9]{1,8}$/.test(r.filename)) throw Error('本地文件名无效');
  return path.join(dir, '原图', r.filename);
}
module.exports = { ROOT, STATE, config, mkdir, read, atomic, id, jobDir, cleanName, imageFilename, imageUrl, normalizePin, sha, alive, settings, fileFor };
