'use strict';
const fs=require('node:fs'),path=require('node:path');
const C=require('./common.cjs');
const {dispatch}=require('./service.cjs');
(async()=>{
 const [action,...args]=process.argv.slice(2);
 if(action==='import'){
  const data=C.read(path.resolve(args[0]));const boardId=C.id(data.board.board_id);const outIndex=args.indexOf('--output');
  if(outIndex>=0)C.atomic(path.join(C.STATE,'settings.json'),{downloadRoot:path.resolve(args[outIndex+1])});
  await dispatch({action:'begin',boardId,board:data.board,userAgent:data.userAgent});
  for(let i=0;i<data.pins.length;i+=100)await dispatch({action:'append',boardId,pins:data.pins.slice(i,i+100)});
  console.log(JSON.stringify(await dispatch({action:'commit',boardId,exhausted:data.pagination.exhausted,finalTotal:data.board.pin_count,start:!args.includes('--no-start')}),null,2));
 }else if(action==='status'||action==='pause'||action==='resume'||action==='openFolder'||action==='package')console.log(JSON.stringify(await dispatch({action,boardId:args[0]}),null,2));
 else if(action==='list'||action==='hello')console.log(JSON.stringify(await dispatch({action}),null,2));
 else throw Error('Usage: cli.cjs import manifest.json [--output folder] [--no-start] | status/pause/resume boardId | list');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
