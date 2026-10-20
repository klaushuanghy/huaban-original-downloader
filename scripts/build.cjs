'use strict';
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),pkg=require('../package.json'),STAGE=path.join(ROOT,'.build','HuabanOriginalDownloader');
if(process.platform!=='win32'||process.arch!=='x64')throw Error('Build requires Windows x64');
const version=fs.readFileSync(path.join(ROOT,'.node-version'),'utf8').trim();if(process.version!=='v'+version)throw Error('Use Node.js '+version);
// Resolve and check the fixed output before replacing any previous build.
const buildRoot=path.join(fs.realpathSync(ROOT),'.build');fs.mkdirSync(buildRoot,{recursive:true});
if(fs.realpathSync(buildRoot)!==buildRoot||path.resolve(STAGE)!==path.join(buildRoot,'HuabanOriginalDownloader'))throw Error('Invalid build output');
if(fs.existsSync(STAGE)){if(fs.lstatSync(STAGE).isSymbolicLink())throw Error('Build output must not be a link');fs.rmSync(STAGE,{recursive:true});}
fs.mkdirSync(STAGE,{recursive:true});
for(const rel of ['app','extension','tests','licenses','docs','scripts','package.json','pnpm-lock.yaml','.node-version','.gitignore','README.md','LICENSE','SECURITY.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','CHANGELOG.md','安装本地引擎.cmd','卸载本地连接.cmd'])fs.cpSync(path.join(ROOT,rel),path.join(STAGE,rel),{recursive:true,dereference:true});
const config=JSON.parse(fs.readFileSync(path.join(STAGE,'app/config.json'),'utf8')),manifest=JSON.parse(fs.readFileSync(path.join(STAGE,'extension/manifest.json'),'utf8')),identity=require('../app/identity.json');
if(config.version!==pkg.version||manifest.version!==pkg.version||identity.key!==manifest.key)throw Error('Version or identity mismatch');
const runtime=path.join(STAGE,'runtime');fs.mkdirSync(path.join(runtime,'node_modules'),{recursive:true});fs.copyFileSync(process.execPath,path.join(runtime,'node.exe'));fs.copyFileSync(path.join(ROOT,'licenses/NODE_LICENSE.txt'),path.join(runtime,'NODE_LICENSE.txt'));
const depsIndex=process.argv.indexOf('--dependencies-from'),depsRoot=depsIndex>=0?path.resolve(process.argv[depsIndex+1]):ROOT,copied=new Map();
function packageRoot(name,from){const req=createRequire(path.join(from,'package.json'));for(const spec of [name+'/package.json',name+'/package',name]){try{let dir=path.dirname(req.resolve(spec));while(dir!==path.dirname(dir)){const f=path.join(dir,'package.json');if(fs.existsSync(f)&&JSON.parse(fs.readFileSync(f,'utf8')).name===name)return fs.realpathSync(dir);dir=path.dirname(dir);}}catch(e){if(!['MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(e.code))throw e;}}throw Object.assign(Error('Package not installed: '+name),{code:'MODULE_NOT_FOUND'});}
function copyPackage(name,from,optional=false){let src;try{src=packageRoot(name,from);}catch(e){if(optional&&e.code==='MODULE_NOT_FOUND')return;throw e;}const p=JSON.parse(fs.readFileSync(path.join(src,'package.json'),'utf8'));if(copied.has(name)){if(copied.get(name)!==p.version)throw Error('Two versions of '+name);return;}copied.set(name,p.version);fs.cpSync(src,path.join(runtime,'node_modules',name),{recursive:true,dereference:true});for(const dep of Object.keys(p.dependencies||{}))copyPackage(dep,src);for(const dep of Object.keys(p.optionalDependencies||{}))copyPackage(dep,src,true);}
for(const [name,expected]of Object.entries(pkg.dependencies)){copyPackage(name,depsRoot);if(copied.get(name)!==expected)throw Error('Unexpected dependency version: '+name);}
const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
execFileSync(compiler,['/nologo','/target:exe','/out:'+path.join(STAGE,'HuabanDownloader.exe'),'/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',path.join(STAGE,'app/Launcher.cs')],{stdio:'inherit',windowsHide:true});
fs.writeFileSync(path.join(STAGE,'使用说明.html'),fs.readFileSync(path.join(STAGE,'extension/help.html'),'utf8').replace('href="manager.css"','href="extension/manager.css"'));
fs.writeFileSync(path.join(STAGE,'BUILD-INFO.json'),JSON.stringify({version:pkg.version,node:process.version,platform:process.platform,arch:process.arch,dependencies:Object.fromEntries(copied)},null,2));
require(path.join(runtime,'node_modules/sharp'))({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer().then(()=>console.log('Built '+STAGE)).catch(e=>{console.error(e);process.exitCode=1;});
