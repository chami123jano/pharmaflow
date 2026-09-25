import { contextBridge, ipcRenderer } from 'electron';

type IpcResult<T=any> = { ok: true; data?: T; [k: string]: any } | { ok: false; error: string };

const api = {
  auth: {
    login:    (email: string, password: string) => ipcRenderer.invoke('auth:login', email, password) as Promise<IpcResult>,
    register: (email: string, password: string, role?: string, name?: string) => ipcRenderer.invoke('auth:register', email, password, role, name) as Promise<IpcResult>,
    me:       (token: string) => ipcRenderer.invoke('auth:me', token) as Promise<IpcResult>,
    list:     () => ipcRenderer.invoke('auth:list') as Promise<IpcResult>,
    update:   (id: string, patch: any) => ipcRenderer.invoke('auth:update', id, patch) as Promise<IpcResult>,
    delete:   (id: string) => ipcRenderer.invoke('auth:delete', id) as Promise<IpcResult>,
    verifyAdmin: (password: string) => ipcRenderer.invoke('auth:verifyAdmin', password) as Promise<IpcResult>,
  },
  products: {
    list:        () => ipcRenderer.invoke('products:list') as Promise<IpcResult>,
    get:         (id: string) => ipcRenderer.invoke('products:get', id) as Promise<IpcResult>,
    create:      (payload: any) => ipcRenderer.invoke('products:create', payload) as Promise<IpcResult>,
    update:      (id: string, patch: any) => ipcRenderer.invoke('products:update', id, patch) as Promise<IpcResult>,
    delete:      (id: string) => ipcRenderer.invoke('products:delete', id) as Promise<IpcResult>,
    adjustStock: (id: string, delta: number, notes?: string) => ipcRenderer.invoke('products:adjustStock', id, delta, notes) as Promise<IpcResult>,
    generateSku: (payload?: { name?: string; category?: string }) => ipcRenderer.invoke('products:generateSku', payload) as Promise<IpcResult>,
  },
  sales: {
    list:         (limit?: number) => ipcRenderer.invoke('sales:list', limit) as Promise<IpcResult>,
    get:          (id: string) => ipcRenderer.invoke('sales:get', id) as Promise<IpcResult>,
    create:       (payload: any) => ipcRenderer.invoke('sales:create', payload) as Promise<IpcResult>,
    summaryToday: () => ipcRenderer.invoke('sales:summaryToday') as Promise<IpcResult>,
  },
  sync: {
    status:     () => ipcRenderer.invoke('sync:status') as Promise<IpcResult>,
    configure:  (payload: { repo: string; token?: string; label?: string; branch?: string }) => ipcRenderer.invoke('sync:configure', payload) as Promise<IpcResult>,
    configureCloud: (payload: { url: string; key?: string; label?: string }) => ipcRenderer.invoke('sync:configureCloud', payload) as Promise<IpcResult>,
    setProvider: (name: 'github' | 'supabase') => ipcRenderer.invoke('sync:setProvider', name) as Promise<IpcResult>,
    run:        () => ipcRenderer.invoke('sync:run') as Promise<IpcResult>,
    disconnect: (which?: 'github' | 'cloud') => ipcRenderer.invoke('sync:disconnect', which) as Promise<IpcResult>,
    exportEvents:  () => ipcRenderer.invoke('sync:exportEvents') as Promise<IpcResult>,
    markExported:  (ids: string[]) => ipcRenderer.invoke('sync:markExported', ids) as Promise<IpcResult>,
    importEvents:  (content: string) => ipcRenderer.invoke('sync:importEvents', content) as Promise<IpcResult>,
  },
  app: {
    approveExit: () => ipcRenderer.invoke('app:approveExit') as Promise<IpcResult>,
    lockState:   () => ipcRenderer.invoke('app:lockState') as Promise<IpcResult>,
    setKiosk:    (on: boolean) => ipcRenderer.invoke('app:setKiosk', on) as Promise<IpcResult>,
    onExitRequested: (cb: () => void) => {
      const h = () => cb();
      ipcRenderer.on('app:exit-requested', h);
      return () => ipcRenderer.removeListener('app:exit-requested', h);
    },
  },
  customers: {
    list:    (search?: string) => ipcRenderer.invoke('customers:list', search) as Promise<IpcResult>,
    create:  (payload: any) => ipcRenderer.invoke('customers:create', payload) as Promise<IpcResult>,
    update:  (id: string, patch: any) => ipcRenderer.invoke('customers:update', id, patch) as Promise<IpcResult>,
    delete:  (id: string) => ipcRenderer.invoke('customers:delete', id) as Promise<IpcResult>,
    history: (id: string, limit?: number) => ipcRenderer.invoke('customers:history', id, limit) as Promise<IpcResult>,
  },
  suppliers: {
    list:    (search?: string) => ipcRenderer.invoke('suppliers:list', search) as Promise<IpcResult>,
    create:  (payload: any) => ipcRenderer.invoke('suppliers:create', payload) as Promise<IpcResult>,
    update:  (id: string, patch: any) => ipcRenderer.invoke('suppliers:update', id, patch) as Promise<IpcResult>,
    delete:  (id: string) => ipcRenderer.invoke('suppliers:delete', id) as Promise<IpcResult>,
    history: (id: string, limit?: number) => ipcRenderer.invoke('suppliers:history', id, limit) as Promise<IpcResult>,
  },
  batches: {
    list:     (productId: string) => ipcRenderer.invoke('batches:list', productId) as Promise<IpcResult>,
    expiring: (days?: number) => ipcRenderer.invoke('batches:expiring', days) as Promise<IpcResult>,
    receive:  (payload: { product_id: string; qty: number; expiry?: string; batch_no?: string; cost_price?: number; supplier?: string; created_by?: string }) => ipcRenderer.invoke('batches:receive', payload) as Promise<IpcResult>,
    adjust:   (batchId: string, newQty: number, reason?: string, userId?: string) => ipcRenderer.invoke('batches:adjust', batchId, newQty, reason, userId) as Promise<IpcResult>,
  },
  pos: {
    hold:        (payload: { label?: string; cart: any[]; total?: number; cashier_id?: string }) => ipcRenderer.invoke('pos:hold', payload) as Promise<IpcResult>,
    heldList:    () => ipcRenderer.invoke('pos:heldList') as Promise<IpcResult>,
    recall:      (id: string) => ipcRenderer.invoke('pos:recall', id) as Promise<IpcResult>,
    discardHeld: (id: string) => ipcRenderer.invoke('pos:discardHeld', id) as Promise<IpcResult>,
    void:        (saleId: string, reason?: string, userId?: string) => ipcRenderer.invoke('pos:void', saleId, reason, userId) as Promise<IpcResult>,
  },
  reports: {
    lowStock:        (threshold?: number) => ipcRenderer.invoke('reports:lowStock', threshold) as Promise<IpcResult>,
    nearExpiry:      (days?: number) => ipcRenderer.invoke('reports:nearExpiry', days) as Promise<IpcResult>,
    salesTrend:      (range?: string, from?: string, to?: string) => ipcRenderer.invoke('reports:salesTrend', range, from, to) as Promise<IpcResult>,
    salesSummary:    (range?: string, from?: string, to?: string) => ipcRenderer.invoke('reports:salesSummary', range, from, to) as Promise<IpcResult>,
    salesDetail:     (range?: string, from?: string, to?: string) => ipcRenderer.invoke('reports:salesDetail', range, from, to) as Promise<IpcResult>,
    topProducts:     (range?: string, from?: string, to?: string) => ipcRenderer.invoke('reports:topProducts', range, from, to) as Promise<IpcResult>,
    stockMovements:  (productId?: string) => ipcRenderer.invoke('reports:stockMovements', productId) as Promise<IpcResult>,
    inventoryValue:  () => ipcRenderer.invoke('reports:inventoryValue') as Promise<IpcResult>,
  },
  settings: {
    get:  (key: string) => ipcRenderer.invoke('settings:get', key) as Promise<IpcResult>,
    set:  (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value) as Promise<IpcResult>,
    list: () => ipcRenderer.invoke('settings:list') as Promise<IpcResult>,
  },
  admin: {
    resetAllSales:        () => ipcRenderer.invoke('admin:resetAllSales') as Promise<IpcResult>,
    seedCommonProductsLK: () => ipcRenderer.invoke('admin:seedCommonProductsLK') as Promise<IpcResult>,
    resetLocalDb:         () => ipcRenderer.invoke('admin:resetLocalDb') as Promise<IpcResult>,
    backupDb:             () => ipcRenderer.invoke('admin:backupDb') as Promise<IpcResult>,
    restoreDb:            () => ipcRenderer.invoke('admin:restoreDb') as Promise<IpcResult>,
  },
  util: {
    exportCSV:    (suggested: string, data: string) => ipcRenderer.invoke('util:exportCSV', suggested, data) as Promise<boolean>,
    printHTML:    (html: string) => ipcRenderer.invoke('util:printHTML', html) as Promise<{ ok: boolean; error?: string; message?: string }>,
    listPrinters: () => ipcRenderer.invoke('util:listPrinters') as Promise<Array<{ name:string; displayName?:string; isDefault?:boolean }>>,
    restartApp:   () => ipcRenderer.invoke('util:restartApp') as Promise<boolean>,
    saveReceiptPDF: (html: string, filename: string) => ipcRenderer.invoke('util:saveReceiptPDF', html, filename) as Promise<{ ok: boolean; data?: { path: string }; error?: string; message?: string }>,
  },
  dev: { dbStatus: () => ipcRenderer.invoke('dev:dbStatus') as Promise<any> },
};

contextBridge.exposeInMainWorld('api', api);

declare global { interface Window { api: typeof api } }
