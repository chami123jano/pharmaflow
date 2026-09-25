export {};

declare global {
  interface Window {
    api: {
      auth: {
        login: (email: string, password: string) => Promise<{ ok: boolean; [k: string]: any }>
      }
      products: {
        list: () => Promise<{ ok: boolean; data?: any[]; error?: string }>
        get: (id: string) => Promise<{ ok: boolean; data?: any; error?: string }>
        create: (payload: any) => Promise<{ ok: boolean; data?: any; error?: string }>
        update: (id: string, patch: any) => Promise<{ ok: boolean; error?: string }>
        delete: (id: string) => Promise<{ ok: boolean; error?: string }>
        adjustStock: (id: string, delta: number) => Promise<{ ok: boolean; stock?: number; error?: string }>
        generateSku: (payload?: { name?: string; category?: string }) => Promise<{ ok: boolean; data?: { sku: string }; error?: string }>
      }
      sales: {
        list: () => Promise<{ ok: boolean; data?: any[]; error?: string }>
        create: (payload: any) => Promise<{ ok: boolean; data?: any; error?: string }>
        summaryToday: () => Promise<{ ok: boolean; data?: any; error?: string }>
      }
      reports: {
        lowStock: () => Promise<{ ok: boolean; data?: any[]; error?: string }>
        nearExpiry: () => Promise<{ ok: boolean; data?: any[]; error?: string }>
        salesTrend: () => Promise<{ ok: boolean; data?: any[]; error?: string }>
      }
      settings: {
        get: (key: string) => Promise<{ ok: boolean; data?: string; error?: string }>
        set: (key: string, value: string) => Promise<{ ok: boolean; error?: string }>
        list: () => Promise<{ ok: boolean; data?: Array<{ key: string; value: string }>; error?: string }>
      }
      util: {
        exportCSV: (suggested: string, data: string) => Promise<boolean>
      }
    }
  }
}
