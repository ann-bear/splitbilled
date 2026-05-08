import { useState, useCallback, useRef, useEffect } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const COLORS = ["#FF6B6B","#4ECDC4","#FFE66D","#A8E6CF","#FF8B94","#A29BFE","#FD79A8","#00B894","#FDCB6E","#74B9FF"];
let _id = 1;
const uid = () => _id++;
const fRp = (n) => "Rp " + Math.round(n).toLocaleString("id-ID");
const colorOf = (i) => COLORS[i % COLORS.length];
const todayStr = () => new Date().toISOString().split("T")[0];
const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
};

// Compress image to max 900px, JPEG 0.75
async function compressImage(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const MAX = 900;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(b);
      }, "image/jpeg", 0.75);
    };
    img.onerror = rej;
    img.src = url;
  });
}

// ─── Gemini API ───────────────────────────────────────────────────────────────
const GEMINI_PROMPT = `You are a receipt parser for Indonesian receipts (GoFood, Shopee Food, GrabFood, Fore Coffee, Kopi Kenangan, Starbucks, Alfamart, etc). Return ONLY valid JSON, no markdown, no extra text: {"items":[{"name":string,"price":number,"qty":number}],"ppn_rate":number|null,"service_charge":number|null,"delivery_fee":number|null,"discount_idr":number|null,"other_fees":[{"name":string,"amount":number}]} Rules: price = per unit (not x qty). ppn_rate = percentage number like 11. All amounts plain IDR numbers.`;

async function callGemini(imageB64) {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: "image/jpeg", data: imageB64 } },
        { text: GEMINI_PROMPT }
      ]}]
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function drawBg(ctx, W, totalH) {
  const bg = ctx.createLinearGradient(0,0,0,totalH);
  bg.addColorStop(0,"#0d0c1a"); bg.addColorStop(1,"#111020");
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,totalH);
  ctx.save(); ctx.globalAlpha=0.05;
  ctx.fillStyle="#FF6B6B"; ctx.beginPath(); ctx.arc(W-50,70,110,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="#A29BFE"; ctx.beginPath(); ctx.arc(50,totalH-70,90,0,Math.PI*2); ctx.fill();
  ctx.restore();
  const bar=ctx.createLinearGradient(0,0,W,0);
  bar.addColorStop(0,"#FF6B6B"); bar.addColorStop(1,"#ff8e53");
  ctx.fillStyle=bar; ctx.fillRect(0,0,W,5);
}

function drawHeader(ctx, W, PAD, dateStr, grandTotal, peopleCount) {
  ctx.font="bold 24px sans-serif"; ctx.fillStyle="#fffffe";
  ctx.fillText("Split",PAD,50);
  ctx.fillStyle="#FF6B6B";
  ctx.fillText("Billed",PAD+ctx.measureText("Split ").width-2,50);
  ctx.font="11px monospace"; ctx.fillStyle="#4a4a6a";
  const dateDisplay = dateStr ? fmtDate(dateStr) : new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});
  ctx.fillText(dateDisplay, PAD, 68);

  const gY=80;
  ctx.fillStyle="#1a1929"; rr(ctx,PAD,gY,W-PAD*2,76,12); ctx.fill();
  ctx.strokeStyle="#2d2d48"; ctx.lineWidth=1.5; rr(ctx,PAD,gY,W-PAD*2,76,12); ctx.stroke();
  ctx.font="10px monospace"; ctx.fillStyle="#6a6a8a"; ctx.fillText("GRAND TOTAL",PAD+18,gY+20);
  ctx.font="bold 26px sans-serif"; ctx.fillStyle="#FF6B6B"; ctx.fillText(fRp(grandTotal),PAD+18,gY+56);
  ctx.font="11px monospace"; ctx.fillStyle="#6a6a8a";
  ctx.textAlign="right"; ctx.fillText(`${peopleCount} people`,W-PAD-18,gY+44); ctx.textAlign="left";
  return gY + 88; // return next Y
}

