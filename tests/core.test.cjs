'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {test}=require('node:test');
const testWork=path.resolve(__dirname,'../state/test-work');fs.mkdirSync(testWork,{recursive:true});
const temp=fs.mkdtempSync(path.join(testWork,'downloader-tests-'));
process.env.HUABAN_DOWNLOADER_STATE=path.join(temp,'state');
const C=require('../app/common.cjs'),{dispatch}=require('../app/service.cjs'),{run,inspect}=require('../app/worker.cjs');
const sharp=require('../runtime/node_modules/sharp');
const pin=(id,boardId='10')=>({pin_id:id,board_id:boardId,raw_text:'=HYPERLINK("test")',file:{key:'test-'+id,url:'https://gd-hbimg-edge.huaban.com/test-'+id+'?auth_key=test',width:32,height:24,type:'image/png'}});
const config={requestIntervalMs:1,cooldownMs:1,requestTimeoutSeconds:2,concurrency:1,maxRateLimitRetries:4};
async function stage(boardId,pins){await dispatch({action:'begin',boardId,board:{board_id:boardId,title:'Test',pin_count:pins.length}});await dispatch({action:'append',boardId,pins});return dispatch({action:'commit',boardId,exhausted:true,finalTotal:pins.length,start:false});}
test('input validation rejects traversal, external hosts and thumbnail URLs',()=>{
 for(const id of ['../10','0','10;calc','10/20'])assert.throws(()=>C.id(id));
 for(const url of ['http://gd-hbimg.huaban.com/key','https://evil.example/key','https://huaban.com.evil.example/key','https://localhost/key','https://user:password@gd-hbimg.huaban.com/key','https://gd-hbimg.huaban.com/key_fw658webp','https://gd-hbimg.huaban.com/key?x-oss-process=image/resize,w_240'])assert.throws(()=>C.imageUrl(url));
 assert.match(C.imageUrl('https://gd-hbimg-edge.huaban.com/key?auth_key=123'),/^https:\/\/gd-hbimg-edge.huabanimg.com\/key\?auth_key=123$/);
 assert.throws(()=>C.normalizePin({...pin('1'),file:{...pin('1').file,key:'different'}},'10'));
 assert.equal(C.imageFilename({pin_id:'1',title:'标题: / 示例? '},'jpg'),'标题_ _ 示例__1.jpg');
 assert.equal(C.imageFilename({pin_id:'2',title:'  '},'png'),'未命名采集_2.png');
 const long=C.imageFilename({pin_id:'3',title:'😀'.repeat(80)},'webp');assert.ok(long.length<=70);assert.equal(long.split('_')[0].length,60);
 for(const filename of ['../标题_1.jpg','标题:1_1.jpg','标题\\1_1.jpg'])assert.throws(()=>C.fileFor(temp,{filename}));
});
test('incomplete or duplicated manifests cannot be committed',async()=>{
 C.atomic(path.join(C.STATE,'settings.json'),{downloadRoot:path.join(temp,'images')});
 await dispatch({action:'begin',boardId:'11',board:{board_id:'11',title:'Test',pin_count:2}});
 await dispatch({action:'append',boardId:'11',pins:[pin('1','11')]});
 await assert.rejects(dispatch({action:'commit',boardId:'11',exhausted:true,finalTotal:2,start:false}),/不一致/);
 await assert.rejects(dispatch({action:'append',boardId:'11',pins:[pin('1','11')]}),/重复/);
 await assert.rejects(dispatch({action:'begin',boardId:'11',board:{board_id:'12',title:'Test',pin_count:2}}),/不一致/);
});
test('pause, resume, corruption repair and a no-download repeat run',async()=>{
 const buf=await sharp({create:{width:32,height:24,channels:3,background:'#244cb0'}}).png().toBuffer();
 const state=await stage('20',[pin('101','20'),pin('102','20')]);let transfers=0;
 const transfer=async(url,dest)=>{transfers++;fs.writeFileSync(dest,buf);if(transfers===1)C.atomic(path.join(C.jobDir('20'),'control.json'),{paused:true});};
 let r=await run('20',{config,transfer,retryDelayMs:0});assert.equal(r.status,'paused');assert.equal(r.completed,1);
 const results=C.read(path.join(C.jobDir('20'),'results.json'));const saved=path.join(state.outputDir,'原图',results['101'].filename);assert.deepEqual(fs.readFileSync(saved),buf);
 fs.writeFileSync(saved,Buffer.from('damaged'));
 C.atomic(path.join(C.jobDir('20'),'control.json'),{paused:false});transfers=1;
 r=await run('20',{config,transfer,retryDelayMs:0});assert.equal(r.status,'complete');assert.equal(r.completed,2);assert.equal(r.newDownloads,2);assert.equal(transfers,3);
 r=await run('20',{config,transfer:async()=>assert.fail('Valid files must not be downloaded again'),retryDelayMs:0});assert.equal(r.completed,2);assert.equal(r.newDownloads,0);assert.equal(r.skipped,2);
 assert.match(fs.readFileSync(path.join(state.outputDir,'采集清单.csv'),'utf8'),/'=HYPERLINK/);
 assert.equal(C.read(path.join(state.outputDir,'下载核验结果.json')).downloaded,2);
});
test('expired links stop the job without reporting success or losing pending items',async()=>{
 await stage('30',[pin('201','30')]);const r=await run('30',{config,transfer:async()=>{throw Object.assign(Error('HTTP 403'),{httpStatus:403});},retryDelayMs:0});assert.equal(r.status,'needs_refresh');assert.equal(r.completed,0);assert.equal(r.failed,0);
});
test('repeated rate limits pause recoverably and never become completed images',async()=>{
 await stage('40',[pin('301','40')]);let calls=0;
 const r=await run('40',{config,transfer:async()=>{calls++;throw Object.assign(Error('HTTP 567'),{httpStatus:567});},retryDelayMs:0});assert.equal(r.status,'access_limited');assert.equal(r.completed,0);assert.equal(r.failed,0);assert.equal(calls,4);
});
test('a 200 response with incorrect dimensions is rejected',async()=>{
 const wrong=path.join(temp,'wrong.png');await sharp({create:{width:16,height:12,channels:3,background:'white'}}).png().toFile(wrong);await assert.rejects(inspect(wrong,pin('999')),/尺寸不符/);
});
test('streaming ZIP contains only manifest files, validates CRCs, and rejects altered source images',async()=>{
 const {buildArchive,validateZip}=require('../app/package.cjs');
 const image=await sharp({create:{width:32,height:24,channels:3,background:'#d07030'}}).png().toBuffer();
 const s=await stage('50',[pin('401','50')]);await run('50',{config,transfer:async(url,dest)=>fs.writeFileSync(dest,image),retryDelayMs:0});
 const packed=await buildArchive('50');assert.ok(fs.existsSync(packed.archivePath));assert.match(packed.archiveSha256,/^[a-f0-9]{64}$/);
 const filename=C.read(path.join(C.jobDir('50'),'results.json'))['401'].filename;
 const expected=new Set(['原图/'+filename,'采集清单.csv','校验清单.sha256','采集元数据.json','下载核验结果.json','阅读说明.txt']);
 assert.equal(await validateZip(packed.archivePath,expected),6);
 const bad=path.join(temp,'corrupt.zip'),bytes=fs.readFileSync(packed.archivePath),pos=bytes.indexOf(image);assert.ok(pos>=0);bytes[pos+40]^=1;fs.writeFileSync(bad,bytes);
 await assert.rejects(validateZip(bad,expected),/校验失败/);
 fs.writeFileSync(path.join(s.outputDir,'原图',filename),Buffer.from('altered'));
 await assert.rejects(buildArchive('50'),/校验值发生变化/);
});
test('title filenames migrate legacy images, distinguish duplicate titles, and recover a rename checkpoint',async()=>{
 const pins=[pin('501','60'),pin('502','60')];pins.forEach(p=>p.raw_text='相同标题: 示例 / 参考');
 const state=await stage('60',pins),buf=await sharp({create:{width:32,height:24,channels:3,background:'#123456'}}).png().toBuffer(),results={};
 for(const p of pins){const filename=p.pin_id+'.png',file=path.join(state.outputDir,'原图',filename);fs.writeFileSync(file,buf);results[p.pin_id]={status:'ok',key:p.file.key,filename,...await inspect(file,p)};}
 C.atomic(path.join(C.jobDir('60'),'results.json'),results);
 const noNetwork=async()=>assert.fail('Title migration must preserve existing original bytes without downloads');
 let stateAfter=await run('60',{config,transfer:noNetwork});assert.equal(stateAfter.renamed,2);assert.equal(stateAfter.skipped,2);assert.equal(stateAfter.newDownloads,0);
 const saved=C.read(path.join(C.jobDir('60'),'results.json'));assert.notEqual(saved['501'].filename,saved['502'].filename);
 for(const r of Object.values(saved)){assert.match(r.filename,/^相同标题_ 示例 _ 参考_50[12]\.png$/);assert.deepEqual(fs.readFileSync(C.fileFor(state.outputDir,r)),buf);}
 const manifestPath=path.join(C.jobDir('60'),'manifest.json'),manifest=C.read(manifestPath);manifest.pins[0].title='更新后的标题';C.atomic(manifestPath,manifest);
 stateAfter=await run('60',{config,transfer:noNetwork});assert.equal(stateAfter.renamed,1);assert.equal(stateAfter.newDownloads,0);
 const oldCheckpoint=C.read(path.join(C.jobDir('60'),'results.json'));oldCheckpoint['501'].filename=saved['501'].filename;C.atomic(path.join(C.jobDir('60'),'results.json'),oldCheckpoint);
 stateAfter=await run('60',{config,transfer:noNetwork});assert.equal(stateAfter.skipped,2);assert.equal(stateAfter.newDownloads,0);
 assert.equal(C.read(path.join(C.jobDir('60'),'results.json'))['501'].filename,'更新后的标题_501.png');
});
test('a locked legacy filename stays verified and is never downloaded again for a rename failure',async()=>{
 const p=pin('601','61');p.raw_text='标题命名';const s=await stage('61',[p]),file=path.join(s.outputDir,'原图','601.png');
 await sharp({create:{width:32,height:24,channels:3,background:'#345678'}}).png().toFile(file);
 C.atomic(path.join(C.jobDir('61'),'results.json'),{'601':{status:'ok',key:p.file.key,filename:'601.png',...await inspect(file,p)}});
 const noNetwork=async()=>assert.fail('A rename failure must never cause another transfer');
 let r=await run('61',{config,transfer:noNetwork,renameDelayMs:0,renameExisting:async()=>{throw Object.assign(Error('file is locked'),{code:'EPERM'});}});
 assert.equal(r.status,'partial');assert.equal(r.renamePending,1);assert.equal(r.skipped,1);assert.equal(r.newDownloads,0);assert.ok(fs.existsSync(file));
 let attempts=0;r=await run('61',{config,transfer:noNetwork,renameDelayMs:0,renameExisting:async(a,b)=>{if(++attempts<3)throw Error('temporary file lock');return fs.promises.rename(a,b);}});
 assert.equal(attempts,3);assert.equal(r.status,'complete');assert.equal(r.renamed,1);assert.equal(r.newDownloads,0);
});
