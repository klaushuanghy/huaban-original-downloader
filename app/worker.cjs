'use strict';
const fs = require('node:fs'), fsp = fs.promises, path = require('node:path');
const { spawn } = require('node:child_process');
const sharp = require('../runtime/node_modules/sharp');
const C = require('./common.cjs');
sharp.cache(false);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function inspect(file, pin) {
  const buf = await fsp.readFile(file);
  const md = await sharp(buf, { limitInputPixels: 500000000, animated: true }).metadata();
  const height = md.pageHeight || md.height;
  const match = md.width === pin.file.width && height === pin.file.height || md.width === pin.file.height && height === pin.file.width && md.orientation >= 5;
  if (!match) throw Error(`尺寸不符：下载 ${md.width}×${height}，原图 ${pin.file.width}×${pin.file.height}`);
  // Decode without writing a derivative: the downloaded bytes are never re-encoded.
  await sharp(buf, { limitInputPixels: 500000000, animated: true, failOn: 'warning' }).resize({ width: 8, height: 8, fit: 'inside' }).raw().toBuffer();
  const ext = ({ jpeg:'jpg', tiff:'tif' })[md.format] || md.format;
  if (!/^[a-z0-9]+$/.test(ext)) throw Error('图片格式无法识别');
  return { width: md.width, height, format: md.format, frames: md.pages || 1, bytes: buf.length, sha256: C.sha(buf), ext };
}
function transfer(url, dest, manifest, conf) {
  return new Promise((resolve, reject) => {
    const args = ['--silent','--show-error','--fail','--proto','=https','--connect-timeout','20','--max-time',String(conf.requestTimeoutSeconds),'--header','Referer: https://huaban.com/','--user-agent',manifest.userAgent,'--output',dest,'--write-out','%{http_code}',url];
    let output = '', errors = '';
    const p = spawn('curl.exe', args, { windowsHide: true });
    p.stdout.on('data', d => output += d); p.stderr.on('data', d => errors += d);
    p.on('error', reject); p.on('close', code => { const status = Number(output.trim()); if (code === 0 && status === 200) resolve(); else reject(Object.assign(Error(`HTTP ${status || 0} ${errors.trim().slice(0,160)}`), { httpStatus: status })); });
  });
}
function reports(manifest, results, state) {
  const rows = manifest.pins.map(p => ({ p, r: results[p.pin_id] || { status:'pending' } }));
  const quote = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const cell = s => /^[=+\-@]/.test(String(s)) ? "'" + s : s;
  const csv = [['采集ID','标题','本地文件','宽度','高度','格式','字节数','状态','详情链接','SHA256','说明']];
  for (const {p,r} of rows) csv.push([p.pin_id,cell(p.title),r.filename ? '原图/'+r.filename : '',r.width,r.height,r.format,r.bytes,r.status,'https://huaban.com/pins/'+p.pin_id,r.sha256,r.error || '']);
  fs.writeFileSync(path.join(manifest.outputDir, '采集清单.csv'), '\ufeff' + csv.map(r => r.map(quote).join(',')).join('\r\n'));
  fs.writeFileSync(path.join(manifest.outputDir, '校验清单.sha256'), rows.filter(x=>x.r.status==='ok').map(x=>x.r.sha256+'  原图/'+x.r.filename).join('\n')+'\n');
  C.atomic(path.join(manifest.outputDir, '采集元数据.json'), manifest);
  const ok = rows.filter(x=>x.r.status==='ok');
  C.atomic(path.join(manifest.outputDir,'下载核验结果.json'), { version:C.config().version, boardId:manifest.boardId, title:manifest.title, boardUrl:'https://huaban.com/boards/'+manifest.boardId, expected:manifest.expected, collected:manifest.pins.length, downloaded:ok.length, failed:rows.filter(x=>x.r.status==='failed').length, pending:rows.filter(x=>!['ok','failed'].includes(x.r.status)).length, renamePending:rows.filter(x=>x.r.renameError).length, uniqueContents:new Set(ok.map(x=>x.r.sha256)).size, totalBytes:ok.reduce((s,x)=>s+x.r.bytes,0), pagination:manifest.pagination, state, results:rows.map(x=>({pinId:x.p.pin_id,...x.r})) });
  fs.writeFileSync(path.join(manifest.outputDir,'阅读说明.txt'), `画板：${manifest.title}\r\n链接：https://huaban.com/boards/${manifest.boardId}\r\n\r\n原图保存在“原图”文件夹，文件名为“花瓣标题_采集ID.实际格式”。标题最多保留60个UTF-16字符，非法字符会替换为下划线，无标题使用“未命名采集”。完整标题始终保存在采集清单.csv。\r\n采集清单.csv 可查标题、尺寸、来源详情、下载状态与校验值。\r\n保存的是花瓣大图提供的原始字节，没有重新压缩或放大。原图尺寸以花瓣实际保存的版本为准。\r\n遇到“链接已过期”时，在插件中更新画板清单后继续。重复运行会核对已有文件，合格文件会跳过；原图不会主动删除。\r\n`);
}
async function run(boardId, testOptions = {}) {
  const dir = C.jobDir(boardId), manifest = C.read(path.join(dir,'manifest.json'));
  if (!manifest) throw Error('找不到画板清单');
  const lock = path.join(dir,'worker.lock');
  const old = C.read(lock);
  if (old && C.alive(old.pid) && old.pid !== process.pid) throw Error('这个画板已有下载任务');
  if (old) fs.unlinkSync(lock);
  fs.writeFileSync(lock, JSON.stringify({pid:process.pid}), {flag:'wx'});
  const conf = {...C.config(),...testOptions.config}, resultsPath = path.join(dir,'results.json');
  const doTransfer = testOptions.transfer || transfer;
  const results = C.read(resultsPath, {});
  let next = 0, nextAt = Date.now(), cooldownUntil = 0, rateLimits = 0, terminal = '', newDownloads = 0, skipped = 0, renamed = 0;
  let state = { status:'verifying',pid:process.pid,completed:0,failed:0,total:manifest.pins.length,bytes:0,message:'正在核对已有文件',newDownloads,skipped,renamed };
  function persist(message, extra={}) {
    const rows = manifest.pins.map(p=>results[p.pin_id]);
    state = {...state,...extra,message,completed:rows.filter(r=>r?.status==='ok').length,failed:rows.filter(r=>r?.status==='failed').length,bytes:rows.reduce((s,r)=>s+(r?.status==='ok'?r.bytes:0),0),renamePending:rows.filter(r=>r?.renameError).length,newDownloads,skipped,renamed,updatedAt:new Date().toISOString()};
    C.atomic(resultsPath,results); C.atomic(path.join(dir,'status.json'),state);
  }
  const paused = () => C.read(path.join(dir,'control.json'),{}).paused === true;
  async function slot() {
    const reserved = Math.max(Date.now(), nextAt, cooldownUntil); nextAt = reserved + conf.requestIntervalMs;
    while (Date.now() < Math.max(reserved,cooldownUntil)) { if (paused() || terminal) return false; await sleep(Math.min(500, Math.max(reserved,cooldownUntil)-Date.now())); }
    return !paused() && !terminal;
  }
  try {
    for (const p of manifest.pins) {
      if (paused()) break;
      const r = results[p.pin_id];
      if (r?.status==='ok' && r.key===p.file.key) {
        try {
          let file=C.fileFor(manifest.outputDir,r);
          const wanted=C.imageFilename(p,r.ext||({jpeg:'jpg',tiff:'tif'})[r.format]||r.format);
          const wantedPath=path.join(manifest.outputDir,'原图',wanted);
          if(!fs.existsSync(file)&&fs.existsSync(wantedPath))file=wantedPath;
          const meta=await inspect(file,p);if(meta.sha256!==r.sha256)throw Error('校验值不一致');
          const wantedFilename=C.imageFilename(p,meta.ext),destination=path.join(manifest.outputDir,'原图',wantedFilename);
          let filename=path.basename(file),renameError;
          if(file!==destination){
            for(let attempt=1;attempt<=3;attempt++){
              try{await (testOptions.renameExisting||fsp.rename)(file,destination);filename=wantedFilename;renamed++;renameError=undefined;break;}
              catch(e){renameError='文件改名未完成：'+e.message;if(attempt<3)await sleep(testOptions.renameDelayMs??attempt*150);}
            }
          }
          results[p.pin_id]={...r,...meta,filename,renameError,verifiedAt:new Date().toISOString()};skipped++;
        }
        catch(e) { results[p.pin_id] = {status:'pending',error:'已有文件需重新下载：'+e.message}; }
      } else results[p.pin_id] = {status:'pending'};
    }
    persist('已有文件核对完成', {status:'running'});
    async function one(p) {
      const temp = path.join(manifest.outputDir,'原图',p.pin_id+'.part');
      for (let attempt=1;attempt<=Math.max(3,conf.maxRateLimitRetries);attempt++) {
        if (!await slot()) return;
        try {
          const url=C.imageUrl(p.file.url); await doTransfer(url,temp,manifest,conf);
          const meta = await inspect(temp,p), filename=C.imageFilename(p,meta.ext);
          await fsp.rename(temp,path.join(manifest.outputDir,'原图',filename));
          results[p.pin_id]={status:'ok',key:p.file.key,filename,...meta,url,verifiedAt:new Date().toISOString()}; newDownloads++;
          persist('正在下载原图',{status:Date.now()<cooldownUntil?'cooldown':'running'}); return;
        } catch(e) {
          if ([401,403].includes(e.httpStatus)) { terminal='needs_refresh'; persist('图片链接已过期或访问需要重新确认，请在插件中更新画板清单',{status:terminal}); return; }
          if ([405,429,567,570,571,579].includes(e.httpStatus)) {
            rateLimits++; cooldownUntil=Math.max(cooldownUntil,Date.now()+conf.cooldownMs*Math.min(4,Math.pow(2,rateLimits-1)));
            persist('花瓣暂时限制下载，等待后会自动继续',{status:'cooldown',resumeAt:new Date(cooldownUntil).toISOString()});
            if (attempt===conf.maxRateLimitRetries) { terminal='access_limited'; persist('花瓣持续限制访问，请稍后点击继续',{status:terminal}); return; }
          } else if (attempt>=3) { results[p.pin_id]={status:'failed',error:e.message,attempts:attempt}; persist('部分图片未完成，可重试失败项'); return; }
          else await sleep(attempt*(testOptions.retryDelayMs ?? 2000));
        }
      }
    }
    async function worker() { while (next<manifest.pins.length && !paused() && !terminal) { const p=manifest.pins[next++]; if (results[p.pin_id]?.status==='ok') continue; await one(p); } }
    await Promise.all(Array.from({length:Math.min(2,Math.max(1,conf.concurrency))},worker));
    const renamePending=manifest.pins.filter(p=>results[p.pin_id]?.renameError).length;
    const final = terminal || (paused()?'paused':manifest.pins.every(p=>results[p.pin_id]?.status==='ok')&&!renamePending?'complete':'partial');
    persist(final==='complete'?'全部原图已下载并核验'+(renamed?'，'+renamed+' 个文件已按标题命名':''):final==='paused'?'已暂停，可随时继续':renamePending?'原图已核验，部分文件改名未完成。请关闭占用图片的程序后重新核验':state.message,{status:final});
    reports(manifest,results,state);
    console.log(JSON.stringify(state));
    return state;
  } finally { const owned=C.read(lock); if (owned?.pid===process.pid) fs.unlinkSync(lock); }
}
if (require.main===module) run(C.id(process.argv[2])).catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={run,inspect,reports,transfer};
