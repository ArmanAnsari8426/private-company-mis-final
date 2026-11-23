"use client";

import ExcelJS from "exceljs";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Building2, CalendarDays,
  CheckCircle2, ChevronRight, Database, FileSpreadsheet, LayoutDashboard,
  Loader2, LogOut, Plus, RefreshCw, Search, Settings, ShieldCheck, Upload, Users, Wallet, X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Company = { id: string; name: string; code: string };
type Tx = {
  id: string; transaction_date: string; value_date?: string | null; description: string | null;
  party_name: string | null; amount: number; transaction_type: "paid" | "received" | "advance" | "balance";
  remarks: string | null; company_id: string; cheque_no?: string | null; crdr?: string | null;
  tax_id?: string | null; month_label?: string | null; location?: string | null; source_company?: string | null;
};
type ImportRow = {
  sourceRow: number; transaction_date: string; value_date: string | null; description: string | null;
  cheque_no: string | null; crdr: string; amount: number; remarks: string | null; source_company: string;
  party_name: string | null; tax_id: string | null; month_label: string | null; location: string | null;
  source_hash: string; transaction_type: "paid" | "received";
};
type Tab = "overview" | "companies" | "transactions" | "ledger" | "imports" | "reports" | "settings";

const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);
const dateLabel = (v: string) => v ? new Date(`${v}T00:00:00`).toLocaleDateString("en-IN") : "—";
const clean = (v: unknown) => String(v ?? "").trim();
const DEFAULT_MAP: Record<string, string> = {
  "Knack-Mohali": "KNACK", "SouthSquare": "SOUTHSQ", "Crystal-Mohali": "CRYSTAL",
  "Telus-Mohali": "TELUS", "Skysun- Mohali": "SKYSUN", "Skysun- Mohali ": "SKYSUN",
  "Coronis-Mohali": "CORONIS",
};

