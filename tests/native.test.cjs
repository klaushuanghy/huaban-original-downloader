'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{test}=require('node:test');
const ROOT=path.resolve(__dirname,'..'),identity=JSON.parse(fs.readFileSync(path.join(ROOT,'app/identity.json'),'utf8'));
const version=JSON.parse(fs.readFileSync(path.join(ROOT,'app/config.json'),'utf8')).version;
function frame(x){const b=Buffer.from(JSON.stringify(x));const h=Buffer.alloc(4);h.writeUInt32LE(b.length);return Buffer.concat([h,b]);}
test('native launcher responds to repeated requests while input remains open',async()=>{
 const p=spawn(path.join(ROOT,'HuabanDownloader.exe'),['chrome-extension://'+identity.extensionId+'/'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output=Buffer.alloc(0),waiting=[],errors='';
 p.stderr.on('data',b=>errors+=b);p.stdout.on('data',b=>{output=Buffer.concat([output,b]);while(output.length>=4&&output.length>=output.readUInt32LE()+4){const n=output.readUInt32LE(),m=JSON.parse(output.subarray(4,4+n));output=output.subarray(4+n);waiting.shift()?.(m);}});
 function roundTrip(message){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No native response with open input: '+errors)),2000);waiting.push(m=>{clearTimeout(timer);resolve(m);});p.stdin.write(frame(message));});}
 try {const first=await roundTrip({action:'hello',requestId:11});assert.equal(first.id,11);assert.equal(first.result.version,version);assert.equal(p.stdin.writableEnded,false);const second=await roundTrip({action:'list',requestId:12});assert.equal(second.id,12);assert.equal(second.ok,true);assert.equal(p.stdin.writableEnded,false);}finally{p.stdin.end();await new Promise(r=>p.on('close',r));}
});
test('compiled native launcher handles fragmented and consecutive JSON frames',async()=>{
 const p=spawn(path.join(ROOT,'HuabanDownloader.exe'),['chrome-extension://'+identity.extensionId+'/'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output=Buffer.alloc(0),errors='';p.stdout.on('data',b=>output=Buffer.concat([output,b]));p.stderr.on('data',b=>errors+=b);
 const data=Buffer.concat([frame({action:'hello',requestId:1}),frame({action:'list',requestId:2})]);p.stdin.write(data.subarray(0,3));p.stdin.end(data.subarray(3));
 const code=await new Promise(r=>p.on('close',r));assert.equal(code,0,errors);const messages=[];while(output.length>=4){const n=output.readUInt32LE();messages.push(JSON.parse(output.subarray(4,4+n)));output=output.subarray(4+n);}assert.equal(output.length,0);assert.equal(messages.length,2);assert.equal(messages[0].result.version,version);assert.equal(messages[0].id,1);assert.equal(messages[1].id,2);
});
test('native host refuses a different extension origin',async()=>{
 const p=spawn(path.join(ROOT,'runtime/node.exe'),[path.join(ROOT,'app/native-host.cjs'),'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'],{windowsHide:true});let out='';p.stdout.on('data',b=>out+=b);const code=await new Promise(r=>p.on('close',r));assert.equal(code,1);assert.equal(out,'');
});
