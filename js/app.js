/* ==========================================================================
   Academic Almanac — app.js
   Loads the official catalog from data.json (regenerated from Excel) and
   layers the user's own interactions — favourites, "interested" marks,
   comments, self-submitted posts, correction reports — on top, stored in
   this browser's localStorage under LOCAL_KEY. data.json can be replaced
   at any time without touching what's in localStorage, as long as post ids
   don't change.
   ========================================================================== */

/* ============================ CATEGORIES ============================ */
const CATS = [
  { id:'Conferences',                   color:'#CF0921' },
  { id:'PhD Courses & Summer Schools',   color:'#5C6B5C' },
  { id:'Workshops',                     color:'#8A6D3B' },
  { id:'Calls for Papers',              color:'#3B5B7A' },
  { id:'Calls for Special Issues',      color:'#6B4E7A' },
  { id:'Symposiums',                    color:'#A15A2E' },
  { id:'Seminars & Webinars',           color:'#3E7C7B' },
  { id:'Grants & Funding',              color:'#7C6A3E' },
  { id:'Jobs & Positions',              color:'#54455C' }
];
const catById = id => CATS.find(c => c.id === id) || {id, color:'#999'};

const RATING_SYSTEMS = [
  {sys:'ABS',  grades:['4*','4','3','2','1']},
  {sys:'ABDC', grades:['A*','A','B','C']},
  {sys:'VHB',  grades:['A+','A','B','C','D']},
  {sys:'FT50', grades:['Listed']}
];
const RATED_CATS = ['Conferences','Workshops','Symposiums','Calls for Papers','Calls for Special Issues'];
const ECTS_CATS = ['PhD Courses & Summer Schools','Seminars & Webinars','Workshops'];

const regionName = (() => { try { return new Intl.DisplayNames(['en'], {type:'region'}); } catch(e){ return null; } })();
function countryName(code){
  if (!code) return '';
  if (!regionName) return code;
  try { return regionName.of(code); } catch(e){ return code; }
}
const CC = ('AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TW TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE VN YE ZM ZW HK MO PR').split(' ');
const COUNTRIES = regionName ? CC.map(c => ({code:c, name:regionName.of(c)})).sort((a,b)=>a.name.localeCompare(b.name)) : CC.map(c=>({code:c,name:c}));
const CURRENCIES = 'EUR USD GBP CHF JPY CNY AUD CAD SEK NOK DKK PLN CZK HUF RON TRY INR BRL MXN ZAR SGD HKD KRW NZD AED SAR ILS THB MYR IDR'.split(' ');

/* ============================ LOCAL STATE ============================= */
const LOCAL_KEY = 'academic_almanac_local_v1';
function loadLocal(){
  try { const raw = localStorage.getItem(LOCAL_KEY); if (raw) return JSON.parse(raw); }
  catch(e){ console.warn('Local state reset:', e); }
  return null;
}
function saveLocal(){ localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); }

let local = loadLocal() || {
  user: 'Guest',
  filter: 'all',
  savedOnly: false,
  favs: [],                 // array of post ids
  interactions: {},         // { [id]: { interested:[names], comments:[{who,text,ts}], reports:[{who,text,ts}] } }
  userPosts: []             // posts created locally in the browser, same shape as official posts
};
if (!local.interactions) local.interactions = {};
if (!local.userPosts) local.userPosts = [];
saveLocal();

function interactionFor(id){
  if (!local.interactions[id]) local.interactions[id] = { interested:[], comments:[], reports:[] };
  return local.interactions[id];
}

/* ============================ DATA (from data.json) ==================== */
let officialPosts = [];   // loaded at startup, read-only, regenerated from Excel

async function loadData(){
  try {
    const res = await fetch('data.json', {cache:'no-store'});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    officialPosts = Array.isArray(json.posts) ? json.posts : [];
  } catch (e) {
    console.error('Could not load data.json:', e);
    officialPosts = [];
    document.getElementById('feed').innerHTML =
      '<div class="empty">Could not load data.json. Run scripts/generate.py, ' +
      'then serve this folder over http:// (not file://) — browsers block fetch() on local files.</div>';
  }
}

function allPosts(){
  // Official (from Excel) + this browser's own submissions, with interactions merged in.
  return officialPosts.concat(local.userPosts).map(p => {
    const it = local.interactions[p.id] || {interested:[], comments:[], reports:[]};
    return Object.assign({}, p, {
      interested: it.interested,
      comments: it.comments,
      reports: it.reports
    });
  });
}

