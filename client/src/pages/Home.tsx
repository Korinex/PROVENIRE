import { createContext, useContext, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Eye,
  FlaskConical,
  KeyRound,
  Lock,
  Network,
  RefreshCcw,
  RotateCcw,
  ScanLine,
  Server,
  ShieldAlert,
  ShieldCheck,
  Truck,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

type Panel = "overview" | "handoffs" | "conflicts" | "network" | "public";

type State = inferRouterOutputs<AppRouter>["provenire"]["state"];
const ChainIntegrityContext = createContext(true);

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function StatusPill({ tone, children }: { tone: "good" | "warning" | "danger" | "neutral"; children: React.ReactNode }) {
  const styles = {
    good: "border-cyan-400/25 bg-cyan-400/10 text-cyan-300",
    warning: "border-amber-400/25 bg-amber-400/10 text-amber-200",
    danger: "border-rose-400/25 bg-rose-400/10 text-rose-200",
    neutral: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  };
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em]", styles[tone])}>{children}</span>;
}

function MetricCard({ label, value, detail, icon: Icon, tone = "cyan" }: { label: string; value: string; detail: string; icon: React.ElementType; tone?: "cyan" | "amber" | "rose" | "violet" }) {
  const colors = { cyan: "text-cyan-300 bg-cyan-400/10", amber: "text-amber-200 bg-amber-400/10", rose: "text-rose-200 bg-rose-400/10", violet: "text-violet-200 bg-violet-400/10" };
  return <div className="panel-card metric-card">
    <div className={cn("metric-icon", colors[tone])}><Icon size={18} /></div>
    <div className="min-w-0"><div className="eyebrow">{label}</div><div className="mt-1 truncate text-2xl font-semibold tracking-tight text-white">{value}</div><div className="mt-1 truncate text-xs text-slate-400">{detail}</div></div>
  </div>;
}

function ProofBadge({ valid, label }: { valid: boolean; label: string }) {
  const chainIntegrityValid = useContext(ChainIntegrityContext);
  const badgeValid = valid && chainIntegrityValid;
  const failureLabel = label.replace(/\bintact\b/i, "proof failed").replace(/\bvalid\b/i, "check failed").replace(/\blinked\b/i, "check failed");
  return <span className={cn("proof-badge", badgeValid ? "proof-badge-valid" : "proof-badge-invalid")}><span className="proof-badge-dot" />{chainIntegrityValid ? label : failureLabel}</span>;
}

