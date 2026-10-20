'use strict';
const path=require('node:path'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const stage=path.resolve(__dirname,'../.build/HuabanOriginalDownloader');if(!fs.existsSync(path.join(stage,'HuabanDownloader.exe')))throw Error('Run pnpm build first');
const r=spawnSync(path.join(stage,'runtime/node.exe'),['--test','--test-concurrency=1',path.join(stage,'tests/core.test.cjs'),path.join(stage,'tests/native.test.cjs')],{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;process.exitCode=r.status??1;