function dateFromCell(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = clean(v);
  if (!s) return "";
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function amountFromCell(v: unknown): number {
  if (typeof v === "number") return v;
  const s = clean(v).replace(/[₹,\s]/g, "").replace(/[()]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]); const [txs, setTxs] = useState<Tx[]>([]);
  const [role, setRole] = useState("staff"); const [workspace, setWorkspace] = useState("");
  const [tab, setTab] = useState<Tab>("overview"); const [selected, setSelected] = useState("");
  const [query, setQuery] = useState(""); const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ transaction_date: new Date().toISOString().slice(0, 10), company_id: "", party_name: "", description: "", amount: "", transaction_type: "paid", remarks: "" });
  const [fileName, setFileName] = useState(""); const [sheetName, setSheetName] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([]); const [sourceNames, setSourceNames] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({}); const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [batches, setBatches] = useState<any[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!session?.user?.id) return;
    setLoading(true); setError("");
    const { data: member, error: memberError } = await supabase.from("workspace_members").select("workspace_id,role").eq("user_id", session.user.id).maybeSingle();
    if (memberError || !member) { setError(memberError?.message || "Is login ko workspace access nahi mila. Admin membership check karein."); setLoading(false); return; }
    setWorkspace(member.workspace_id); setRole(member.role);
    const { data: c, error: ce } = await supabase.from("companies").select("id,name,code").eq("workspace_id", member.workspace_id).eq("is_active", true).order("name");
    if (ce) setError(ce.message);
    setCompanies((c || []) as Company[]);
    const all: Tx[] = []; let from = 0; const pageSize = 1000;
    while (true) {
      const { data, error: te } = await supabase.from("transactions")
        .select("id,transaction_date,value_date,description,party_name,amount,transaction_type,remarks,company_id,cheque_no,crdr,tax_id,month_label,location,source_company")
        .eq("workspace_id", member.workspace_id).order("transaction_date", { ascending: false }).range(from, from + pageSize - 1);
      if (te) { setError(te.message); break; }
      all.push(...((data || []) as Tx[]));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    setTxs(all);
    if (c?.length && !form.company_id) setForm(v => ({ ...v, company_id: c[0].id }));
    const { data: b } = await supabase.from("import_batches").select("id,file_name,sheet_name,row_count,inserted_count,duplicate_count,status,error_message,created_at").eq("workspace_id", member.workspace_id).order("created_at", { ascending: false }).limit(10);
    setBatches(b || []); setLoading(false);
  }, [session, form.company_id]);
  useEffect(() => { if (session) void loadData(); }, [session, loadData]);

  async function login(e: React.FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
    if (e2) setError(e2.message);
    setBusy(false);
  }
  async function addTx(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const amount = amountFromCell(form.amount);
    if (!amount || amount <= 0) { setError("Amount zero se zyada hona chahiye."); setBusy(false); return; }
    const { error: e2 } = await supabase.from("transactions").insert({ workspace_id: workspace, company_id: form.company_id, transaction_date: form.transaction_date, party_name: form.party_name || null, description: form.description || null, amount, transaction_type: form.transaction_type, remarks: form.remarks || null });
    if (e2) setError(e2.message); else { setShowAdd(false); setForm(v => ({ ...v, party_name: "", description: "", amount: "", remarks: "" })); setNotice("Transaction database mein save ho gayi."); await loadData(); }
    setBusy(false);
  }

  async function parseWorkbook(file: File) {
    setBusy(true); setError(""); setNotice(""); setParseErrors([]); setImportRows([]); setSourceNames([]); setMapping({}); setFileName(file.name);
    try {
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
      let ws = wb.getWorksheet("Sheet3");
      if (!ws) ws = wb.worksheets.find(s => s.getRow(1).values.some(v => clean(v).toLowerCase() === "txn posted date"));
      if (!ws) throw new Error("Workbook mein 'Txn Posted Date' header wala sheet nahi mila. Original MIS format check karein.");
      setSheetName(ws.name);
      const headers: Record<string, number> = {};
      ws.getRow(1).eachCell((cell, col) => { headers[clean(cell.value).toLowerCase()] = col; });
      const col = (name: string) => headers[name.toLowerCase()] || 0;
      const required = ["txn posted date", "txn amount(inr)", "crdr", "companyhead"];
      const missing = required.filter(h => !col(h));
      if (missing.length) throw new Error(`Required columns missing: ${missing.join(", ")}`);
      const parsed: ImportRow[] = []; const issues: string[] = []; const srcSet = new Set<string>();
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const raw = (name: string) => col(name) ? row.getCell(col(name)).value : null;
        const company = clean(raw("CompanyHEAD"));
        const date = dateFromCell(raw("Txn Posted Date"));
        const amount = amountFromCell(raw("Txn Amount(INR)"));
        const drcr = clean(raw("CrDr")).toLowerCase();
        if (!company && !date && !clean(raw("Description")) && !clean(raw("Name")) && !clean(raw("Txn Amount(INR)"))) continue;
        if (!date || !Number.isFinite(amount) || amount <= 0 || !company || !["dr.", "cr.", "dr", "cr"].includes(drcr)) {
          issues.push(`Row ${r}: date, positive amount, company ya Dr./Cr. value invalid hai.`); continue;
        }
        const valueDate = dateFromCell(raw("Value Date")) || null;
        const source = {
          transaction_date: date, value_date: valueDate, description: clean(raw("Description")) || null,
          cheque_no: clean(raw("Cheque No.")) || null, crdr: clean(raw("CrDr")), amount,
          remarks: clean(raw("Remarks2")) || null, source_company: company, party_name: clean(raw("Name")) || null,
          tax_id: clean(raw("EBQPK4275L")) || null, month_label: dateFromCell(raw("Month")) || clean(raw("Month")) || null,
          location: clean(raw("Location")) || null,
        };
        const canonical = [ws.name, r, ...Object.values(source)].join("¦");
        parsed.push({ ...source, sourceRow: r, source_hash: await sha256(canonical), transaction_type: drcr.startsWith("dr") ? "paid" : "received" });
        srcSet.add(company);
      }
      const names = [...srcSet].sort();
      setImportRows(parsed); setSourceNames(names);
      const initial: Record<string, string> = {};
      for (const name of names) {
        const guess = DEFAULT_MAP[name] || DEFAULT_MAP[name.trim()];
        if (guess && companies.some(c => c.code === guess)) initial[name] = companies.find(c => c.code === guess)!.id;
      }
      setMapping(initial); setParseErrors(issues);
      setNotice(`${parsed.length} valid rows preview ke liye ready hain. ${issues.length} rows validation ke karan skip hongi.`);
    } catch (e: any) { setError(e?.message || "Excel file read nahi ho payi."); }
    setBusy(false);
  }

  async function importExcel() {
    if (!workspace || !importRows.length) return;
    const unmapped = sourceNames.filter(n => !mapping[n]);
    if (unmapped.length) { setError(`Pehle in source companies ki mapping select karein: ${unmapped.join(", ")}`); return; }
    setBusy(true); setError(""); setNotice("");
    const { data: batch, error: batchError } = await supabase.from("import_batches").insert({ workspace_id: workspace, file_name: fileName, sheet_name: sheetName, row_count: importRows.length, status: "processing" }).select("id").single();
    if (batchError || !batch) { setError(`Import batch create nahi hua. Supabase migration_v2.sql run kiya hai? ${batchError?.message || ""}`); setBusy(false); return; }
    let inserted = 0;
    try {
      const chunkSize = 150;
      for (let i = 0; i < importRows.length; i += chunkSize) {
        const chunk = importRows.slice(i, i + chunkSize).map(r => ({
          workspace_id: workspace, company_id: mapping[r.source_company], transaction_date: r.transaction_date,
          value_date: r.value_date, description: r.description, cheque_no: r.cheque_no, crdr: r.crdr,
          amount: r.amount, remarks: r.remarks, source_company: r.source_company, party_name: r.party_name,
          tax_id: r.tax_id, month_label: r.month_label, location: r.location, source_sheet: sheetName,
          source_row: r.sourceRow, source_hash: r.source_hash, transaction_type: r.transaction_type,
          import_batch_id: batch.id,
        }));
        const { data, error: insertError } = await supabase.from("transactions")
          .upsert(chunk, { onConflict: "workspace_id,source_hash", ignoreDuplicates: true }).select("id");
        if (insertError) throw insertError;
        inserted += data?.length || 0;
      }
      const duplicateCount = importRows.length - inserted;
      const { error: updateError } = await supabase.from("import_batches").update({ inserted_count: inserted, duplicate_count: duplicateCount, status: "completed" }).eq("id", batch.id);
      if (updateError) throw updateError;
      setNotice(`Import complete: ${inserted} new rows save hui, ${duplicateCount} duplicate rows skip hui. Invalid rows ${parseErrors.length} preview mein skip hui.`);
      setImportRows([]); setSourceNames([]); setMapping({}); await loadData();
    } catch (e: any) {
      await supabase.from("import_batches").update({ inserted_count: inserted, status: "failed", error_message: e?.message || "Import failed" }).eq("id", batch.id);
      setError(`Import beech mein ruk gaya. ${inserted} rows save ho chuki hain; same file dobara import karne par duplicate protection unhe skip karega. Error: ${e?.message || "Unknown error"}`);
      await loadData();
    }
    setBusy(false);
  }

  const filtered = useMemo(() => txs.filter(t => (!selected || t.company_id === selected)
    && (!dateFrom || t.transaction_date >= dateFrom) && (!dateTo || t.transaction_date <= dateTo)
    && [t.party_name, t.description, t.remarks, t.location, t.source_company, t.cheque_no, t.tax_id, t.month_label].join(" ").toLowerCase().includes(query.toLowerCase())), [txs, selected, query, dateFrom, dateTo]);
  const totals = useMemo(() => ({ paid: txs.filter(t => t.transaction_type === "paid").reduce((s,t)=>s+Number(t.amount),0), received: txs.filter(t => t.transaction_type === "received").reduce((s,t)=>s+Number(t.amount),0) }), [txs]);
  const parties = useMemo(() => {
    const map = new Map<string, { party: string; paid: number; received: number; advances: number; count: number }>();
    filtered.forEach(t => { const name = (t.party_name || "(Party name missing)").trim(); const x = map.get(name) || { party: name, paid: 0, received: 0, advances: 0, count: 0 }; const a = Number(t.amount || 0); if (t.transaction_type === "paid") x.paid += a; if (t.transaction_type === "received") x.received += a; if (/advance/i.test(t.remarks || "")) x.advances += a; x.count++; map.set(name, x); });
    return [...map.values()].sort((a,b) => (b.paid+b.received)-(a.paid+a.received));
  }, [filtered]);
  const monthly = useMemo(() => {
    const map = new Map<string, { month: string; paid: number; received: number; count: number }>();
    txs.forEach(t => { const month = (t.month_label && /^\d{4}-\d{2}/.test(t.month_label) ? t.month_label.slice(0,7) : t.transaction_date.slice(0,7)); const x = map.get(month) || { month, paid: 0, received: 0, count: 0 }; if (t.transaction_type === "paid") x.paid += Number(t.amount); if (t.transaction_type === "received") x.received += Number(t.amount); x.count++; map.set(month,x); });
    return [...map.values()].sort((a,b)=>b.month.localeCompare(a.month));
  }, [txs]);
  const nav: { id: Tab; label: string; icon: any }[] = [
    { id: "overview", label: "Overview", icon: LayoutDashboard }, { id: "companies", label: "Companies", icon: Building2 },
    { id: "transactions", label: "Transactions", icon: ArrowLeftRight }, { id: "ledger", label: "Party ledger", icon: Users },
    { id: "imports", label: "Excel imports", icon: FileSpreadsheet }, { id: "reports", label: "Monthly reports", icon: CalendarDays },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  if (!session) return <div className="login"><form className="loginbox" onSubmit={login}><div className="brand" style={{padding:0,color:"#182230"}}><div className="brandmark">M</div><span>PRIVATE MIS</span></div><p className="eyebrow" style={{marginTop:28}}>SECURE WORKSPACE</p><h1>Welcome back</h1><p className="sub">Sign in to your company dashboard</p><label className="sub">Email address</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@company.com"/><label className="sub">Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Your password"/>{error&&<p className="error">{error}</p>}<button className="btn" disabled={busy} style={{width:"100%",padding:13}}>{busy?"Signing in…":"Sign in securely"}</button><p className="muted" style={{fontSize:11,marginTop:20}}>Access is limited to invited team members.</p></form></div>;

  return <div className="shell"><aside className="sidebar"><div className="brand"><div className="brandmark">M</div><span className="brandname">PRIVATE MIS</span></div><div className="navlabel">WORKSPACE</div>{nav.slice(0,6).map(n=>{const Icon=n.icon;return <button key={n.id} className={`navitem ${tab===n.id?"active":""}`} onClick={()=>{setTab(n.id);setSelected("");setError("");}}><Icon size={17}/><span>{n.label}</span></button>})}<div className="navlabel" style={{marginTop:18}}>SYSTEM</div><button className={`navitem ${tab==="settings"?"active":""}`} onClick={()=>setTab("settings")}><Settings size={17}/><span>Settings</span></button><div className="sidefoot">PRIVATE COMPANY DATA<br/>Protected by Supabase RLS<br/><span style={{color:"#7186ff"}}>● Workspace connected</span></div></aside>
    <main className="main"><header className="top"><div><div className="eyebrow">PRIVATE MIS / {tab.toUpperCase()}</div><h1 className="h1">{nav.find(n=>n.id===tab)?.label || "Dashboard"}</h1><div className="sub">Your company financial workspace</div></div><div style={{display:"flex",alignItems:"center",gap:12}}><span className="pill">{role.toUpperCase()}</span><div className="avatar">{session.user.email?.[0]?.toUpperCase()}</div><button className="btn secondary" onClick={()=>supabase.auth.signOut()} title="Sign out"><LogOut size={15}/></button></div></header>
    {error&&<div className="error banner">{error}</div>}{notice&&<div className="notice banner"><CheckCircle2 size={16}/>{notice}<button onClick={()=>setNotice("")}><X size={14}/></button></div>}
    <div className="toolbar"><div className="searchbox"><Search size={15}/><input placeholder="Search party, description, location…" value={query} onChange={e=>setQuery(e.target.value)}/></div><button className="btn secondary" onClick={()=>void loadData()} disabled={loading}><RefreshCw size={15}/> Refresh</button><button className="btn" onClick={()=>setShowAdd(true)}><Plus size={15}/> Add transaction</button></div>
    {loading&&<p className="muted"><Loader2 className="spin" size={15}/> Loading database records…</p>}

    {tab==="overview"&&<><section className="stats"><div className="stat"><div className="stathead">Transactions loaded <ArrowLeftRight size={17}/></div><div className="statnum">{txs.length.toLocaleString("en-IN")}</div><div className="statnote">All records accessible to this workspace</div></div><div className="stat"><div className="stathead">Total paid <ArrowUpRight size={17}/></div><div className="statnum">{money(totals.paid)}</div><div className="statnote">Dr. / paid entries</div></div><div className="stat"><div className="stathead">Total received <ArrowDownLeft size={17}/></div><div className="statnum">{money(totals.received)}</div><div className="statnote">Cr. / received entries</div></div><div className="stat"><div className="stathead">Net movement <Wallet size={17}/></div><div className="statnum">{money(totals.received-totals.paid)}</div><div className="statnote">Received minus paid</div></div></section><div className="sectionhead"><div><h2>Company portfolio</h2><div className="sub">Select a company to view its transactions</div></div><button className="btn secondary" onClick={()=>setTab("imports")}><Upload size={15}/> Import Excel</button></div><section className="companies">{companies.map(c=><button className="company" key={c.id} onClick={()=>{setSelected(c.id);setTab("transactions");}}><div className="companytop"><div className="companylogo">{c.code.slice(0,2)}</div><ChevronRight size={16}/></div><h3>{c.name}</h3><p>Company account</p><div className="companyfoot"><span>{txs.filter(t=>t.company_id===c.id).length} transactions</span><span>Open →</span></div></button>)}</section><TransactionTable rows={filtered.slice(0,12)} companies={companies}/></>}

    {tab==="companies"&&<><div className="sectionhead"><div><h2>Company accounts</h2><div className="sub">Each company is kept separate; TP remains independent.</div></div></div><section className="companies">{companies.map(c=><button className="company" key={c.id} onClick={()=>{setSelected(c.id);setTab("transactions");}}><div className="companytop"><div className="companylogo">{c.code.slice(0,2)}</div><ChevronRight size={16}/></div><h3>{c.name}</h3><p>{money(txs.filter(t=>t.company_id===c.id).reduce((s,t)=>s+Number(t.amount),0))} recorded gross value</p><div className="companyfoot"><span>{txs.filter(t=>t.company_id===c.id).length} transactions</span><span>View details →</span></div></button>)}</section></>}

    {tab==="transactions"&&<><FilterBar selected={selected} setSelected={setSelected} companies={companies} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}/><TransactionTable rows={filtered} companies={companies}/></>}

    {tab==="ledger"&&<><FilterBar selected={selected} setSelected={setSelected} companies={companies} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo}/><section className="panel"><div className="panelhead"><div><h2>Party-wise ledger</h2><div className="sub">Net balance = received − paid. Advance is identified from remarks and is informational, not added twice.</div></div><span className="pill">{parties.length} parties</span></div><div className="tablewrap"><table><thead><tr><th>Party / Name</th><th>Entries</th><th>Total paid</th><th>Total received</th><th>Advance mentioned</th><th>Net balance</th></tr></thead><tbody>{parties.map(p=><tr key={p.party}><td><b>{p.party}</b></td><td>{p.count}</td><td>{money(p.paid)}</td><td>{money(p.received)}</td><td>{money(p.advances)}</td><td><b>{money(p.received-p.paid)}</b></td></tr>)}</tbody></table>{!parties.length&&<div className="empty">No party records found.</div>}</div></section></>}

    {tab==="imports"&&<><section className="panel importpanel"><div className="panelhead"><div><h2>Upload monthly Excel MIS</h2><div className="sub">Upload .xlsx. File is read in your browser and rows are saved to Supabase after preview and mapping.</div></div><FileSpreadsheet size={26}/></div><label className="uploadzone"><Upload size={28}/><b>Choose Excel workbook</b><span>Expected columns: Txn Posted Date, Value Date, Description, Cheque No., CrDr, Txn Amount(INR), Remarks2, CompanyHEAD, Name, EBQPK4275L, Month, Location</span><input type="file" accept=".xlsx" onChange={e=>{const f=e.target.files?.[0];if(f)void parseWorkbook(f);e.currentTarget.value="";}}/></label>{fileName&&<p className="muted">Selected file: <b>{fileName}</b> · Sheet: {sheetName || "—"}</p>}{importRows.length>0&&<><div className="previewhead"><div><h3>Import preview</h3><p className="sub">{importRows.length} valid rows · {parseErrors.length} invalid rows will be skipped</p></div><button className="btn" onClick={()=>void importExcel()} disabled={busy||sourceNames.some(n=>!mapping[n])}>{busy?<Loader2 className="spin" size={15}/>:<Database size={15}/>} Save to database</button></div><div className="mappinggrid">{sourceNames.map(n=><label key={n}>Excel CompanyHEAD: <b>{n}</b><select value={mapping[n]||""} onChange={e=>setMapping(v=>({...v,[n]:e.target.value}))}><option value="">Select matching MIS company</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}</select></label>)}</div><div className="tablewrap"><table><thead><tr><th>Excel row</th><th>Date</th><th>Source company</th><th>Party</th><th>Dr/Cr</th><th>Amount</th><th>Remarks</th></tr></thead><tbody>{importRows.slice(0,20).map(r=><tr key={r.sourceRow}><td>{r.sourceRow}</td><td>{dateLabel(r.transaction_date)}</td><td>{r.source_company}</td><td>{r.party_name||"—"}</td><td>{r.crdr}</td><td>{money(r.amount)}</td><td>{r.remarks||"—"}</td></tr>)}</tbody></table>{importRows.length>20&&<div className="empty">Showing first 20 of {importRows.length} valid rows in preview.</div>}</div></>}{parseErrors.length>0&&<details className="parseissues"><summary>{parseErrors.length} rows skipped — view reasons</summary>{parseErrors.slice(0,100).map(x=><p key={x}>{x}</p>)}</details>}</section><section className="panel"><div className="panelhead"><div><h2>Import history</h2><div className="sub">Recent Excel upload records</div></div></div><div className="tablewrap"><table><thead><tr><th>Date</th><th>File</th><th>Sheet</th><th>Rows</th><th>Inserted</th><th>Duplicates</th><th>Status</th></tr></thead><tbody>{batches.map(b=><tr key={b.id}><td>{new Date(b.created_at).toLocaleString("en-IN")}</td><td>{b.file_name}</td><td>{b.sheet_name}</td><td>{b.row_count}</td><td>{b.inserted_count}</td><td>{b.duplicate_count}</td><td>{b.status}</td></tr>)}</tbody></table>{!batches.length&&<div className="empty">Abhi koi Excel import nahi hua.</div>}</div></section></>}

    {tab==="reports"&&<><section className="panel"><div className="panelhead"><div><h2>Monthly summary</h2><div className="sub">Monthly totals from transaction date / Excel Month column.</div></div></div><div className="tablewrap"><table><thead><tr><th>Month</th><th>Transactions</th><th>Paid</th><th>Received</th><th>Net movement</th></tr></thead><tbody>{monthly.map(m=><tr key={m.month}><td><b>{m.month}</b></td><td>{m.count}</td><td>{money(m.paid)}</td><td>{money(m.received)}</td><td><b>{money(m.received-m.paid)}</b></td></tr>)}</tbody></table>{!monthly.length&&<div className="empty">No report data available.</div>}</div></section></>}

    {tab==="settings"&&<><section className="panel"><div className="panelhead"><div><h2>Workspace & access</h2><div className="sub">Private MIS access configuration</div></div><ShieldCheck size={24}/></div><div className="settingsgrid"><div><span className="muted">Signed-in user</span><b>{session.user.email}</b></div><div><span className="muted">Your role</span><b>{role.toUpperCase()}</b></div><div><span className="muted">Workspace ID</span><code>{workspace}</code></div><div><span className="muted">Database</span><b>Supabase with Row Level Security</b></div></div><div className="notice"><ShieldCheck size={16}/> Staff can view and add transactions. Existing transactions can only be updated/deleted by admins, enforced by database RLS.</div><h3 style={{marginTop:24}}>Add a staff member</h3><p className="sub">Create/invite the staff user first in Supabase → Authentication → Users. Then run the staff membership SQL in the included README using that user's email. Never enable public sign-ups for this private MIS.</p><p className="sub">For security, this browser app uses only the Supabase publishable key. Never put service_role or secret keys in .env.local.</p></section></>}
    <p className="muted footerhint">Private MIS · Excel data is imported only after preview and company mapping. Financial net shown here is received minus paid.</p>
    </main>
    {showAdd&&<div className="modalback" onClick={()=>setShowAdd(false)}><form className="modal" onClick={e=>e.stopPropagation()} onSubmit={addTx}><div className="panelhead"><div><h2>New transaction</h2><p className="sub">Save a new entry directly to the database.</p></div><button type="button" className="btn secondary" onClick={()=>setShowAdd(false)}><X size={15}/></button></div><div className="formgrid"><label>Date<input type="date" value={form.transaction_date} onChange={e=>setForm({...form,transaction_date:e.target.value})} required/></label><label>Company<select value={form.company_id} onChange={e=>setForm({...form,company_id:e.target.value})} required>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Party / Name<input value={form.party_name} onChange={e=>setForm({...form,party_name:e.target.value})} placeholder="Party name"/></label><label>Amount (INR)<input type="number" min="0.01" step="0.01" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} required placeholder="0.00"/></label><label>Transaction type<select value={form.transaction_type} onChange={e=>setForm({...form,transaction_type:e.target.value})}><option value="paid">Paid</option><option value="received">Received</option></select></label><label>Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Purpose / details"/></label><label className="wide">Remarks (advance details yahan likhein)<textarea value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})} rows={2} placeholder="Additional notes"/></label></div>{error&&<p className="error">{error}</p>}<div className="actions"><button type="button" className="btn secondary" onClick={()=>setShowAdd(false)}>Cancel</button><button className="btn" disabled={busy}>{busy?"Saving…":"Save transaction"}</button></div></form></div>}
  </div>;
}

