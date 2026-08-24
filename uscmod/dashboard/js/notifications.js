import { db } from "../../firebase/firebase-config.js";
import { callSecure } from "../../shared/security-client.js";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

const uscAuthAllowed = await (globalThis.USC_AUTH_READY || Promise.resolve(false));
if (uscAuthAllowed !== true) await new Promise(() => {});


const PROFILE_KEY = "studentProfile";
const READ_KEY_PREFIX = "uscNotificationRead:";
const feeds = { announcements: [], events: [], complaints: [], election: null, application: null };

function dashboardHref(fileName) {
  return window.location.pathname.includes("/dashboard/") ? fileName : `../dashboard/${fileName}`;
}

function profile() {
  try { return JSON.parse(sessionStorage.getItem(PROFILE_KEY) || "null"); }
  catch { return null; }
}
function clean(v, fallback="") { return String(v ?? fallback).trim(); }
function toDate(v) {
  if (!v) return null;
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function eventDate(v) {
  const s = clean(v);
  if (!s) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function relativeTime(v) {
  const d = toDate(v) || eventDate(v);
  if (!d) return "Recently";
  const diff = Date.now() - d.getTime();
  const min = Math.round(Math.abs(diff) / 60000);
  if (diff < 0) {
    if (min < 60) return `in ${min} minute${min===1?"":"s"}`;
    const h = Math.round(min/60); if (h<24) return `in ${h} hour${h===1?"":"s"}`;
    const days=Math.round(h/24); return `in ${days} day${days===1?"":"s"}`;
  }
  if (min < 1) return "Just now";
  if (min < 60) return `${min} minute${min===1?"":"s"} ago`;
  const h=Math.round(min/60); if (h<24) return `${h} hour${h===1?"":"s"} ago`;
  const days=Math.round(h/24); return `${days} day${days===1?"":"s"} ago`;
}
function readSet() {
  const p=profile();
  try { return new Set(JSON.parse(localStorage.getItem(`${READ_KEY_PREFIX}${clean(p?.uid,"guest")}`) || "[]")); }
  catch { return new Set(); }
}
function saveRead(set) {
  const p=profile();
  localStorage.setItem(`${READ_KEY_PREFIX}${clean(p?.uid,"guest")}`, JSON.stringify([...set].slice(-200)));
}
function item(id,type,title,message,at,icon,href="") { return { id,type,title,message,at,icon,href }; }
function buildItems() {
  const p=profile();
  const list=[];
  feeds.announcements.slice(0,3).forEach(a=>list.push(item(`announcement:${a.id}`,"announcement","New Announcement",clean(a.title,"A new USC announcement was posted."),a.createdAt||a.createdAtMs,"fa-bullhorn",dashboardHref("bulletin.html"))));
  const now=Date.now();
  feeds.events.filter(e=>eventDate(e.eventDate)?.getTime() >= now-86400000).slice(0,3).forEach(e=>list.push(item(`event:${e.id}`,"event","Event Reminder",`${clean(e.title,"USC event")} • ${clean(e.venue,"See event details")}`,e.eventDate,"fa-calendar-days",dashboardHref("events.html"))));
  feeds.complaints.slice(0,3).forEach(c=>list.push(item(`complaint:${c.id}:${clean(c.status)}`,"complaint","Complaint Update",`Your complaint ${clean(c.complaintRef,c.id)} is now ${clean(c.status,"updated")}.`,c.updatedAt||c.createdAt,"fa-comments","../complaint/complaint.html")));
  if (feeds.election) {
    const e=feeds.election;
    list.push(item(`election:${clean(e.electionId,"active")}:${clean(e.lifecycle,"Unavailable")}`,"election","Election Update",`${clean(e.title,"USC Election")} is currently in the ${clean(e.lifecycle,"Unavailable")} phase.`,e.serverNowMs||Date.now(),"fa-file-lines",dashboardHref("election.html")));
  }
  if (feeds.application && p?.uid) {
    const a=feeds.application;
    list.push(item(`application:${a.id}:${clean(a.status)}`,"election","Candidacy Update",`Your candidacy application is ${clean(a.status,"under review")}.`,a.updatedAt||a.submittedAt,"fa-circle-check",dashboardHref("election.html")));
  }
  return list.sort((a,b)=>{
    const ad=(toDate(a.at)||eventDate(a.at))?.getTime()||0;
    const bd=(toDate(b.at)||eventDate(b.at))?.getTime()||0;
    return bd-ad;
  }).slice(0,8);
}
function render() {
  const host=document.getElementById("notificationList");
  const dot=document.getElementById("notificationDot");
  if (!host || !dot) return;
  const reads=readSet();
  const items=buildItems();
  const unread=items.filter(n=>!reads.has(n.id)).length;
  dot.classList.toggle("hidden", unread===0);
  if (!items.length) { host.innerHTML='<div class="notification-empty">No new notifications yet.</div>'; return; }
  host.innerHTML=items.map(n=>`<div class="notification-item ${reads.has(n.id)?"read":""}" data-notification-id="${n.id}" data-href="${n.href}"><div class="notification-icon ${n.type}"><i class="fa-solid ${n.icon}"></i></div><div class="notification-copy"><strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.message)}</p><small>${escapeHtml(relativeTime(n.at))}</small></div><span class="notification-unread"></span></div>`).join("");
}
function escapeHtml(v){return clean(v).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function listen() {
  const p=profile();
  onSnapshot(query(collection(db,"announcements"),orderBy("createdAtMs","desc"),limit(5)),s=>{feeds.announcements=s.docs.map(d=>({id:d.id,...d.data()}));render();},()=>{});
  onSnapshot(query(collection(db,"events"),orderBy("eventDate","asc"),limit(8)),s=>{feeds.events=s.docs.map(d=>({id:d.id,...d.data()}));render();},()=>{});
  if (p?.uid) onSnapshot(query(collection(db,"complaints"),where("studentUid","==",p.uid)),s=>{feeds.complaints=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(toDate(b.updatedAt||b.createdAt)?.getTime()||0)-(toDate(a.updatedAt||a.createdAt)?.getTime()||0));render();},()=>{});
  let unsubscribeApplication=null;
  let boundElectionId="";
  const refreshElection=async()=>{
    try{
      const context=await callSecure("getElectionContext");
      feeds.election=context;
      if(p?.uid && context.electionId!==boundElectionId){
        unsubscribeApplication?.();
        boundElectionId=context.electionId;
        unsubscribeApplication=onSnapshot(doc(db,"elections",context.electionId,"applications",p.uid),s=>{feeds.application=s.exists()?{id:s.id,...s.data()}:null;render();},()=>{feeds.application=null;render();});
      }
      render();
    }catch(error){console.warn("Election notification feed unavailable:",error);feeds.election=null;feeds.application=null;render();}
  };
  refreshElection();
  setInterval(refreshElection,60000);
}

const btn=document.getElementById("notificationButton");
const panel=document.getElementById("notificationPanel");
btn?.addEventListener("click",e=>{e.stopPropagation();panel?.classList.toggle("hidden");btn.setAttribute("aria-expanded", String(!panel?.classList.contains("hidden")));});
document.getElementById("markNotificationsRead")?.addEventListener("click",()=>{const set=readSet();buildItems().forEach(n=>set.add(n.id));saveRead(set);render();});
document.getElementById("notificationList")?.addEventListener("click",e=>{const row=e.target.closest?.("[data-notification-id]"); if(!row)return; const set=readSet();set.add(row.dataset.notificationId);saveRead(set);render();const href=row.dataset.href;if(href){if(href.startsWith("#")){document.querySelector(href)?.scrollIntoView({behavior:"smooth"});panel?.classList.add("hidden");}else window.location.href=href;}});
document.addEventListener("click",e=>{if(panel && !panel.classList.contains("hidden") && !panel.contains(e.target) && !btn?.contains(e.target)) panel.classList.add("hidden");});
listen();
