import { db } from "../../../firebase/firebase-config.js";
import { collection, doc, getCountFromServer, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { callSecure } from "../../../shared/security-client.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});

const PENDING_COMPLAINT_STATUSES = new Set(["Submitted", "Under Review", "In Review", "In Progress"]);
const state = { events: [], announcements: [], complaints: [], election: null };

const clean = (value, fallback = "") => String(value ?? fallback).trim();
const toDate = (value) => { if (!value) return null; const d = value?.toDate ? value.toDate() : new Date(value); return Number.isNaN(d.getTime()) ? null : d; };
const formatDate = (value) => { const d = toDate(value); return d ? d.toLocaleDateString([], { month:"short", day:"numeric", year:"numeric" }) : "N/A"; };
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

function setText(selector, value) { document.querySelectorAll(selector).forEach(el => el.textContent = String(value)); }
function canonicalRole(_email, role) { const value=clean(role,"student").toLowerCase(); return ["student","officer","admin"].includes(value)?value:"student"; }
function getEventDate(item){ return toDate(item.eventDate || item.date || item.startDate); }
function eventImage(item){ return clean(item.backgroundImageUrl || item.imageUrl || item.eventImageUrl || item.posterUrl); }
function announcementImage(item){ return clean(item.imageUrl || item.imageURL || item.posterUrl || item.announcementImageUrl); }

function renderToday(){ const el=document.getElementById("officerTodayLabel"); if(el) el.textContent=new Date().toLocaleDateString([], {month:"long",day:"numeric",year:"numeric"}); }

function renderRecentComplaints(){
  const host=document.getElementById("officerRecentComplaints");
  if(!host)return;
  const recent=state.complaints.slice(0,4);
  if(!recent.length){host.innerHTML='<div class="reference-empty">No complaints yet.</div>';return;}
  host.innerHTML=recent.map(item=>{
    const status=clean(item.status,"Submitted");
    const statusClass=status.toLowerCase().replace(/\s+/g,"-");
    return `<article class="management-case-item"><div class="management-case-icon"><i class="fa-solid fa-message"></i></div><div class="management-case-copy"><strong>${escapeHtml(clean(item.subject,"Student complaint"))}</strong><span>${escapeHtml(clean(item.complaintRef||item.ticketId||item.id,"Case"))} • ${escapeHtml(formatDate(item.updatedAt||item.createdAt))}</span></div><span class="management-case-status ${escapeHtml(statusClass)}">${escapeHtml(status)}</span></article>`;
  }).join("");
}
let complaintCountRefreshTimer = 0;
async function refreshPendingComplaintCount(){
  try {
    const pendingQuery = query(collection(db,"complaints"), where("status","in",Array.from(PENDING_COMPLAINT_STATUSES)));
    const aggregate = await getCountFromServer(pendingQuery);
    setText("[data-overview-pending-complaints]", aggregate.data().count || 0);
  } catch (error) {
    console.warn("Complaint count unavailable:", error);
  }
}
function schedulePendingComplaintCountRefresh(){
  clearTimeout(complaintCountRefreshTimer);
  complaintCountRefreshTimer = setTimeout(refreshPendingComplaintCount, 700);
}
function bindComplaintSummary(){
  const recentQuery = query(collection(db,"complaints"), orderBy("createdAt","desc"), limit(4));
  onSnapshot(recentQuery, snap => {
    state.complaints = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderRecentComplaints();
    schedulePendingComplaintCountRefresh();
  }, error => {
    console.warn("Recent complaint listener unavailable:", error);
    state.complaints=[];
    renderRecentComplaints();
  });
  refreshPendingComplaintCount();
  setInterval(refreshPendingComplaintCount, 30000);
}
async function bindOfficerSummary(){
  const refresh=async()=>{
    try{
      const metrics=await callSecure("getOfficerDashboardMetrics");
      setText("[data-overview-officer-count]",Number(metrics.activeOfficerCount||0));
    }catch(error){console.warn("Officer metric unavailable:",error);setText("[data-overview-officer-count]",0);}
  };
  await refresh();
  setInterval(refresh,60000);
}
async function bindVoteSummary(){
  try{
    const context=await callSecure("getElectionContext");
    onSnapshot(doc(db,"elections",context.electionId,"turnout","public"), snap => {
      const data=snap.exists()?snap.data():{};
      const votes=Number(data.ballotsCast||0);
      const eligible=Number(data.eligibleVoters||context.eligibleVoterCount||0);
      const turnout=eligible?votes/eligible*100:0;
      setText("[data-overview-election-votes-cast]",votes.toLocaleString());
      setText("[data-overview-election-turnout]",`${turnout.toFixed(1)}%`);
    },()=>{setText("[data-overview-election-votes-cast]",0);setText("[data-overview-election-turnout]","0.0%");});
  }catch(error){ console.warn("Election turnout unavailable:",error); setText("[data-overview-election-votes-cast]",0); setText("[data-overview-election-turnout]","0.0%"); }
}

function renderBulletin(){ const host=document.getElementById("officerBulletinPreview"); if(!host)return; const item=state.announcements[0]; if(!item){host.innerHTML='<div class="reference-empty">No announcement posted yet.</div>';return;} const image=announcementImage(item); host.innerHTML=`${image?`<img src="${escapeHtml(image)}" alt="${escapeHtml(clean(item.title,'Announcement'))}" onerror="this.style.display='none'">`:''}<div class="bulletin-copy"><time>${escapeHtml(formatDate(item.createdAt||item.publishedAt||item.date))}</time><h3>${escapeHtml(clean(item.title,'USC Announcement'))}</h3><p>${escapeHtml(clean(item.content||item.description,'Official USC bulletin update.').slice(0,180))}</p><a href="../announcements/announcements.html">Open Bulletin Board Center</a></div>`; }
function bindAnnouncements(){ onSnapshot(collection(db,"announcements"), snap => { state.announcements=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(toDate(b.createdAt||b.publishedAt)?.getTime()||0)-(toDate(a.createdAt||a.publishedAt)?.getTime()||0)); setText("[data-overview-announcement-count]",state.announcements.length); renderBulletin(); },()=>renderBulletin()); }

