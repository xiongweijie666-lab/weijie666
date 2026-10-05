const durations={
 'swordsman-luqinglan':{a:1100,b:1350,ultimate:2250},
 'saber-hanpoyue':{a:1400,b:1550,ultimate:2450},
 'assassin-xieqian':{a:1200,b:1200,ultimate:2200},
 'mage-suyingyue':{a:1450,b:1800,ultimate:2800},
 'healer-shenzhiwei':{a:1500,b:1750,ultimate:2850}
};

export function actionDuration(classId,type,skillId){
 if(type==='skill')return durations[classId]?.[skillId]||1500;
 return {normal:850,defend:850,capture:1500,item:1250,'pet-skill':1350}[type]||850;
}

// Keep the approved standing pose still; animate only a deliberate action.
export function resolveFrame(clip,time){
 if(clip.id==='idle')return 0;
 const frame=Math.max(0,Math.floor(time/1000*clip.fps));
 return clip.loopInGame?frame%clip.frames.length:Math.min(frame,clip.frames.length-1);
}

export const skillArt={
 'swordsman-luqinglan':{color:'#6be6e1',deep:'#338f9f',cells:{a:0,b:1,ultimate:2},theme:'岚风 · 剑气'},
 'saber-hanpoyue':{color:'#ffbb65',deep:'#dc654b',cells:{a:3,b:4,ultimate:5},theme:'裂岩 · 霸刀'},
 'assassin-xieqian':{color:'#b6b9ff',deep:'#60598d',cells:{a:6,b:7,ultimate:8},theme:'影遁 · 刃光'},
 'mage-suyingyue':{color:'#dcc0ff',deep:'#9073d3',cells:{a:9,b:10,ultimate:11},theme:'星火 · 月阵'},
 'healer-shenzhiwei':{color:'#a4f1ac',deep:'#4b9e74',cells:{a:12,b:13,ultimate:14},theme:'百草 · 青莲'}
};

export function effectTargets(event){
 return [...new Set(event.targets?.length?event.targets:[event.targetId,...(event.hits||[]).map(h=>h.id)].filter(Boolean))];
}

export function targetEffect(event,actor,unit){
 const hits=(event.hits||[]).filter(hit=>hit.id===unit?.id);
 if(hits.some(hit=>hit.type==='heal'))return 'heal';
 if(hits.some(hit=>hit.type==='mana'))return 'mana';
 const bonus=event.bonusEffects?.find(effect=>effect.id===unit?.id&&['heal','mana','shield','protect','rage','stealth'].includes(effect.type));
 if(bonus)return bonus.type==='heal'?'heal':bonus.type==='mana'?'mana':'support';
 if(event.kind==='normal'&&actor.classId==='healer-shenzhiwei'&&unit?.id===actor.id)return 'heal';
 if(event.kind==='pet-skill'&&unit?.kind!=='enemy')return 'support';
 return 'damage';
}

const clamp=value=>Math.max(0,Math.min(1,value));
const windowAlpha=(p,start,end)=>p<start||p>end?0:Math.sin((p-start)/(end-start)*Math.PI);
const smooth=value=>{const t=clamp(value);return t*t*(3-2*t);};

export function actionPose(event,actor,progress,from,to){
 const idle={pose:'idle',time:0,x:0,y:0,alpha:1};
 if(progress<0||progress>=1)return idle;
 const attack=event.kind==='normal'||event.kind==='pet-skill';
 const pose=attack?'attack':['skill','capture','item'].includes(event.kind)?'cast':'idle';
 const out={...idle,pose,time:Math.max(0,(progress-.08)*event.durationMs)};
 const melee=event.kind==='normal'||event.kind==='skill'&&(actor.classId?.startsWith('swordsman')&&event.skillId==='a'||actor.classId?.startsWith('assassin'));
 if(melee&&to){const travel=windowAlpha(progress,.22,.82);out.x=(to.x-from.x)*travel*.66;out.y=(to.y-from.y)*travel*.38;}
 if(actor.classId==='assassin-xieqian'&&event.kind==='skill'&&progress>.27&&progress<.42)out.alpha=.3;
 if(progress>.88)out.pose='idle';
 return out;
}