function drawPersonCard(ctx, W, PAD, cy, d, col, result, ppn, ongkir, people) {
  const IH=22, LH=18, cW=W-PAD*2;

  ctx.fillStyle="#161525"; rr(ctx,PAD,cy,cW,999,12); // placeholder, will be clipped
  // We'll draw card items and return final height

  ctx.fillStyle="#161525"; 
  // Draw card bg after we know height — skip for now, draw contents first then rect
  // Actually let's just draw contents and track ry

  // header tint bg
  ctx.fillStyle=col+"10"; rr(ctx,PAD,cy,cW,52,12); ctx.fill();
  ctx.fillStyle=col+"10"; ctx.fillRect(PAD,cy+40,cW,12);

  // avatar
  ctx.fillStyle=col+"22"; ctx.beginPath(); ctx.arc(PAD+22,cy+26,13,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(PAD+22,cy+26,13,0,Math.PI*2); ctx.stroke();
  ctx.font="bold 13px sans-serif"; ctx.fillStyle=col;
  ctx.textAlign="center"; ctx.fillText(d.p.name.charAt(0).toUpperCase(),PAD+22,cy+31); ctx.textAlign="left";

  ctx.font="bold 15px sans-serif"; ctx.fillStyle="#fffffe"; ctx.fillText(d.p.name,PAD+44,cy+22);
  const pct=result.grandTotal>0?Math.round(d.total/result.grandTotal*100):0;
  ctx.font="10px monospace"; ctx.fillStyle=col+"99"; ctx.fillText(`${pct}% of total`,PAD+44,cy+38);
  ctx.font="bold 17px sans-serif"; ctx.fillStyle=col;
  ctx.textAlign="right"; ctx.fillText(fRp(d.total),PAD+cW-16,cy+30); ctx.textAlign="left";

  // progress bar
  const bY=cy+54, bW=cW-24;
  ctx.fillStyle="#252440"; rr(ctx,PAD+12,bY,bW,4,2); ctx.fill();
  if (pct>0) { ctx.fillStyle=col; rr(ctx,PAD+12,bY,bW*(pct/100),4,2); ctx.fill(); }

  let ry=cy+74;

  if (d.itemLines.length > 0) {
    ctx.font="bold 9px monospace"; ctx.fillStyle="#4a4a6a"; ctx.fillText("ITEMS",PAD+16,ry); ry+=LH;
    d.itemLines.forEach(ln => {
      let lbl=ln.name.length>30?ln.name.slice(0,28)+"...":ln.name;
      if (ln.qty>1) lbl+=` x${ln.qty}`;
      ctx.font="13px sans-serif"; ctx.fillStyle="#c8c4ff"; ctx.fillText(lbl,PAD+16,ry+13);
      if (ln.assigned>1) {
        const badge=`/${ln.assigned}`, bx=PAD+16+ctx.measureText(lbl).width+6;
        ctx.fillStyle="#3a3a58"; rr(ctx,bx,ry+2,ctx.measureText(badge).width+10,13,3); ctx.fill();
        ctx.font="9px monospace"; ctx.fillStyle="#6a6a8a"; ctx.fillText(badge,bx+5,ry+11);
      }
      ctx.font="13px sans-serif"; ctx.fillStyle="#fffffe";
      ctx.textAlign="right"; ctx.fillText(fRp(ln.share),PAD+cW-14,ry+13); ctx.textAlign="left";
      ry+=IH;
      if (ln.qty>1||ln.assigned>1) {
        let note="";
        if (ln.qty>1) note+=`${fRp(ln.unitPrice)}x${ln.qty}`;
        if (ln.qty>1&&ln.assigned>1) note+=" ";
        if (ln.assigned>1) note+=`/${ln.assigned}`;
        ctx.font="10px monospace"; ctx.fillStyle="#3e3e5e";
        ctx.textAlign="right"; ctx.fillText(note,PAD+cW-14,ry-2); ctx.textAlign="left";
        ry+=13;
      }
    });
    ctx.strokeStyle=col+"22"; ctx.lineWidth=1; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(PAD+16,ry); ctx.lineTo(PAD+cW-16,ry); ctx.stroke(); ctx.setLineDash([]); ry+=8;
    ctx.font="11px monospace"; ctx.fillStyle="#4a4a6a"; ctx.fillText("Subtotal",PAD+16,ry+12);
    ctx.textAlign="right"; ctx.fillStyle="#a7a9be"; ctx.fillText(fRp(d.mySubtotal),PAD+cW-14,ry+12); ctx.textAlign="left";
    ry+=IH+10;
  } else {
    ctx.font="11px monospace"; ctx.fillStyle="#2a2a42";
    ctx.textAlign="center"; ctx.fillText("-- no items --",PAD+cW/2,ry+12); ctx.textAlign="left"; ry+=IH;
  }

  const hasFees=d.myDiscount>0||d.myPpn>0||d.myOngkir>0||d.myExtras.length>0;
  if (hasFees) {
    ctx.font="bold 9px monospace"; ctx.fillStyle="#4a4a6a"; ctx.fillText("ADDITIONAL CHARGES",PAD+16,ry); ry+=LH+4;
    const drawFee=(label,amt,fcol,badge)=>{
      ctx.font="12px sans-serif"; ctx.fillStyle="#a7a9be"; ctx.fillText(label,PAD+16,ry+12);
      if (badge) {
        const bx=PAD+16+ctx.measureText(label+" ").width+2;
        ctx.fillStyle="#252440"; rr(ctx,bx,ry+1,ctx.measureText(badge).width+10,13,3); ctx.fill();
        ctx.font="9px monospace"; ctx.fillStyle="#4a4a6a"; ctx.fillText(badge,bx+5,ry+11);
      }
      ctx.font="12px sans-serif"; ctx.fillStyle=fcol||"#a7a9be";
      ctx.textAlign="right"; ctx.fillText(fcol?`-${fRp(amt)}`:fRp(amt),PAD+cW-14,ry+12); ctx.textAlign="left"; ry+=IH;
    };
    if (d.myDiscount>0) drawFee("Discount",d.myDiscount,"#00b894");
    if (d.myPpn>0) drawFee("Tax",d.myPpn,null,ppn.mode==="per_item"?"prop.":"equal");
    if (d.myOngkir>0) drawFee("Delivery Fee",d.myOngkir,null,`/${people.length}`);
    d.myExtras.forEach(ex=>drawFee(ex.name,ex.amt,null,ex.mode==="per_item"?"prop.":"equal"));
  }

  ry+=4;
  ctx.strokeStyle=col+"44"; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(PAD+12,ry); ctx.lineTo(PAD+cW-12,ry); ctx.stroke(); ry+=12;
  ctx.font="bold 14px sans-serif"; ctx.fillStyle="#fffffe"; ctx.fillText("Total Amount Due",PAD+16,ry+15);
  ctx.font="bold 18px sans-serif"; ctx.fillStyle=col;
  ctx.textAlign="right"; ctx.fillText(fRp(d.total),PAD+cW-14,ry+15); ctx.textAlign="left";
  ry+=30;

  return ry - cy; // card height
}

// Build one canvas per person
function buildPersonCanvas(personData, personIndex, people, result, ppn, ongkir, extraFees, discount, dateStr, gbRows) {
  const DPR=2, W=640, PAD=36;

  // Estimate card height
  const IH=22, LH=18;
  const d = personData;
  let cardH = 58 + 4 + 16;
  if (d.itemLines.length > 0) {
    cardH += LH;
    d.itemLines.forEach(ln => { cardH += IH; if (ln.qty>1||ln.assigned>1) cardH+=13; });
    cardH += IH + 10;
  } else { cardH += IH; }
  const hasFees = d.myDiscount>0||d.myPpn>0||d.myOngkir>0||d.myExtras.length>0;
  if (hasFees) {
    cardH += LH + 4;
    if (d.myDiscount>0) cardH += IH;
    if (d.myPpn>0) cardH += IH;
    if (d.myOngkir>0) cardH += IH;
    cardH += d.myExtras.length * IH;
  }
  cardH += 42 + 18;

  const breakdownH = gbRows.length * 22 + 44;
  const HEADER_H = 5 + 70 + 88 + breakdownH + 28;
  const totalH = HEADER_H + cardH + 60;

  const canvas = document.createElement("canvas");
  canvas.width = W*DPR; canvas.height = totalH*DPR;
  const ctx = canvas.getContext("2d");
  ctx.scale(DPR, DPR);

  drawBg(ctx, W, totalH);
  let cy = drawHeader(ctx, W, PAD, dateStr, result.grandTotal, people.length);

  // Breakdown summary
  gbRows.forEach(([label, val, col]) => {
    ctx.font="12px monospace"; ctx.fillStyle="#6a6a8a"; ctx.fillText(label,PAD,cy);
    ctx.textAlign="right"; ctx.fillStyle=col||"#fffffe"; ctx.fillText(val,W-PAD,cy);
    ctx.textAlign="left"; cy+=22;
  });
  ctx.strokeStyle="#252440"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PAD,cy); ctx.lineTo(W-PAD,cy); ctx.stroke(); cy+=10;
  ctx.font="bold 13px sans-serif"; ctx.fillStyle="#fffffe"; ctx.fillText("Total",PAD,cy+13);
  ctx.textAlign="right"; ctx.fillStyle="#FF6B6B"; ctx.fillText(fRp(result.grandTotal),W-PAD,cy+13);
  ctx.textAlign="left"; cy+=34;

  // Section label
  ctx.font="10px monospace"; ctx.fillStyle="#4a4a6a";
  ctx.fillText(`RECEIPT — ${d.p.name.toUpperCase()}`,PAD,cy); cy+=20;

  // Card background
  const col = colorOf(personIndex);
  const cW = W-PAD*2;
  ctx.fillStyle="#161525"; rr(ctx,PAD,cy,cW,cardH,12); ctx.fill();
  ctx.strokeStyle=col+"28"; ctx.lineWidth=1.5; rr(ctx,PAD,cy,cW,cardH,12); ctx.stroke();

  drawPersonCard(ctx, W, PAD, cy, d, col, result, ppn, ongkir, people);

  // Footer
  ctx.font="10px monospace"; ctx.fillStyle="#2a2a40";
  ctx.textAlign="center"; ctx.fillText("made by dotterspace",W/2,totalH-16); ctx.textAlign="left";

  return canvas;
}