function renderCalendar(){ const monthEl=document.getElementById("officerCalendarMonth"), daysEl=document.getElementById("officerCalendarDays"); if(!monthEl||!daysEl)return; const next=state.events.find(e=>getEventDate(e))||null; const base=getEventDate(next)||new Date(); const y=base.getFullYear(),m=base.getMonth(); monthEl.textContent=base.toLocaleDateString([], {month:"long",year:"numeric"}); const first=new Date(y,m,1).getDay(), total=new Date(y,m+1,0).getDate(), prevTotal=new Date(y,m,0).getDate(); const eventDays=new Set(state.events.map(getEventDate).filter(Boolean).filter(d=>d.getMonth()===m&&d.getFullYear()===y).map(d=>d.getDate())); const cells=[]; for(let i=first-1;i>=0;i--)cells.push(`<span class="muted">${prevTotal-i}</span>`); for(let d=1;d<=total;d++)cells.push(`<span class="${eventDays.has(d)?'event-day':''}">${d}</span>`); let nextDay=1; while(cells.length<35)cells.push(`<span class="muted">${nextDay++}</span>`); daysEl.innerHTML=cells.join(''); }
function renderEvents(){ const host=document.getElementById("officerOverviewEvents"); if(!host)return; const upcoming=state.events.filter(e=>{const d=getEventDate(e);return d&&d>=new Date(new Date().setHours(0,0,0,0));}).slice(0,2); if(!upcoming.length){host.innerHTML='<div class="reference-empty">No upcoming events yet.</div>';renderCalendar();return;} host.innerHTML=upcoming.map(item=>{const d=getEventDate(item);return `<article class="overview-event-item"><div class="overview-event-date"><small>${d?d.toLocaleDateString([], {month:'short'}).toUpperCase():'EVENT'}</small><strong>${d?d.getDate():'-'}</strong></div><div class="overview-event-copy"><h4>${escapeHtml(clean(item.title||item.name,'USC Event'))}</h4><p>${escapeHtml(clean(item.venue||item.location,'Samar State University'))}</p></div></article>`;}).join(''); const img=eventImage(upcoming[0]); if(img) host.style.backgroundImage=`url("${img.replace(/"/g,'%22')}")`; renderCalendar(); }
function bindEvents(){ onSnapshot(collection(db,"events"), snap => { state.events=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(getEventDate(a)?.getTime()||Infinity)-(getEventDate(b)?.getTime()||Infinity)); const today=new Date();today.setHours(0,0,0,0);const upcomingCount=state.events.filter(e=>{const d=getEventDate(e);return d&&d>=today;}).length; setText("[data-overview-upcoming-events]",upcomingCount); renderEvents(); },()=>{setText("[data-overview-upcoming-events]",0);renderEvents();}); }