function Timeline({ state }: { state: State }) {
  const integrityValid = state.batch.recordIntegrityState === "valid";
  return <div className="space-y-3">
    {state.events.slice().reverse().map((event, index) => <div className={cn("timeline-row", !integrityValid && "timeline-row-integrity-failed")} key={event.id}>
      <div className={cn("timeline-dot", !integrityValid ? "timeline-dot-failed" : event.type === "receipt" ? "bg-cyan-300" : event.type === "dispatch" ? "bg-amber-200" : "bg-cyan-300")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-white">{event.label}</p><span className="text-[11px] text-slate-500">{formatTime(event.occurredAt)}</span></div>
        <p className="mt-1 text-xs text-slate-400">{event.actorName} · <span className="font-mono text-slate-500">{event.proof.recordHash.slice(0, 12)}…</span></p>
      </div>
      {index === 0 && <StatusPill tone={integrityValid ? "good" : "danger"}>{integrityValid ? "verified" : "integrity failed"}</StatusPill>}
    </div>)}
  </div>;
}

function HandoffCard({ dispatch, receipt, onReceipt, busy, integrityValid }: { dispatch: State["dispatches"][number]; receipt?: State["receipts"][number]; onReceipt: (quantity: number) => void; busy: boolean; integrityValid: boolean }) {
  const [quantity, setQuantity] = useState(String(dispatch.dispatchedQuantity));
  const pending = dispatch.status === "receiver_pending";
  const mismatch = dispatch.status === "needs_review";
  const signatureValid = integrityValid && dispatch.proof.signatureValid;
  const hashValid = integrityValid && dispatch.proof.recordHash.length > 0;
  return <div className={cn("handoff-card", mismatch && "handoff-danger", !integrityValid && "handoff-integrity-failed")}>
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3"><div className={cn("icon-box", pending ? "icon-amber" : mismatch ? "icon-rose" : "icon-cyan")}><Truck size={18} /></div><div className="min-w-0"><div className="eyebrow">Handoff {dispatch.id.split("-")[1]}</div><h3 className="handoff-route-title mt-1">{dispatch.senderName}<ArrowRight className="mx-2 inline text-slate-500" size={15} />{dispatch.receiverName}</h3><p className="handoff-meta mt-1">Dispatch signed at {formatTime(dispatch.occurredAt)} · {dispatch.location}</p></div></div>
      <StatusPill tone={pending ? "warning" : mismatch ? "danger" : "good"}>{dispatch.status.replace("_", " ")}</StatusPill>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <div className="data-cell"><span>Sender claim</span><strong>{dispatch.dispatchedQuantity.toLocaleString()} {dispatch.unit}</strong></div>
      <div className="data-cell"><span>Receiver observation</span><strong>{receipt ? `${receipt.receiverObservedQuantity.toLocaleString()} ${receipt.unit}` : "Awaiting receipt"}</strong></div>
      <div className="data-cell"><span>Proof</span><div className="mt-1 flex flex-wrap gap-3"><ProofBadge valid={signatureValid} label={signatureValid ? "Signature valid" : "Signature check failed"} /><ProofBadge valid={hashValid} label={hashValid ? "Hash linked" : "Hash check failed"} /></div></div>
    </div>
    {pending && <section className="receiver-action" aria-labelledby={`receipt-action-${dispatch.id}`}>
      <div className="receiver-action-heading"><ScanLine size={18} /><h4 id={`receipt-action-${dispatch.id}`}>Receiver action required</h4></div>
      <p className="receiver-action-copy">Review the custody history, then enter the quantity you observed. Provenire compares it with the sender claim and records the result.</p>
      <div className="receiver-action-controls">
        <label className="quantity-field"><span>Observed quantity <span className="unit-hint">({dispatch.unit})</span></span><input aria-label="Observed quantity" className="quantity-input" min="1" max="1000000" step="1" type="number" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <button className="primary-button" disabled={busy || quantity === ""} onClick={() => onReceipt(Number(quantity))}>{busy ? "Signing…" : "Sign observed quantity"}<ChevronRight size={15} /></button>
      </div>
    </section>}
    {receipt && <div className={cn("mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3", mismatch ? "border-rose-300/15 bg-rose-300/[0.05]" : "border-cyan-300/15 bg-cyan-300/[0.05]")}><div className="flex items-center gap-2 text-sm text-white"><UserCheck size={16} className={mismatch ? "text-rose-200" : "text-cyan-200"} /> {receipt.receiverName} signed {receipt.receiverObservedQuantity.toLocaleString()} {receipt.unit}<span className="text-xs text-slate-500">· server-recorded {formatTime(receipt.observedAt)}</span></div>{mismatch ? <span className="text-xs font-semibold text-rose-200">Variance {receipt.variance} · onward custody blocked</span> : <span className="text-xs font-semibold text-cyan-200">Custody accepted</span>}</div>}
  </div>;
}

function AppHeader({ active, setActive, onReset, onRunHappy, onRunMismatch, busy }: { active: Panel; setActive: (panel: Panel) => void; onReset: () => void; onRunHappy: () => void; onRunMismatch: () => void; busy: boolean }) {
  const nav: { id: Panel; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: Boxes },
    { id: "handoffs", label: "Handoff lineage", icon: Truck },
    { id: "conflicts", label: "Conflict review", icon: ShieldAlert },
    { id: "network", label: "Network verify", icon: Network },
    { id: "public", label: "Public verifier", icon: Eye },
  ];
  return <header className="app-header">
    <button className="rail-brand" onClick={() => setActive("overview")} aria-label="Open Provenire overview"><span className="rail-logo"><FlaskConical size={18} /></span><span className="rail-brand-copy"><strong>PROVENIRE</strong><small>VERIFIED CUSTODY</small></span></button>
    <nav className="desktop-nav" aria-label="Primary navigation">{nav.map(item => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><item.icon size={15} /><span>{item.label}</span></button>)}</nav>
    <div className="topbar-context"><span className="live"><i />LIVE PROTOTYPE</span><span className="topbar-separator" /><span className="mono">MS-2026-001 · SHA-256</span></div>
    <div className="header-actions"><button className="ghost-button" onClick={onReset}><RotateCcw size={14} />Reset demo</button><div className="relative group"><button className="primary-button compact" disabled={busy}><PlayIcon /><span>Run demo</span></button><div className="demo-menu"><button onClick={onRunHappy}><CheckCircle2 size={14} />Run clean route</button><button onClick={onRunMismatch}><AlertTriangle size={14} />Run 1,000 → 950 mismatch</button></div></div></div>
  </header>;
}
function PlayIcon() { return <span className="play-icon"><span /></span>; }

