'use strict';
const $=s=>document.querySelector(s);
let connected=false,busy=false,collectingId='',connectionError='';
const labels={empty:'未开始',ready:'清单就绪',running:'下载中',verifying:'核验中',cooldown:'等待恢复',packaging:'打包中',paused:'已暂停',interrupted:'已中断',complete:'已完成',partial:'有失败项',needs_refresh:'需要更新链接',access_limited:'访问受限'};
async function request(m){const r=await chrome.runtime.sendMessage(m);if(!r?.ok)throw Error(r?.error||'插件没有响应');return r.result;}
function notice(message,error=false){$('#notice').textContent=message;$('#notice').classList.toggle('error',error);$('#notice').hidden=!message;}
function size(n){return n>=1e9?(n/1e9).toFixed(2)+' GB':n>=1e6?(n/1e6).toFixed(1)+' MB':Math.round(n/1024)+' KB';}
function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function action(text,fn,secondary=true){const b=el('button',text,secondary?'secondary':'');b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();await refresh();}catch(e){notice(e.message,true);}finally{b.disabled=false;}};return b;}
const jobRows=new Map();
function renderJobs(jobs){const box=$('#jobs'),wanted=new Set(jobs.map(j=>j.boardId));for(const [id,row]of jobRows){if(!wanted.has(id)){row.remove();jobRows.delete(id);}}if(!jobs.length){if(!box.querySelector('.empty'))box.replaceChildren(el('div','还没有下载任务。粘贴画板链接后开始。','empty'));return;}box.querySelector('.empty')?.remove();for(const j of jobs){
 const previous=jobRows.get(j.boardId);
 if(previous){updateJob(previous,j);continue;}
 const row=el('article',undefined,'job'),header=el('div',undefined,'job-header'),heading=el('div');heading.append(el('h3',j.title||'画板 '+j.boardId,'job-title'),el('p','画板 '+j.boardId,'job-id'));header.append(heading,el('span',labels[j.status]||j.status,'badge '+j.status));
 const count=el('div',undefined,'job-count');count.append(el('span',`${j.completed||0} / ${j.total||0} 张已核验`),el('span',size(j.bytes||0)),el('span',`失败 ${j.failed||0}`));
 const progress=el('div',undefined,'progress '+j.status),bar=el('span');bar.style.width=((j.total?Math.min(100,(j.completed||0)/j.total*100):0))+'%';progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','画板下载进度');progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax',String(j.total||0));progress.setAttribute('aria-valuenow',String(j.completed||0));progress.append(bar);
 const message=j.status==='cooldown'&&j.resumeAt?j.message+'，预计 '+new Date(j.resumeAt).toLocaleTimeString('zh-CN')+' 继续':j.message||'';
 const actions=el('div',undefined,'job-actions');
 row.append(header,count,progress,el('p',message,'job-message'),actions,el('p',j.outputDir||'','job-path'));box.append(row);
 row.ui={heading:heading.firstChild,badge:header.lastChild,count,progress,bar,message:row.querySelector('.job-message'),actions,path:row.lastChild,buttons:new Map()};row.ui.heading.tabIndex=-1;jobRows.set(j.boardId,row);updateJob(row,j);
}}
function updateJob(row,j){
 const u=row.ui;u.heading.textContent=j.title||'画板 '+j.boardId;u.badge.textContent=labels[j.status]||j.status;u.badge.className='badge '+j.status;
 const values=[`${j.completed||0} / ${j.total||0} 张已核验`,size(j.bytes||0),`失败 ${j.failed||0}`];values.forEach((v,i)=>u.count.children[i].textContent=v);
 u.progress.className='progress '+j.status;u.progress.setAttribute('aria-valuemax',String(j.total||0));u.progress.setAttribute('aria-valuenow',String(j.completed||0));u.bar.style.width=(j.total?Math.min(100,(j.completed||0)/j.total*100):0)+'%';
 u.message.textContent=j.status==='cooldown'&&j.resumeAt?j.message+'，预计 '+new Date(j.resumeAt).toLocaleTimeString('zh-CN')+' 继续':j.message||'';u.path.textContent=j.outputDir||'';
 const specs=[],active=['running','cooldown','verifying','packaging'].includes(j.status),rpc=name=>()=>request({type:'rpc',action:name,boardId:j.boardId});
 if(active&&j.status!=='packaging')specs.push(['pause','暂停',rpc('pause'),true]);
 else if(!active){if(j.status!=='complete')specs.push(['resume',j.failed?'重试未完成项':'继续下载',rpc('resume'),false]);specs.push(['collect',j.status==='complete'?'检查新增采集':'更新清单并继续',()=>begin(j.boardId),true]);if(j.status==='complete')specs.push(['verify','重新核验',rpc('resume'),true],['package','生成压缩包',rpc('package'),true]);}
 specs.push(['open','打开文件夹',rpc('openFolder'),true]);
 const wanted=new Set(specs.map(s=>s[0]));for(const [key,button]of u.buttons){if(!wanted.has(key)){const focused=document.activeElement===button;button.remove();u.buttons.delete(key);if(focused)u.heading.focus();}}
 specs.forEach(([key,text,fn,secondary],i)=>{let button=u.buttons.get(key);if(!button){button=action(text,fn,secondary);button.dataset.action=key;u.buttons.set(key,button);u.actions.insertBefore(button,u.actions.children[i]||null);}button.textContent=text;});
}
async function refresh(){if(busy)return;busy=true;try{const hello=await request({type:'rpc',action:'hello'});connected=true;if(connectionError&&$('#notice').textContent===connectionError)notice('');connectionError='';$('#connection').textContent='本地引擎已连接 · '+hello.version;$('#folder').textContent=hello.downloadRoot;$('#choose').disabled=false;$('#start').disabled=Boolean(collectingId);renderJobs(hello.jobs);if(collectingId){const c=await request({type:'collectionStatus',boardId:collectingId});if(c){notice(c.message,c.status==='error');if(['started','error'].includes(c.status)){collectingId='';$('#start').disabled=false;}}}}catch(e){connected=false;connectionError=e.message;$('#connection').textContent='本地引擎未连接';$('#choose').disabled=true;$('#start').disabled=true;notice(e.message,true);}finally{busy=false;}}
async function begin(value){if(!connected)throw Error('请先安装并连接本地引擎');const result=await request({type:'collect',value});collectingId=result.boardId;$('#start').disabled=true;notice('正在读取完整画板清单…');}
$('#form').addEventListener('submit',e=>{e.preventDefault();begin($('#board').value).catch(e=>notice(e.message,true));});
$('#choose').onclick=async()=>{try{const r=await request({type:'rpc',action:'chooseFolder'});if(!r.canceled)$('#folder').textContent=r.downloadRoot;}catch(e){notice(e.message,true);}};
$('#refresh').onclick=refresh;
const initial=new URL(location.href).searchParams.get('board');if(initial)$('#board').value='https://huaban.com/boards/'+initial;
refresh();setInterval(refresh,2000);
