import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Game} from './rules.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(dir);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8'};
export async function createApp({game,storeFile=path.resolve(dir,'../../work/first-map-v1-state.json'),tickMs=null}={}){
 let saved=null;if(storeFile){try{saved=JSON.parse(await fs.readFile(storeFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}}
 game=game||new Game({savedPlayers:saved?.players||[],savedWorld:saved?.world});const sessions=new Map(saved?.sessions||[]),clients=new Map(),timers=new Map();let writeQueue=Promise.resolve();
 function snapshot(id){const s=game.snapshot(id);if(s.party)for(const member of s.party.members)member.connected=member.npc||!!clients.get(member.id)?.size;return s;}
 function saveNow(){if(!storeFile)return Promise.resolve();const body=JSON.stringify({players:game.exportPlayers(),sessions:[...sessions],world:game.exportWorld()},null,2);writeQueue=writeQueue.then(async()=>{await fs.mkdir(path.dirname(storeFile),{recursive:true});await fs.writeFile(storeFile+'.tmp',body);await fs.rename(storeFile+'.tmp',storeFile);});return writeQueue;}
 function notify(){for(const [id,connections] of clients){const message='data: '+JSON.stringify(snapshot(id))+'\n\n';for(const response of connections)response.write(message);}}
 function cancelSchedule(key){if(timers.has(key)){clearTimeout(timers.get(key));timers.delete(key);}}
 function schedule(key,restart=false){
  if(timers.has(key)){if(!restart)return;cancelSchedule(key);}const battle=game.battles.get(key);if(!battle)return;
  const delay=tickMs??(battle.busy?battle.lastAction?.durationMs||850:850);timers.set(key,setTimeout(async()=>{
   timers.delete(key);const b=game.battles.get(key);if(!b)return;b.busy=false;notify();if(b.status!=='active')return;
   const actor=game.unit(b,b.currentActor);if(actor.kind==='hero'&&!actor.npc&&clients.get(actor.id)?.size)return;
   const event=game.stepAuto(b.controller,true);if(event){b.busy=true;notify();await saveNow();schedule(key);}
  },delay));
 }
 function credentials(request,url){const id=request.headers['x-player-id']||url.searchParams.get('id'),token=request.headers['x-player-token']||url.searchParams.get('token');if(!id||sessions.get(id)!==token){const error=new Error('会话已失效，请重新连接');error.status=401;throw error;}game.player(id);return id;}
 async function readBody(request){let text='';for await(const chunk of request){text+=chunk;if(text.length>65536){const error=new Error('请求过大');error.status=413;throw error;}}return text?JSON.parse(text):{};}
 function json(response,status,data){response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(data));}
 const server=http.createServer(async(request,response)=>{
  try{
   const url=new URL(request.url,'http://127.0.0.1');
   if(url.pathname==='/api/events'){
    const id=credentials(request,url);response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store','connection':'keep-alive'});
    if(!clients.has(id))clients.set(id,new Set());clients.get(id).add(response);response.write('data: '+JSON.stringify(snapshot(id))+'\n\n');notify();
    const heartbeat=setInterval(()=>response.write(': keepalive\n\n'),15000);request.on('close',()=>{clearInterval(heartbeat);clients.get(id)?.delete(response);notify();const b=game.battleFor(id);if(b)schedule(game.key(id));});return;
   }
   if(url.pathname.startsWith('/api/')){
    const route=url.pathname.slice(5),body=request.method==='POST'?await readBody(request):{};
    if(route==='session'){
     let id,token;if(body.id){id=body.id;token=body.token;if(sessions.get(id)!==token){const e=new Error('存档会话不匹配');e.status=401;throw e;}game.player(id);}
     else{const p=game.createPlayer(body.classId||'swordsman-luqinglan');id=p.id;token=randomUUID();sessions.set(id,token);}
     await saveNow();json(response,200,{...snapshot(id),session:{id,token}});return;
    }
    const id=credentials(request,url);
    if(route==='state'){json(response,200,snapshot(id));return;}
    if(request.method!=='POST'){json(response,405,{error:'请使用POST提交指令'});return;}
    switch(route){
     case 'team/create':game.createTeam(id);break;
     case 'team/join':game.joinTeam(id,body.code);break;
     case 'team/leave':game.leaveTeam(id);break;
     case 'team/companion':game.addCompanion(id,body.classId);break;
     case 'team/remove':game.removeMember(id,body.memberId);break;
     case 'team/ready':game.setReady(id,body.ready);break;
     case 'team/leader':game.transferLeader(id,body.memberId);break;
     case 'pet/equip':game.equipPet(id,body.petId);break;
     case 'pet/rename':game.renamePet(id,body.petId,body.name);break;
     case 'equipment/equip':game.equipEquipment(id,body.itemId);break;
     case 'equipment/unequip':game.unequipEquipment(id,body.slot);break;
     case 'equipment/auto':game.autoEquipment(id);break;
     case 'bag/use':game.useSupply(id,body.itemId);break;
     case 'rest':game.rest(id);break;
     case 'settings':game.settings(id,body.classId,Number(body.level));break;
     case 'move':{const encountered=game.move(id,Number(body.x),Number(body.y));if(encountered){schedule(game.key(id));await saveNow();}notify();json(response,200,snapshot(id));return;}
     case 'encounter':game.startEncounter(id,body.species,body.rarity);schedule(game.key(id));break;
     case 'action':{const b=game.battleFor(id);if(b?.busy)throw new Error('动作正在演出，请稍候');game.act(id,body);b.busy=true;schedule(game.key(id),true);break;}
     case 'battle/finish':game.finishBattle(id);cancelSchedule(game.key(id));break;
     case 'battle/retreat':game.retreat(id);cancelSchedule(game.key(id));break;
     default:json(response,404,{error:'接口不存在'});return;
    }
    notify();await saveNow();json(response,200,snapshot(id));return;
   }
   const pathname=url.pathname==='/'?'/first-map-v1/index.html':decodeURIComponent(url.pathname),file=path.resolve(root,'.'+pathname);
   if(!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
   const bytes=await fs.readFile(file);response.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});response.end(bytes);
  }catch(error){if(response.headersSent){response.end();return;}json(response,error.status||(error.code==='ENOENT'?404:409),{error:error.message});}
 });
 for(const [key,battle] of game.battles)if(battle.status==='active')schedule(key);
 async function stop(){for(const timer of timers.values())clearTimeout(timer);for(const connections of clients.values())for(const response of connections)response.end();await writeQueue;server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}
 return {server,game,saveNow,stop};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=await createApp();app.server.listen(4177,'127.0.0.1',()=>console.log('First map: http://127.0.0.1:4177/first-map-v1/index.html'));
}
