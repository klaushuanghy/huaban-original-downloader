'use strict';
const fs=require('node:fs'),path=require('node:path');
const {dispatch}=require('./service.cjs');
const C=require('./common.cjs');
const expected='chrome-extension://'+JSON.parse(fs.readFileSync(path.join(C.ROOT,'app','identity.json'),'utf8')).extensionId+'/';
if(process.argv[2]!==expected){process.stderr.write('Origin is not authorized\n');process.exit(1);}
let pending=Buffer.alloc(0),chain=Promise.resolve();
function send(value){const b=Buffer.from(JSON.stringify(value));if(b.length>900000)throw Error('Response too large');const h=Buffer.alloc(4);h.writeUInt32LE(b.length);process.stdout.write(h);process.stdout.write(b);}
process.stdin.on('data',chunk=>{
 pending=Buffer.concat([pending,chunk]);
 while(pending.length>=4){const n=pending.readUInt32LE();if(n<2||n>8000000){process.stderr.write('Message length invalid\n');process.exit(1);}if(pending.length<n+4)break;const b=pending.subarray(4,n+4);pending=pending.subarray(n+4);chain=chain.then(async()=>{let request;try{request=JSON.parse(b.toString('utf8'));const result=await dispatch(request);send({id:request.requestId,ok:true,result});}catch(e){send({id:request?.requestId,ok:false,error:e.message});}});}
});
process.stdin.on('end',()=>chain.finally(()=>process.exit(0)));
