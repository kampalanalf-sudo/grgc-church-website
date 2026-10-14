/* ═════════ GRGC — interactions ═════════ */
(function(){
"use strict";
const $=(s,c=document)=>c.querySelector(s), $$=(s,c=document)=>[...c.querySelectorAll(s)];
const WA_NUMBER="256772421488";
const waLink=t=>`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(t)}`;

/* ---------- nav ---------- */
const navToggle=$("#navToggle"), navLinks=$("#navLinks");
navToggle.addEventListener("click",()=>{
  const open=navLinks.classList.toggle("open"); navToggle.classList.toggle("open",open);
  navToggle.setAttribute("aria-expanded",open);
});
$$("#navLinks a").forEach(a=>a.addEventListener("click",()=>{navLinks.classList.remove("open");navToggle.classList.remove("open");}));
$("#year").textContent=new Date().getFullYear();

/* ---------- reveal on scroll ---------- */
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("visible");io.unobserve(e.target);}}),{threshold:.12});
$$(".section h2, .section .eyebrow, .value-card, .branch-card, .ministry-card, .visit-card, .spotlight, .video-feature, .hq-banner, .timeline-item, .letters").forEach(el=>{el.classList.add("reveal");io.observe(el);});

/* ---------- animated counters ---------- */
const cio=new IntersectionObserver(es=>es.forEach(e=>{
  if(!e.isIntersecting)return; const el=e.target, end=+el.dataset.count; cio.unobserve(el);
  const t0=performance.now(), dur=1400;
  (function tick(t){const p=Math.min((t-t0)/dur,1), v=Math.round(end*(1-Math.pow(1-p,3)));
    el.textContent=v.toLocaleString(); if(p<1)requestAnimationFrame(tick);})(t0);
}),{threshold:.5});
$$("[data-count]").forEach(el=>cio.observe(el));

/* ═════════ VIDEOS ═════════
   ▶ CHURCH MEDIA TEAM: replace each `youtubeId` with your real YouTube video IDs
   (the 11 characters after "v=" in a YouTube link) and update titles/dates. */
const VIDEOS=[
  {youtubeId:"dy9nwe9_xzw", title:"12th Anniversary Thanksgiving Service — “Not to us, O Lord” (Psalm 115:1)", meta:"Pastor Agatha Christine Idusso • 30 Aug 2025", dur:"2:14:20", thumb:"assets/images/real/anniversary-stage.jpg",
   desc:"The climax of 12 years of God's faithfulness — worship, testimonies and thanksgiving."},
  {youtubeId:"dy9nwe9_xzw", title:"Ministering Under the Trees — Tema Village, Kikyusa", meta:"Outdoor Service • Kikyusa–Tema", dur:"1:48:05", thumb:"assets/images/real/tema-trees.jpg",
   desc:"The Word preached where the church began — under the eucalyptus trees."},
  {youtubeId:"dy9nwe9_xzw", title:"Night Crusade — Tema Village", meta:"Crusade • Tema Branch", dur:"2:02:44", thumb:"assets/images/real/night-crusade.jpg",
   desc:"Souls won, hearts turned back to Jesus — the first of its kind in the area."},
  {youtubeId:"dy9nwe9_xzw", title:"Worship Team Ministration — Anniversary Celebrations", meta:"GRGC Worship Team • 30 Aug 2025", dur:"48:10", thumb:"assets/images/real/worship-team.jpg",
   desc:"Songs of thanksgiving from our anniversary choir and worship team."},
  {youtubeId:"dy9nwe9_xzw", title:"Laying the Foundation Stone — Kikyusa Church", meta:"Building Project • Kikyusa", dur:"32:18", thumb:"assets/images/real/foundation-stone.jpg",
   desc:"A new altar rises in Kikyusa — foundation stone laid in faith."},
  {youtubeId:"dy9nwe9_xzw", title:"Gayaza Children's Home — From Then to Now", meta:"GRGC Projects • Documentary", dur:"12:40", thumb:"assets/images/real/gayaza-home.jpg",
   desc:"From construction site to a loving home for teenagers — see what God has done."}
];
const grid=$("#videoGrid"), modal=$("#videoModal"), mFrame=$("#modalFrame"), mTitle=$("#modalTitle");
VIDEOS.forEach((v,i)=>{
  const b=document.createElement("button");
  b.className="video-card"; b.type="button";
  b.innerHTML=`<span class="video-thumb" style="background-image:url('${v.thumb}')">
      <span class="play"><span>▶</span></span><span class="dur">${v.dur}</span></span>
    <span class="video-meta"><h3>${v.title}</h3><p>${v.meta}</p></span>`;
  b.addEventListener("click",()=>{
    if(i===0){document.querySelector(".video-feature").scrollIntoView({behavior:"smooth",block:"center"});return;}
    mTitle.textContent=v.title;
    mFrame.src=`https://www.youtube-nocookie.com/embed/${v.youtubeId}?rel=0&autoplay=1`;
    modal.classList.add("open"); modal.setAttribute("aria-hidden","false"); document.body.style.overflow="hidden";
  });
  grid.appendChild(b);
});
function closeModal(){modal.classList.remove("open");modal.setAttribute("aria-hidden","true");mFrame.src="";document.body.style.overflow="";}
$("#modalClose").addEventListener("click",closeModal);
modal.addEventListener("click",e=>{if(e.target===modal)closeModal();});