function updateElectionControls(context={}){
  state.election=context;
  const statusEl=document.getElementById("overviewElectionStatus"), noteEl=document.getElementById("overviewElectionPhaseNote");
  if(statusEl)statusEl.textContent=`Current phase: ${context.lifecycle||"Unavailable"}`;
  if(noteEl)noteEl.textContent=context.lifecycle
    ? `Server-verified lifecycle: ${context.lifecycle}. Sensitive election actions are authorized by backend time and security rules.`
    : "Election services are unavailable. Sensitive actions remain locked.";
}
async function bindElectionSettings(){
  const refresh=async()=>{try{updateElectionControls(await callSecure("getElectionContext"));}catch(error){console.warn(error);updateElectionControls({});}};
  await refresh(); setInterval(refresh,30000);
}

const OFFICER_MODULES = [
  { name:"Dashboard", detail:"Officer overview and live summaries", href:"../overview/overview.html", icon:"fa-table-columns", keywords:"dashboard overview home summary" },
  { name:"Bulletin Board Center", detail:"Create and manage USC announcements", href:"../announcements/announcements.html", icon:"fa-note-sticky", keywords:"bulletin announcement announcements post notice" },
  { name:"Election Management", detail:"Election schedule, candidates and voting", href:"../elections/elections.html", icon:"fa-rectangle-list", keywords:"election elections voting vote candidate candidates schedule results" },
  { name:"Events", detail:"Create and manage USC events", href:"../events/events.html", icon:"fa-calendar", keywords:"event events calendar activity activities" },
  { name:"Organizational Chart", detail:"View the USC council structure", href:"../organizational-chart/organizational-chart.html", icon:"fa-users", keywords:"organization organizational chart officers council structure" },
  { name:"Complaints Management", detail:"Review and manage student complaints", href:"../complaints/complaints.html", icon:"fa-message", keywords:"complaint complaints case cases concern concerns" }
];

function bindQuickSearch(){
  const input=document.getElementById("officerQuickSearch");
  const box=document.getElementById("officerSearchBox");
  const results=document.getElementById("officerSearchResults");
  const clearBtn=document.getElementById("officerSearchClear");
  if(!input||!box||!results)return;

  let visible=[];
  let activeIndex=-1;

  const closeResults=()=>{
    results.hidden=true;
    results.innerHTML="";
    visible=[];
    activeIndex=-1;
    input.removeAttribute("aria-activedescendant");
  };

  const setActive=(index)=>{
    const buttons=[...results.querySelectorAll(".officer-search-result")];
    if(!buttons.length){activeIndex=-1;return;}
    activeIndex=Math.max(0,Math.min(index,buttons.length-1));
    buttons.forEach((button,i)=>button.classList.toggle("is-active",i===activeIndex));
    const active=buttons[activeIndex];
    if(active){
      input.setAttribute("aria-activedescendant",active.id);
      active.scrollIntoView({block:"nearest"});
    }
  };

  const renderResults=()=>{
    const q=clean(input.value).toLowerCase();
    if(clearBtn)clearBtn.hidden=!q;
    if(!q){closeResults();return;}
    visible=OFFICER_MODULES.filter(item=>`${item.name} ${item.detail} ${item.keywords}`.toLowerCase().includes(q));
    results.hidden=false;
    activeIndex=-1;
    if(!visible.length){
      results.innerHTML='<div class="officer-search-empty">No matching officer module found.</div>';
      return;
    }
    results.innerHTML=visible.map((item,index)=>`<button class="officer-search-result" id="officerSearchResult${index}" type="button" role="option" data-search-index="${index}"><i class="fa-solid ${escapeHtml(item.icon)}"></i><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></span><i class="fa-solid fa-chevron-right"></i></button>`).join("");
  };

  input.addEventListener("input",renderResults);
  input.addEventListener("focus",()=>{if(clean(input.value))renderResults();});
  input.addEventListener("keydown",event=>{
    if(event.key==="Escape"){
      closeResults();
      input.blur();
      return;
    }
    if(event.key==="ArrowDown"){
      if(results.hidden)renderResults();
      if(visible.length){event.preventDefault();setActive(activeIndex+1);}
      return;
    }
    if(event.key==="ArrowUp"){
      if(visible.length){event.preventDefault();setActive(activeIndex<=0?visible.length-1:activeIndex-1);}
      return;
    }
    if(event.key!=="Enter")return;
    const target=visible[activeIndex>=0?activeIndex:0];
    if(target){event.preventDefault();window.location.href=target.href;}
  });

  results.addEventListener("click",event=>{
    const button=event.target.closest("[data-search-index]");
    if(!button)return;
    const item=visible[Number(button.dataset.searchIndex)];
    if(item)window.location.href=item.href;
  });

  clearBtn?.addEventListener("click",()=>{
    input.value="";
    clearBtn.hidden=true;
    closeResults();
    input.focus();
  });

  document.addEventListener("pointerdown",event=>{
    if(!box.contains(event.target))closeResults();
  });
}

