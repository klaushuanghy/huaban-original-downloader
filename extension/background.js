'use strict';
const HOST='com.huaban.original_downloader';
let nativePort, serial=0;
const pending=new Map();
function nativeRpc(message){
  if(!nativePort){
    nativePort=chrome.runtime.connectNative(HOST);
    nativePort.onMessage.addListener(m=>{const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.ok?p.resolve(m.result):p.reject(Error(m.error));});
    nativePort.onDisconnect.addListener(()=>{const text=chrome.runtime.lastError?.message||'本地引擎连接已关闭';nativePort=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(text+'。请先运行“安装本地引擎.cmd”。'));}pending.clear();});
  }
  const requestId=++serial;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('本地引擎响应超时，请重试'));},180000);pending.set(requestId,{resolve,reject,timer});nativePort.postMessage({...message,requestId});});
}
const collectionTasks=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boardIdFrom(value){const s=String(value).trim();if(/^[1-9]\d{0,19}$/.test(s))return s;const u=new URL(s);if(u.protocol!=='https:'||u.hostname!=='huaban.com')throw Error('请输入花瓣画板链接');const m=u.pathname.match(/^\/boards\/([1-9]\d*)\/?$/);if(!m)throw Error('请输入画板链接，而不是单张采集链接');return m[1];}
async function pageData(tabId,relative){
  const result=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:async url=>{
    if(location.origin!=='https://huaban.com')return {error:'请在花瓣页面重新操作'};
    try{const r=await fetch(url,{credentials:'include',headers:{Accept:'application/json, text/plain, */*'}});if(!r.ok)return {error:'花瓣返回 HTTP '+r.status+'，请先在花瓣页面确认登录或访问状态'};const d=await r.json();return {data:d,userAgent:navigator.userAgent};}catch{return {error:'未能读取花瓣数据，请确认花瓣页面能正常打开'};}
  },args:[relative]});
  const value=result[0]?.result;if(!value||value.error)throw Error(value?.error||'无法读取花瓣页面');return value;
}
async function huabanTab(boardId){
  const tabs=await chrome.tabs.query({url:'https://huaban.com/*'});const exact=tabs.find(t=>new URL(t.url).pathname==='/boards/'+boardId);
  const chosen=exact||tabs.find(t=>!t.url.includes('/v3/'));
  if(chosen)return chosen.id;
  const t=await chrome.tabs.create({url:'https://huaban.com/boards/'+boardId,active:true});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{chrome.tabs.onUpdated.removeListener(onUpdate);reject(Error('花瓣页面打开超时，请登录花瓣后重试'));},30000);function onUpdate(id,change){if(id===t.id&&change.status==='complete'){clearTimeout(timer);chrome.tabs.onUpdated.removeListener(onUpdate);resolve();}}chrome.tabs.onUpdated.addListener(onUpdate);});
  return t.id;
}
async function collect(boardId){
  const progress={boardId,status:'collecting',received:0,message:'正在读取画板'};collectionTasks.set(boardId,progress);await chrome.storage.local.set({['collection:'+boardId]:progress});
  try{
    const tabId=await huabanTab(boardId),seen=new Set();let cursor='',count=0,expected,board;
    const fields='pins:PIN|board:BOARD_DETAIL|check';
    while(true){
      const q=new URLSearchParams({limit:'100',fields});if(cursor)q.set('max',cursor);
      const {data,userAgent}=await pageData(tabId,'/v3/boards/'+boardId+'/pins?'+q);
      if(!Array.isArray(data.pins)||!data.board)throw Error('花瓣返回的数据格式有变化，请更新下载器');
      if(expected===undefined){board=data.board;expected=Number(board.pin_count);await nativeRpc({action:'begin',boardId,board,userAgent});}
      if(Number(data.board.pin_count)!==expected)throw Error('读取期间画板数量发生变化，请重新读取');
      if(data.pins.length===0)break;
      for(const p of data.pins){if(String(p.board_id)!==boardId)throw Error('分页包含其他画板的采集');if(seen.has(String(p.pin_id)))throw Error('分页出现重复采集，请重试');seen.add(String(p.pin_id));}
      await nativeRpc({action:'append',boardId,pins:data.pins});count+=data.pins.length;
      cursor=String(data.pins.at(-1).pin_id);Object.assign(progress,{received:count,total:expected,title:board.title,message:'已读取 '+count+' / '+expected+' 条采集'});await chrome.storage.local.set({['collection:'+boardId]:progress});
      if(count>expected)throw Error('采集数量超过画板总数，请重新读取');
      await sleep(600);
    }
    if(count!==expected)throw Error('清单不完整：读取 '+count+' 条，画板显示 '+expected+' 条');
    const check=await pageData(tabId,'/v3/boards/'+boardId+'/pins?'+new URLSearchParams({limit:'1',fields}));
    if(Number(check.data.board?.pin_count)!==expected)throw Error('画板数量发生变化，请重新读取');
    const state=await nativeRpc({action:'commit',boardId,exhausted:true,finalTotal:expected,start:true});Object.assign(progress,{status:'started',received:count,total:expected,message:'清单已完整核对，开始下载'});await chrome.storage.local.set({['collection:'+boardId]:progress});return state;
  }catch(e){Object.assign(progress,{status:'error',message:e.message});await chrome.storage.local.set({['collection:'+boardId]:progress});throw e;}finally{collectionTasks.delete(boardId);}
}
chrome.action.onClicked.addListener(async tab=>{let boardId='';try{boardId=boardIdFrom(tab.url);}catch{}await chrome.tabs.create({url:chrome.runtime.getURL('manager.html')+(boardId?'?board='+boardId:'')});});
chrome.runtime.onMessage.addListener((m,sender,sendResponse)=>{
  if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL('manager.html')))return false;
  (async()=>{
    if(m.type==='rpc'){if(!['hello','list','status','chooseFolder','resume','pause','openFolder','package'].includes(m.action))throw Error('此操作未开放');if(['resume','package'].includes(m.action)&&collectionTasks.has(String(m.boardId)))throw Error('正在读取这个画板的清单，请稍候');return nativeRpc(m);}
    if(m.type==='collect'){const boardId=boardIdFrom(m.value);if(collectionTasks.has(boardId))return {boardId,started:true};collect(boardId).catch(()=>{});return {boardId,started:true};}
    if(m.type==='collectionStatus'){const key='collection:'+boardIdFrom(m.boardId);return (await chrome.storage.local.get(key))[key]||null;}
    throw Error('未知请求');
  })().then(result=>sendResponse({ok:true,result}),e=>sendResponse({ok:false,error:e.message}));return true;
});