/* ---------- lightbox (gallery + any .zoomable photo) ---------- */
const light=$("#lightbox"), lightImg=$("#lightImg"), lightCap=$("#lightCap");
function openLight(img){
  if(!img)return;
  lightImg.src=img.src; lightImg.alt=img.alt;
  const fig=img.closest("figure");
  lightCap.textContent=(fig&&$("figcaption",fig)?.textContent)||img.alt||"";
  light.classList.add("open"); light.setAttribute("aria-hidden","false"); document.body.style.overflow="hidden";
}
$$("#annivGallery figure").forEach(f=>f.addEventListener("click",()=>openLight($("img",f))));
$$(".zoomable").forEach(img=>img.addEventListener("click",e=>{e.stopPropagation();openLight(img);}));
function closeLight(){light.classList.remove("open");light.setAttribute("aria-hidden","true");document.body.style.overflow="";}
$("#lightClose").addEventListener("click",closeLight);
light.addEventListener("click",e=>{if(e.target===light)closeLight();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeModal();closeLight();}});

/* ---------- testimony carousel ---------- */
const track=$("#carouselTrack"), cards=()=>$$(".t-card",track), dotsBox=$("#carouselDots");
let idx=0;
function perView(){return innerWidth<640?1:innerWidth<960?2:3;}
function maxIdx(){return Math.max(0,cards().length-perView());}
function renderDots(){
  dotsBox.innerHTML="";
  for(let i=0;i<=maxIdx();i++){const d=document.createElement("button");
    d.setAttribute("aria-label","Go to slide "+(i+1));
    if(i===idx)d.classList.add("on");
    d.addEventListener("click",()=>{idx=i;slide();}); dotsBox.appendChild(d);}
}
function slide(){
  const w=cards()[0].offsetWidth+16;
  track.style.transform=`translateX(${-idx*w}px)`; renderDots();
}
$("#carPrev").addEventListener("click",()=>{idx=idx<=0?maxIdx():idx-1;slide();});
$("#carNext").addEventListener("click",()=>{idx=idx>=maxIdx()?0:idx+1;slide();});
addEventListener("resize",()=>{idx=Math.min(idx,maxIdx());slide();});
renderDots();
setInterval(()=>{if(document.hidden)return; idx=idx>=maxIdx()?0:idx+1; slide();},7000);

/* ---------- forms → localStorage + WhatsApp ---------- */
function save(key,obj){try{const a=JSON.parse(localStorage.getItem(key)||"[]");a.push({at:new Date().toISOString(),...obj});localStorage.setItem(key,JSON.stringify(a));}catch(e){}}
function note(el,msg,ok=true){el.textContent=msg;el.className="form-note "+(ok?"ok":"err");}

