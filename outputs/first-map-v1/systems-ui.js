const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const disabled = condition => condition ? ' disabled' : '';
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function createSystemsPanels({config, equipment, items, getState, command, openEquipment, toast, gearIcon, gearStats}) {
 const roots = {
  team: document.querySelector('#team-content'),
  pets: document.querySelector('#pet-list'),
  bag: document.querySelector('#bag-content')
 };
 const signatures = {team: '', pets: '', bag: ''};
 const pending = {team: false, pets: false, bag: false};
 const medicines = items || [];
 let roomDraft = '', companionClass = config.classes[0]?.id || '';
 let selectedPet = null, renameDraft = '', renameDirty = false;
 let bagFilter = 'all', selectedBagItem = null;
 const medicineTargets = {hp: null, mp: null};

 function paint(root, html) {
  const active = document.activeElement;
  const focus = root.contains(active) && active.dataset.focusKey ? {
   key: active.dataset.focusKey,
   start: active.selectionStart,
   end: active.selectionEnd
  } : null;
  const scroll = new Map([...root.querySelectorAll('[data-sys-scroll]')].map(node => [node.dataset.sysScroll, node.scrollTop]));
  root.innerHTML = html;
  root.querySelectorAll('[data-sys-scroll]').forEach(node => { node.scrollTop = scroll.get(node.dataset.sysScroll) || 0; });
  if (focus) {
   const next = [...root.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focus.key);
   if (next) {
    next.focus({preventScroll: true});
    if (typeof focus.start === 'number' && next.setSelectionRange) next.setSelectionRange(focus.start, focus.end);
   }
  }
 }

 async function perform(panel, route, body = {}, message = '') {
  if (pending[panel]) return null;
  pending[panel] = true;
  renderers[panel](true);
  try {
   const result = await command(route, body);
   if (result && message) toast(message);
   return result;
  } finally {
   pending[panel] = false;
   renderers[panel](true);
  }
 }

 function memberReady(member) { return member.ready === true || member.npc && member.ready !== false; }
 function petName(pet) {
  return pet.name || (config.rarities[pet.rarity]?.name || '') + (config.zones.find(zone => zone.id === pet.species)?.name || '灵宠');
 }
 function petArt(pet) { return 'assets/' + encodeURIComponent(pet.species) + '-' + encodeURIComponent(pet.rarity) + '.png'; }
 function quality(item) { return equipment.qualities.find(entry => entry.id === item.quality) || equipment.qualities[0]; }
 function countItem(player, itemId) { return Math.max(0, number(player.supplies?.[itemId])); }
 function nearInn(player) {
  return Math.hypot(player.x - config.world.spawn[0], player.y - config.world.spawn[1]) <= 120;
 }
 function currentVitals(state) {
  return state.battle?.allies?.find(ally => ally.id === state.player.id) || state.player.vitals || state.player.stats;
 }
 function resourceMeter(name, value, maximum, className) {
  const percent = maximum > 0 ? Math.min(100, Math.max(0, value / maximum * 100)) : 0;
  return '<div class="sys-resource ' + className + '"><div><span>' + name + '</span><strong>' + value + ' / ' + maximum + '</strong></div><span class="sys-resource-track"><i style="width:' + percent + '%"></i></span></div>';
 }

 function renderTeam(force = false) {
  const state = getState(), root = roots.team;
  if (!state?.player || !root) return;
  const player = state.player, team = state.party, battle = !!state.battle;
  const signature = JSON.stringify([player.id, player.name, player.classId, player.level, team?.code, team?.leader,
   team?.members.map(member => [member.id, member.name, member.profession, member.classId, member.level, member.connected, member.npc, member.ready, member.equippedPet, member.pets?.find(pet => pet.id === member.equippedPet)]), battle, pending.team]);
  if (!force && signatures.team === signature) return;
  signatures.team = signature;
  const locked = battle || pending.team;
  if (!team) {
   paint(root, '<div class="sys-shell sys-team-start" data-sys-scroll="team"><div class="sys-solo-intro"><img src="../cast-v5/' + esc(player.classId) + '.png" alt="' + esc(player.name) + '"><div><span class="sys-eyebrow">结伴山行</span><h3>邀同道，一起历练</h3><p>单人遭遇1—2只怪物。队伍最多5人，每人可携1只宠物。</p></div></div><div class="sys-team-entry"><section class="sys-entry-card"><h4>创建队伍</h4><p>成为队长后，可邀请真人玩家或剧情AI。</p><button type="button" class="primary" data-team-action="create"' + disabled(locked) + '>创建队伍</button></section><form class="sys-entry-card" data-team-join><h4>输入房号加入</h4><label class="sys-form-label" for="sys-room-code">六位房号</label><div class="sys-inline-form"><input id="sys-room-code" data-focus-key="room" name="room" aria-label="队伍房号" placeholder="例如 A1B2C3" value="' + esc(roomDraft) + '" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" autocomplete="off" autocapitalize="characters" spellcheck="false" required' + disabled(locked) + '><button type="submit" data-team-action="join"' + disabled(locked || roomDraft.length !== 6) + '>加入队伍</button></div><p class="sys-note">向队长索取房号，输入后即可加入。</p></form></div><p class="sys-state-note" role="status">' + (battle ? '请先返回地图，再创建或加入队伍。' : pending.team ? '正在处理队伍请求…' : '组队后，需要所有成员准备，队长在活动区移动才会遇敌。') + '</p></div>');
   return;
  }
  const mine = team.leader === player.id;
  const members = team.members, myself = members.find(member => member.id === player.id) || player;
  const readyCount = members.filter(memberReady).length, allReady = readyCount === members.length;
  const slots = Array.from({length: 5}, (_, index) => {
   const member = members[index];
   if (!member) return '<article class="sys-team-seat sys-seat-empty"><span class="sys-seat-number">席位 ' + (index + 1) + '</span><div class="sys-empty-seal" aria-hidden="true">候</div><strong>虚位以待</strong><small>等待同道加入</small></article>';
   const lead = member.id === team.leader, self = member.id === player.id;
   const pet = member.pets?.find(entry => entry.id === member.equippedPet);
   return '<article class="sys-team-seat' + (self ? ' sys-seat-self' : '') + '"><span class="sys-seat-number">席位 ' + (index + 1) + (self ? ' · 我' : '') + '</span><img class="sys-member-art" src="../cast-v5/' + esc(member.classId) + '.png" alt="' + esc(member.name) + '立绘"><h4 title="' + esc(member.name) + '">' + esc(member.name) + '</h4><p class="sys-member-class">' + member.level + '级 · ' + esc(member.profession || config.classes.find(entry => entry.id === member.classId)?.profession) + '</p><div class="sys-member-badges">' + (lead ? '<span class="sys-badge sys-badge-leader">队长</span>' : '') + '<span class="sys-badge">' + (member.npc ? '剧情AI' : '真人') + '</span></div><p class="sys-connection' + (!member.npc && !member.connected ? ' sys-connection-offline' : '') + '"><i></i>' + (member.npc ? '随队 · 自动行动' : member.connected ? '在线' : '离线 · AI代打') + '</p><strong class="sys-ready-state' + (memberReady(member) ? ' is-ready' : '') + '">' + (memberReady(member) ? '已准备' : '待准备') + '</strong><small class="sys-member-pet">' + (pet ? '携宠 · ' + esc(petName(pet)) : '未携宠') + '</small>' + (mine && !self ? '<div class="sys-member-actions"><button type="button" data-team-action="remove" data-member="' + esc(member.id) + '" aria-label="移出' + esc(member.name) + '"' + disabled(locked) + '>移出</button>' + (!member.npc ? '<button type="button" data-team-action="leader" data-member="' + esc(member.id) + '" aria-label="将队长转让给' + esc(member.name) + '"' + disabled(locked) + '>转让队长</button>' : '') + '</div>' : '') + '</article>';
  }).join('');
  paint(root, '<div class="sys-shell sys-team-scroll" data-sys-scroll="team"><div class="sys-room-bar"><div><small>队伍房号</small><code aria-label="队伍房号 ' + esc(team.code) + '">' + esc(team.code) + '</code></div><div class="sys-room-actions"><span>' + members.length + ' / 5人</span><button type="button" data-team-action="copy"' + disabled(pending.team) + '>复制房号</button><a href="index.html?new=1&amp;room=' + encodeURIComponent(team.code) + '" target="_blank" rel="noopener">新窗口加入 ↗</a></div></div><div class="sys-team-summary"><p>本场遇敌 <strong>' + members.length + '—' + Math.min(10, members.length * 2) + '只</strong><span>携宠不增加怪物数量</span></p><span class="sys-ready-summary' + (allReady ? ' is-ready' : '') + '">' + readyCount + ' / ' + members.length + '人已准备</span></div><div class="sys-team-grid" aria-label="队伍五个席位">' + slots + '</div><div class="sys-team-manage"><div class="sys-own-ready"><button type="button" class="' + (memberReady(myself) ? '' : 'primary') + '" data-team-action="ready"' + disabled(locked) + '>' + (memberReady(myself) ? '取消准备' : '我已准备') + '</button><span>' + (allReady ? '全员已准备，队长可移动遇敌。' : '全员准备后才会遇敌。') + '</span></div>' + (mine ? '<div class="sys-companion-form"><select data-focus-key="companion" aria-label="邀请剧情同伴职业"' + disabled(locked || members.length >= 5) + '>' + config.classes.map(entry => '<option value="' + esc(entry.id) + '"' + (entry.id === companionClass ? ' selected' : '') + '>' + esc(entry.name) + ' · ' + esc(entry.profession) + '</option>').join('') + '</select><button type="button" data-team-action="companion"' + disabled(locked || members.length >= 5) + '>' + (members.length >= 5 ? '队伍已满' : '邀请剧情AI') + '</button></div>' : '') + '<button type="button" class="sys-quiet-danger" data-team-action="leave"' + disabled(locked) + '>' + (mine ? '解散队伍' : '离开队伍') + '</button></div><p class="sys-state-note" role="status">' + (battle ? '请先返回地图，再调整队伍、准备状态或队长。' : pending.team ? '正在处理队伍请求…' : '真人玩家各自操作；剧情AI与离线玩家自动行动。') + '</p></div>');
 }

 function renameReason(state, pet) {
  if (pending.pets) return '正在保存…';
  if (state.battle) return '返回地图后可调整出战与昵称。';
  if (!renameDraft.trim()) return '请输入宠物昵称。';
  if (Array.from(renameDraft.trim()).length > 12) return '昵称最多12字。';
  if (renameDraft.trim() === petName(pet)) return '昵称最多12字，修改后保存。';
  return '保存后使用新昵称。';
 }
 function canRename(state, pet) {
  return !state.battle && !pending.pets && renameDraft.trim() && Array.from(renameDraft.trim()).length <= 12 && renameDraft.trim() !== petName(pet);
 }
 function renderPets(force = false) {
  const state = getState(), root = roots.pets;
  if (!state?.player || !root) return;
  const player = state.player, pets = player.pets || [];
  const pet = pets.find(entry => entry.id === selectedPet) || pets.find(entry => entry.id === player.equippedPet) || pets[0];
  if (selectedPet !== pet?.id) { selectedPet = pet?.id || null; renameDirty = false; }
  if (pet && !renameDirty) renameDraft = petName(pet);
  const signature = JSON.stringify([player.id, pets, player.equippedPet, !!state.battle, pending.pets, selectedPet]);
  if (!force && signatures.pets === signature) return;
  signatures.pets = signature;
  if (!pet) {
   paint(root, '<div class="sys-pet-empty"><div class="sys-empty-seal" aria-hidden="true">宠</div><h3>山间灵宠，等你结缘</h3><p>在活动区移动随机遇敌，战斗中选择“捕捉”。</p><small>宝宝更易捕获，降低怪物气血可提高成功率。<br>每人同时出战1只宠物。</small></div>');
   return;
  }
  const rarity = config.rarities[pet.rarity], equipped = pet.id === player.equippedPet;
  const xp = number(pet.xp), nextXp = number(pet.nextXp) || 60 + number(pet.level) * 20;
  const stats = pet.stats || {}, ability = pet.ability;
  const cards = pets.map(entry => '<button type="button" class="sys-pet-card ' + esc(entry.rarity) + '" data-focus-key="pet-' + esc(entry.id) + '" data-pet-select="' + esc(entry.id) + '" aria-label="查看' + esc(petName(entry)) + '，' + entry.level + '级' + (entry.id === player.equippedPet ? '，当前出战' : '') + '" aria-pressed="' + (entry.id === pet.id) + '"><img src="' + petArt(entry) + '" alt=""><strong>' + esc(petName(entry)) + '</strong><small>' + entry.level + '级 · ' + esc(config.rarities[entry.rarity]?.name) + '</small>' + (entry.id === player.equippedPet ? '<span class="sys-equipped-mark">出战</span>' : '') + '</button>').join('');
  paint(root, '<div class="sys-pets-layout"><section class="sys-pet-archive" aria-label="我的宠物收藏"><div class="sys-section-head"><h3>宠物收藏</h3><span>' + pets.length + '只 · 出战' + (player.equippedPet ? 1 : 0) + '只</span></div><div class="sys-pet-cards" data-sys-scroll="pets">' + cards + '</div></section><section class="sys-pet-detail ' + esc(pet.rarity) + '" data-sys-scroll="pet-detail" aria-label="宠物详情"><div class="sys-pet-title"><div><span class="sys-eyebrow">' + esc(rarity?.name) + '灵宠</span><h3>' + esc(petName(pet)) + '</h3></div><span class="sys-badge' + (equipped ? ' sys-badge-leader' : '') + '">' + (equipped ? '当前出战' : '休息中') + '</span></div><div class="sys-pet-body"><div class="sys-pet-stage"><div class="sys-pet-ring" aria-hidden="true"></div><img src="' + petArt(pet) + '" alt="' + esc(petName(pet)) + '形象"><span>' + pet.level + '级 · 成长 ' + number(rarity?.growth).toFixed(2) + '×</span></div><div class="sys-pet-info"><div class="sys-pet-xp"><div><span>修行经验</span><strong>' + xp + ' / ' + nextXp + '</strong></div><span class="sys-xp-track" role="progressbar" aria-label="宠物升级经验" aria-valuemin="0" aria-valuemax="' + nextXp + '" aria-valuenow="' + Math.min(nextXp, xp) + '"><i style="width:' + Math.min(100, xp / nextXp * 100) + '%"></i></span></div><dl class="sys-pet-stats">' + [['maxHp','气血'],['atk','攻击'],['def','防御'],['speed','速度']].map(([key, label]) => '<div><dt>' + label + '</dt><dd>' + esc(stats[key] ?? '—') + '</dd></div>').join('') + '</dl><div class="sys-pet-ability"><div><strong>' + esc(ability?.name || '物种技能') + '</strong><span>每' + (number(ability?.cooldown) || 3) + '轮自动使用</span></div><p>' + esc(ability?.description || '宠物在独立回合自动普攻，并自动发动物种技能。') + '</p></div></div></div><div class="sys-pet-actions"><button type="button" class="primary" data-pet-action="equip"' + disabled(!!state.battle || pending.pets) + '>' + (equipped ? '收回休息' : '设为出战') + '</button><span>' + (state.battle ? '请先返回地图。' : equipped ? '每人同时出战1只宠物。' : player.equippedPet ? '会替换当前出战宠物。' : '下场战斗自动参战。') + '</span></div><form class="sys-rename-form" data-pet-rename><label for="sys-pet-name">宠物昵称</label><input id="sys-pet-name" data-focus-key="pet-name" aria-label="宠物昵称，最多12字" value="' + esc(renameDraft) + '" maxlength="12" autocomplete="off"' + disabled(!!state.battle || pending.pets) + '><button type="submit"' + disabled(!canRename(state, pet)) + '>保存昵称</button><p class="sys-note" data-rename-note>' + renameReason(state, pet) + '</p></form><p class="sys-pet-footnote">独立回合 · 自动普攻与物种技能</p></section></div>');
 }

 function medicineIcon(item) {
  if (item.resource === 'mp') return '<svg class="sys-item-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M26 10h12v8c0 5 8 7 8 14 0 4-2 6-5 8 7 2 11 7 11 13 0 7-9 9-20 9s-20-2-20-9c0-6 4-11 11-13-3-2-5-4-5-8 0-7 8-9 8-14Z" fill="#b5c5a0" stroke="#657f67" stroke-width="2"/><path d="M26 8h12M23 25c5 3 13 3 18 0M22 42c7 3 13 3 20 0" fill="none" stroke="#687e67" stroke-width="3" stroke-linecap="round"/><path d="M22 27c-5 9 6 18 18 23" fill="none" stroke="#dec69d" stroke-width="4" stroke-linecap="round"/><path d="m33 22 5 4-5 6-5-6Z" fill="#f3ecd1"/></svg>';
  return '<svg class="sys-item-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M16 23 12 55c0 4 8 6 20 6s20-2 20-6l-4-32Z" fill="#e6d3b4" stroke="#997b5e" stroke-width="2"/><path d="M15 21c4-4 30-4 34 0v7c-7 4-27 4-34 0Z" fill="#7c9b75" stroke="#657d5e" stroke-width="2"/><path d="M29 10c-6 0-9 5-8 10h22c1-5-2-10-8-10Z" fill="#f4edda" stroke="#b29c78" stroke-width="2"/><path d="M18 34c9 4 19 4 29 0M19 52c8 3 18 3 27 0" fill="none" stroke="#c4aa81" stroke-width="2"/><circle cx="32" cy="43" r="8" fill="#f7f1df" stroke="#b0976c" stroke-width="1.5"/><path d="M28 43h8m-4-4v8" stroke="#8b7051" stroke-width="2" stroke-linecap="round"/></svg>';
 }
 function medicineUse(state, item) {
  const battle = state.battle, player = state.player;
  const resource = item.resource, maximumKey = resource === 'hp' ? 'maxHp' : 'maxMp';
  let target = currentVitals(state), targets = [];
  if (battle) {
   targets = (battle.allies || []).filter(ally => ally.hp > 0 && (resource === 'hp' || ally.kind === 'hero'));
   target = targets.find(ally => ally.id === medicineTargets[resource]) || targets.find(ally => ally.id === player.id && ally[resource] < ally[maximumKey]) || targets.find(ally => ally[resource] < ally[maximumKey]) || targets.find(ally => ally.id === player.id) || targets[0];
   medicineTargets[resource] = target?.id || null;
  }
  let reason = '';
  if (pending.bag) reason = '正在处理，请稍候…';
  else if (battle && battle.status !== 'active') reason = '本场战斗已结束，返回地图后可使用药品。';
  else if (battle?.busy) reason = '正在演出，结束后可使用药品。';
  else if (battle && battle.currentActor !== player.id) reason = '尚未轮到你行动。';
  else if (!countItem(player, item.id)) reason = '库存为0，暂时无法使用。';
  else if (!target) reason = '没有可使用药品的存活己方目标。';
  else if (target[resource] >= target[maximumKey]) reason = (battle ? target.name + '的' : '当前') + (resource === 'hp' ? '气血' : '法力') + '已满。';
  const recipient = battle ? target?.kind === 'hero' && [player, ...(state.party?.members || [])].find(member => member.id === target.id) : player;
  const amount = target ? recipient?.supplyRecovery?.[item.id] ?? Math.max(0, Math.min(item.amount, target[maximumKey] - target[resource])) : 0;
  return {target, targets, reason, amount};
 }
 function bagEntries(player) {
  const gear = (player.inventory || []).slice().sort((a, b) => b.level - a.level || equipment.qualities.findIndex(entry => entry.id === b.quality) - equipment.qualities.findIndex(entry => entry.id === a.quality)).map(item => ({kind: 'gear', key: 'gear:' + item.id, item}));
  const supplies = medicines.map(item => ({kind: 'supply', key: 'supply:' + item.id, item}));
  return bagFilter === 'gear' ? gear : bagFilter === 'supply' ? supplies : [...gear, ...supplies];
 }
 function renderBag(force = false) {
  const state = getState(), root = roots.bag;
  if (!state?.player || !root) return;
  const player = state.player, battle = state.battle, entries = bagEntries(player);
  const selected = entries.find(entry => entry.key === selectedBagItem) || entries[0];
  selectedBagItem = selected?.key || null;
  const selectedUse = selected?.kind === 'supply' ? medicineUse(state, selected.item) : null;
  const vitals = currentVitals(state), inn = nearInn(player);
  const signature = JSON.stringify([player.id, player.classId, player.level, player.inventory, player.equipment, player.supplies, player.supplyRecovery, vitals.hp, vitals.mp, vitals.maxHp, vitals.maxMp, inn,
   battle?.id, battle?.status, battle?.busy, battle?.currentActor, battle?.allies?.map(ally => [ally.id, ally.name, ally.kind, ally.hp, ally.maxHp, ally.mp, ally.maxMp]), bagFilter, selectedBagItem, medicineTargets, pending.bag]);
  if (!force && signatures.bag === signature) return;
  signatures.bag = signature;
  const wornIds = Object.values(player.equipment || {}).filter(Boolean), supplyCount = medicines.reduce((sum, item) => sum + countItem(player, item.id), 0);
  const cells = entries.map(entry => {
   const item = entry.item;
   if (entry.kind === 'gear') {
    const q = quality(item), worn = wornIds.includes(item.id);
    return '<button type="button" class="sys-bag-cell" data-focus-key="bag-' + esc(entry.key) + '" data-bag-select="' + esc(entry.key) + '" aria-pressed="' + (entry.key === selectedBagItem) + '" aria-label="查看' + esc(item.name) + '，' + esc(q.name) + '，' + item.level + '级' + (worn ? '，已穿戴' : '') + '" title="' + esc(gearStats(item)) + '" style="--item-quality:' + esc(q.color) + '">' + gearIcon(item.icon) + '<strong>' + esc(item.name) + '</strong><small>' + item.level + '级 · ' + esc(q.name) + '</small>' + (worn ? '<span class="sys-equipped-mark">已穿戴</span>' : '') + '</button>';
   }
   const count = countItem(player, item.id);
   return '<button type="button" class="sys-bag-cell sys-supply-cell' + (!count ? ' sys-item-depleted' : '') + '" data-focus-key="bag-' + esc(entry.key) + '" data-bag-select="' + esc(entry.key) + '" aria-pressed="' + (entry.key === selectedBagItem) + '" aria-label="查看' + esc(item.name) + '，库存' + count + '份" style="--item-quality:' + (item.resource === 'hp' ? '#927653' : '#637f80') + '">' + medicineIcon(item) + '<strong>' + esc(item.name) + '</strong><small>恢复' + (item.resource === 'hp' ? '气血' : '法力') + '</small><span class="sys-item-count">×' + count + '</span></button>';
  }).join('');
  let detail = '<div class="sys-detail-empty"><div class="sys-empty-seal" aria-hidden="true">囊</div><p>选择物品，查看属性或使用药品。</p></div>';
  if (selected?.kind === 'gear') {
   const item = selected.item, q = quality(item), worn = wornIds.includes(item.id);
   const profession = config.classes.find(entry => entry.id === item.classId)?.profession;
   const slot = equipment.slots.find(entry => entry.id === item.slot)?.name;
   const reason = item.classId && item.classId !== player.classId ? '限' + profession + '使用。' : item.level > player.level ? '人物达到' + item.level + '级后可穿戴。' : worn ? '这件装备正在使用。' : '已满足穿戴要求。';
   detail = '<div class="sys-bag-detail-art" style="--item-quality:' + esc(q.color) + '">' + gearIcon(item.icon) + '<span>' + esc(q.name) + '</span></div><h3 style="color:' + esc(q.color) + '">' + esc(item.name) + '</h3><p class="sys-detail-caption">' + item.level + '级 · ' + esc(slot) + ' · ' + (profession ? esc(profession) + '专用' : '全职业通用') + '</p><dl class="sys-item-stats">' + Object.entries(item.stats || {}).map(([key, value]) => '<div><dt>' + esc(equipment.statNames[key] || key) + '</dt><dd>+' + value + '</dd></div>').join('') + '</dl><p class="sys-state-note">' + esc(reason) + '</p><button type="button" class="primary sys-wide-button" data-bag-action="equipment">前往装备</button><p class="sys-note">' + (battle ? '返回地图后可穿戴或卸下装备。' : '在装备页进行穿戴、替换与属性比较。') + '</p>';
  } else if (selected?.kind === 'supply') {
   const item = selected.item, use = selectedUse, resourceName = item.resource === 'hp' ? '气血' : '法力';
   detail = '<div class="sys-bag-detail-art sys-medicine-art">' + medicineIcon(item) + '<span>恢复药品</span></div><h3>' + esc(item.name) + '</h3><p class="sys-detail-caption">恢复' + item.amount + '点' + resourceName + ' · 库存 ' + countItem(player, item.id) + '份</p><p class="sys-item-description">' + esc(item.description) + '</p>' + (battle ? '<label class="sys-medicine-target">使用目标<select data-focus-key="medicine-target" aria-label="药品使用目标"' + disabled(pending.bag || !use.targets.length) + '>' + (use.targets.length ? use.targets.map(ally => '<option value="' + esc(ally.id) + '"' + (use.target?.id === ally.id ? ' selected' : '') + '>' + esc(ally.name) + (ally.kind === 'pet' ? ' · 宠物' : '') + ' · ' + number(ally[item.resource]) + '/' + number(ally[item.resource === 'hp' ? 'maxHp' : 'maxMp']) + '</option>').join('') : '<option>无存活目标</option>') + '</select></label><p class="sys-note">' + (item.resource === 'hp' ? '气血药可用于人物和宠物。' : '法力药可用于己方人物。') + '使用消耗一次人物行动。</p>' : '<div class="sys-medicine-preview"><span>用于自己</span><strong>' + number(vitals[item.resource]) + ' / ' + number(vitals[item.resource === 'hp' ? 'maxHp' : 'maxMp']) + '</strong></div>') + '<button type="button" class="primary sys-wide-button" data-bag-action="use"' + disabled(!!use.reason) + '>' + (battle ? '使用 · 消耗一次行动' : '使用' + esc(item.name)) + '</button><p class="sys-state-note" role="status">' + esc(use.reason || '预计恢复' + use.amount + '点' + resourceName + '。') + '</p>';
  }
  const restReason = battle ? '战斗结束后，先返回地图。' : pending.bag ? '正在处理行囊请求…' : inn ? '石溪驿站 · 可休整' : '回到石溪驿站附近可休整';
  paint(root, '<div class="sys-shell sys-bag-shell"><div class="sys-bag-summary"><div><strong>' + (player.inventory?.length || 0) + '件装备 · ' + supplyCount + '份药品</strong><span>已穿戴' + wornIds.length + '件 · 恢复药品' + medicines.length + '种</span></div><div class="sys-vitals">' + resourceMeter('气血', number(vitals.hp), number(vitals.maxHp), 'sys-hp') + resourceMeter('法力', number(vitals.mp), number(vitals.maxMp), 'sys-mp') + '</div></div><div class="sys-bag-layout"><section class="sys-bag-inventory" aria-label="物品列表"><nav class="sys-bag-filters" aria-label="筛选行囊">' + [['all','全部'],['gear','装备'],['supply','恢复药品']].map(([value, name]) => '<button type="button" data-bag-filter="' + value + '" aria-pressed="' + (bagFilter === value) + '">' + name + '</button>').join('') + '</nav><div class="sys-bag-grid" data-sys-scroll="bag">' + (cells || '<p class="sys-bag-empty">暂无装备，击败怪物有机会获得。</p>') + '</div></section><section class="sys-bag-detail" aria-label="物品详情" data-sys-scroll="bag-detail">' + detail + '</section></div><div class="sys-inn-footer"><div><strong>驿站休整</strong><span>' + restReason + '</span></div><button type="button" data-bag-action="rest"' + disabled(!!battle || pending.bag || !inn) + '>休整</button></div></div>');
 }

 roots.team?.addEventListener('input', event => {
  if (event.target.id !== 'sys-room-code') return;
  roomDraft = event.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
  event.target.value = roomDraft;
  const button = roots.team.querySelector('[data-team-action="join"]');
  if (button) button.disabled = pending.team || !!getState().battle || roomDraft.length !== 6;
 });
 roots.team?.addEventListener('change', event => {
  if (event.target.dataset.focusKey === 'companion') companionClass = event.target.value;
 });
 roots.team?.addEventListener('submit', async event => {
  if (!event.target.matches('[data-team-join]')) return;
  event.preventDefault();
  if (roomDraft.length !== 6 || getState().battle || pending.team) return;
  await perform('team', 'team/join', {code: roomDraft}, '已加入队伍。');
 });
 roots.team?.addEventListener('click', async event => {
  const button = event.target.closest('[data-team-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.teamAction;
  if (action === 'join') return;
  const state = getState(), team = state.party;
  if (action === 'copy') {
   pending.team = true; renderTeam(true);
   try { await navigator.clipboard.writeText(team.code); toast('房号已复制。'); }
   catch { toast('房号复制失败，请手动选择房号复制。'); }
   finally { pending.team = false; renderTeam(true); }
   return;
  }
  if (state.battle || pending.team) return;
  if (action === 'create') await perform('team', 'team/create', {}, '队伍已创建。');
  if (action === 'companion') await perform('team', 'team/companion', {classId: companionClass}, '剧情同伴已加入。');
  if (action === 'remove') await perform('team', 'team/remove', {memberId: button.dataset.member});
  if (action === 'leader') await perform('team', 'team/leader', {memberId: button.dataset.member}, '队长已转让。');
  if (action === 'leave') await perform('team', 'team/leave', {}, team?.leader === state.player.id ? '队伍已解散。' : '已离开队伍。');
  if (action === 'ready') await perform('team', 'team/ready', {ready: !memberReady(team.members.find(member => member.id === state.player.id))});
 });

 roots.pets?.addEventListener('click', async event => {
  const select = event.target.closest('[data-pet-select]');
  if (select) { selectedPet = select.dataset.petSelect; renameDirty = false; renderPets(true); return; }
  const button = event.target.closest('[data-pet-action="equip"]'), state = getState();
  if (!button || button.disabled || state.battle || pending.pets) return;
  const pet = state.player.pets.find(entry => entry.id === selectedPet);
  if (!pet) return;
  const equipped = state.player.equippedPet === pet.id;
  await perform('pets', 'pet/equip', {petId: equipped ? null : pet.id}, equipped ? '宠物已收回休息。' : petName(pet) + '已设为出战。');
 });
 roots.pets?.addEventListener('input', event => {
  if (event.target.id !== 'sys-pet-name') return;
  renameDraft = event.target.value; renameDirty = true;
  const state = getState(), pet = state.player.pets.find(entry => entry.id === selectedPet);
  roots.pets.querySelector('[data-pet-rename] button').disabled = !canRename(state, pet);
  roots.pets.querySelector('[data-rename-note]').textContent = renameReason(state, pet);
 });
 roots.pets?.addEventListener('submit', async event => {
  if (!event.target.matches('[data-pet-rename]')) return;
  event.preventDefault();
  const state = getState(), pet = state.player.pets.find(entry => entry.id === selectedPet);
  if (!pet || !canRename(state, pet)) return;
  const result = await perform('pets', 'pet/rename', {petId: pet.id, name: renameDraft.trim()}, '宠物昵称已保存。');
  if (result) { renameDirty = false; renderPets(true); }
 });

 roots.bag?.addEventListener('change', event => {
  if (event.target.dataset.focusKey !== 'medicine-target') return;
  const entry = bagEntries(getState().player).find(item => item.key === selectedBagItem);
  if (entry?.kind === 'supply') { medicineTargets[entry.item.resource] = event.target.value; renderBag(true); }
 });
 roots.bag?.addEventListener('click', async event => {
  const filter = event.target.closest('[data-bag-filter]');
  if (filter) { bagFilter = filter.dataset.bagFilter; selectedBagItem = null; renderBag(true); return; }
  const select = event.target.closest('[data-bag-select]');
  if (select) { selectedBagItem = select.dataset.bagSelect; renderBag(true); return; }
  const button = event.target.closest('[data-bag-action]');
  if (!button || button.disabled) return;
  const state = getState(), action = button.dataset.bagAction;
  const entry = bagEntries(state.player).find(item => item.key === selectedBagItem);
  if (action === 'equipment' && entry?.kind === 'gear') { openEquipment(entry.item.id); return; }
  if (pending.bag) return;
  if (action === 'rest' && !state.battle && nearInn(state.player)) await perform('bag', 'rest', {}, '驿站休整完成。');
  if (action === 'use' && entry?.kind === 'supply') {
   const use = medicineUse(state, entry.item);
   if (use.reason) { toast(use.reason); renderBag(true); return; }
   await perform('bag', state.battle ? 'action' : 'bag/use', state.battle ? {type: 'item', itemId: entry.item.id, targetId: use.target.id} : {itemId: entry.item.id}, '已使用' + entry.item.name + '。');
  }
 });

 const renderers = {team: renderTeam, pets: renderPets, bag: renderBag};
 return {renderTeam, renderPets, renderBag};
}