/* ============================ HELPERS =============================== */
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function daysUntil(iso){ if(!iso) return null; return Math.ceil((new Date(iso+'T23:59:59') - new Date())/86400000); }
function fmtDate(iso){ if(!iso) return ''; return new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
function fmtRange(a,b){
  if(!a) return '';
  if(!b || a===b) return fmtDate(a);
  const da=new Date(a+'T12:00'), db=new Date(b+'T12:00');
  if(da.getMonth()===db.getMonth() && da.getFullYear()===db.getFullYear())
    return da.getDate()+'\u2013'+db.getDate()+' '+db.toLocaleDateString('en-GB',{month:'short',year:'numeric'});
  return fmtDate(a)+' \u2013 '+fmtDate(b);
}
function feeText(p){
  if (p.fee === null || p.fee === undefined || p.fee === '') return '';
  if (Number(p.fee) === 0) return 'Free';
  let t = Number(p.fee).toLocaleString('en-GB');
  if (p.feeMax) t += '\u2013' + Number(p.feeMax).toLocaleString('en-GB');
  return t + ' ' + (p.currency || '');
}
function pillFor(p){
  const d = daysUntil(p.subDeadline);
  if (d === null) return '';
  if (d < 0)   return '<span class="pill passed">passed</span>';
  if (d === 0) return '<span class="pill">today</span>';
  const cls = d <= 30 ? '' : ' far';
  return '<span class="pill'+cls+'">'+d+' day'+(d===1?'':'s')+'</span>';
}
function agoDays(iso){ if(!iso) return null; return Math.max(0, Math.floor((new Date() - new Date(iso+'T00:00'))/86400000)); }

/* ============================ RENDER ================================ */
const openCards = new Set();

function render(){
  const unameEl = document.getElementById('uname');
  if (unameEl) unameEl.textContent = local.user;
  const savedBtn = document.getElementById('savedfilter');
  if (savedBtn) savedBtn.classList.toggle('on', local.savedOnly);

  const tabBtn = c =>
    '<button class="'+(local.filter===c.id?'active':'')+'" onclick="setFilter(\''+esc(c.id).replace(/'/g,"\\'")+'\')">'+
    '<span class="dot" style="background:'+(c.id==='all'?'transparent':c.color)+'"></span>'+esc(c.id==='all'?'All':c.id)+'</button>';
  const ROW1 = ['all','Calls for Papers','Calls for Special Issues','Grants & Funding','Jobs & Positions'];
  const ROW2 = ['Conferences','Symposiums','PhD Courses & Summer Schools','Seminars & Webinars','Workshops'];
  const present = new Set(allPosts().map(p => p.cat));
  const visible = id => id === 'all' || present.has(id);
  const tabDef = id => id==='all' ? {id:'all', color:'transparent'} : catById(id);
  document.getElementById('tabsgrid').innerHTML =
    ROW1.concat(ROW2).filter(visible).map(id=>tabBtn(tabDef(id))).join('');
  // If the currently active filter just disappeared (its last listing was removed), fall back to All.
  if (local.filter !== 'all' && !present.has(local.filter)) { local.filter = 'all'; saveLocal(); }

  const q = document.getElementById('search').value.trim().toLowerCase();
  let posts = allPosts().sort((a,b) => (b.ts||'').localeCompare(a.ts||''));
  if (local.filter !== 'all') posts = posts.filter(p => p.cat === local.filter);
  if (local.savedOnly) posts = posts.filter(p => local.favs.includes(p.id));
  if (q) posts = posts.filter(p =>
    (p.title+' '+p.acronym+' '+p.org+' '+p.city+' '+countryName(p.country)+' '+p.body+' '+p.author)
      .toLowerCase().includes(q));

  const feed = document.getElementById('feed');
  feed.innerHTML = posts.length ? posts.map(cardHTML).join('')
    : '<div class="empty">Nothing here. Post the first opportunity.</div>';

  renderHorizon();
  renderSidebar();
}

function cardHTML(p){
  const c = catById(p.cat);
  const open = openCards.has(p.id);
  const loc = [esc(p.city), esc(countryName(p.country))].filter(Boolean).join(', ');
  const fav = local.favs.includes(p.id);
  const iAm = p.interested.includes(local.user);
  const rb = Object.entries(p.ratings||{}).map(([sys,g]) =>
    '<span class="badge rating">'+esc(sys)+(g && g!=='Listed' ? ' '+esc(g) : '')+'</span>').join('');

  let head =
    '<div class="chead" onclick="toggleCard('+p.id+')">' +
      '<div>'+pillFor(p)+'</div>' +
      '<div><div class="ctitle">'+(p.acronym?'<b>'+esc(p.acronym)+'</b> &middot; ':'')+esc(p.title)+'</div>' +
        '<div class="badges"><span class="badge catb"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:'+c.color+';margin-right:5px"></span>'+esc(c.id)+'</span>'+rb+
        (p.ects ? '<span class="badge">'+esc(p.ects)+' ECTS</span>' : '')+
        (p.sector ? '<span class="badge">'+esc(p.sector)+'</span>' : '')+'</div></div>' +
      '<div class="chcol"><div class="lab">Submission deadline</div><div class="val">'+(p.subDeadline?fmtDate(p.subDeadline):'&mdash;')+'</div></div>' +
      '<div class="chcol"><div class="val">'+(loc||'&mdash;')+'</div><div class="sub">'+esc(p.mode||'')+'</div></div>' +
      '<div class="chev">'+(open?'&#9650;':'&#9660;')+'</div>' +
    '</div>';

  let grid = '';
  const add = (lab,val) => { if(val) grid += '<div><div class="lab">'+lab+'</div><div class="val">'+val+'</div></div>'; };
  add('Venue dates', fmtRange(p.venueStart, p.venueEnd));
  add('Location', loc ? loc+(p.mode?' &middot; '+esc(p.mode):'') : (p.mode?esc(p.mode):''));
  add('Registration deadline', p.regDeadline?fmtDate(p.regDeadline):'');
  add('Latest feedback', p.feedbackDate?fmtDate(p.feedbackDate):'');
  const moneyLab = p.cat==='Grants & Funding' ? 'Funding amount' : (p.cat==='Jobs & Positions' ? 'Salary band' : 'Fee');
  add(moneyLab, esc(feeText(p)));
  add('ECTS', p.ects?esc(p.ects):'');
  add('Organiser', esc(p.org));

  const isUserPost = local.userPosts.some(u => u.id === p.id);
  const verify = (p.verified && !isUserPost)
    ? '<span class="verified">&#10003; Verified'+(p.verifiedDate ? ' '+agoDays(p.verifiedDate)+' day'+(agoDays(p.verifiedDate)===1?'':'s')+' ago' : '')+'</span>'
    : '<span class="unverified">Unverified'+(isUserPost?' &middot; self-posted':'')+'</span>';

  let body =
    '<div class="cbody">' +
      (p.body?'<div class="desc">'+esc(p.body)+'</div>':'') +
      '<div class="dgrid">'+grid+'</div>' +
      '<div class="cactions">' +
        (p.subLink?'<a class="btn" style="text-decoration:none" href="'+esc(p.subLink)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">Go to submission &#8599;</a>':'') +
        (p.link?'<a class="btn ghost" style="text-decoration:none" href="'+esc(p.link)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">Official site &#8599;</a>':'') +
        ((p.venueStart||p.subDeadline)?'<button class="btn subtle" onclick="addToCalendar('+p.id+');event.stopPropagation()">Add to calendar</button>':'') +
        '<button class="btn subtle savebtn'+(fav?' on':'')+'" onclick="toggleFav('+p.id+');event.stopPropagation()">'+(fav?'&#9733; Saved':'&#9734; Save')+'</button>' +
      '</div>' +
      '<div class="social">' +
        '<button class="'+(iAm?'on':'')+'" onclick="toggleInterest('+p.id+')">&#9733; Interested ('+p.interested.length+')</button>' +
        '<button onclick="toggleComments('+p.id+')">&#9998; Comments ('+p.comments.length+')</button>' +
      '</div>' +
      '<div class="comments" id="cm-'+p.id+'">' +
        p.comments.map(cm=>'<div class="comment"><b>'+esc(cm.who)+'</b><span class="cwhen">'+new Date(cm.ts).toLocaleDateString('en-GB')+'</span><br>'+esc(cm.text)+'</div>').join('') +
        '<div class="crow"><input id="ci-'+p.id+'" placeholder="Add a comment&hellip;" onkeydown="if(event.key===\'Enter\')addComment('+p.id+')"><button class="btn ghost" onclick="addComment('+p.id+')">Post</button></div>' +
      '</div>' +
      '<div class="verifyrow">' +
        '<span>'+verify+' <span class="byline">&middot; posted by '+esc(p.author||'Unknown')+'</span></span>' +
        '<button onclick="reportCorrection('+p.id+')">Report a correction</button>' +
      '</div>' +
    '</div>';

  return '<article class="card'+(open?' open':'')+'" id="post-'+p.id+'">'+head+body+'</article>';
}

function renderHorizon(){
  const hEnd = new Date(); hEnd.setMonth(hEnd.getMonth()+6);
  const SPAN = Math.ceil((hEnd - new Date())/86400000);
  const hz = allPosts()
    .filter(p => p.subDeadline && daysUntil(p.subDeadline) >= 0 && daysUntil(p.subDeadline) <= SPAN)
    .sort((a,b) => a.subDeadline.localeCompare(b.subDeadline));
  const track = document.getElementById('htrack');
  const lanesEnd = [-99,-99,-99];
  if (!hz.length){
    track.innerHTML = '<div class="hempty">No submission deadlines in the next six months.</div>';
    document.getElementById('hticks').innerHTML = '';
    return;
  }
  let dots = '';
  hz.forEach(p => {
    const pct = (daysUntil(p.subDeadline)/SPAN)*100;
    let lane = 0;
    while (lane < 2 && pct - lanesEnd[lane] < 4) lane++;
    lanesEnd[lane] = pct;
    dots += '<span class="hdot" style="left:'+pct.toFixed(2)+'%;background:'+catById(p.cat).color+
      (lane?';bottom:'+(4+lane*16)+'px':'')+'" title="'+esc((p.acronym?p.acronym+' — ':'')+p.title)+
      '" onclick="jumpTo('+p.id+')"></span>';
  });
  track.innerHTML = dots;
  let ticks = '<span class="htick" style="left:0%"></span><span class="hticklabel" style="left:0%">today</span>';
  const now = new Date();
  for (let m=1; m<=6; m++){
    const first = new Date(now.getFullYear(), now.getMonth()+m, 1);
    const d = Math.ceil((first-now)/86400000);
    if (d < 3 || d > SPAN) continue;
    const pct = (d/SPAN)*100;
    const label = first.toLocaleDateString('en-GB',{month:'short'})+'-'+String(first.getFullYear()).slice(-2);
    ticks += '<span class="htick" style="left:'+pct.toFixed(2)+'%"></span>'+
      '<span class="hticklabel" style="left:'+pct.toFixed(2)+'%">'+label+'</span>';
  }
  document.getElementById('hticks').innerHTML = ticks;
}

function renderSidebar(){
  const counts = CATS.map(c => ({...c, n: allPosts().filter(p=>p.cat===c.id).length}));
  document.getElementById('catcounts').innerHTML = counts
    .filter(c => c.n > 0)
    .map(c => '<li onclick="setFilter(\''+c.id.replace(/'/g,"\\'")+'\')"><span><span class="dot" style="background:'+c.color+'"></span>'+esc(c.id)+'</span><b>'+c.n+'</b></li>')
    .join('') || '<li>No categories yet.</li>';

  const upcoming = allPosts()
    .filter(p => p.subDeadline && daysUntil(p.subDeadline) >= 0)
    .sort((a,b) => a.subDeadline.localeCompare(b.subDeadline)).slice(0,5);
  document.getElementById('deadlines').innerHTML = upcoming.length
    ? upcoming.map(p => '<li onclick="jumpTo('+p.id+')"><span class="dtitle">'+esc((p.acronym?p.acronym+' — ':'')+p.title)+'</span>'+
        '<span class="dwhen">deadline in '+daysUntil(p.subDeadline)+' days &middot; '+fmtDate(p.subDeadline)+'</span></li>').join('')
    : '<li>No open deadlines.</li>';

  const mine = local.userPosts.length;
  const marked = allPosts().filter(p=>p.interested.includes(local.user)).length;
  const mycm = allPosts().reduce((n,p)=>n+p.comments.filter(c=>c.who===local.user).length,0);
  document.getElementById('mystats').innerHTML =
    '<li><span>Opportunities posted</span><b>'+mine+'</b></li>'+
    '<li><span>Saved</span><b>'+local.favs.length+'</b></li>'+
    '<li><span>Marked interested</span><b>'+marked+'</b></li>'+
    '<li><span>Comments written</span><b>'+mycm+'</b></li>';
}

/* ========================== INTERACTIONS ============================ */
function setFilter(id){ local.filter=id; saveLocal(); render(); }
function toggleSavedFilter(){ local.savedOnly = !local.savedOnly; saveLocal(); render(); }
function toggleCard(id){ openCards.has(id) ? openCards.delete(id) : openCards.add(id); render(); }
function toggleComposer(){ document.getElementById('composer').classList.toggle('open'); composerInit(); }

let composerInited = false;
function composerInit(){
  if (composerInited) return;
  composerInited = true;
  document.getElementById('f-cat').innerHTML = CATS.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.id)+'</option>').join('');
  document.getElementById('f-country').innerHTML = '<option value="">&mdash;</option>' +
    COUNTRIES.map(c=>'<option value="'+c.code+'">'+esc(c.name)+'</option>').join('');
  document.getElementById('f-currency').innerHTML = '<option value="">&mdash;</option>' +
    CURRENCIES.map(c=>'<option>'+c+'</option>').join('');
  composerCatChange();
}
function composerCatChange(){
  const cat = document.getElementById('f-cat').value;
  document.getElementById('f-ects-wrap').style.display = ECTS_CATS.includes(cat) ? 'block' : 'none';
  document.getElementById('f-sector-wrap').style.display = (cat==='Jobs & Positions') ? 'block' : 'none';
  document.getElementById('f-regdl-wrap').style.display = (cat==='Jobs & Positions') ? 'none' : 'block';
  document.getElementById('f-venue-row').style.display = (cat==='Jobs & Positions') ? 'none' : 'flex';
  document.getElementById('f-feemax-wrap').style.display = (cat==='Jobs & Positions') ? 'block' : 'none';
  const sect = document.getElementById('sect-money');
  const feeLabel = document.getElementById('f-fee-label');
  if (cat === 'Grants & Funding'){ sect.textContent = 'Funding'; feeLabel.textContent = 'Funding amount'; }
  else if (cat === 'Jobs & Positions'){ sect.textContent = 'Compensation'; feeLabel.textContent = 'Salary band — from (per year, required)'; }
  else if (ECTS_CATS.includes(cat)){ sect.textContent = 'Fees & credits'; feeLabel.textContent = 'Fee (leave empty if free)'; }
  else { sect.textContent = 'Fees'; feeLabel.textContent = 'Fee (leave empty if free)'; }

  const systems = RATED_CATS.includes(cat) ? RATING_SYSTEMS : [];
  document.getElementById('f-ratings').innerHTML = systems.length
    ? systems.map(r => '<div><label>'+esc(r.sys)+'</label><select id="f-rating-'+esc(r.sys)+'">'+
        '<option value="">&mdash;</option>'+r.grades.map(g=>'<option>'+esc(g)+'</option>').join('')+'</select></div>').join('')
    : '<div style="font-size:12px;color:var(--muted);padding:6px 0">No rating systems apply to this category.</div>';
}

function submitPost(){
  const title = document.getElementById('f-title').value.trim();
  if (!title){ alert('A title is required.'); return; }
  const cat = document.getElementById('f-cat').value;
  const feeRaw = document.getElementById('f-fee').value;
  if (cat === 'Jobs & Positions' && feeRaw === ''){ alert('A salary band is required for job posts.'); return; }
  const feeMaxRaw = document.getElementById('f-feemax').value;
  const ratings = {};
  if (RATED_CATS.includes(cat)) {
    RATING_SYSTEMS.forEach(r => {
      const v = document.getElementById('f-rating-'+r.sys)?.value;
      if (v) ratings[r.sys] = v;
    });
  }
  const id = Date.now();
  const post = {
    id, cat, title,
    acronym: document.getElementById('f-acronym').value.trim(),
    org: document.getElementById('f-org').value.trim(),
    city: document.getElementById('f-city').value.trim(),
    country: document.getElementById('f-country').value,
    mode: document.getElementById('f-mode').value,
    subDeadline: document.getElementById('f-subdl').value,
    regDeadline: cat==='Jobs & Positions' ? '' : document.getElementById('f-regdl').value,
    feedbackDate: document.getElementById('f-feedback').value,
    venueStart: cat==='Jobs & Positions' ? '' : document.getElementById('f-vstart').value,
    venueEnd: cat==='Jobs & Positions' ? '' : document.getElementById('f-vend').value,
    link: document.getElementById('f-link').value.trim(),
    subLink: document.getElementById('f-sublink').value.trim(),
    body: document.getElementById('f-body').value.trim(),
    fee: feeRaw === '' ? null : Number(feeRaw),
    feeMax: (cat==='Jobs & Positions' && feeMaxRaw !== '') ? Number(feeMaxRaw) : null,
    currency: document.getElementById('f-currency').value,
    ects: ECTS_CATS.includes(cat) && document.getElementById('f-ects').value !== '' ? Number(document.getElementById('f-ects').value) : null,
    sector: cat==='Jobs & Positions' ? document.getElementById('f-sector').value : '',
    ratings,
    author: local.user,
    ts: new Date().toISOString().slice(0,10),
    verified: false, verifiedDate: ''
  };
  local.userPosts.push(post);
  ['f-title','f-acronym','f-org','f-city','f-subdl','f-regdl','f-feedback','f-vstart','f-vend','f-link','f-sublink','f-body','f-fee','f-feemax','f-ects']
    .forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('composer').classList.remove('open');
  saveLocal(); render();
}

function toggleInterest(id){
  const it = interactionFor(id);
  const i = it.interested.indexOf(local.user);
  if (i>=0) it.interested.splice(i,1); else it.interested.push(local.user);
  saveLocal(); render();
}
function toggleFav(id){
  const i = local.favs.indexOf(id);
  if (i>=0) local.favs.splice(i,1); else local.favs.push(id);
  saveLocal(); render();
}
function toggleComments(id){ document.getElementById('cm-'+id).classList.toggle('open'); }
function addComment(id){
  const input = document.getElementById('ci-'+id);
  const text = input.value.trim(); if(!text) return;
  interactionFor(id).comments.push({who:local.user, text, ts:Date.now()});
  openCards.add(id);
  saveLocal(); render();
  document.getElementById('cm-'+id).classList.add('open');
}
function reportCorrection(id){
  const text = prompt('What needs correcting on this post?');
  if (!text || !text.trim()) return;
  interactionFor(id).reports.push({who:local.user, text:text.trim(), ts:Date.now()});
  saveLocal();
  alert('Thanks — your correction report was recorded locally. In the live version this goes to a moderation queue.');
}

function addToCalendar(id){
  const p = allPosts().find(p=>p.id===id);
  if (!p) return;
  const dtfmt = iso => iso.replace(/-/g,'');
  let start, end, summary;
  if (p.venueStart){
    start = dtfmt(p.venueStart);
    const e = new Date((p.venueEnd || p.venueStart) + 'T12:00');
    e.setDate(e.getDate()+1);
    end = dtfmt(e.toISOString().slice(0,10));
    summary = (p.acronym||p.title);
  } else {
    start = dtfmt(p.subDeadline);
    const e = new Date(p.subDeadline+'T12:00'); e.setDate(e.getDate()+1);
    end = dtfmt(e.toISOString().slice(0,10));
    summary = 'Submission deadline: ' + (p.acronym||p.title);
  }
  const escICS = s => String(s||'').replace(/([,;])/g,'\\$1').replace(/\n/g,'\\n');
  const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AcademicAlmanac//Mockup//EN','BEGIN:VEVENT',
    'UID:'+p.id+'@academicalmanac.local','DTSTAMP:'+dtfmt(new Date().toISOString().slice(0,10))+'T000000Z',
    'DTSTART;VALUE=DATE:'+start,'DTEND;VALUE=DATE:'+end,
    'SUMMARY:'+escICS(summary),
    'DESCRIPTION:'+escICS(p.title+(p.link?' — '+p.link:'')),
    (p.city?'LOCATION:'+escICS([p.city,countryName(p.country)].filter(Boolean).join(', ')):''),
    'END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n');
  const blob = new Blob([ics], {type:'text/calendar'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (p.acronym || 'academic-almanac-event').replace(/[^\w-]+/g,'_') + '.ics';
  a.click();
  URL.revokeObjectURL(a.href);
}

function jumpTo(id){
  if (!document.getElementById('post-'+id)){
    local.filter='all'; local.savedOnly=false;
    document.getElementById('search').value='';
    saveLocal();
  }
  openCards.add(id); render();
  const el = document.getElementById('post-'+id);
  if (!el) return;
  el.scrollIntoView({behavior:'smooth', block:'center'});
  el.style.outline = '2px solid var(--red)'; el.style.outlineOffset = '2px';
  setTimeout(()=>{ el.style.outline=''; }, 1600);
}

function changeName(){
  const n = prompt('Display name:', local.user);
  if (n && n.trim()){ local.user=n.trim(); saveLocal(); render(); }
}

/* ============================ STARTUP ================================ */
(async function init(){
  await loadData();
  render();
})();
