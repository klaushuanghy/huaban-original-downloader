'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pipeline}=require('node:stream/promises');
const yazl=require('../runtime/node_modules/yazl'),yauzl=require('../runtime/node_modules/yauzl'),crc32=require('../runtime/node_modules/buffer-crc32');
const C=require('./common.cjs');
async function validateZip(file,expected){return new Promise((resolve,reject)=>{yauzl.open(file,{lazyEntries:true},(error,zip)=>{if(error)return reject(error);let count=0;zip.on('error',reject);zip.on('entry',entry=>{if(!expected.has(entry.fileName))return reject(Error('压缩包包含未知文件'));zip.openReadStream(entry,(e,s)=>{if(e)return reject(e);let crc=0,size=0;s.on('data',buf=>{crc=crc32.unsigned(buf,crc);size+=buf.length;});s.on('error',reject);s.on('end',()=>{if(crc!==entry.crc32||size!==entry.uncompressedSize)return reject(Error('压缩包校验失败：'+entry.fileName));count++;zip.readEntry();});});});zip.on('end',()=>count===expected.size?resolve(count):reject(Error('压缩包文件数量不完整')));zip.readEntry();});});}
async function buildArchive(boardId){
 const dir=C.jobDir(boardId),manifest=C.read(path.join(dir,'manifest.json')),results=C.read(path.join(dir,'results.json'),{}),old=C.read(path.join(dir,'status.json'),{});
 if(!manifest||!manifest.pins.every(p=>results[p.pin_id]?.status==='ok'))throw Error('原图尚未全部完成');
 const files=manifest.pins.map(p=>({file:C.fileFor(manifest.outputDir,results[p.pin_id]),name:'原图/'+results[p.pin_id].filename}));
 for(const name of ['采集清单.csv','校验清单.sha256','采集元数据.json','下载核验结果.json','阅读说明.txt'])files.push({file:path.join(manifest.outputDir,name),name});
 const archive=path.join(manifest.outputDir,manifest.boardId+'_原图.zip'),temp=archive+'.part';
 try{
  for(const p of manifest.pins){const r=results[p.pin_id],hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(C.fileFor(manifest.outputDir,r)))hash.update(chunk);if(hash.digest('hex')!==r.sha256)throw Error('原图校验值发生变化，请先重新核验：'+p.pin_id);}
  const zip=new yazl.ZipFile();for(const f of files)zip.addFile(f.file,f.name,{compress:false});const output=fs.createWriteStream(temp);zip.on('error',e=>output.destroy(e));const done=pipeline(zip.outputStream,output);zip.end();await done;
  await validateZip(temp,new Set(files.map(f=>f.name)));fs.renameSync(temp,archive);
  const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(archive))hash.update(chunk);const digest=hash.digest('hex');fs.writeFileSync(archive+'.sha256.txt',digest+'  '+path.basename(archive)+'\n');
  const state={...old,status:'complete',archivePath:archive,archiveSha256:digest,message:'压缩包已生成并通过完整性校验',updatedAt:new Date().toISOString()};C.atomic(path.join(dir,'status.json'),state);console.log(JSON.stringify({archive,entries:files.length,sha256:digest}));return state;
 }catch(e){C.atomic(path.join(dir,'status.json'),{...old,status:'complete',message:'压缩包未生成：'+e.message,updatedAt:new Date().toISOString()});throw e;}
}
if(require.main===module)buildArchive(C.id(process.argv[2])).catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={buildArchive,validateZip};