export default function Home() {
  const [active, setActive] = useState<Panel>("overview");
  const { data: state, isLoading, error } = trpc.provenire.state.useQuery();
  const utils = trpc.useUtils();
  const [actionMessage, setActionMessage] = useState("");
  const reset = trpc.provenire.reset.useMutation({ onSuccess: data => { utils.provenire.state.setData(undefined, data); setActionMessage("Demo reset to the origin state."); } });
  const happy = trpc.provenire.runHappyPath.useMutation({ onSuccess: data => { utils.provenire.state.setData(undefined, data); setActionMessage("Clean route complete: both receiver-confirmed handoffs passed."); } });
  const mismatch = trpc.provenire.runMismatch.useMutation({ onSuccess: data => { utils.provenire.state.setData(undefined, data); setActive("conflicts"); setActionMessage("Mismatch path ready: 50 units remain disputed and onward dispatch is blocked."); } });
  const dispatch = trpc.provenire.dispatch.useMutation({ onSuccess: data => { utils.provenire.state.setData(undefined, data); setActive("handoffs"); setActionMessage("Dispatch signed. Custody remains receiver-pending until the receiver submits a receipt."); } });
  const receipt = trpc.provenire.receipt.useMutation({ onSuccess: data => { utils.provenire.state.setData(undefined, data); setActionMessage("Receipt signed. The backend derived the handoff result."); } });
  const tamper = trpc.provenire.tamper.useMutation({ onSuccess: data => { utils.provenire.state.setData(undefined, data); setActionMessage("Tamper simulation active: proof checks are now red."); } });
  const restore = trpc.provenire.restore.useMutation({ onSuccess: data => { utils.provenire.state.setData(undefined, data); setActionMessage("Proof restored. Verifier availability is unchanged."); } });
  const togglePeer = trpc.provenire.togglePeer.useMutation({ onSuccess: data => { utils.provenire.state.setData(undefined, data); setActionMessage("Network verification state updated."); } });
  const busy = reset.isPending || happy.isPending || mismatch.isPending || dispatch.isPending || receipt.isPending || tamper.isPending || restore.isPending || togglePeer.isPending;

  const activeDispatch = useMemo(() => state?.dispatches.find(item => item.id === state.batch.activeDispatchId), [state]);
  if (isLoading || !state) return <div className="loading-screen"><div className="brand-mark"><FlaskConical size={18} /></div><p>Loading proof workspace…</p></div>;
  if (error) return <div className="loading-screen"><ShieldAlert className="text-rose-300" /><p>Unable to load the proof workspace.</p></div>;

  const runAction = (mutation: { mutate: () => void }) => mutation.mutate();
  const receiverForNext = state.batch.acceptedHandoffs === 0 ? "central-pharma" : "ramdeobaba-pharmacy";
  const needsReview = state.batch.handoffState === "needs_review";
  const integrityValid = state.batch.recordIntegrityState === "valid";
  const custodyAnchor = needsReview ? state.batch.lastUncontestedCustodian : state.batch.currentHolder;
  const custodyDetail = needsReview
    ? `${state.batch.observedReceiver ?? "Receiver"} observed ${state.batch.receiverObservedQuantity?.toLocaleString() ?? "—"} ${state.batch.unit}; 0 accepted onward`
    : state.batch.activeDispatchId
      ? `Current holder · ${state.batch.currentHolder}`
      : "Current holder · backend-derived";

  const tampered = state.batch.recordIntegrityState === "tampered";
  return <ChainIntegrityContext.Provider value={integrityValid}><div className={cn("min-h-screen provenire-app", tampered && "is-tampered")}><AppHeader active={active} setActive={setActive} onReset={() => runAction(reset)} onRunHappy={() => runAction(happy)} onRunMismatch={() => runAction(mismatch)} busy={busy} />
    <div className="mobile-nav lg:hidden">{(["overview", "handoffs", "conflicts", "network", "public"] as Panel[]).map(panel => <button key={panel} className={cn(active === panel && "mobile-nav-active")} onClick={() => setActive(panel)}>{panel.replace("public", "public verifier")}</button>)}</div>
    {tampered && <div className="tamper-banner" role="alert"><ShieldAlert size={18} /><div><strong>Record integrity compromised</strong><span>A signed field has changed. Hash and signature verification are invalid.</span></div><span className="tamper-banner-tag">TAMPERED</span></div>}
    <main className={cn("app-shell", active !== "overview" && "interior-page")}>
      <section className="hero-row"><div><div className="eyebrow text-cyan-300">Live demo workspace <span className="live-dot" /></div><h1>Make every handoff<br /><span>inspectable.</span></h1><p className="hero-copy">A sender-signed dispatch is not the same as a receiver-signed receipt. Provenire keeps both visible, so a mismatch cannot silently become accepted custody.</p></div><div className="hero-proof"><div className="flex items-center gap-3"><div className="proof-seal"><ShieldCheck size={22} /></div><div><div className="eyebrow">Prototype assurance</div><div className="mt-1 text-sm font-semibold text-white">Signed record history</div></div></div><div className="mt-5 grid grid-cols-2 gap-3"><div><div className="text-2xl font-semibold text-white">{state.batch.acceptedHandoffs}/2</div><div className="text-[11px] uppercase tracking-wider text-slate-500">handoffs accepted</div></div><div><div className="text-2xl font-semibold text-cyan-300">{state.batch.networkState === "agreement" ? "3/3" : "2/3"}</div><div className="text-[11px] uppercase tracking-wider text-slate-500">nodes verifying</div></div></div></div></section>
      {actionMessage && <div className="action-toast"><CheckCircle2 size={15} className="text-cyan-300" />{actionMessage}<button onClick={() => setActionMessage("")}>×</button></div>}
      <section className="metrics-grid"><MetricCard label="Custody anchor" value={custodyAnchor} detail={custodyDetail} icon={UserCheck} tone="cyan" /><MetricCard label="Handoff state" value={state.batch.handoffState.replace("_", " ")} detail={state.batch.activeDispatchId ? "Receiver action required" : "Server-derived status"} icon={state.batch.handoffState === "needs_review" ? AlertTriangle : BadgeCheck} tone={state.batch.handoffState === "needs_review" ? "rose" : state.batch.handoffState === "receiver_pending" ? "amber" : "violet"} /><MetricCard label="Quantity state" value={state.batch.quantityVariance ? `${state.batch.quantityVariance} variance` : "Consistent"} detail={state.batch.receiverObservedQuantity ? `${state.batch.receiverObservedQuantity.toLocaleString()} receiver-observed · ${state.batch.acceptedForOnwardCustody.toLocaleString()} accepted onward` : "No receiver observation yet"} icon={ScanLine} tone={state.batch.quantityVariance ? "rose" : "amber"} /><MetricCard label="Record integrity" value={state.batch.recordIntegrityState === "valid" ? "Valid" : "Tampered"} detail={state.batch.networkState === "agreement" ? "3 verifier nodes agree" : "Verification incomplete"} icon={state.batch.recordIntegrityState === "valid" ? ShieldCheck : ShieldAlert} tone={state.batch.recordIntegrityState === "valid" ? "cyan" : "rose"} /></section>
      {active === "overview" && <section className="demo-explainer"><div className="demo-explainer-head"><div><div className="eyebrow text-cyan-300">How to read this demo</div><h2>Sender claim → receiver observation → server-derived result</h2><p>One click shows the whole custody decision: a clean receipt becomes accepted; a mismatch stays visible for review.</p></div><div className="demo-tip"><span className="eyebrow">Best judge path</span><strong>Run mismatch</strong><span>1,000 dispatched → 950 receiver-observed → 50 quantity variance</span></div></div><div className="demo-steps"><div className="demo-step"><span className="demo-step-number">01</span><div><strong>Sender signs dispatch</strong><span>What was sent is recorded as its own claim.</span></div></div><div className="demo-step"><span className="demo-step-number">02</span><div><strong>Receiver signs observation</strong><span>They attest to the quantity they actually saw.</span></div></div><div className="demo-step"><span className="demo-step-number">03</span><div><strong>Backend derives the state</strong><span>Accepted if equal; needs review if different.</span></div></div></div></section>}
      <section className="content-grid"><div className="main-column">
        {active === "overview" && <>
          <div className="section-heading"><div><div className="eyebrow">Batch workspace</div><h2>{state.batch.productName}</h2><p>Batch <span className="font-mono text-slate-300">{state.batch.batchNumber}</span> · {state.batch.initialQuantity.toLocaleString()} {state.batch.unit}</p></div><StatusPill tone={state.batch.conflictState === "open" ? "danger" : state.batch.handoffState === "receiver_pending" ? "warning" : "good"}>{state.publicVerifier.verificationStatus.replaceAll("_", " ")}</StatusPill></div>
          <div className="panel-card batch-summary"><div className="batch-summary-top"><div className="batch-icon"><FlaskConical size={24} /></div><div className="flex-1"><div className="eyebrow">MedSure Labs · Pharmaceutical batch</div><div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-300"><span>Manufactured {state.batch.manufactureDate}</span><span className="text-slate-600">•</span><span>Expires {state.batch.expiryDate}</span></div></div><div className="text-right"><div className="text-2xl font-semibold text-white">{state.batch.initialQuantity.toLocaleString()}</div><div className="eyebrow">initial units</div></div></div><div className="route-line"><div className="route-node"><div className="route-avatar manufacturer">ML</div><div><div className="route-name">MedSure Labs</div><div className="route-role">Manufacturer</div></div></div><div className={cn("route-connector", state.batch.acceptedHandoffs === 0 && state.batch.activeDispatchId && "route-connector-active", state.batch.acceptedHandoffs > 0 && "route-connector-complete")}><span /><span /><span /></div><div className={cn("route-node", state.batch.acceptedHandoffs >= 1 && "route-complete")}><div className="route-avatar distributor">CP</div><div><div className="route-name">Central Pharma</div><div className="route-role">Distributor</div></div></div><div className={cn("route-connector", state.batch.acceptedHandoffs === 1 && state.batch.activeDispatchId && "route-connector-active", state.batch.acceptedHandoffs >= 2 && "route-connector-complete")}><span /><span /><span /></div><div className={cn("route-node", state.batch.acceptedHandoffs >= 2 && "route-complete")}><div className="route-avatar hospital">RH</div><div><div className="route-name">Ramdeobaba</div><div className="route-role">Hospital pharmacy</div></div></div></div><div className="route-coverage-note">Coverage complete means all two expected handoffs on this demo route have signed receipts; it is different from a single handoff having a record.</div></div>
          <div className="section-heading mt-8"><div><div className="eyebrow">Next action</div><h2>{state.batch.handoffState === "needs_review" ? "Resolve the quantity conflict" : state.batch.activeDispatchId ? "Receiver receipt required" : state.batch.acceptedHandoffs >= 2 ? "Route complete" : "Continue the route"}</h2></div>{state.batch.handoffState === "needs_review" ? <button className="danger-button" onClick={() => setActive("conflicts")}><ShieldAlert size={15} />Review conflict</button> : state.batch.activeDispatchId ? <button className="primary-button" onClick={() => setActive("handoffs")}><ScanLine size={15} />Open receipt</button> : state.batch.onwardDispatchAllowed ? <button className="primary-button" disabled={busy} onClick={() => dispatch.mutate({ receiverId: receiverForNext })}><Truck size={15} />Dispatch next</button> : <StatusPill tone="good"><Check size={14} />Complete</StatusPill>}</div>
          {activeDispatch && <HandoffCard dispatch={activeDispatch} onReceipt={quantity => receipt.mutate({ dispatchId: activeDispatch.id, receiverId: activeDispatch.receiverId, receiverObservedQuantity: quantity })} busy={receipt.isPending} integrityValid={integrityValid} />}
          <div className="section-heading mt-8"><div><div className="eyebrow">Proof timeline</div><h2>Chain of custody</h2></div><button className="ghost-button" onClick={() => setActive("handoffs")}>View handoffs <ArrowRight size={14} /></button></div><div className="panel-card p-5"><Timeline state={state} /></div>
        </>}
        {active === "handoffs" && <><div className="section-heading"><div><div className="eyebrow">Bilateral protocol</div><h2>Handoffs</h2><p>One dispatch claim. One receiver observation. One server-derived result.</p></div><StatusPill tone={state.batch.activeDispatchId ? "warning" : "neutral"}>{state.dispatches.length} dispatches</StatusPill></div>{state.dispatches.length === 0 ? <div className="panel-card empty-state"><Truck size={28} /><h3>No dispatch yet</h3><p>Start with the clean route or dispatch the batch to Central Pharma.</p><button className="primary-button" onClick={() => dispatch.mutate({ receiverId: "central-pharma" })}><Truck size={15} />Sign first dispatch</button></div> : <div className="space-y-4">{state.dispatches.map(item => <HandoffCard key={item.id} dispatch={item} receipt={state.receipts.find(receiptItem => receiptItem.dispatchId === item.id)} onReceipt={quantity => receipt.mutate({ dispatchId: item.id, receiverId: item.receiverId, receiverObservedQuantity: quantity })} busy={receipt.isPending} integrityValid={integrityValid} />)}</div>}<div className="info-callout mt-5"><Lock size={15} /><p>The browser never decides custody. It submits the receiver observation; the backend compares quantities and updates the state.</p></div></>}
        {active === "conflicts" && <><div className="section-heading"><div><div className="eyebrow">Exception handling</div><h2>Conflict review</h2><p>Disagreement stays visible instead of becoming a silent overwrite.</p></div><StatusPill tone={state.conflicts.length ? "danger" : "good"}>{state.conflicts.length ? `${state.conflicts.length} open` : "No open conflicts"}</StatusPill></div>{state.conflicts.length === 0 ? <div className="panel-card empty-state"><ShieldCheck size={28} className="text-cyan-300" /><h3>All claims agree</h3><p>The mismatch scenario shows how Provenire preserves both sides when they do not.</p><button className="danger-button" onClick={() => runAction(mismatch)}><AlertTriangle size={15} />Run mismatch scenario</button></div> : <div className="space-y-4">{state.conflicts.map(conflict => { const d = state.dispatches.find(item => item.id === conflict.dispatchId); const r = state.receipts.find(item => item.id === conflict.receiptId); return <div className="panel-card conflict-card" key={conflict.id}><div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="icon-box icon-rose"><ShieldAlert size={18} /></div><div><div className="eyebrow text-rose-200">Quantity discrepancy</div><h3 className="mt-1 text-lg font-semibold text-white">{d?.senderName} ↔ {r?.receiverName}</h3><p className="mt-1 text-xs text-slate-400">Opened {formatTime(conflict.createdAt)} · both signed claims are preserved</p></div></div><StatusPill tone="danger">needs review</StatusPill></div><div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="conflict-number"><span>Sender dispatched</span><strong>{conflict.expectedValue.toLocaleString()} <small>units</small></strong></div><div className="conflict-number"><span>Receiver-observed quantity</span><strong>{conflict.observedValue.toLocaleString()} <small>units</small></strong></div><div className="conflict-number conflict-number-danger"><span>Quantity variance</span><strong>{conflict.delta.toLocaleString()} <small>units</small></strong></div></div><div className="mt-5 grid gap-3 md:grid-cols-2"><div className="fact-card"><span>Last uncontested custodian</span><strong>{state.batch.lastUncontestedCustodian}</strong><p>Do not interpret this as physical custody of every unit.</p></div><div className="fact-card"><span>Onward custody</span><strong className="text-rose-200">0 units accepted</strong><p>Next dispatch is blocked pending an append-only signed resolution.</p></div></div><div className="mt-4 rounded-xl border border-rose-300/15 bg-rose-300/[0.04] px-3 py-2 text-xs leading-5 text-rose-100/70">The 950 is receiver-observed, not an allocated custody balance. No quantity is accepted for onward custody until the conflict is resolved.</div><div className="mt-5 flex flex-wrap gap-3"><ProofBadge valid label="Dispatch claim intact" /><ProofBadge valid label="Receipt claim intact" /><ProofBadge valid={state.batch.recordIntegrityState === "valid"} label={state.batch.recordIntegrityState === "valid" ? "Record integrity valid" : "Record tampered"} /></div></div>})}</div>}<div className="info-callout mt-5"><KeyRound size={15} /><p>Prototype note: organization signatures are simulated. They demonstrate attributable claims, not human identity or legal authorization.</p></div></>}
        {active === "network" && <><div className="section-heading"><div><div className="eyebrow">Replicated verification</div><h2>Verifier network</h2><p>Central application write path with simulated multi-party claim verification.</p></div><StatusPill tone={state.batch.networkState === "agreement" ? "good" : "warning"}>{state.batch.networkState === "agreement" ? "agreement" : "incomplete"}</StatusPill></div><div className="panel-card p-5"><div className="network-intro"><div className="network-orbit"><div className="orbit-core"><ShieldCheck size={21} /></div><span className="orbit-node orbit-node-a" /><span className="orbit-node orbit-node-b" /><span className="orbit-node orbit-node-c" /></div><div><h3 className="text-base font-semibold text-white">Proof checks stay separate from custody state</h3><p className="mt-1 max-w-lg text-sm leading-6 text-slate-400">A valid signature does not erase a quantity discrepancy. A peer outage is shown as incomplete verification, never healthy agreement.</p></div></div><div className="mt-6 space-y-3">{state.network.map(node => <div className="node-row" key={node.id}><div className={cn("node-status-dot", node.status === "healthy" ? "node-good" : "node-offline")} /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-medium text-white">{node.name}</span><span className="text-[10px] uppercase tracking-widest text-slate-500">{node.status}</span></div><div className="mt-1 truncate font-mono text-[11px] text-slate-500">head {node.headHash.slice(0, 20)}… · checked {formatTime(node.checkedAt)}</div></div><button className="ghost-button compact" onClick={() => togglePeer.mutate({ nodeId: node.id })}>{node.status === "healthy" ? "Simulate outage" : "Restore peer"}</button></div>)}</div><div className={cn("mt-5 rounded-2xl border p-4", state.batch.networkState === "agreement" ? "border-cyan-300/15 bg-cyan-300/[0.05]" : "border-amber-300/15 bg-amber-300/[0.05]")}><div className="flex items-center gap-2 text-sm font-medium text-white"><Server size={16} className={state.batch.networkState === "agreement" ? "text-cyan-200" : "text-amber-200"} />{state.batch.networkState === "agreement" ? "All verifier nodes report the same proof head." : "Verification incomplete: one or more verifier peers are unavailable."}</div></div></div></>}
        {active === "public" && <><div className="section-heading"><div><div className="eyebrow">Privacy-safe projection</div><h2>Public verifier</h2><p>What an external checker can see without private route details.</p></div><StatusPill tone={state.publicVerifier.verificationStatus === "verified_history" ? "good" : state.publicVerifier.verificationStatus === "needs_review" ? "danger" : "warning"}>{state.publicVerifier.verificationStatus.replaceAll("_", " ")}</StatusPill></div><div className="public-card"><div className="public-card-top"><div className="qr-placeholder"><div className="qr-grid">{Array.from({ length: 25 }).map((_, i) => <span key={i} className={i % 3 === 0 || i % 7 === 0 || i < 5 || i > 19 ? "qr-dark" : "qr-light"} />)}</div></div><div><div className="eyebrow text-cyan-300">Signed supply-chain history</div><h3 className="mt-2 text-2xl font-semibold text-white">{state.publicVerifier.productName}</h3><p className="mt-1 font-mono text-sm text-slate-400">{state.publicVerifier.batchNumber}</p><div className="mt-4 flex flex-wrap gap-2"><StatusPill tone={state.publicVerifier.recordIntegrityState === "valid" ? "good" : "danger"}><ShieldCheck size={13} />record integrity {state.publicVerifier.recordIntegrityState}</StatusPill><StatusPill tone={state.publicVerifier.networkAgreement ? "good" : "warning"}><Network size={13} />network {state.publicVerifier.networkAgreement ? "agreement" : "incomplete"}</StatusPill></div></div></div><div className="public-details"><div><span>Manufacturer</span><strong>{state.publicVerifier.manufacturer}</strong></div><div><span>Manufactured</span><strong>{state.publicVerifier.manufactureDate}</strong></div><div><span>Expiry</span><strong>{state.publicVerifier.expiryDate}</strong></div><div><span>Accepted handoffs</span><strong>{state.publicVerifier.acceptedHandoffCount} / 2</strong></div></div><div className="public-explainer"><strong>How to read the checks:</strong> Handoff complete means the current transfer has a signed receipt. Coverage complete means all two expected handoffs in this demo route have signed receipts. The headline status is a deterministic summary; the individual checks remain separate below.<span className="public-rule">Priority: tampered → network incomplete → needs review → receiver pending → coverage incomplete → verified history.</span></div><div className="assurance-grid">{([ ["Identity valid", state.publicVerifier.identityValid], ["Hash valid", state.publicVerifier.hashValid], ["Signature valid", state.publicVerifier.signatureValid], ["Predecessor valid", state.publicVerifier.predecessorValid], ["Handoff complete", state.publicVerifier.handoffComplete], ["Coverage complete", state.publicVerifier.coverageComplete], ["Quantity consistent", state.publicVerifier.quantityConsistent], ["Conflict open", state.publicVerifier.conflictOpen], ["Physical authenticity proven", state.publicVerifier.physicalAuthenticityProven] ] as [string, boolean][]).map(([label, value]) => <div className="assurance-row" key={label}><span className={cn("assurance-check", value ? "assurance-yes" : "assurance-no")}>{value ? <Check size={12} /> : <XCircle size={13} />}</span><span>{label}</span><span className={cn("ml-auto text-[11px] font-semibold uppercase tracking-widest", value ? "text-cyan-300" : "text-rose-200")}>{value ? "yes" : "no"}</span></div>)}</div><div className="public-notice"><Eye size={15} /><p>{state.publicVerifier.notice}</p></div></div></>}
      </div><aside className="side-column"><div className="side-card"><div className="flex items-center justify-between"><div className="eyebrow">Demo controls</div><CircleDot size={14} className="text-cyan-300" /></div><p className="mt-3 text-sm leading-6 text-slate-400">Use these controls to rehearse the exact judge path from a clean reset.</p><div className="mt-4 space-y-2"><button className="side-action" onClick={() => runAction(happy)}><span className="side-action-icon cyan"><CheckCircle2 size={15} /></span><span><strong>Run clean route</strong><small>Two accepted handoffs</small></span><ChevronRight size={14} /></button><button className="side-action" onClick={() => runAction(mismatch)}><span className="side-action-icon red"><AlertTriangle size={15} /></span><span><strong>Run mismatch</strong><small>1,000 dispatched / 950 observed</small></span><ChevronRight size={14} /></button><button className="side-action" onClick={() => tamper.mutate()}><span className="side-action-icon amber"><ShieldAlert size={15} /></span><span><strong>Simulate tamper</strong><small>Invalidate a signed field</small></span><ChevronRight size={14} /></button><button className="side-action" onClick={() => restore.mutate()}><span className="side-action-icon cyan"><RefreshCcw size={15} /></span><span><strong>Restore proof</strong><small>Return to valid state</small></span><ChevronRight size={14} /></button></div></div><div className="side-card"><div className="flex items-center gap-2"><Users size={15} className="text-violet-200" /><div className="eyebrow">Participants</div></div><div className="mt-4 space-y-3">{state.organizations.map(org => <div className="participant" key={org.id}><div className="participant-avatar">{org.name.split(" ").map(word => word[0]).slice(0, 2).join("")}</div><div className="min-w-0"><div className="truncate text-sm font-medium text-white">{org.name}</div><div className="text-xs text-slate-500">{org.shortRole}</div></div><BadgeCheck size={14} className="ml-auto text-cyan-300" /></div>)}</div></div><div className="side-card security-note"><div className="flex items-center gap-2 text-cyan-200"><KeyRound size={15} /><span className="text-xs font-semibold uppercase tracking-widest">Truth boundary</span></div><p className="mt-3 text-xs leading-5 text-slate-400">Provenire checks submitted records: integrity, authorship, predecessor links, and configured route state. It does not prove physical contents or chemical safety.</p></div><div className="side-card"><div className="flex items-center gap-2"><Activity size={15} className="text-cyan-300" /><div className="eyebrow">Recent activity</div></div><div className="mt-4 space-y-3">{state.activity.slice(0, 5).map(item => <div className="activity-item" key={item.id}><div className={cn("activity-dot", item.tone === "good" ? "bg-cyan-300" : item.tone === "danger" ? "bg-rose-300" : item.tone === "warning" ? "bg-amber-200" : "bg-slate-500")} /><div className="min-w-0"><div className="truncate text-xs text-slate-300">{item.label}</div><div className="truncate text-[11px] text-slate-600">{item.detail}</div></div></div>)}</div></div></aside></section>
      <footer className="app-footer"><div className="flex items-center gap-2"><Lock size={12} />Prototype organization signing is simulated.</div><div>Provenire · record integrity, not physical authenticity</div></footer>
    </main>
  </div></ChainIntegrityContext.Provider>;
}