// One effect recipe per skill, built from transparent painted textures and
// continuous trails. Character drawings are never stretched or warped.
export function drawEffects(ctx,{event,actor,spots,units,progress:p,width:w,height:h,atlas,layer='front'}){
 if(!event||!actor||p<0||p>1)return;
 const from=spots.get(actor.id);if(!from)return;
 const targets=effectTargets(event).map(id=>({unit:units.find(u=>u.id===id),...spots.get(id)})).filter(t=>Number.isFinite(t.x));
 const art=skillArt[actor.classId]||{color:'#f2d28b',deep:'#9d804b',cells:{}},s=Math.min(w/730,h/410),rank=Math.min(3,event.skillRank||event.passiveRank||1),base=Math.max(.4,s)*(1+.08*(rank-1)),ultimate=event.skillId==='ultimate';
 const color=event.kind==='item'?(event.itemId==='mp-pill'?'#a8cfff':'#b6ecc3'):event.kind==='capture'?'#f3d48b':art.color;
 const source={x:from.x,y:from.y-from.size*.46};
 function sprite(cell,x,y,size,alpha=1,rotation=0){
  if(!atlas?.complete||!atlas.naturalWidth||alpha<=0)return;
  const cw=atlas.naturalWidth/4,ch=atlas.naturalHeight/4;
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.globalAlpha*=alpha;ctx.drawImage(atlas,cell%4*cw,Math.floor(cell/4)*ch,cw,ch,-size/2,-size/2,size,size);ctx.restore();
 }
 function glow(x,y,r,a=.7,c=color){
  const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,c);g.addColorStop(.18,c+'aa');g.addColorStop(1,c+'00');ctx.save();ctx.globalAlpha*=a;ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 function ring(x,y,r,a=1,turn=0,c=color){
  ctx.save();ctx.globalAlpha*=a;ctx.translate(x,y);ctx.scale(1,.36);ctx.rotate(turn);ctx.strokeStyle=c;ctx.lineWidth=1.6/base;ctx.shadowColor=c;ctx.shadowBlur=8*base;
  for(const scale of [1,.84]){ctx.beginPath();ctx.arc(0,0,r*scale,0,Math.PI*2);ctx.stroke();}
  for(let i=0;i<12;i++){ctx.save();ctx.rotate(i*Math.PI/6);ctx.strokeRect(r*.9,-3*base,6*base,6*base);ctx.restore();}ctx.restore();
 }
 function motes(x,y,r,a=1,c=color,count=18,seed=0){
  ctx.save();ctx.globalAlpha*=a;ctx.fillStyle=c;ctx.shadowColor=c;ctx.shadowBlur=5*base;
  for(let i=0;i<count;i++){const angle=i*2.39996+p*2+seed,spread=r*(.24+((i*17)%23)/30),up=(p*60+i*7)%60*base;const px=x+Math.cos(angle)*spread,py=y+Math.sin(angle)*spread*.4-up;ctx.beginPath();ctx.arc(px,py,(i%3*.5+.8)*base,0,Math.PI*2);ctx.fill();}ctx.restore();
 }
 function trail(a,b,q,cell=art.cells[event.skillId],c=color){
  const duration=smooth(q),bend=Math.min(100*base,Math.abs(b.x-a.x)*.25);
  ctx.save();ctx.lineCap='round';ctx.shadowColor=c;ctx.shadowBlur=12*base;
  for(let i=0;i<16;i++){const t=Math.max(0,duration-i*.026),x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t-Math.sin(t*Math.PI)*bend;ctx.globalAlpha=(1-i/16)*.65;ctx.fillStyle=c;ctx.beginPath();ctx.arc(x,y,(6-i*.22)*base,0,Math.PI*2);ctx.fill();}
  ctx.restore();const x=a.x+(b.x-a.x)*duration,y=a.y+(b.y-a.y)*duration-Math.sin(duration*Math.PI)*bend;sprite(cell,x,y,110*base,.96,-.18);
 }
 function slash(t,a=1,rotation=-.6,cell=15,scale=1){sprite(cell,t.x,t.y-t.size*.48,160*base*scale,a,rotation);}
 function impact(t,a=1,c=color){glow(t.x,t.y-t.size*.45,75*base,a*.55,c);sprite(15,t.x,t.y-t.size*.45,105*base,a);motes(t.x,t.y-t.size*.2,46*base,a,c,13);}
 function cracks(t,a=1){
  ctx.save();ctx.globalAlpha*=a;ctx.strokeStyle='#62453d';ctx.lineWidth=2*base;ctx.shadowColor='#ffb964';ctx.shadowBlur=9*base;
  for(let i=0;i<7;i++){const angle=i*Math.PI/3.5;ctx.beginPath();ctx.moveTo(t.x,t.y);for(let j=1;j<=4;j++)ctx.lineTo(t.x+Math.cos(angle)*j*18*base+(j%2?5:-5)*base,t.y+Math.sin(angle)*j*6*base);ctx.stroke();}ctx.restore();
 }
 ctx.save();
 if(layer==='back'){
  if(event.kind==='skill'){
   const windup=windowAlpha(p,0,.5);ring(from.x,from.y+2,from.size*.37,windup,p*2);glow(source.x,source.y,from.size*.48,windup*.26);
   if(ultimate){ctx.fillStyle='#192537';ctx.globalAlpha=windowAlpha(p,.03,.94)*.34;ctx.fillRect(0,0,w,h);ctx.globalAlpha=1;}
   for(const t of targets){const a=windowAlpha(p,.27,1);if(actor.classId==='mage-suyingyue'&&event.skillId==='b'){ring(t.x,t.y,65*base,a,p*.4);sprite(10,t.x,t.y-t.size*.15,160*base,a*.8);}else if(actor.classId==='healer-shenzhiwei'&&event.skillId!=='a'&&t.unit?.kind!=='enemy'){ring(t.x,t.y,65*base,a,p);sprite(13,t.x,t.y-15*base,130*base,a*.8);}else if(actor.classId==='saber-hanpoyue'&&p>.45)cracks(t,windowAlpha(p,.45,1));}
  }
  ctx.restore();return;
 }
 if(event.kind==='skill'){
  const anticipation=windowAlpha(p,0,.43);motes(source.x,source.y,from.size*.5,anticipation,color,ultimate?28:16);sprite(art.cells[event.skillId],source.x,source.y,ultimate?135*base:80*base,anticipation*.65);
  targets.forEach((t,index)=>{
   const hit={x:t.x,y:t.y-t.size*.4},q=(p-.24-index*.02)/.32,hitAlpha=windowAlpha(p,.49+index*.015,.98),release=windowAlpha(p,.22,.66);
   switch(actor.classId){
    case 'swordsman-luqinglan':
     if(event.skillId==='a'){if(q>=0&&q<=1.1)trail(source,hit,q,0);slash(t,hitAlpha,-.18,0,1.3);impact(t,hitAlpha);}
     else if(event.skillId==='b'){sprite(1,source.x+(hit.x-source.x)*smooth(q),source.y+(hit.y-source.y)*smooth(q),220*base,release,-.35+p*.9);slash(t,hitAlpha,.4-p,1,1.4);impact(t,hitAlpha);}
     else{sprite(2,hit.x,hit.y-95*base+smooth((p-.22)/.32)*95*base,260*base,windowAlpha(p,.17,.86));for(let i=0;i<4;i++){const a=windowAlpha(p,.44+i*.09,.64+i*.09);slash(t,a,-.7+i*.7,1,.95);impact(t,a);}}
     break;
    case 'saber-hanpoyue':
     if(t.unit?.id===actor.id){ring(from.x,from.y,70*base,hitAlpha,p,'#ffce8b');glow(source.x,source.y,from.size*.5,hitAlpha*.2,'#ffce8b');break;}
     if(event.skillId==='a'){sprite(4,hit.x,hit.y-130*base+smooth((p-.22)/.35)*130*base,235*base,release,-.95);sprite(3,t.x,t.y-15*base,260*base,hitAlpha);impact(t,hitAlpha,'#ffc682');}
     else if(event.skillId==='b'){sprite(4,hit.x,hit.y,260*base,windowAlpha(p,.28,.82),-.8+p*1.2);sprite(3,t.x,t.y-8*base,160*base,hitAlpha*.7);}
     else{sprite(5,hit.x,hit.y-160*base+smooth((p-.3)/.24)*145*base,320*base,windowAlpha(p,.16,.84));sprite(3,t.x,t.y-5*base,320*base,hitAlpha);ring(from.x,from.y,70*base,hitAlpha,p,'#ffce8b');}
     break;
    case 'assassin-xieqian':
     if(t.unit?.id===actor.id){sprite(6,source.x,source.y,140*base,release);break;}
     sprite(6,source.x,source.y,140*base,release);sprite(6,hit.x,hit.y,170*base,windowAlpha(p,.3,.91));
     if(event.skillId==='a'){slash(t,hitAlpha,-.65,7,1.2);slash(t,windowAlpha(p,.56,.9),.75,7,.9);}
     else if(event.skillId==='b'){slash(t,hitAlpha,-.15,7,1.2);motes(hit.x,hit.y,40*base,hitAlpha,'#dc80b1');ring(t.x,t.y,43*base,windowAlpha(p,.52,1),p,'#9f719f');}
     else{sprite(8,hit.x,hit.y,280*base,windowAlpha(p,.27,.94),p*.4);for(let i=0;i<5;i++){const a=windowAlpha(p,.34+i*.09,.54+i*.09);slash(t,a,i%2?.9:-.9,7,1.25);impact(t,a,'#b7b4fa');}}
     break;
    case 'mage-suyingyue':
     if(event.skillId==='a'){if(q>=0&&q<=1.15)trail(source,hit,q,9);sprite(11,hit.x,hit.y,180*base,hitAlpha);motes(hit.x,hit.y,70*base,hitAlpha,color,24);}
     else if(event.skillId==='b'){sprite(10,hit.x,hit.y,195*base,windowAlpha(p,.23,.98),p*.2);for(let i=0;i<3;i++){ctx.strokeStyle='#ccb8f0';ctx.globalAlpha=hitAlpha*.7;ctx.lineWidth=2*base;ctx.beginPath();ctx.ellipse(hit.x,hit.y,48*base,80*base,(i-1)*.7,0,Math.PI*2);ctx.stroke();}ctx.globalAlpha=1;motes(hit.x,hit.y,68*base,hitAlpha);}
     else{for(let i=0;i<3;i++){const at=(p-.22-i*.11-index*.025)/.28;if(at>0&&at<1.2)trail({x:hit.x-120*base-i*30*base,y:-80*base},hit,at,9);}sprite(11,hit.x,hit.y,310*base,hitAlpha);impact(t,hitAlpha);motes(hit.x,hit.y,120*base,hitAlpha,color,32);}
     break;
    case 'healer-shenzhiwei':
     if(event.skillId==='a'){if(q>=0&&q<=1.2)trail(source,hit,q,12);sprite(12,hit.x,hit.y,180*base,hitAlpha);ring(t.x,t.y,42*base,hitAlpha,p);motes(hit.x,hit.y,75*base,hitAlpha);}
     else if(event.skillId==='b'||t.unit?.kind!=='enemy'){sprite(13,hit.x,hit.y+10*base,225*base,windowAlpha(p,.29,.98),p*.2);motes(hit.x,hit.y+40*base,70*base,hitAlpha,color,26);glow(hit.x,hit.y,100*base,hitAlpha*.35);}
     else{sprite(12,hit.x,hit.y,190*base,hitAlpha);impact(t,hitAlpha);}
     break;
   }
  });
  if(actor.classId==='healer-shenzhiwei'&&ultimate){sprite(14,w*.46,h*.46,Math.min(h*.8,320*base),windowAlpha(p,.19,.9));motes(w*.46,h*.48,150*base,windowAlpha(p,.2,.93),color,40);}
  if(ultimate){const a=windowAlpha(p,.02,.42);ctx.save();ctx.globalAlpha=a;const g=ctx.createLinearGradient(0,0,w,0);g.addColorStop(0,'#18273500');g.addColorStop(.38,'#182735d9');g.addColorStop(.62,'#182735d9');g.addColorStop(1,'#18273500');ctx.fillStyle=g;ctx.fillRect(0,h*.1,w,44*base);ctx.textAlign='center';ctx.font=`${21*base}px SimSun,serif`;ctx.shadowColor=color;ctx.shadowBlur=8*base;ctx.fillStyle='#fff6dd';ctx.fillText(event.skillName,w/2,h*.1+28*base);ctx.restore();}
 }else if(event.kind==='normal'||event.kind==='pet-skill'){
  const a=windowAlpha(p,.36,.8);
  for(const t of targets){const effect=targetEffect(event,actor,t.unit);if(effect==='damage'){slash(t,a,-.55,actor.classId?.startsWith('saber')?4:15,.6);impact(t,a*.5);if(event.kind==='pet-skill')sprite(actor.species==='wolf'?7:actor.species==='boar'?3:9,t.x,t.y-t.size*.4,125*base,a);}else{const tint=effect==='mana'?'#a8cfff':effect==='support'?color:'#abebaf';ring(t.x,t.y,45*base,a,p,tint);if(effect!=='support')sprite(13,t.x,t.y-t.size*.4,125*base,a);motes(t.x,t.y,45*base,a,tint,14);}}
  if(event.passiveTriggered)ring(from.x,from.y,from.size*.4,a,p,color);
 }else if(event.kind==='capture'){
  for(const t of targets){const a=windowAlpha(p,.15,.98);ring(t.x,t.y,70*base,a,p*2,color);glow(t.x,t.y-t.size*.5,100*base,a*.3,color);ctx.strokeStyle=color;ctx.lineWidth=2*base;ctx.globalAlpha=a;for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(t.x,t.y-t.size*.4,45*base,70*base,(i-1)*.7+p,0,Math.PI*2);ctx.stroke();}ctx.globalAlpha=1;motes(t.x,t.y,70*base,a,color,24);}
 }else if(event.kind==='item'){
  for(const t of targets){const a=windowAlpha(p,.18,.98);sprite(13,t.x,t.y-t.size*.4,190*base,a);glow(t.x,t.y-t.size*.4,90*base,a*.4,color);motes(t.x,t.y,75*base,a,color,24);}
 }else if(event.kind==='defend')ring(from.x,from.y,from.size*.35,windowAlpha(p,.08,.94),p,color);
 ctx.restore();
}
