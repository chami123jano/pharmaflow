// Lightweight fallback using sqlite3 (async) if better-sqlite3 native build fails.
// Only minimal methods used by current code are implemented.
import log from '../log.js';

export interface FallbackDB {
  run(sql: string, params?: any[]): Promise<void>;
  get<T=any>(sql: string, params?: any[]): Promise<T | undefined>;
  all<T=any>(sql: string, params?: any[]): Promise<T[]>;
  prepare(sql: string): { run: (...p:any[])=>Promise<void>; get: (...p:any[])=>Promise<any>; all: (...p:any[])=>Promise<any[]> };
}

export async function createFallbackDb(file: string): Promise<FallbackDB> {
  const sqlite3 = await import('sqlite3');
  const db = new sqlite3.Database(file);
  log.warn('[DB] Using fallback sqlite3 adapter (performance reduced)');
  function wrap<T>(fn: Function, sql: string, params: any[] = []): Promise<T> {
    return new Promise((resolve, reject) => {
      try {
        fn.call(db, sql, params, function(this: any, err: any, rows: any) {
          if (err) return reject(err);
          resolve(rows as T);
        });
      } catch (e) { reject(e); }
    });
  }
  return {
    async run(sql, params:any[] = []) { await wrap<void>(db.run, sql, params); },
    async get(sql, params:any[] = []) { return await wrap<any>(db.get, sql, params); },
    async all(sql, params:any[] = []) { return await wrap<any[]>(db.all, sql, params); },
    prepare(sql: string) {
      return {
        run: async (...p:any[]) => { await wrap<void>(db.run, sql, p); },
        get: async (...p:any[]) => await wrap<any>(db.get, sql, p),
        all: async (...p:any[]) => await wrap<any[]>(db.all, sql, p),
      };
    }
  };
}

