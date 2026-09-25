// Global renderer-side type declarations for the preload exposed API

export interface ApiResponse<T=any> { ok:boolean; data?:T; error?:string }

export interface ProductInput { name?:string; sku?:string; price?:number; stock?:number; expiry?:string; category?:string }

export interface WindowApi {
  auth: {
    login(email:string, password:string): Promise<any>
    register?(email:string, password:string, role?:string): Promise<any>
    me(token:string): Promise<any>
    list(): Promise<ApiResponse<Array<{ id:string; email:string; role:string }>>>
    verifyAdmin(password:string): Promise<ApiResponse<{ id:string; name:string }> & { message?:string }>
  }
  products: {
    list(): Promise<ApiResponse<Array<{ id:string; name:string; sku:string; price:number; stock:number; expiry?:string; category?:string; description?:string; supplier?:string }>>>
    get(id:string): Promise<ApiResponse<{ id:string; name:string; sku:string; price:number; stock:number; expiry?:string; category?:string; description?:string; supplier?:string }>>
    create(data:ProductInput): Promise<ApiResponse<{ id:string; sku:string }>>
    update(id:string, data:ProductInput): Promise<ApiResponse<{ id:string }>>
    delete(id:string): Promise<ApiResponse<{ id:string }>>
    adjustStock(id:string, delta:number): Promise<ApiResponse<{ id:string; stock:number }>>
    generateSku(payload?: { name?:string; category?:string }): Promise<ApiResponse<{ sku:string }>>
  }
  sales: {
    create(payload:{ items: Array<{ product_id:string; quantity:number }>; payment_method: string }): Promise<ApiResponse<{ id:string }>>
    list(): Promise<ApiResponse<Array<{ id:string; total:number; created_at:string }>>>
    summaryToday(): Promise<ApiResponse<{ totalSales:number; transactions:number }>>
  }
  sync: {
    status(): Promise<ApiResponse<{ configured:boolean; owner:string; repo:string; deviceId:string; deviceLabel:string; pending:number; lastSync:string; lastResult:string; tokenEncrypted:boolean; hasToken:boolean }>>
    configure(payload:{ repo:string; token?:string; label?:string; branch?:string }): Promise<ApiResponse<{ owner:string; repo:string; private?:boolean }>>
    run(): Promise<ApiResponse<{ applied:number; pushed:number; skipped:number }>>
    disconnect(): Promise<ApiResponse<void>>
    exportEvents(): Promise<ApiResponse<{ filename:string; content:string; count:number; ids:string[] }>>
    markExported(ids:string[]): Promise<ApiResponse<void>>
    importEvents(content:string): Promise<ApiResponse<{ applied:number; skipped:number; malformed:number; own:number }>>
  }
  app: {
    approveExit(): Promise<ApiResponse<void>>
    lockState(): Promise<ApiResponse<{ lockExit:boolean; kiosk:boolean }>>
    setKiosk(on:boolean): Promise<ApiResponse<void>>
    onExitRequested(cb:()=>void): () => void
  }
  customers: {
    list(search?:string): Promise<ApiResponse<any[]>>
    create(payload:any): Promise<ApiResponse<any> & { message?:string }>
    update(id:string, patch:any): Promise<ApiResponse<any> & { message?:string }>
    delete(id:string): Promise<ApiResponse<any> & { message?:string }>
    history(id:string, limit?:number): Promise<ApiResponse<{ sales:any[]; visits:number; totalSpent:number }>>
  }
  suppliers: {
    list(search?:string): Promise<ApiResponse<any[]>>
    create(payload:any): Promise<ApiResponse<any> & { message?:string }>
    update(id:string, patch:any): Promise<ApiResponse<any> & { message?:string }>
    delete(id:string): Promise<ApiResponse<any> & { message?:string }>
    history(id:string, limit?:number): Promise<ApiResponse<{ batches:any[]; deliveries:number; totalValue:number }>>
  }
  batches: {
    list(productId:string): Promise<ApiResponse<Array<{ id:string; batch_no:string|null; expiry:string|null; qty_received:number; qty_remaining:number; cost_price:number|null; supplier:string|null; expired:boolean }>>>
    expiring(days?:number): Promise<ApiResponse<Array<{ id:string; product_name:string; batch_no:string|null; expiry:string; qty_remaining:number; expired:boolean; value_at_risk:number }>>>
    receive(payload:{ product_id:string; qty:number; expiry?:string; batch_no?:string; cost_price?:number; supplier?:string; created_by?:string }): Promise<ApiResponse<any> & { message?:string }>
    adjust(batchId:string, newQty:number, reason?:string, userId?:string): Promise<ApiResponse<any>>
  }
  pos: {
    hold(payload:{ label?:string; cart:any[]; total?:number; cashier_id?:string }): Promise<ApiResponse<{ id:string }>>
    heldList(): Promise<ApiResponse<Array<{ id:string; label:string|null; item_count:number; total:number; created_at:string }>>>
    recall(id:string): Promise<ApiResponse<{ cart:any[]; dropped:string[] }>>
    discardHeld(id:string): Promise<ApiResponse<void>>
    void(saleId:string, reason?:string, userId?:string): Promise<ApiResponse<{ receipt_no:number; restored:number }>>
  }
  reports: {
    lowStock(): Promise<ApiResponse<Array<{ id:string; name:string; stock:number }>>>
    nearExpiry(): Promise<ApiResponse<Array<{ id:string; name:string; expiry:string }>>>
    salesTrend(start:string, end:string): Promise<ApiResponse<Array<{ date:string; total:number }>>>
  }
  settings: {
    get(key:string): Promise<any>
    set(key:string, value:string): Promise<any>
    list(): Promise<ApiResponse<Array<{ key:string; value:string }>>>
  }
}

declare global {
  interface Window { api: WindowApi }
}