/* prayer */
$("#prayerForm").addEventListener("submit",e=>{
  e.preventDefault();
  const d={name:$("#pName").value.trim(),phone:$("#pPhone").value.trim(),topic:$("#pTopic").value,text:$("#pText").value.trim(),urgent:$("#pUrgent").checked,priv:$("#pPrivate").checked};
  if(!d.name||!d.text)return note($("#pNote"),"Please fill in your name and request.",false);
  save("grgc_prayers",d);
  note($("#pNote"),`Thank you, ${d.name.split(" ")[0]}. Your request has been received — our team is praying with you. 🙏`);
  e.target.reset();
});
$("#pWhats").addEventListener("click",()=>{
  const n=$("#pName").value.trim()||"[My name]", t=$("#pText").value.trim()||"[my prayer request]";
  open(waLink(`Hello GRGC Prayer Team, I am ${n}. Please pray with me: ${t} (${$("#pTopic").value})`+( $("#pUrgent").checked?" — URGENT":""))," _blank");
});

/* testimony */
$("#testimonyForm").addEventListener("submit",e=>{
  e.preventDefault();
  const d={name:$("#tName").value.trim(),branch:$("#tBranch").value,text:$("#tText").value.trim(),consent:$("#tConsent").checked};
  if(!d.name||!d.text)return note($("#tNote"),"Please fill in your name and testimony.",false);
  save("grgc_testimonies",d);
  note($("#tNote"),"Thank you for sharing! Your testimony has been received and will encourage many. 🎉");
  e.target.reset(); $("#tConsent").checked=true;
});
$("#tWhats").addEventListener("click",()=>{
  const n=$("#tName").value.trim()||"[My name]", t=$("#tText").value.trim()||"[my testimony]";
  open(waLink(`Hello GRGC! My testimony: I am ${n} (${$("#tBranch").value}). ${t}`),"_blank");
});

/* newsletter */
$("#newsForm").addEventListener("submit",e=>{
  e.preventDefault();
  const c=$("#nContact").value.trim();
  if(!c)return note($("#nNote"),"Please enter your WhatsApp number or email.",false);
  save("grgc_subscribers",{name:$("#nName").value.trim(),contact:c});
  note($("#nNote"),"Subscribed! Watch out for Pastor's weekly devotion. 🔔");
  e.target.reset();
});

/* ---------- give tabs ---------- */
$$(".give-tab").forEach(t=>t.addEventListener("click",()=>{
  $$(".give-tab").forEach(x=>x.classList.remove("active")); t.classList.add("active");
  $$(".give-panel").forEach(p=>p.classList.toggle("active",p.id==="tab-"+t.dataset.tab));
}));

/* copy-to-clipboard */
$$(".copyable").forEach(el=>el.addEventListener("click",()=>{
  const v=el.dataset.copy;
  (navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).then(
    ()=>{const s=$("small",el); if(s){const o=s.textContent; s.textContent="(copied ✓)"; setTimeout(()=>s.textContent=o,1600);}},
    ()=>prompt("Copy this:",v));
}));

/* amount quick-pick */
$$("[data-amount-group] button").forEach(b=>b.addEventListener("click",()=>{
  $$("[data-amount-group] button").forEach(x=>x.classList.remove("picked")); b.classList.add("picked");
  open(waLink(`Hello GRGC! I would like to give UGX ${b.textContent.trim()} (${$("#momoPurpose").value}). Please confirm the MoMo details.`),"_blank");
}));

/* card formatting + demo submit */
const cNum=$("#cNum"), cExp=$("#cExp"), cCvc=$("#cCvc");
cNum.addEventListener("input",()=>{cNum.value=cNum.value.replace(/\D/g,"").slice(0,16).replace(/(\d{4})(?=\d)/g,"$1 ");});
cExp.addEventListener("input",()=>{let v=cExp.value.replace(/\D/g,"").slice(0,4); cExp.value=v.length>2?v.slice(0,2)+"/"+v.slice(2):v;});
cCvc.addEventListener("input",()=>{cCvc.value=cCvc.value.replace(/\D/g,"").slice(0,4);});
$("#cardForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(cNum.value.replace(/\s/g,"").length<15||cExp.value.length<5||cCvc.value.length<3)
    return note($("#cNote"),"Please check your card details and try again.",false);
  save("grgc_card_intents",{name:$("#cName").value,amount:$("#cAmount").value,currency:$("#cCurrency").value,purpose:$("#cPurpose").value});
  note($("#cNote"),`Thank you, ${$("#cName").value.split(" ")[0]||"friend"}! This is a demo checkout — no charge was made. Please confirm card activation with the church via WhatsApp. 🙏`);
  e.target.reset();
});
})();