function FilterBar({ selected, setSelected, companies, dateFrom, setDateFrom, dateTo, setDateTo }: any) {
  return <div className="filters"><select className="field" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">All companies</option>{companies.map((c:Company)=><option key={c.id} value={c.id}>{c.name}</option>)}</select><label>From <input className="field" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label><label>To <input className="field" type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label></div>;
}
function TransactionTable({ rows, companies }: { rows: Tx[]; companies: Company[] }) {
  return <section className="panel"><div className="panelhead"><div><h2>Transactions</h2><div className="sub">{rows.length} records in current view</div></div></div><div className="tablewrap"><table><thead><tr><th>Posted date</th><th>Value date</th><th>Company</th><th>Party / Name</th><th>Description</th><th>Type</th><th>Amount</th><th>Remarks</th><th>Month</th><th>Location</th><th>Cheque no.</th><th>Tax ID</th></tr></thead><tbody>{rows.map(t=><tr key={t.id}><td>{dateLabel(t.transaction_date)}</td><td>{dateLabel(t.value_date || "")}</td><td>{companies.find(c=>c.id===t.company_id)?.name||"—"}</td><td><b>{t.party_name||"—"}</b></td><td>{t.description||"—"}</td><td><span className="pill">{t.transaction_type}</span></td><td><b>{money(Number(t.amount))}</b></td><td>{t.remarks||"—"}</td><td>{t.month_label||"—"}</td><td>{t.location||"—"}</td><td>{t.cheque_no||"—"}</td><td>{t.tax_id||"—"}</td></tr>)}</tbody></table>{!rows.length&&<div className="empty">No transactions found. Excel import karein ya Add transaction use karein.</div>}</div></section>;
}