function readOfficerSessionProfile(){
  try{
    const raw=JSON.parse(sessionStorage.getItem("studentProfile")||"null");
    return raw&&typeof raw==="object"?raw:{};
  }catch{return {};}
}

function setProfileDrawerText(selector,value,fallback="Not available"){
  document.querySelectorAll(selector).forEach(element=>{
    element.textContent=clean(value)||fallback;
  });
}

function refreshProfileDrawer(){
  const profile=readOfficerSessionProfile();
  const fullName=clean(profile.fullName||profile.name||profile.email,"USC Officer");
  const role=clean(profile.role,"officer");
  const position=clean(profile.officePosition,"USC Officer");
  const status=clean(profile.accountStatus,profile.isActive===false?"suspended":"approved");
  setProfileDrawerText("[data-profile-full-name]",fullName,"USC Officer");
  setProfileDrawerText("[data-profile-student-id]",profile.studentId);
  setProfileDrawerText("[data-profile-email]",profile.email);
  setProfileDrawerText("[data-profile-role]",role,"Officer");
  setProfileDrawerText("[data-profile-position]",position,"USC Officer");
  setProfileDrawerText("[data-profile-status]",status,"Approved");
  setProfileDrawerText("[data-profile-access]",profile.isActive===false?"Restricted":"Active","Active");
}

function bindProfileDrawer(){
  const trigger=document.getElementById("officerProfileTrigger");
  const drawer=document.getElementById("officerProfileDrawer");
  const overlay=document.getElementById("officerProfileOverlay");
  const closeBtn=document.getElementById("officerProfileClose");
  if(!trigger||!drawer||!overlay)return;

  const closeDrawer=()=>{
    drawer.classList.remove("is-open");
    overlay.classList.remove("is-open");
    drawer.setAttribute("aria-hidden","true");
    trigger.setAttribute("aria-expanded","false");
    document.body.classList.remove("profile-drawer-open");
    window.setTimeout(()=>{if(!drawer.classList.contains("is-open"))overlay.hidden=true;},220);
  };

  const openDrawer=()=>{
    refreshProfileDrawer();
    overlay.hidden=false;
    requestAnimationFrame(()=>{
      overlay.classList.add("is-open");
      drawer.classList.add("is-open");
    });
    drawer.setAttribute("aria-hidden","false");
    trigger.setAttribute("aria-expanded","true");
    document.body.classList.add("profile-drawer-open");
  };

  trigger.addEventListener("click",()=>drawer.classList.contains("is-open")?closeDrawer():openDrawer());
  closeBtn?.addEventListener("click",closeDrawer);
  overlay.addEventListener("click",closeDrawer);
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&drawer.classList.contains("is-open"))closeDrawer();});

  drawer.addEventListener("click",event=>{
    const menuButton=event.target.closest("[data-profile-panel-target]");
    if(!menuButton)return;
    const target=menuButton.dataset.profilePanelTarget;
    drawer.querySelectorAll("[data-profile-panel-target]").forEach(button=>button.classList.toggle("active",button===menuButton));
    drawer.querySelectorAll("[data-profile-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.profilePanel===target));
  });

  refreshProfileDrawer();
}

renderToday();bindQuickSearch();bindProfileDrawer();bindComplaintSummary();bindOfficerSummary();bindVoteSummary();bindAnnouncements();bindEvents();bindElectionSettings();
