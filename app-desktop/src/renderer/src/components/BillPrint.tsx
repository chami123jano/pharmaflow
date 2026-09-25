import { formatLKR } from '../lib/format';

export default function BillPrint({ sale }: { sale: any }) {
  const widthChars = 32; // suitable for ~58-76mm printers with 12px monospace

  function line(left: string, right: string = "") {
    const l = left ?? "";
    const r = right ?? "";
    const takeLeft = Math.max(0, widthChars - (r.length + 1));
    const lTrim = l.length > takeLeft ? l.slice(0, takeLeft) : l;
    const spaces = Math.max(0, widthChars - (lTrim.length + r.length));
    return `${lTrim}${" ".repeat(spaces)}${r}`;
  }

  function fmt(n: any) {
    const val = Number(n ?? 0);
    return formatLKR(val);
  }

  const createdAt = new Date(sale?.createdAt || Date.now());
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const subtotal = Number(sale?.subtotal ?? items.reduce((s: number, it: any) => s + (Number(it.qty || 0) * Number(it.unitPrice || 0)), 0));
  const discountPct = Math.max(0, Math.min(5, Number(sale?.discountPct ?? 0)));
  const discountAmount = Number(sale?.discountAmount ?? (subtotal * discountPct) / 100);
  const total = Number(sale?.total ?? Math.max(0, subtotal - discountAmount));
  const payment = String(sale?.payment || "").toUpperCase();
  const customerAmount = Number(sale?.customerAmount ?? (payment === 'CASH' ? total : 0));
  const change = Number(sale?.change ?? (payment === 'CASH' ? Math.max(0, customerAmount - total) : 0));

  return (
    <div className="w-[280px] font-mono text-[12px] leading-[1.2] text-black">
      <div className="text-center font-bold mb-1">RECEIPT</div>
      <pre className="m-0">{line(`Date: ${createdAt.toLocaleString()}`)}</pre>
      <pre className="m-0">{line(`Sale ID: ${sale?.id ?? ''}`)}</pre>
      <pre className="m-0">{'-'.repeat(widthChars)}</pre>

      {/* Items */}
      <div>
        {items.map((item: any) => {
          const name: string = String(item?.product?.name ?? '').trim() || 'Item';
          const qty: number = Number(item?.qty || 0);
          const unit: number = Number(item?.unitPrice ?? item?.product?.price ?? 0);
          const rowLeft = `${qty} x ${fmt(unit)}`;
          const rowRight = fmt(qty * unit);
          return (
            <div key={item?.product?.id || name}>
              <pre className="m-0">{line(name)}</pre>
              <pre className="m-0">{line(rowLeft, rowRight)}</pre>
            </div>
          );
        })}
      </div>

      <pre className="m-0">{'-'.repeat(widthChars)}</pre>

      {/* Totals */}
      <pre className="m-0">{line('Subtotal', fmt(subtotal))}</pre>
      {discountPct > 0 && (
        <>
          <pre className="m-0">{line(`Discount (${discountPct}%)`, `-${fmt(discountAmount)}`)}</pre>
        </>
      )}
      <pre className="m-0 font-bold">{line('TOTAL', fmt(total))}</pre>

      {/* Payment details */}
      {payment && <pre className="m-0">{line('Payment', payment === 'CARD' ? 'CREDIT CARD' : payment)}</pre>}
      {payment === 'CASH' && (
        <>
          <pre className="m-0">{line('Cash', fmt(customerAmount))}</pre>
          <pre className="m-0">{line('Change', fmt(change))}</pre>
        </>
      )}

      <pre className="m-0">{'-'.repeat(widthChars)}</pre>
      <div className="text-center mt-1">Thank you!</div>
    </div>
  );
}