// ─── Calculation ──────────────────────────────────────────────────────────────
function calculate({ people, items, ppn, ongkir, discount, extraFees }) {
  const totals={}, personSub={};
  people.forEach(p=>{totals[p.id]=0;personSub[p.id]=0;});
  let subtotal=0;
  items.forEach(item=>{
    const price=(parseFloat(item.price)||0)*(parseInt(item.qty)||1);
    subtotal+=price;
    const assigned=Object.keys(item.assignedTo).filter(k=>item.assignedTo[k]);
    if (!assigned.length) return;
    const share=price/assigned.length;
    assigned.forEach(pid=>{totals[pid]=(totals[pid]||0)+share;personSub[pid]=(personSub[pid]||0)+share;});
  });
  let discountAmt=0;
  if (discount.enabled) {
    discountAmt=discount.unit==="pct"?subtotal*(parseFloat(discount.value)||0)/100:parseFloat(discount.value)||0;
    discountAmt=Math.min(discountAmt,subtotal);
    if (discount.mode==="per_item") people.forEach(p=>{totals[p.id]-=subtotal>0?personSub[p.id]/subtotal*discountAmt:discountAmt/people.length;});
    else people.forEach(p=>{totals[p.id]-=discountAmt/people.length;});
  }
  const taxBase=subtotal-discountAmt;
  let ppnTotal=0;
  if (ppn.enabled) {
    const rate=parseFloat(ppn.rate)||0;
    if (ppn.unit==="rp") {
      ppnTotal=rate;
      if (ppn.mode==="per_item") people.forEach(p=>{const ratio=subtotal>0?personSub[p.id]/subtotal:1/people.length;totals[p.id]+=ppnTotal*ratio;});
      else people.forEach(p=>{totals[p.id]+=ppnTotal/people.length;});
    } else {
      if (ppn.mode==="per_item") people.forEach(p=>{const tb=subtotal>0?personSub[p.id]/subtotal*taxBase:taxBase/people.length;const s=tb*rate/100;ppnTotal+=s;totals[p.id]+=s;});
      else {ppnTotal=taxBase*rate/100;people.forEach(p=>{totals[p.id]+=ppnTotal/people.length;});}
    }
  }
  const ongkirAmt=ongkir.enabled?parseFloat(ongkir.amount)||0:0;
  if (ongkirAmt>0) people.forEach(p=>{totals[p.id]+=ongkirAmt/people.length;});
  let extraTotal=0;
  const extraAmounts=extraFees.map(fee=>{
    let amt=fee.unit==="pct"?subtotal*(parseFloat(fee.value)||0)/100:parseFloat(fee.value)||0;
    extraTotal+=amt; return amt;
  });
  extraFees.forEach((fee,fi)=>{
    const amt=extraAmounts[fi];if(!amt)return;
    if (fee.mode==="per_item") people.forEach(p=>{totals[p.id]+=subtotal>0?personSub[p.id]/subtotal*amt:amt/people.length;});
    else people.forEach(p=>{totals[p.id]+=amt/people.length;});
  });
  return {totals,personSub,subtotal,discountAmt,ppnTotal,ongkirAmt,extraTotal,extraAmounts,grandTotal:taxBase+ppnTotal+ongkirAmt+extraTotal};
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function UnitToggle({value,onChange}) {
  return (
    <div style={{display:"flex",background:"#0d0c1a",borderRadius:7,padding:2,border:"1px solid #252440",flexShrink:0}}>
      {["Rp","%"].map(u=>(
        <button key={u} onClick={()=>onChange(u==="%"?"pct":"rp")}
          style={{padding:"4px 10px",borderRadius:5,border:"none",fontSize:11,cursor:"pointer",fontFamily:"'DM Mono',monospace",
          background:(u==="%")===(value==="pct")?"#ff6b6b":"transparent",
          color:(u==="%")===(value==="pct")?"#fff":"#6a6a8a",transition:"all .15s"}}>{u}</button>
      ))}
    </div>
  );
}

function ModeToggle({value,onChange,labels=["Per Item","Equal Split"]}) {
  return (
    <div style={{display:"flex",gap:6,marginTop:8}}>
      {labels.map((l,li)=>{const modes=["per_item","rata"];const on=value===modes[li];return(
        <button key={l} onClick={()=>onChange(modes[li])}
          style={{padding:"4px 12px",borderRadius:99,border:`1.5px solid ${on?"#a29bfe":"#252440"}`,
          background:on?"#a29bfe1a":"transparent",color:on?"#c8c4ff":"#4a4a6a",fontSize:11,cursor:"pointer",fontFamily:"'DM Mono',monospace",transition:"all .15s"}}>
          {on?"✓ ":""}{l}</button>
      );})}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SplitBilled() {
  const [people,setPeople]=useState([{id:uid(),name:"Person 1"}]);
  const [items,setItems]=useState([{id:uid(),name:"",qty:1,price:"",assignedTo:{}}]);
  const [ppn,setPpn]=useState({enabled:false,rate:11,unit:"pct",mode:"per_item"});
  const [ongkir,setOngkir]=useState({enabled:false,amount:""});
  const [discount,setDiscount]=useState({enabled:false,value:"",unit:"rp",mode:"per_item"});
  const [extraFees,setExtraFees]=useState([]);
  const [newName,setNewName]=useState("");
  const [date,setDate]=useState(todayStr());
  const [activeTab,setActiveTab]=useState("items");

  const [showScan,setShowScan]=useState(false);
  const [scanPhase,setScanPhase]=useState("preview");
  const [scanErr,setScanErr]=useState("");
  const [stream,setStream]=useState(null);
  const [capturedImg,setCapturedImg]=useState(null);
  const videoRef=useRef(null);
  const canvasRef=useRef(null);

  // Share modal — per person pages
  const [sharePages,setSharePages]=useState([]); // array of dataURLs
  const [sharePageIdx,setSharePageIdx]=useState(0);
  const [showShare,setShowShare]=useState(false);

  // Camera
  useEffect(()=>{
    if (!showScan) return;
    let s;
    (async()=>{
      try {
        s=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment",width:{ideal:1280},height:{ideal:720}}});
        setStream(s); setScanPhase("preview"); setCapturedImg(null); setScanErr("");
        if (videoRef.current) { videoRef.current.srcObject=s; videoRef.current.play(); }
      } catch(e) {
        setScanErr("Camera access denied. Please allow camera permissions and try again."); setScanPhase("error");
      }
    })();
    return ()=>{ if (s) s.getTracks().forEach(t=>t.stop()); };
  },[showScan]);

  const closeScan=()=>{
    if (stream) stream.getTracks().forEach(t=>t.stop());
    setStream(null); setShowScan(false); setScanPhase("preview"); setCapturedImg(null); setScanErr("");
  };

  const captureAndScan=async()=>{
    const video=videoRef.current;
    if (!video) return;
    const c=canvasRef.current;
    c.width=video.videoWidth; c.height=video.videoHeight;
    c.getContext("2d").drawImage(video,0,0);
    if (stream) stream.getTracks().forEach(t=>t.stop()); setStream(null);
    setScanPhase("processing");
    try {
      const blob=await new Promise(r=>c.toBlob(r,"image/jpeg",0.9));
      const b64=await compressImage(blob);
      setCapturedImg(`data:image/jpeg;base64,${b64}`);
      const parsed=await callGemini(b64);
      applyParsed(parsed);
      setScanPhase("done");
    } catch(e) { setScanErr("Failed to read receipt: "+(e.message||"please try again")); setScanPhase("error"); }
  };

  const applyParsed=(s)=>{
    if (s.items?.length) setItems(s.items.map(i=>({id:uid(),name:i.name||"",qty:i.qty||1,price:i.price?String(i.price):"",assignedTo:{}})));
    if (s.ppn_rate>0) setPpn(x=>({...x,enabled:true,rate:s.ppn_rate}));
    if (s.delivery_fee>0) setOngkir({enabled:true,amount:String(s.delivery_fee)});
    const extras=[];
    if (s.service_charge>0) extras.push({id:uid(),name:"Service Charge",value:String(s.service_charge),unit:"rp",mode:"rata"});
    s.other_fees?.forEach(f=>{if(f.amount!==0)extras.push({id:uid(),name:f.name,value:String(Math.abs(f.amount)),unit:"rp",mode:"rata"});});
    if (extras.length) setExtraFees(extras);
    if (s.discount_idr>0) setDiscount(x=>({...x,enabled:true,value:String(s.discount_idr),unit:"rp"}));
  };

  const addPerson=()=>{setPeople(p=>[...p,{id:uid(),name:newName.trim()||`Person ${p.length+1}`}]);setNewName("");};
  const removePerson=(id)=>{setPeople(p=>p.filter(x=>x.id!==id));setItems(it=>it.map(item=>{const a={...item.assignedTo};delete a[id];return{...item,assignedTo:a};}));};
  const renamePerson=(id,n)=>setPeople(p=>p.map(x=>x.id===id?{...x,name:n}:x));

  const addItem=()=>setItems(i=>[...i,{id:uid(),name:"",qty:1,price:"",assignedTo:{}}]);
  const removeItem=(id)=>setItems(i=>i.filter(x=>x.id!==id));
  const updateItem=(id,k,v)=>setItems(i=>i.map(x=>x.id===id?{...x,[k]:v}:x));
  const toggleAssign=(iid,pid)=>setItems(items=>items.map(item=>{if(item.id!==iid)return item;const a={...item.assignedTo};a[pid]?delete a[pid]:(a[pid]=true);return{...item,assignedTo:a};}));
  const assignAll=(iid)=>setItems(items=>items.map(item=>{if(item.id!==iid)return item;const a={};people.forEach(p=>(a[p.id]=true));return{...item,assignedTo:a};}));

  const addExtraFee=()=>setExtraFees(f=>[...f,{id:uid(),name:"",value:"",unit:"rp",mode:"rata"}]);
  const removeExtraFee=(id)=>setExtraFees(f=>f.filter(x=>x.id!==id));
  const updateFee=(id,k,v)=>setExtraFees(f=>f.map(x=>x.id===id?{...x,[k]:v}:x));

  const result=useCallback(()=>calculate({people,items,ppn,ongkir,discount,extraFees}),[people,items,ppn,ongkir,discount,extraFees])();

  const buildPerPersonData=useCallback(()=>people.map(p=>{
    const myItems=items.filter(item=>item.assignedTo[p.id]&&parseFloat(item.price)>0);
    let mySubtotal=0;
    const itemLines=myItems.map(item=>{
      const assigned=Object.keys(item.assignedTo).filter(k=>item.assignedTo[k]);
      const qty=parseInt(item.qty)||1, unitPrice=parseFloat(item.price)||0;
      const share=(unitPrice*qty)/assigned.length; mySubtotal+=share;
      return{name:item.name||"Item",qty,unitPrice,assigned:assigned.length,share};
    });
    let myDiscount=0;
    if (discount.enabled&&result.discountAmt>0) myDiscount=discount.mode==="per_item"?(result.subtotal>0?mySubtotal/result.subtotal*result.discountAmt:result.discountAmt/people.length):result.discountAmt/people.length;
    const myTaxBase=result.subtotal>0?mySubtotal/result.subtotal*(result.subtotal-result.discountAmt):(result.subtotal-result.discountAmt)/people.length;
    let myPpn=0;
    if (ppn.enabled&&result.ppnTotal>0) {
      if (ppn.unit==="rp") myPpn=ppn.mode==="per_item"?(result.subtotal>0?mySubtotal/result.subtotal*result.ppnTotal:result.ppnTotal/people.length):result.ppnTotal/people.length;
      else myPpn=ppn.mode==="per_item"?myTaxBase*(parseFloat(ppn.rate)||0)/100:result.ppnTotal/people.length;
    }
    const myOngkir=(ongkir.enabled&&result.ongkirAmt>0)?result.ongkirAmt/people.length:0;
    const myExtras=extraFees.map((fee,fi)=>{
      if(!result.extraAmounts[fi])return null;
      const amt=fee.mode==="per_item"?(result.subtotal>0?mySubtotal/result.subtotal*result.extraAmounts[fi]:result.extraAmounts[fi]/people.length):result.extraAmounts[fi]/people.length;
      return{name:fee.name||"Other Fee",amt,mode:fee.mode};
    }).filter(Boolean);
    return{p,itemLines,mySubtotal,myDiscount,myPpn,myOngkir,myExtras,total:result.totals[p.id]||0};
  }),[people,items,discount,ppn,ongkir,extraFees,result]);

  const perPersonData=buildPerPersonData();

  const handleShare=()=>{
    const gbRows=[
      ["Item Subtotal",fRp(result.subtotal)],
      discount.enabled&&result.discountAmt>0&&["Discount"+(discount.unit==="pct"?` (${discount.value}%)`:""),(("-"+fRp(result.discountAmt))),"#00b894"],
      ppn.enabled&&result.ppnTotal>0&&["Tax "+(ppn.unit==="rp"?fRp(ppn.rate):`${ppn.rate}%`)+(ppn.mode==="per_item"?" · proportional":" · equal"),fRp(result.ppnTotal)],
      ongkir.enabled&&result.ongkirAmt>0&&["Delivery Fee · equal split",fRp(result.ongkirAmt)],
      ...extraFees.map((f,fi)=>result.extraAmounts[fi]>0&&[(f.name||"Other Fee")+(f.unit==="pct"?` (${f.value}%)`:"")+( f.mode==="per_item"?" · proportional":" · equal"),fRp(result.extraAmounts[fi])]),
    ].filter(Boolean);

    const pages = perPersonData.map((d, i) =>
      buildPersonCanvas(d, i, people, result, ppn, ongkir, extraFees, discount, date, gbRows).toDataURL("image/png")
    );
    setSharePages(pages);
    setSharePageIdx(0);
    setShowShare(true);
  };

  const downloadImg=()=>{
    const a=document.createElement("a");
    a.href=sharePages[sharePageIdx];
    a.download=`splitbill-${perPersonData[sharePageIdx]?.p.name||sharePageIdx+1}.png`;
    a.click();
  };

  return (
    <div style={{minHeight:"100vh",background:"#0d0c1a",fontFamily:"'DM Mono',monospace",color:"#fffffe"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input,button,textarea{font-family:inherit}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#2d2d4e;border-radius:2px}
        .tb{background:none;border:none;cursor:pointer;padding:10px 16px;font-size:13px;color:#4a4a6a;border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
        .tb.on{color:#ff6b6b;border-bottom-color:#ff6b6b}
        .tag{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:99px;font-size:11px;cursor:pointer;border:1.5px solid;transition:all .15s;user-select:none}
        .tag.on{opacity:1}.tag.off{opacity:.28}.tag:hover{opacity:.7}
        .ifield{background:#161525;border:1.5px solid #252440;border-radius:8px;color:#fffffe;padding:7px 11px;font-size:13px;outline:none;transition:border .15s;width:100%}
        .ifield:focus{border-color:#ff6b6b55}
        .ifield::placeholder{color:#333354}
        .ifield[type="date"]{color-scheme:dark}
        .card{background:#161525;border:1.5px solid #252440;border-radius:12px;padding:15px}
        .sl{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#4a4a6a;margin-bottom:9px}
        .toggle{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0}
        .toggle input{opacity:0;width:0;height:0}
        .knob{position:absolute;cursor:pointer;inset:0;background:#252440;border-radius:20px;transition:.25s}
        .knob:before{content:"";position:absolute;width:14px;height:14px;left:3px;bottom:3px;background:#6a6a8a;border-radius:50%;transition:.25s}
        input:checked+.knob{background:#ff6b6b2a}
        input:checked+.knob:before{transform:translateX(16px);background:#ff6b6b}
        .ib{background:none;border:none;cursor:pointer;color:#3e3e5e;font-size:14px;padding:3px;transition:color .15s;flex-shrink:0}
        .ib:hover{color:#ff6b6b}
        @keyframes spin{to{transform:rotate(360deg)}}
        .spin{width:18px;height:18px;border:2px solid #6C5CE722;border-top-color:#a29bfe;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
        .overlay{position:fixed;inset:0;background:#060511ee;backdrop-filter:blur(14px);z-index:200;display:flex;align-items:flex-end;justify-content:center}
        .modal{background:#111020;border:1.5px solid #252440;border-radius:20px 20px 0 0;padding:20px;width:100%;max-width:480px;max-height:96vh;overflow-y:auto}
        .addbtn{background:#ff6b6b0d;border:1.5px dashed #ff6b6b33;border-radius:8px;color:#ff6b6b;padding:8px;cursor:pointer;font-size:12px;transition:all .15s;width:100%}
        .addbtn:hover{background:#ff6b6b1a;border-color:#ff6b6b66}
        video{display:block;}
        .share-img{width:100%;border-radius:12px;border:1.5px solid #252440;display:block;-webkit-touch-callout:default;user-select:none;-webkit-user-select:none}
        .tags-wrap{display:flex;flex-wrap:wrap;gap:5px}
      `}</style>

      {/* ── SCAN MODAL — fullscreen camera ── */}
      {showScan && (
        <div style={{position:"fixed",inset:0,background:"#000",zIndex:200,display:"flex",flexDirection:"column"}}>

          {/* Top bar */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 18px",background:"linear-gradient(to bottom,rgba(0,0,0,.7),transparent)",position:"absolute",top:0,left:0,right:0,zIndex:2}}>
            <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:16,color:"#fff"}}>📷 Scan Receipt</span>
            <button onClick={closeScan} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:99,color:"#fff",width:32,height:32,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>

          {/* Camera / captured image — fills screen */}
          {scanPhase==="preview" && (
            <>
              <video ref={videoRef} autoPlay playsInline muted
                style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} />
              {/* Subtle full-screen scan line hint */}
              <div style={{position:"absolute",inset:0,pointerEvents:"none",
                background:"linear-gradient(to bottom,transparent 60%,rgba(0,0,0,.5) 100%)"}} />
              <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"20px 20px 40px",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
                <span style={{fontSize:11,color:"rgba(255,255,255,0.5)",textAlign:"center"}}>Point the camera at the entire receipt, then tap Scan.</span>
                <button onClick={captureAndScan}
                  style={{width:"100%",maxWidth:360,padding:"16px",background:"#fff",border:"none",borderRadius:14,color:"#0d0c1a",fontSize:16,fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,boxShadow:"0 4px 24px rgba(0,0,0,.4)"}}>
                  <span style={{fontSize:22}}>📸</span> Scan Now
                </button>
              </div>
            </>
          )}

          {scanPhase==="processing" && (
            <>
              {capturedImg && <img src={capturedImg} alt="captured" style={{width:"100%",height:"100%",objectFit:"contain",display:"block"}} />}
              <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"20px 20px 40px"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",background:"rgba(108,92,231,0.15)",border:"1px solid #6C5CE755",borderRadius:12,backdropFilter:"blur(10px)"}}>
                  <div className="spin"/>
                  <span style={{fontSize:13,color:"#a29bfe"}}>AI is reading your receipt...</span>
                </div>
              </div>
            </>
          )}

          {scanPhase==="done" && (
            <>
              {capturedImg && <img src={capturedImg} alt="captured" style={{width:"100%",height:"100%",objectFit:"contain",display:"block"}} />}
              <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"20px 20px 40px",display:"flex",flexDirection:"column",gap:10}}>
                <div style={{padding:"13px 16px",background:"rgba(0,184,148,0.12)",border:"1px solid #00b89455",borderRadius:12,backdropFilter:"blur(10px)",fontSize:12,color:"#00b894",lineHeight:1.6}}>
                  ✅ Success! Items and charges have been filled in automatically. Please assign each item to the relevant person.
                </div>
                <button onClick={closeScan}
                  style={{width:"100%",padding:"14px",background:"#ff6b6b",border:"none",borderRadius:12,color:"#fff",fontSize:15,fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,cursor:"pointer"}}>
                  Continue →
                </button>
              </div>
            </>
          )}

          {scanPhase==="error" && (
            <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"flex-end",padding:"20px 20px 40px",gap:10}}>
              <div style={{padding:"13px 16px",background:"rgba(255,107,107,0.1)",border:"1px solid #ff6b6b44",borderRadius:12,fontSize:12,color:"#ff8b8b",lineHeight:1.6}}>
                ⚠️ {scanErr}
              </div>
              <button onClick={()=>{setCapturedImg(null);setShowScan(false);setTimeout(()=>setShowScan(true),100);}}
                style={{width:"100%",padding:"13px",background:"#252440",border:"none",borderRadius:12,color:"#a7a9be",fontSize:13,cursor:"pointer"}}>
                Try Again
              </button>
              <button onClick={closeScan}
                style={{width:"100%",padding:"12px",background:"none",border:"1px solid #252440",borderRadius:12,color:"#6a6a8a",fontSize:13,cursor:"pointer"}}>
                Close
              </button>
            </div>
          )}

          <canvas ref={canvasRef} style={{display:"none"}}/>
        </div>
      )}

      {/* ── SHARE MODAL — per person ── */}
      {showShare && sharePages.length > 0 && (
        <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)setShowShare(false);}}>
          <div className="modal">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:16}}>🖼️ Share Receipt</span>
              <button className="ib" onClick={()=>setShowShare(false)} style={{fontSize:17}}>✕</button>
            </div>

            {/* Person navigation */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <button onClick={()=>setSharePageIdx(i=>Math.max(0,i-1))}
                disabled={sharePageIdx===0}
                style={{padding:"6px 14px",background:"#161525",border:"1.5px solid #252440",borderRadius:8,color:sharePageIdx===0?"#333354":"#a7a9be",cursor:sharePageIdx===0?"default":"pointer",fontSize:13}}>
                ← Prev
              </button>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:13,fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,color:colorOf(sharePageIdx)}}>
                  {perPersonData[sharePageIdx]?.p.name}
                </div>
                <div style={{fontSize:10,color:"#4a4a6a"}}>{sharePageIdx+1} of {sharePages.length}</div>
              </div>
              <button onClick={()=>setSharePageIdx(i=>Math.min(sharePages.length-1,i+1))}
                disabled={sharePageIdx===sharePages.length-1}
                style={{padding:"6px 14px",background:"#161525",border:"1.5px solid #252440",borderRadius:8,color:sharePageIdx===sharePages.length-1?"#333354":"#a7a9be",cursor:sharePageIdx===sharePages.length-1?"default":"pointer",fontSize:13}}>
                Next →
              </button>
            </div>

            <div style={{background:"#a29bfe14",border:"1px solid #a29bfe33",borderRadius:10,padding:"9px 13px",fontSize:11,color:"#a29bfe",marginBottom:12,lineHeight:1.7}}>
              📱 Mobile: press and hold image → <b>Save Image</b><br/>
              💻 Desktop: right-click image → <b>Save Image As</b>
            </div>

            <img
              key={sharePageIdx}
              src={sharePages[sharePageIdx]}
              alt={`Receipt for ${perPersonData[sharePageIdx]?.p.name}`}
              className="share-img"
            />
          </div>
        </div>
      )}

      {/* ── HEADER ── */}
      <div style={{background:"#111020",borderBottom:"1px solid #252440",padding:"16px 18px 0"}}>
        <div style={{maxWidth:520,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:9}}>
              <span style={{fontSize:22}}>🧾</span>
              <div>
                <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:18,letterSpacing:"-0.02em"}}>Split</span>
                <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:18,letterSpacing:"-0.02em",color:"#ff6b6b"}}>Billed</span>
              </div>
            </div>
            <button onClick={()=>setShowScan(true)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 13px",background:"#6C5CE71a",border:"1.5px solid #6C5CE744",borderRadius:99,color:"#a29bfe",fontSize:12,cursor:"pointer"}}>
              📷 Scan Receipt
            </button>
          </div>
          <div style={{display:"flex"}}>
            {[["items","🛒 Input"],["result","💸 Result"]].map(([t,l])=>(
              <button key={t} className={`tb${activeTab===t?" on":""}`} onClick={()=>setActiveTab(t)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:520,margin:"0 auto",padding:"18px 13px 80px"}}>

        {/* ═══ INPUT TAB ═══ */}
        {activeTab==="items" && (<>
          <div className="card" style={{marginBottom:18,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div>
              <div style={{fontSize:13,fontWeight:500}}>📅 Date</div>
              <div style={{fontSize:10,color:"#4a4a6a",marginTop:1}}>Date of the bill</div>
            </div>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{background:"#0d0c1a",border:"1.5px solid #252440",borderRadius:8,color:"#fffffe",padding:"6px 10px",fontSize:12,outline:"none",fontFamily:"'DM Mono',monospace",colorScheme:"dark",flexShrink:0}} />
          </div>

          {/* People */}
          <div style={{marginBottom:22}}>
            <div className="sl">👥 People</div>
            <div className="tags-wrap" style={{marginBottom:9}}>
              {people.map((p,i)=>(
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:3,background:"#161525",border:`1.5px solid ${colorOf(i)}2e`,borderRadius:99,padding:"3px 6px 3px 10px"}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:colorOf(i),display:"inline-block",flexShrink:0}}/>
                  <input value={p.name} onChange={e=>renamePerson(p.id,e.target.value)}
                    style={{background:"none",border:"none",color:"#fffffe",fontSize:12,outline:"none",width:Math.max(40,p.name.length*7.8)}} />
                  {people.length>1 && <button className="ib" onClick={()=>removePerson(p.id)} style={{fontSize:10}}>✕</button>}
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:7}}>
              <input className="ifield" placeholder="Add person..." value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPerson()} />
              <button onClick={addPerson} style={{background:"#ff6b6b",border:"none",borderRadius:8,color:"#fff",padding:"0 13px",cursor:"pointer",fontSize:16,flexShrink:0}}>+</button>
            </div>
          </div>

          {/* Items */}
          <div style={{marginBottom:22}}>
            <div className="sl">🍜 Items</div>
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              {items.map((item,idx)=>(
                <div key={item.id} className="card">
                  <div style={{display:"flex",gap:6,marginBottom:9}}>
                    <input className="ifield" placeholder={`Item ${idx+1}...`} value={item.name} onChange={e=>updateItem(item.id,"name",e.target.value)} style={{flex:1}} />
                    <input className="ifield" placeholder="1" value={item.qty} onChange={e=>updateItem(item.id,"qty",e.target.value)} type="number" min="1" style={{width:48,textAlign:"center",padding:"7px 4px"}} />
                    <div style={{position:"relative",width:120}}>
                      <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"#4a4a6a",fontSize:11}}>Rp</span>
                      <input className="ifield" placeholder="0" value={item.price} onChange={e=>updateItem(item.id,"price",e.target.value)} type="number" style={{paddingLeft:26}} />
                    </div>
                    {items.length>1 && <button className="ib" onClick={()=>removeItem(item.id)}>🗑</button>}
                  </div>
                  <div style={{fontSize:10,color:"#4a4a6a",marginBottom:5}}>Who ordered this?</div>
                  <div className="tags-wrap">
                    {people.map((p,pi)=>{const sel=!!item.assignedTo[p.id];return(
                      <span key={p.id} className={`tag ${sel?"on":"off"}`} style={{borderColor:colorOf(pi),color:colorOf(pi),background:sel?colorOf(pi)+"18":"transparent"}} onClick={()=>toggleAssign(item.id,p.id)}>
                        {sel?"✓ ":""}{p.name}</span>
                    );})}
                    <span className="tag off" style={{borderColor:"#4a4a6a",color:"#4a4a6a"}} onClick={()=>assignAll(item.id)}>Everyone</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{marginTop:8}}><button className="addbtn" onClick={addItem}>+ Add Item</button></div>
          </div>

          {/* Tax */}
          <div className="card" style={{marginBottom:9}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:13,fontWeight:500}}>🧾 Tax (PPN)</div><div style={{fontSize:10,color:"#4a4a6a"}}>Value Added Tax</div></div>
              <label className="toggle"><input type="checkbox" checked={ppn.enabled} onChange={e=>setPpn(x=>({...x,enabled:e.target.checked}))}/><span className="knob"/></label>
            </div>
            {ppn.enabled && (<>
              <div style={{marginTop:10,display:"flex",gap:6,alignItems:"center"}}>
                <UnitToggle value={ppn.unit} onChange={v=>setPpn(x=>({...x,unit:v}))} />
                {ppn.unit==="rp"
                  ? <><span style={{fontSize:12,color:"#4a4a6a",flexShrink:0}}>Rp</span><input className="ifield" type="number" placeholder="0" value={ppn.rate} onChange={e=>setPpn(x=>({...x,rate:e.target.value}))} /></>
                  : <><input className="ifield" type="number" value={ppn.rate} onChange={e=>setPpn(x=>({...x,rate:e.target.value}))} style={{width:72}} /><span style={{fontSize:12,color:"#4a4a6a"}}>% of subtotal</span></>
                }
              </div>
              <div style={{fontSize:10,color:"#4a4a6a",marginTop:10,marginBottom:2}}>Distribution method:</div>
              <ModeToggle value={ppn.mode} onChange={v=>setPpn(x=>({...x,mode:v}))} labels={["Proportional","Equal Split"]} />
            </>)}
          </div>

          {/* Delivery */}
          <div className="card" style={{marginBottom:9}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:13,fontWeight:500}}>🚚 Delivery Fee</div><div style={{fontSize:10,color:"#4a4a6a"}}>Split equally among all</div></div>
              <label className="toggle"><input type="checkbox" checked={ongkir.enabled} onChange={e=>setOngkir(x=>({...x,enabled:e.target.checked}))}/><span className="knob"/></label>
            </div>
            {ongkir.enabled && (
              <div style={{marginTop:10,display:"flex",gap:6,alignItems:"center"}}>
                <span style={{fontSize:12,color:"#4a4a6a",flexShrink:0}}>Rp</span>
                <input className="ifield" type="number" placeholder="0" value={ongkir.amount} onChange={e=>setOngkir(x=>({...x,amount:e.target.value}))} />
              </div>
            )}
          </div>

          {/* Discount */}
          <div className="card" style={{marginBottom:9}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:13,fontWeight:500}}>🏷️ Discount</div><div style={{fontSize:10,color:"#4a4a6a"}}>Promo code / voucher</div></div>
              <label className="toggle"><input type="checkbox" checked={discount.enabled} onChange={e=>setDiscount(x=>({...x,enabled:e.target.checked}))}/><span className="knob"/></label>
            </div>
            {discount.enabled && (<>
              <div style={{marginTop:10,display:"flex",gap:6,alignItems:"center"}}>
                <UnitToggle value={discount.unit} onChange={v=>setDiscount(x=>({...x,unit:v}))} />
                {discount.unit==="rp"
                  ? <><span style={{fontSize:12,color:"#4a4a6a",flexShrink:0}}>Rp</span><input className="ifield" type="number" placeholder="0" value={discount.value} onChange={e=>setDiscount(x=>({...x,value:e.target.value}))} /></>
                  : <><input className="ifield" type="number" placeholder="0" value={discount.value} onChange={e=>setDiscount(x=>({...x,value:e.target.value}))} style={{width:80}} /><span style={{fontSize:12,color:"#4a4a6a"}}>% of subtotal</span></>}
              </div>
              <div style={{fontSize:10,color:"#4a4a6a",marginTop:10,marginBottom:2}}>Distribution method:</div>
              <ModeToggle value={discount.mode} onChange={v=>setDiscount(x=>({...x,mode:v}))} labels={["Proportional","Equal Split"]} />
            </>)}
          </div>

          {/* Other Fees */}
          <div className="card" style={{marginBottom:22}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:extraFees.length?10:0}}>
              <div><div style={{fontSize:13,fontWeight:500}}>➕ Other Charges</div><div style={{fontSize:10,color:"#4a4a6a"}}>Service charge, tips, packaging...</div></div>
              <button onClick={addExtraFee} style={{background:"#ff6b6b0d",border:"1px solid #ff6b6b33",borderRadius:7,color:"#ff6b6b",padding:"4px 10px",cursor:"pointer",fontSize:11}}>+ Add</button>
            </div>
            {extraFees.map(fee=>(
              <div key={fee.id} style={{borderTop:"1px solid #252440",paddingTop:10,marginTop:10}}>
                <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:7}}>
                  <input className="ifield" placeholder="Charge name..." value={fee.name} onChange={e=>updateFee(fee.id,"name",e.target.value)} style={{flex:1}} />
                  <button className="ib" onClick={()=>removeExtraFee(fee.id)}>🗑</button>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <UnitToggle value={fee.unit} onChange={v=>updateFee(fee.id,"unit",v)} />
                  {fee.unit==="rp"
                    ? <><span style={{fontSize:12,color:"#4a4a6a",flexShrink:0}}>Rp</span><input className="ifield" type="number" placeholder="0" value={fee.value} onChange={e=>updateFee(fee.id,"value",e.target.value)} /></>
                    : <><input className="ifield" type="number" placeholder="0" value={fee.value} onChange={e=>updateFee(fee.id,"value",e.target.value)} style={{width:72}} /><span style={{fontSize:12,color:"#4a4a6a"}}>% of subtotal</span></>}
                </div>
                <div style={{fontSize:10,color:"#4a4a6a",marginTop:8,marginBottom:2}}>Distribution method:</div>
                <ModeToggle value={fee.mode} onChange={v=>updateFee(fee.id,"mode",v)} labels={["Proportional","Equal Split"]} />
              </div>
            ))}
          </div>

          <button onClick={()=>setActiveTab("result")} style={{width:"100%",padding:"13px",background:"#ff6b6b",border:"none",borderRadius:12,color:"#fff",fontSize:15,fontWeight:700,fontFamily:"'Space Grotesk',sans-serif",cursor:"pointer",boxShadow:"0 0 30px #ff6b6b33"}}>
            Calculate →
          </button>
        </>)}

        {/* ═══ RESULT TAB ═══ */}
        {activeTab==="result" && (<>
          {date && (
            <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",background:"#a29bfe14",border:"1px solid #a29bfe33",borderRadius:99,fontSize:11,color:"#a29bfe",marginBottom:14}}>
              📅 {fmtDate(date)}
            </div>
          )}

          <div style={{background:"linear-gradient(135deg,#ff6b6b,#ff8e53)",borderRadius:16,padding:"18px 20px",marginBottom:18,position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:-24,right:-24,width:88,height:88,background:"#ffffff14",borderRadius:"50%"}}/>
            <div style={{position:"absolute",bottom:-28,right:20,width:112,height:112,background:"#ffffff08",borderRadius:"50%"}}/>
            <div style={{fontSize:9,letterSpacing:".18em",textTransform:"uppercase",opacity:.75,marginBottom:2}}>Grand Total</div>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:28,fontWeight:700,letterSpacing:"-0.03em"}}>{fRp(result.grandTotal)}</div>
            <div style={{fontSize:10,opacity:.65,marginTop:2}}>for {people.length} {people.length===1?"person":"people"}</div>
          </div>

          <div className="card" style={{marginBottom:18}}>
            <div className="sl">📊 Summary</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {[
                ["Item Subtotal",fRp(result.subtotal),"#fffffe"],
                discount.enabled&&result.discountAmt>0&&["Discount"+(discount.unit==="pct"?` (${discount.value}%)`:"")+(discount.mode==="per_item"?" · proportional":" · equal"),"−"+fRp(result.discountAmt),"#00b894"],
                ppn.enabled&&result.ppnTotal>0&&["Tax "+(ppn.unit==="rp"?fRp(ppn.rate):`${ppn.rate}%`)+(ppn.mode==="per_item"?" · proportional":" · equal"),fRp(result.ppnTotal),"#fffffe"],
                ongkir.enabled&&result.ongkirAmt>0&&["Delivery Fee · equal split",fRp(result.ongkirAmt),"#fffffe"],
                ...extraFees.map((f,fi)=>result.extraAmounts[fi]>0&&[(f.name||"Other Fee")+(f.unit==="pct"?` (${f.value}%)`:"")+( f.mode==="per_item"?" · proportional":" · equal"),fRp(result.extraAmounts[fi]),"#fffffe"]),
              ].filter(Boolean).map(([lbl,val,col],i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12}}>
                  <span style={{color:"#6a6a8a"}}>{lbl}</span>
                  <span style={{color:col}}>{val}</span>
                </div>
              ))}
              <div style={{borderTop:"1px solid #252440",paddingTop:8,marginTop:2,display:"flex",justifyContent:"space-between",fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:14}}>
                <span>Total</span><span style={{color:"#ff6b6b"}}>{fRp(result.grandTotal)}</span>
              </div>
            </div>
          </div>

          <div className="sl">🧾 Receipt per Person</div>
          <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:18}}>
            {perPersonData.map(({p,itemLines,mySubtotal,myDiscount,myPpn,myOngkir,myExtras,total},i)=>{
              const pct=result.grandTotal>0?(total/result.grandTotal)*100:0;
              const col=colorOf(i);
              const hasFees=myDiscount>0||myPpn>0||myOngkir>0||myExtras.length>0;
              return (
                <div key={p.id} style={{background:"#161525",border:`1.5px solid ${col}28`,borderRadius:14,overflow:"hidden"}}>
                  <div style={{background:`${col}10`,borderBottom:`1px solid ${col}20`,padding:"12px 15px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:28,height:28,borderRadius:"50%",background:`${col}22`,border:`2px solid ${col}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:col,fontFamily:"'Space Grotesk',sans-serif"}}>
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:15}}>{p.name}</span>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:17,color:col}}>{fRp(total)}</div>
                      <div style={{fontSize:10,color:col+"99"}}>{Math.round(pct)}% of total</div>
                    </div>
                  </div>
                  <div style={{height:3,background:"#252440"}}><div style={{width:`${pct}%`,height:"100%",background:col}}/></div>
                  <div style={{padding:"12px 15px"}}>
                    {itemLines.length>0 ? (<>
                      <div style={{fontSize:10,color:"#4a4a6a",letterSpacing:".1em",textTransform:"uppercase",marginBottom:7}}>Items</div>
                      {itemLines.map((ln,li)=>(
                        <div key={li} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:6}}>
                          <div style={{flex:1,minWidth:0}}>
                            <span style={{fontSize:13,color:"#c8c4ff"}}>{ln.name}</span>
                            {ln.qty>1 && <span style={{fontSize:11,color:"#4a4a6a",marginLeft:4}}>×{ln.qty}</span>}
                            {ln.assigned>1 && <span style={{fontSize:10,color:"#3a3a5a",marginLeft:4}}>÷{ln.assigned} people</span>}
                            {(ln.qty>1||ln.assigned>1) && (
                              <div style={{fontSize:10,color:"#3a3a5a",marginTop:1}}>
                                {ln.qty>1?`${fRp(ln.unitPrice)} × ${ln.qty}`:""}{ln.qty>1&&ln.assigned>1?" ":""}{ln.assigned>1?`÷ ${ln.assigned}`:""}
                              </div>
                            )}
                          </div>
                          <span style={{fontSize:13,color:"#fffffe",marginLeft:10,flexShrink:0}}>{fRp(ln.share)}</span>
                        </div>
                      ))}
                      <div style={{display:"flex",justifyContent:"space-between",borderTop:`1px dashed ${col}22`,paddingTop:7,marginTop:2,marginBottom:hasFees?12:0}}>
                        <span style={{fontSize:11,color:"#4a4a6a"}}>Item subtotal</span>
                        <span style={{fontSize:12,color:"#a7a9be"}}>{fRp(mySubtotal)}</span>
                      </div>
                    </>) : (
                      <div style={{fontSize:12,color:"#3a3a5a",textAlign:"center",padding:"8px 0",marginBottom:hasFees?10:0}}>— no items assigned —</div>
                    )}
                    {hasFees && (<>
                      <div style={{fontSize:10,color:"#4a4a6a",letterSpacing:".1em",textTransform:"uppercase",marginBottom:7}}>Additional Charges</div>
                      {myDiscount>0 && (
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,alignItems:"center"}}>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <span style={{fontSize:11,color:"#00b894"}}>🏷️ Discount</span>
                            <span style={{fontSize:10,color:"#00b89455",background:"#00b89410",padding:"1px 6px",borderRadius:99}}>{discount.mode==="per_item"?"proportional":"equal"}</span>
                          </div>
                          <span style={{fontSize:13,color:"#00b894"}}>−{fRp(myDiscount)}</span>
                        </div>
                      )}
                      {myPpn>0 && (
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,alignItems:"center"}}>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <span style={{fontSize:11,color:"#a7a9be"}}>🧾 Tax {ppn.unit==="rp"?fRp(ppn.rate):`${ppn.rate}%`}</span>
                            <span style={{fontSize:10,color:"#4a4a6a",background:"#252440",padding:"1px 6px",borderRadius:99}}>{ppn.mode==="per_item"?"proportional":"equal"}</span>
                          </div>
                          <span style={{fontSize:13,color:"#a7a9be"}}>{fRp(myPpn)}</span>
                        </div>
                      )}
                      {myOngkir>0 && (
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                          <span style={{fontSize:11,color:"#a7a9be"}}>🚚 Delivery Fee <span style={{fontSize:10,color:"#4a4a6a"}}>(÷{people.length})</span></span>
                          <span style={{fontSize:13,color:"#a7a9be"}}>{fRp(myOngkir)}</span>
                        </div>
                      )}
                      {myExtras.map((ex,ei)=>(
                        <div key={ei} style={{display:"flex",justifyContent:"space-between",marginBottom:5,alignItems:"center"}}>
                          <div style={{display:"flex",alignItems:"center",gap:5}}>
                            <span style={{fontSize:11,color:"#a7a9be"}}>➕ {ex.name}</span>
                            <span style={{fontSize:10,color:"#4a4a6a",background:"#252440",padding:"1px 6px",borderRadius:99}}>{ex.mode==="per_item"?"proportional":"equal"}</span>
                          </div>
                          <span style={{fontSize:13,color:"#a7a9be"}}>{fRp(ex.amt)}</span>
                        </div>
                      ))}
                    </>)}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:`1px solid ${col}33`,paddingTop:10,marginTop:8}}>
                      <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:14}}>Total Amount Due</span>
                      <span style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,fontSize:18,color:col}}>{fRp(total)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{display:"flex",gap:9,marginBottom:12}}>
            <button onClick={()=>setActiveTab("items")} style={{flex:1,padding:"11px",background:"#161525",border:"1.5px solid #252440",borderRadius:11,color:"#6a6a8a",fontSize:13,cursor:"pointer"}}>← Edit</button>
            <button onClick={handleShare} style={{flex:2,padding:"11px",background:"linear-gradient(135deg,#6C5CE7,#a29bfe)",border:"none",borderRadius:11,color:"#fff",fontSize:13,fontFamily:"'Space Grotesk',sans-serif",fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
              📤 Share as Image
            </button>
          </div>
          <div style={{textAlign:"center",paddingBottom:4}}>
            <span style={{fontSize:11,color:"#2a2a42"}}>created by </span>
            <span style={{fontSize:11,color:"#3a3a58",fontFamily:"'Space Grotesk',sans-serif",fontWeight:600,letterSpacing:"0.02em"}}>dotterspace</span>
            <span style={{fontSize:11,color:"#2a2a42"}}> ✦</span>
          </div>
        </>)}
      </div>
    </div>
  );
}
