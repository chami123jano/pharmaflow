import { useState, useEffect, useRef, useCallback } from 'react';
import { formatLKR } from '../lib/format';
import { useShortcuts } from '../hooks/useShortcuts';
import { useToast } from '../components/Toast';
import { parseEntry, searchProducts, findExact, tenderSuggestions } from '../lib/pos-input';
import { receiptHTML } from '../lib/receipt';
import { useShop } from '../lib/shop';

/**
 * The sale moves forward in stages, and the numpad + key is what moves it.
 * Enter confirms whatever is in front of the cashier — an item, a quantity, a
 * payment method — so "+ then Enter" reads exactly as it is typed.
 */
type Stage = 'items' | 'billing' | 'payment' | 'cash';

export default function Sales({ user, tokens, darkMode }: { user: any; tokens?: any; darkMode?: boolean }) {
  const toast = useToast();
  const [products, setProducts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [resultIdx, setResultIdx] = useState(0);
  const [cart, setCart] = useState<any[]>([]);
  const [stage, setStage] = useState<Stage>('items');

  // Which bill line is having its quantity typed, and what has been typed.
  const [qtyIdx, setQtyIdx] = useState<number | null>(null);
  const [qtyDraft, setQtyDraft] = useState('');
  // The highlighted bill line, so a row can be changed or removed from the
  // keyboard. -1 means nothing is picked.
  const [lineIdx, setLineIdx] = useState(-1);

  const [discType, setDiscType] = useState<'percent' | 'fixed'>('percent');
  const [discVal, setDiscVal] = useState(0);
  const [approvalLimit, setApprovalLimit] = useState(5);
  const [approvedBy, setApprovedBy] = useState<string | null>(null);
  const [askPassword, setAskPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);

  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [tender, setTender] = useState(0);
  // Finishing takes two keys on purpose: + arms it, Enter commits. A single
  // stray keypress must never take money and print a bill.
  const [armed, setArmed] = useState(false);

  const [heldBills, setHeldBills] = useState<any[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  const [heldIdx, setHeldIdx] = useState(0);
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastSale, setLastSale] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const shop = useShop();

  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const discRef = useRef<HTMLInputElement>(null);
  const payRef = useRef<HTMLDivElement>(null);
  const cashRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  /* ------------------------------------------------------------------ setup */

  useEffect(() => { fetchProducts(); loadSettings(); refreshHeld(); }, [user]);
  useEffect(() => { focusSearch(); }, []);

  const focusSearch = useCallback(() => {
    setTimeout(() => { searchRef.current?.focus(); searchRef.current?.select(); }, 20);
  }, []);

  async function fetchProducts() {
    try { const r: any = await window.api?.products?.list?.(); if (r?.ok) setProducts(r.data || []); } catch {}
  }
  async function loadSettings() {
    try {
      const r: any = await window.api?.settings?.list?.();
      if (r?.ok) {
        const m: any = Object.fromEntries((r.data || []).map((s: any) => [s.key, s.value]));
        const lim = Number(m['sale.discount_approval_percent']);
        if (Number.isFinite(lim) && lim >= 0) setApprovalLimit(lim);
      }
    } catch {}
  }
  async function refreshHeld() {
    try { const r: any = await window.api?.pos?.heldList?.(); if (r?.ok) setHeldBills(r.data || []); } catch {}
  }

  /* ------------------------------------------------------------------- cart */

  const stockFor = (id: string) => Number(products.find((p) => p.id === id)?.stock ?? 0);

  /** Adds the product and immediately opens its quantity box. */
  function addToCart(p: any, qty = 1) {
    const available = Number(p.stock) || 0;
    if (available <= 0) { toast.error(p.name + ' is out of stock'); return; }

    // Work the line out here rather than inside the updater. React runs the
    // updater later, so a variable assigned inside it is still unset by the
    // time the quantity box is opened — which left qtyIdx pointing at nothing.
    const existingIdx = cart.findIndex((it) => it.product.id === p.id);
    const landedAt = existingIdx >= 0 ? existingIdx : cart.length;

    setCart((prev) => {
      const i = prev.findIndex((it) => it.product.id === p.id);
      if (i >= 0) {
        const want = prev[i].qty + qty;
        if (want > available) { toast.error(`Only ${available} in stock`); return prev; }
        const u = [...prev]; u[i] = { ...u[i], qty: want }; return u;
      }
      return [...prev, { product: p, qty, unitPrice: parseFloat(p.price) || 0 }];
    });

    setSearch('');
    setResultIdx(0);
    // The cashier's next keystroke is nearly always the quantity, so open the
    // quantity box on this line. Focusing happens in the effect below: the
    // input is rendered conditionally, so a timer fired here races the render
    // and the cursor was being left behind in the search box.
    setQtyIdx(landedAt);
    setQtyDraft('');
  }

  useEffect(() => {
    if (qtyIdx === null) return;
    qtyRef.current?.focus();
    qtyRef.current?.select();
  }, [qtyIdx, cart.length]);

  // Focus follows the stage. Doing this from a timer at the call site races
  // the render, and when it lost, the cashier's next keystrokes went nowhere —
  // a typed discount was simply swallowed.
  useEffect(() => {
    if (askPassword) return;
    if (stage === 'billing') { discRef.current?.focus(); discRef.current?.select(); }
    else if (stage === 'payment') { payRef.current?.focus(); }
    else if (stage === 'cash') { cashRef.current?.focus(); cashRef.current?.select(); }
  }, [stage, askPassword]);

  /** Applies whatever is in the quantity box and returns focus to search. */
  function commitQty(back = true) {
    if (qtyIdx === null || qtyIdx < 0 || qtyIdx >= cart.length) { setQtyIdx(null); setQtyDraft(''); return; }
    const n = parseInt(qtyDraft, 10);
    if (qtyDraft.trim() !== '' && Number.isFinite(n)) {
      if (n <= 0) {
        setCart((prev) => prev.filter((_, i) => i !== qtyIdx));
      } else {
        const line = cart[qtyIdx];
        const available = line ? stockFor(line.product.id) : 0;
        if (n > available) toast.error(`Only ${available} in stock — kept ${available}`);
        setCart((prev) => prev.map((it, i) => (i === qtyIdx ? { ...it, qty: Math.min(n, available) } : it)));
      }
    }
    setQtyIdx(null);
    setQtyDraft('');
    if (back) focusSearch();
  }

  function removeLine(idx: number) {
    setCart((p) => p.filter((_, i) => i !== idx));
    if (qtyIdx === idx) { setQtyIdx(null); setQtyDraft(''); }
    setLineIdx((i) => (i >= idx ? i - 1 : i));
    focusSearch();
  }

  function resetBill() {
    setCart([]); setSearch(''); setQtyIdx(null); setQtyDraft('');
    setDiscVal(0); setApprovedBy(null); setTender(0);
    setPayMethod('CASH'); setStage('items'); setArmed(false); setLineIdx(-1);
    focusSearch();
  }

  // Changing anything about the bill cancels a pending finish, so Enter can
  // never commit something other than what was armed.
  useEffect(() => { setArmed(false); }, [cart, discVal, discType, tender, payMethod, stage]);

  /* ----------------------------------------------------------------- totals */

  const subtotal = cart.reduce((s, it) => s + it.qty * it.unitPrice, 0);
  const rawDiscount = discType === 'percent'
    ? subtotal * (Math.max(0, Math.min(100, discVal)) / 100)
    : Math.min(Math.max(0, discVal), subtotal);
  const discountPercent = subtotal > 0 ? (rawDiscount / subtotal) * 100 : 0;
  const needsApproval = discVal > 0 && discountPercent > approvalLimit;
  const discAmt = needsApproval && !approvedBy ? 0 : rawDiscount;
  const total = Math.max(0, Math.round((subtotal - discAmt) * 100) / 100);
  const change = Math.max(0, tender - total);

  const parsed = parseEntry(search);
  // At the till the first entry is what Enter takes, so sellable stock leads.
  const results = searchProducts(products, parsed.term, 8, { sellableFirst: true });

  /* ------------------------------------------------------------- navigation */

  function goBilling() {
    if (!cart.length) { toast.error('Add an item first'); return; }
    if (qtyIdx !== null) commitQty(false);
    setStage('billing');
  }

  /**
   * Leaving the billing stage is where a large discount is challenged. If the
   * password is wrong or refused the discount is simply dropped and the sale
   * carries on at full price — the customer is never left standing.
   */
  function goPayment() {
    if (needsApproval && !approvedBy) {
      setAskPassword(true);
      setPassword('');
      setTimeout(() => pwRef.current?.focus(), 60);
      return;
    }
    setStage('payment');
  }

  async function confirmApproval() {
    setChecking(true);
    const r: any = await window.api?.auth?.verifyAdmin?.(password);
    setChecking(false);
    setAskPassword(false);
    setPassword('');
    if (r?.ok) {
      setApprovedBy(r.data?.name || 'Admin');
      toast.success('Discount approved by ' + (r.data?.name || 'admin'));
    } else {
      setDiscVal(0);
      setApprovedBy(null);
      toast.error((r?.message || 'Not approved') + ' — no discount applied');
    }
    setStage('payment');
  }

  function cancelApproval() {
    setAskPassword(false);
    setPassword('');
    setDiscVal(0);
    setApprovedBy(null);
    toast.info('No discount applied');
    setStage('payment');
  }

  function choosePayment() {
    if (payMethod === 'CASH') {
      setStage('cash');
      setTender(0);
    } else {
      setTender(total);
    }
  }

  /** numpad + — always means "next". */
  function advance() {
    if (askPassword) return;
    if (stage === 'items') {
      if (qtyIdx !== null) commitQty(false);
      goBilling();
    } else if (stage === 'billing') {
      goPayment();
    } else if (stage === 'payment') {
      if (payMethod === 'CASH') choosePayment();
      else armFinish();
    } else if (stage === 'cash') {
      armFinish();
    }
  }

  /** + at the last step only arms the finish; Enter is what commits it. */
  function armFinish() {
    if (!cart.length) { toast.error('Nothing to sell'); return; }
    if (payMethod === 'CASH' && tender < total) { toast.error('Cash received is less than the total'); return; }
    setArmed(true);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'NumpadAdd') { e.preventDefault(); advance(); return; }
      // Once armed, Enter commits from wherever the cursor is, and Escape
      // stands the sale back down.
      if (armed && e.key === 'Enter') { e.preventDefault(); completeSale(); return; }
      if (armed && e.key === 'Escape') { e.preventDefault(); setArmed(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ------------------------------------------------------------------- sale */

  async function completeSale() {
    if (!cart.length) { toast.error('Nothing to sell'); return; }
    if (payMethod === 'CASH' && tender < total) { toast.error('Cash received is less than the total'); return; }
    if (loading) return;
    setLoading(true);
    try {
      const res: any = await window.api?.sales?.create?.({
        items: cart.map((it) => ({ product_id: it.product.id, quantity: it.qty })),
        payment_method: payMethod,
        discount_type: discType,
        discount_value: discAmt > 0 ? discVal : 0,
        customer_amount: payMethod === 'CASH' ? tender : total,
        cashier_id: user?.id,
        notes: approvedBy ? `Discount approved by ${approvedBy}` : undefined,
      });
      if (!res?.ok) throw new Error(res?.error || 'Sale failed');

      const sd = {
        id: res.data?.id, receiptNo: res.data?.receipt_no,
        cashierName: user?.name || user?.email?.split('@')[0] || 'Staff',
        items: cart, subtotal: res.data?.subtotal ?? subtotal,
        discountAmount: res.data?.discountAmount ?? discAmt,
        approvedBy, total: res.data?.total ?? total, payment: payMethod,
        customerAmount: payMethod === 'CASH' ? tender : total,
        change: res.data?.changeAmt ?? change, createdAt: new Date().toISOString(),
      };
      setLastSale(sd);

      const html = receiptHTML(sd, shop);

      // Show the change and free the till straight away. Printing is not
      // awaited: a network printer took 41 seconds in testing, and the cashier
      // cannot stand there holding the customer's money until it finishes.
      // The sale is already saved, so a printing problem is a warning, never a
      // reason to hold up the counter.
      setDone({ receiptNo: sd.receiptNo, total: sd.total, payment: payMethod, change: sd.change, tender: sd.customerAmount });
      try {
        window.dispatchEvent(new CustomEvent('ph:sale:completed'));
        localStorage.setItem('ph:lastSaleTs', String(Date.now()));
      } catch {}
      resetBill();
      fetchProducts();

      void (async () => {
        try {
          const pr: any = await window.api?.util?.printHTML?.(html);
          if (!pr?.ok && pr?.error !== 'CANCELLED') toast.error(pr?.message || 'Could not print');
        } catch { toast.error('Could not print the receipt'); }
        try {
          const sv: any = await window.api?.util?.saveReceiptPDF?.(html, `receipt-${String(sd.receiptNo).padStart(5, '0')}`);
          if (!sv?.ok) toast.error(sv?.message || 'Could not save the receipt copy');
        } catch { toast.error('Could not save the receipt copy'); }
      })();
    } catch (e: any) {
      toast.error(e?.message || 'Sale failed');
    } finally {
      setLoading(false);
    }
  }

  async function reprint() {
    if (!lastSale) { toast.info('No receipt yet'); return; }
    const html = receiptHTML(lastSale, shop, { reprint: true });
    const r: any = await window.api?.util?.printHTML?.(html);
    if (r?.ok) toast.success('Reprinted');
    else if (r?.error !== 'CANCELLED') toast.error(r?.message || 'Could not print');
  }

  /* -------------------------------------------------------------- hold bill */

  async function holdBill() {
    if (!cart.length) { toast.error('Nothing to hold'); return; }
    const r: any = await window.api?.pos?.hold?.({
      cart, total, cashier_id: user?.id,
      label: cart[0]?.product?.name + (cart.length > 1 ? ` +${cart.length - 1}` : ''),
    });
    if (r?.ok) { toast.success('Bill held'); resetBill(); refreshHeld(); }
    else toast.error(r?.error || 'Could not hold');
  }

  async function recallBill(id: string) {
    const r: any = await window.api?.pos?.recall?.(id);
    if (!r?.ok) { toast.error(r?.error || 'Could not recall'); return; }
    setCart(r.data?.cart || []);
    setShowHeld(false);
    setStage('items');
    if (r.data?.dropped?.length) toast.error('Removed: ' + r.data.dropped.join(', '));
    refreshHeld();
    focusSearch();
  }

  async function openHeld() {
    await refreshHeld();
    const r: any = await window.api?.pos?.heldList?.();
    const list = r?.ok ? r.data || [] : [];
    if (!list.length) { toast.info('No held bills'); return; }
    setHeldIdx(0);
    setShowHeld(true);
  }

  useEffect(() => {
    if (!showHeld) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHeldIdx((i) => Math.min(i + 1, heldBills.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHeldIdx((i) => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); const b = heldBills[heldIdx]; if (b) recallBill(b.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showHeld, heldBills, heldIdx]);

  /* ------------------------------------------------------------ key handlers */

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const typing = !!search.trim();

    // With something typed the arrows walk the suggestions; with the box empty
    // they walk the bill, so a line can be corrected without the mouse.
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (typing) setResultIdx((i) => Math.min(i + 1, results.length - 1));
      else setLineIdx((i) => Math.min(i + 1, cart.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (typing) setResultIdx((i) => Math.max(i - 1, 0));
      else setLineIdx((i) => Math.max(i - 1, cart.length ? 0 : -1));
      return;
    }

    if (!typing && lineIdx >= 0 && lineIdx < cart.length) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const gone = cart[lineIdx]?.product?.name;
        removeLine(lineIdx);
        toast.info((gone || 'Line') + ' removed');
        return;
      }
      if (e.key === 'Enter') {
        // Enter on a highlighted line opens its quantity for correction.
        e.preventDefault();
        setQtyIdx(lineIdx);
        setQtyDraft('');
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const { qty, term } = parsed;
      if (!term) { if (cart.length) goBilling(); return; }
      const exact = findExact(products, term);
      if (exact) { addToCart(exact, qty); return; }
      if (results.length) addToCart(results[Math.min(resultIdx, results.length - 1)], qty);
      else toast.error('Not found: ' + term);
    }
  }

  function onQtyKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); commitQty(true); }
    if (e.key === 'Escape') { e.preventDefault(); setQtyIdx(null); setQtyDraft(''); focusSearch(); }
  }

  function onDiscountKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); goPayment(); }
    if (e.key === 'Escape') { e.preventDefault(); setStage('items'); focusSearch(); }
  }

  function onPaymentKey(e: React.KeyboardEvent) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      setPayMethod((m) => (m === 'CASH' ? 'CARD' : 'CASH'));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (armed) completeSale();
      else choosePayment();
    }
    if (e.key === 'Escape') { e.preventDefault(); setArmed(false); setStage('billing'); }
  }

  function onCashKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (armed) completeSale();
      else toast.info('Press + then Enter to finish');
    }
    if (e.key === 'Escape') { e.preventDefault(); setStage('payment'); setTimeout(() => payRef.current?.focus(), 30); }
  }

  useShortcuts([
    { key: 'F2', description: 'Back to the item box', group: 'POS', action: () => { setStage('items'); focusSearch(); } },
    { key: 'F3', description: 'Hold bill', group: 'POS', action: () => holdBill() },
    { key: 'F6', description: 'Recall held bill', group: 'POS', action: () => openHeld() },
    { key: 'F7', description: 'Exact cash', group: 'POS', action: () => { if (stage === 'cash') { setTender(Math.ceil(total)); setTimeout(() => cashRef.current?.focus(), 20); } } },
    { key: 'F9', description: 'Reprint last receipt', group: 'POS', action: () => reprint() },
    { key: 'Escape', description: 'Cancel / back', group: 'POS', action: () => {
      if (showReceipt) { setShowReceipt(false); focusSearch(); return; }
      if (showHeld) { setShowHeld(false); focusSearch(); return; }
      if (done) { setDone(null); focusSearch(); return; }
    } },
    { key: 'Delete', ctrl: true, description: 'Clear the bill', group: 'POS', action: () => { if (cart.length) { resetBill(); toast.info('Bill cleared'); } } },
  ]);

  /* ----------------------------------------------------------------- styles */

  const dm = darkMode;
  const card = `rounded-2xl border ${dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`;
  const tp = dm ? 'text-gray-100' : 'text-gray-900';
  const ts = dm ? 'text-gray-400' : 'text-gray-500';
  const inp = `w-full px-4 py-3 rounded-xl border-2 focus:outline-none focus:border-blue-500 transition ${dm ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900'}`;

  /**
   * The panel whose turn it is gets a ring and a lifted shadow; the others stay
   * fully legible rather than dimmed. The discount has to be readable at a
   * glance from any stage — that was the point of putting it on screen instead
   * of behind a key.
   */
  const panel = (s: Stage) =>
    `${card} transition-shadow ${stage === s
      ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-500/10'
      : 'shadow-sm'}`;

  const Key = ({ k, label }: { k: string; label: string }) => (
    <span className="inline-flex items-center gap-1.5">
      <kbd className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-bold ${dm ? 'bg-gray-700 text-gray-200 border border-gray-600' : 'bg-gray-100 text-gray-700 border border-gray-300'}`}>{k}</kbd>
      <span className={`text-[11px] ${ts}`}>{label}</span>
    </span>
  );

  const STAGES: Stage[] = ['items', 'billing', 'payment', 'cash'];
  const stageLabel: Record<Stage, string> = {
    items: 'Items', billing: 'Discount', payment: 'Payment', cash: 'Cash',
  };
  const stageAt = STAGES.indexOf(stage);

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:h-[calc(100vh-7.5rem)]">
      {/* ---------------------------------------------------------- LEFT --- */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">

        {/* Where the sale has got to */}
        <div className={`${card} shadow-sm px-4 py-3 flex items-center gap-2 flex-wrap`}>
          {STAGES.map((st, i) => {
            const passed = i < stageAt;
            const now = i === stageAt;
            return (
              <div key={st} className="flex items-center gap-2">
                <span className={`flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full text-xs font-bold transition ${
                  now ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                  : passed ? (dm ? 'bg-emerald-900/50 text-emerald-300' : 'bg-emerald-50 text-emerald-700')
                  : (dm ? 'bg-gray-700/60 text-gray-500' : 'bg-gray-100 text-gray-400')}`}>
                  <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] ${
                    now ? 'bg-white/25' : passed ? (dm ? 'bg-emerald-400/20' : 'bg-emerald-200/70') : (dm ? 'bg-gray-600' : 'bg-gray-200')}`}>
                    {passed ? '✓' : i + 1}
                  </span>
                  {stageLabel[st]}
                </span>
                {i < STAGES.length - 1 && (
                  <span className={`w-4 h-px ${passed ? 'bg-emerald-400' : dm ? 'bg-gray-700' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
          <span className="ml-auto"><Key k="Numpad +" label="next stage" /></span>
        </div>

        {/* Item entry */}
        <div className={`${panel('items')} p-4`}>
          <div className="flex items-center justify-between mb-2">
            <label className={`text-sm font-bold ${tp}`}>Item</label>
            {cart.length > 0 && <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-xs font-bold">{cart.length} line{cart.length > 1 ? 's' : ''}</span>}
          </div>
          <input
            ref={searchRef} type="text" value={search}
            onChange={(e) => { setSearch(e.target.value); setResultIdx(0); }}
            onKeyDown={onSearchKey}
            onFocus={() => setStage('items')}
            placeholder="Type part of the name, or scan"
            className={`${inp} text-lg`} autoComplete="off" spellCheck={false}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
            <Key k="↑ ↓" label="choose" />
            <Key k="Enter" label="add, then type qty" />
            <Key k="Numpad +" label="finish items" />
            <Key k="F3" label="hold" />
            <Key k="F6" label="recall" />
            <Key k="F9" label="reprint" />
          </div>

          {search.trim() && results.length > 0 && stage === 'items' && (
            <div className={`mt-3 rounded-xl border overflow-hidden ${dm ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'}`}>
              {results.map((p, i) => (
                <div key={p.id} onClick={() => addToCart(p, parsed.qty)}
                  className={`flex items-center justify-between px-4 py-2.5 cursor-pointer border-b last:border-0 ${i === resultIdx ? 'bg-blue-600 text-white' : dm ? 'hover:bg-gray-600 border-gray-700 text-gray-200' : 'hover:bg-blue-50 border-gray-50 text-gray-800'}`}>
                  <div className="min-w-0">
                    <span className="font-semibold text-sm">{p.name}</span>
                    {p.generic_name && <span className={`ml-2 text-xs ${i === resultIdx ? 'text-blue-100' : ts}`}>{p.generic_name}</span>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`font-bold text-sm ${i === resultIdx ? 'text-white' : 'text-emerald-500'}`}>{formatLKR(p.price)}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      Number(p.stock) <= 0 ? 'bg-red-500 text-white'
                      : Number(p.price) <= 0 ? 'bg-amber-400 text-white'
                      : 'bg-emerald-100 text-emerald-700'}`}>
                      {Number(p.stock) <= 0 ? 'none' : Number(p.price) <= 0 ? 'no price' : p.stock}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {search.trim() && !results.length && <p className={`mt-2 text-sm ${ts}`}>No match for "{parsed.term}".</p>}
        </div>

        {/* The bill takes whatever height is left, so a long one scrolls inside
            its own panel instead of pushing the total off the screen. */}
        <div className={`${card} shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden`}>
          <div className={`flex items-center justify-between gap-3 flex-wrap px-4 py-3 border-b ${dm ? 'border-gray-700' : 'border-gray-100'}`}>
            <h3 className={`text-sm font-bold ${tp}`}>Bill</h3>
            {cart.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Key k="↑ ↓" label="pick a line" />
                <Key k="Del" label="remove it" />
                <Key k="Enter" label="change qty" />
              </div>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="flex-1 grid place-items-center px-6 py-10">
              <div className="text-center">
                <div className={`mx-auto w-11 h-11 rounded-2xl grid place-items-center mb-3 ${dm ? 'bg-gray-700' : 'bg-gray-100'}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                       strokeLinecap="round" strokeLinejoin="round" className={ts} aria-hidden="true">
                    <path d="M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2.5 1.5L9 2 6.5 3.5z"/>
                    <path d="M8 7h8M8 11h8M8 15h5"/>
                  </svg>
                </div>
                <p className={`text-sm font-medium ${tp}`}>No items yet</p>
                <p className={`text-xs mt-1 ${ts}`}>Type a name above, or scan a barcode.</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className={`sticky top-0 z-10 ${dm ? 'bg-gray-800' : 'bg-white'}`}>
                  <tr className={`border-b text-[11px] uppercase tracking-wide ${dm ? 'border-gray-700 text-gray-500' : 'border-gray-100 text-gray-400'}`}>
                    <th className="text-left font-semibold px-4 py-2">Item</th>
                    <th className="text-center font-semibold py-2 w-24">Qty</th>
                    <th className="text-right font-semibold py-2 w-24">Price</th>
                    <th className="text-right font-semibold py-2 w-28">Amount</th>
                    <th className="py-2 w-24 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item, idx) => (
                    <tr key={item.product.id}
                      onClick={() => { setLineIdx(idx); focusSearch(); }}
                      className={`border-b cursor-pointer transition-colors ${dm ? 'border-gray-700/70' : 'border-gray-50'} ${
                        qtyIdx === idx || lineIdx === idx
                          ? (dm ? 'bg-blue-900/40' : 'bg-blue-50')
                          : (dm ? 'hover:bg-gray-700/40' : 'hover:bg-gray-50')
                      }`}>
                      <td className={`px-4 py-2.5 font-medium ${tp}`}>{item.product.name}</td>
                      <td className="py-2.5 text-center">
                        {qtyIdx === idx ? (
                          <input
                            ref={qtyRef} type="text" inputMode="numeric" value={qtyDraft}
                            onChange={(e) => setQtyDraft(e.target.value.replace(/[^0-9]/g, ''))}
                            onKeyDown={onQtyKey}
                            onBlur={() => commitQty(false)}
                            placeholder={String(item.qty)}
                            className="w-20 px-2 py-1 text-center font-bold rounded-lg border-2 border-blue-500 focus:outline-none text-gray-900"
                          />
                        ) : (
                          <button onClick={() => { setQtyIdx(idx); setQtyDraft(''); setTimeout(() => qtyRef.current?.focus(), 20); }}
                            className={`w-20 py-1 rounded-lg font-bold tabular-nums ${dm ? 'text-gray-100 hover:bg-gray-700' : 'text-gray-900 hover:bg-gray-100'}`}>
                            {item.qty}
                          </button>
                        )}
                      </td>
                      <td className={`py-2.5 text-right tabular-nums ${ts}`}>{formatLKR(item.unitPrice)}</td>
                      <td className={`py-2.5 text-right font-bold tabular-nums ${tp}`}>{formatLKR(item.qty * item.unitPrice)}</td>
                      <td className="py-2.5 text-right pr-4">
                        <button onClick={(e) => { e.stopPropagation(); removeLine(idx); }}
                          title="Remove this line"
                          className="px-2 py-1 rounded-lg text-xs font-semibold bg-red-100 text-red-600 hover:bg-red-200">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------- RIGHT --- */}
      <div data-rail className="w-full lg:w-[390px] shrink-0 flex flex-col gap-2.5 lg:min-h-0">

        {/* The total is the one number the cashier and the customer both look
            at, so it gets the strongest block on the screen. */}
        <div className={`rounded-2xl px-4 py-3 shadow-lg ${dm ? 'bg-gray-800 border border-gray-700' : 'bg-slate-900'}`}>
          <div className="flex justify-between text-sm text-slate-400">
            <span>Subtotal</span><span className="tabular-nums">{formatLKR(subtotal)}</span>
          </div>
          {discAmt > 0 && (
            <div className="flex justify-between text-sm text-emerald-400 mt-1">
              <span>Discount {discType === 'percent' ? `(${discVal}%)` : ''}</span>
              <span className="tabular-nums">−{formatLKR(discAmt)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline border-t border-white/10 pt-2 mt-2">
            <span className="font-bold text-slate-300 text-sm tracking-wide">TOTAL</span>
            <span data-total className="text-[2rem] font-extrabold text-emerald-400 tabular-nums leading-none">{formatLKR(total)}</span>
          </div>
        </div>

        {/* Discount — always visible, no shortcut needed */}
        <div className={`${panel('billing')} px-4 py-3`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={`text-sm font-bold ${tp}`}>Discount</h3>
            <span className={`text-[11px] ${ts}`}>over {approvalLimit}% needs admin</span>
          </div>
          <div className="flex gap-2">
            <select value={discType} onChange={(e) => { setDiscType(e.target.value as any); setApprovedBy(null); }}
              className={`px-3 rounded-xl border-2 w-20 shrink-0 ${dm ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-gray-300'}`}>
              <option value="percent">%</option>
              <option value="fixed">Rs</option>
            </select>
            <input ref={discRef} type="number" min={0} value={discVal || ''}
              onChange={(e) => { setDiscVal(Math.max(0, Number(e.target.value) || 0)); setApprovedBy(null); }}
              onKeyDown={onDiscountKey}
              onFocus={() => setStage('billing')}
              placeholder="0" className={`${inp} flex-1`} />
          </div>
          {needsApproval && !approvedBy && discVal > 0 && (
            <p className="mt-2 text-xs text-orange-500 font-medium">
              {discountPercent.toFixed(1)}% — an admin password is needed when you continue.
            </p>
          )}
          {approvedBy && <p className="mt-2 text-xs text-emerald-600 font-medium">Approved by {approvedBy}</p>}
        </div>

        {/* Payment */}
        <div ref={payRef} tabIndex={-1} onKeyDown={onPaymentKey}
          className={`${panel('payment')} px-4 py-3 outline-none`}>
          <div className="flex items-center justify-between mb-2">
            <h3 className={`text-sm font-bold ${tp}`}>Payment</h3>
            <Key k="↑ ↓" label="switch, Enter to choose" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(['CASH', 'CARD'] as const).map((m) => (
              <button key={m} onClick={() => { setPayMethod(m); setStage('payment'); }}
                className={`py-2.5 rounded-xl text-sm font-bold border-2 transition ${payMethod === m ? (m === 'CASH' ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/30' : 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/30') : dm ? 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500' : 'bg-gray-50 border-gray-300 text-gray-700 hover:border-gray-400'}`}>
                {m === 'CASH' ? 'Cash' : 'Card'}
              </button>
            ))}
          </div>
        </div>

        {/* Cash received — only for cash */}
        {payMethod === 'CASH' && (
          <div className={`${panel('cash')} px-4 py-3`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className={`text-sm font-bold ${tp}`}>Cash received</h3>
              <Key k="F7" label="exact" />
            </div>
            <input ref={cashRef} type="number" min={0} step="0.01" value={tender || ''}
              onChange={(e) => setTender(parseFloat(e.target.value) || 0)}
              onKeyDown={onCashKey} onFocus={() => setStage('cash')}
              placeholder="0.00" className={`${inp} py-2 text-2xl font-bold text-right tabular-nums`} />
            <div className="grid grid-cols-4 gap-2 mt-2">
              {tenderSuggestions(total).map((a) => (
                <button key={a} data-suggest onClick={() => { setTender(a); setStage('cash'); setTimeout(() => cashRef.current?.focus(), 20); }}
                  className={`py-1.5 text-xs rounded-lg font-bold tabular-nums transition ${dm ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{a}</button>
              ))}
            </div>
            {tender > 0 && (tender >= total ? (
              <div className={`mt-2 px-3 py-2 rounded-xl flex items-baseline justify-between ${dm ? 'bg-emerald-900/30 border border-emerald-800' : 'bg-emerald-50 border border-emerald-200'}`}>
                <span className={`text-xs font-semibold ${ts}`}>Change</span>
                <span className="text-2xl font-bold text-emerald-500 tabular-nums">{formatLKR(change)}</span>
              </div>
            ) : (
              <div className={`mt-2 px-3 py-2 rounded-xl text-center text-sm font-medium ${dm ? 'bg-red-900/30 border border-red-800 text-red-300' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                Short by {formatLKR(total - tender)}
              </div>
            ))}
          </div>
        )}

        <button
          data-finish
          onClick={() => (armed ? completeSale() : advance())}
          disabled={loading || !cart.length}
          className={`w-full py-3.5 rounded-2xl font-bold text-lg text-white disabled:opacity-40 disabled:shadow-none shadow-lg transition ${armed ? 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/40 animate-pulse' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30'}`}
        >
          {loading
            ? 'Saving…'
            : armed
              ? 'Press Enter to finish'
              : stage === 'cash' || (stage === 'payment' && payMethod === 'CARD')
                ? 'Finish  ·  Numpad +'
                : 'Next  ·  Numpad +'}
        </button>
        {armed && (
          <p className="text-center text-xs text-orange-500 font-medium -mt-1">
            The bill will be printed and filed. Esc to go back.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={holdBill} disabled={!cart.length}
            className={`py-2 rounded-xl border text-sm font-medium disabled:opacity-40 transition ${dm ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>Hold · F3</button>
          <button onClick={openHeld}
            className={`py-2 rounded-xl border text-sm font-medium transition ${dm ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
            Recall · F6 {heldBills.length > 0 && <span className="ml-1 px-1.5 rounded-full bg-orange-500 text-white text-xs">{heldBills.length}</span>}
          </button>
        </div>
      </div>

      {/* Admin approval */}
      {askPassword && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className={`rounded-2xl p-6 w-full max-w-sm shadow-2xl ${dm ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-lg font-bold ${tp}`}>Admin approval</h3>
            <p className={`text-sm mt-1 mb-4 ${ts}`}>
              {discountPercent.toFixed(1)}% is above the {approvalLimit}% limit. Enter an admin password to allow it.
            </p>
            <input ref={pwRef} type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); confirmApproval(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelApproval(); }
              }}
              placeholder="Admin password" className={inp} />
            <div className="flex gap-3 mt-4">
              <button onClick={cancelApproval}
                className={`flex-1 py-2.5 rounded-xl border font-medium ${dm ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-700'}`}>
                No discount (Esc)
              </button>
              <button onClick={confirmApproval} disabled={checking}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold disabled:opacity-50">
                {checking ? 'Checking…' : 'Approve (Enter)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* After a sale — change is the thing the cashier needs to see */}
      {done && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 p-4"
          onClick={() => { setDone(null); focusSearch(); }}>
          <div className={`rounded-2xl p-8 text-center shadow-2xl ${dm ? 'bg-gray-800' : 'bg-white'}`}>
            <div className="text-sm text-gray-500">Receipt #{done.receiptNo} · saved, printing</div>
            <div className={`text-2xl font-bold mt-1 ${tp}`}>{formatLKR(done.total)} {done.payment === 'CARD' ? 'by card' : 'cash'}</div>
            {done.payment === 'CASH' && (
              <>
                <div className="mt-4 text-sm text-gray-500">Change to give</div>
                <div className="text-5xl font-bold text-green-600">{formatLKR(done.change)}</div>
              </>
            )}
            <p className={`mt-5 text-xs ${ts}`}>Press Esc or click to start the next bill</p>
          </div>
        </div>
      )}

      {/* Held bills */}
      {showHeld && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowHeld(false); focusSearch(); } }}>
          <div className={`rounded-2xl shadow-2xl w-full max-w-lg ${dm ? 'bg-gray-800' : 'bg-white'}`}>
            <div className={`p-4 border-b ${dm ? 'border-gray-700' : 'border-gray-200'}`}>
              <h3 className={`font-bold ${tp}`}>Held bills</h3>
              <p className={`text-xs mt-0.5 ${ts}`}>↑↓ to choose · Enter to recall · Esc to close</p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {heldBills.map((b, i) => (
                <div key={b.id} onClick={() => recallBill(b.id)}
                  className={`flex items-center justify-between px-4 py-3 cursor-pointer border-b last:border-0 ${i === heldIdx ? 'bg-blue-600 text-white' : dm ? 'border-gray-700 text-gray-200' : 'border-gray-100 text-gray-800'}`}>
                  <div>
                    <div className="font-semibold text-sm">{b.label || 'Bill'}</div>
                    <div className={`text-xs ${i === heldIdx ? 'text-blue-100' : ts}`}>{b.item_count} line(s)</div>
                  </div>
                  <span className="font-bold">{formatLKR(b.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
